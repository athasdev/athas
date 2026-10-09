import type { HeaderList } from "../types/previews.types";
import type { DesktopFrame, TunnelRequestFrame } from "./preview-protocol";

/** The Worker cuts responses off past this, so the app stops reading there too. */
export const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
/** Body bytes per frame; the Worker accepts up to 1 MB. */
export const BODY_CHUNK_BYTES = 256 * 1024;
/** How long the local server may take to start answering, and between body chunks. */
export const LOCAL_RESPONSE_TIMEOUT_MS = 30_000;

/** `fetch` with the Tauri HTTP plugin's client options. */
export type ProxyFetch = (
  url: string,
  init: RequestInit & { maxRedirections?: number; connectTimeout?: number },
) => Promise<Response>;

export type ProxySend = (frame: DesktopFrame, payload?: Uint8Array) => void;

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export function isValidPort(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

/**
 * The URL a visitor's path maps to on this computer: always `http://localhost:<port>`, never
 * another host, whatever the path tries (`//host`, `\\host`, absolute URLs).
 */
export function localTargetUrl(port: number, path: string): string | null {
  if (!isValidPort(port)) return null;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  const base = `http://localhost:${port}`;
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    return null;
  }
  return url.origin === base ? url.toString() : null;
}

/**
 * The headers the local server gets: the visitor's, minus hop-by-hop headers, asking for an
 * unencoded body. An empty Origin keeps the HTTP plugin from adding the app's own origin when
 * the visitor sent none.
 */
export function headersForLocalServer(headers: HeaderList): HeaderList {
  const list: HeaderList = [];
  let hasOrigin = false;
  for (const [rawName, value] of headers) {
    const name = rawName.toLowerCase();
    if (HOP_BY_HOP.has(name) || name === "accept-encoding") continue;
    if (name === "origin") hasOrigin = true;
    list.push([name, value]);
  }
  list.push(["accept-encoding", "identity"]);
  if (!hasOrigin) list.push(["origin", ""]);
  return list;
}

/**
 * The headers sent back to the visitor. Redirects to the local server itself become paths, so
 * the visitor stays on the preview instead of being sent to their own localhost.
 */
export function headersForVisitor(response: Response, port: number): HeaderList {
  const list: HeaderList = [];
  response.headers.forEach((value, rawName) => {
    const name = rawName.toLowerCase();
    if (HOP_BY_HOP.has(name) || name === "set-cookie") return;
    list.push([name, name === "location" ? rewriteLocation(value, port) : value]);
  });
  for (const cookie of response.headers.getSetCookie?.() ?? []) list.push(["set-cookie", cookie]);
  return list;
}

export function rewriteLocation(location: string, port: number) {
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
    for (const scheme of ["http://", "https://"]) {
      const prefix = `${scheme}${host}`;
      if (location === prefix) return "/";
      if (
        location.startsWith(`${prefix}/`) ||
        location.startsWith(`${prefix}?`) ||
        location.startsWith(`${prefix}#`)
      )
        return location.slice(prefix.length).replace(/^(?=[?#])/, "/");
    }
  }
  return location;
}

export type ProxyResult = { status: number; bytes: number } | { error: string };

/**
 * Answers one visitor request from the local server on `port`: sends the response status and
 * headers, the body in chunks and then `end`, or `error` when the server cannot be reached,
 * answers too slowly or sends more than a preview may carry. Redirects are never followed.
 * When `signal` aborts (the visitor went away) nothing more is sent.
 */
export async function proxyLocalRequest(options: {
  request: TunnelRequestFrame;
  body: Uint8Array<ArrayBuffer>;
  port: number;
  fetch: ProxyFetch;
  send: ProxySend;
  signal?: AbortSignal;
}): Promise<ProxyResult> {
  const { request, port, send } = options;
  const fail = (message: string): ProxyResult => {
    if (!options.signal?.aborted) send({ type: "error", id: request.id, message });
    return { error: message };
  };

  const url = localTargetUrl(port, request.path);
  if (!url) return fail("The request path is not allowed.");
  const method = request.method.toUpperCase();
  if (!METHODS.has(method)) return fail("The request method is not allowed.");

  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(abort, LOCAL_RESPONSE_TIMEOUT_MS);
  };

  try {
    arm();
    let response: Response;
    try {
      response = await options.fetch(url, {
        method,
        headers: headersForLocalServer(request.headers),
        body:
          method === "GET" || method === "HEAD" || options.body.byteLength === 0
            ? undefined
            : options.body,
        maxRedirections: 0,
        connectTimeout: 10_000,
        signal: controller.signal,
      });
    } catch {
      if (options.signal?.aborted) return { error: "Cancelled." };
      return fail(
        controller.signal.aborted
          ? `The server on port ${port} did not answer in time.`
          : `Nothing answered on localhost:${port}. Is the dev server running?`,
      );
    }
    if (options.signal?.aborted) {
      await response.body?.cancel().catch(() => {});
      return { error: "Cancelled." };
    }

    send({
      type: "response",
      id: request.id,
      status: response.status,
      headers: headersForVisitor(response, port),
    });

    let bytes = 0;
    if (response.body && method !== "HEAD") {
      const reader = response.body.getReader();
      try {
        for (;;) {
          arm();
          const { done, value } = await reader.read();
          if (done) break;
          if (options.signal?.aborted) {
            await reader.cancel().catch(() => {});
            return { error: "Cancelled." };
          }
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) {
            await reader.cancel().catch(() => {});
            return fail("The response is larger than a preview may send.");
          }
          for (let offset = 0; offset < value.byteLength; offset += BODY_CHUNK_BYTES) {
            send(
              { type: "body", id: request.id },
              value.subarray(offset, offset + BODY_CHUNK_BYTES),
            );
          }
        }
      } catch {
        if (options.signal?.aborted) return { error: "Cancelled." };
        return fail(`The server on port ${port} stopped sending its response.`);
      }
    }
    send({ type: "end", id: request.id });
    return { status: response.status, bytes };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
