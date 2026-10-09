import type { HeaderList } from "../types/previews.types";

/**
 * The frames a local preview's tunnel exchanges with the athas-cloud Worker (the Worker's
 * `cloud/src/preview-protocol.ts` is the other side). Every frame is a binary message: a
 * big-endian u32 header length, the header as UTF-8 JSON, then the body bytes. Plain text
 * `ping` is answered with `pong`.
 */
export type TunnelRequestFrame = {
  type: "request";
  id: string;
  method: string;
  path: string;
  headers: HeaderList;
};

export type ServerFrame =
  | { type: "welcome"; preview: string; expiresAt: string }
  | TunnelRequestFrame
  | { type: "cancel"; id: string }
  | { type: "renewed"; expiresAt: string }
  | { type: "notice"; message: string };

export type DesktopFrame =
  | { type: "response"; id: string; status: number; headers: HeaderList }
  | { type: "body"; id: string }
  | { type: "end"; id: string }
  | { type: "error"; id: string; message: string }
  | { type: "renew"; token: string };

/** The Worker replaced this tunnel with a newer connection for the same preview. */
export const TUNNEL_REPLACED_CLOSE_CODE = 4000;
/** The tunnel's token expired; connect again with a new one. */
export const TUNNEL_TOKEN_EXPIRED_CLOSE_CODE = 4001;
/** The preview was stopped or expired. */
export const PREVIEW_ENDED_CLOSE_CODE = 4003;

const MAX_HEADER_BYTES = 64 * 1024;

export function encodeFrame(header: DesktopFrame | ServerFrame, payload?: Uint8Array) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const frame = new Uint8Array(4 + json.byteLength + (payload?.byteLength ?? 0));
  new DataView(frame.buffer).setUint32(0, json.byteLength);
  frame.set(json, 4);
  if (payload) frame.set(payload, 4 + json.byteLength);
  return frame;
}

function isHeaderList(value: unknown): value is HeaderList {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string",
    )
  );
}

/** A frame from the Worker with its payload, or null when it is malformed or unknown. */
export function parseServerFrame(
  data: ArrayBuffer | Uint8Array,
): { frame: ServerFrame; payload: Uint8Array } | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 4) return null;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (length > MAX_HEADER_BYTES || 4 + length > bytes.byteLength) return null;
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)));
  } catch {
    return null;
  }
  if (!header || typeof header !== "object") return null;
  const payload = bytes.subarray(4 + length);
  switch (header.type) {
    case "welcome":
      return typeof header.preview === "string" && typeof header.expiresAt === "string"
        ? {
            frame: { type: "welcome", preview: header.preview, expiresAt: header.expiresAt },
            payload,
          }
        : null;
    case "request":
      return typeof header.id === "string" &&
        typeof header.method === "string" &&
        typeof header.path === "string" &&
        isHeaderList(header.headers)
        ? {
            frame: {
              type: "request",
              id: header.id,
              method: header.method,
              path: header.path,
              headers: header.headers,
            },
            payload,
          }
        : null;
    case "cancel":
      return typeof header.id === "string"
        ? { frame: { type: "cancel", id: header.id }, payload }
        : null;
    case "renewed":
      return typeof header.expiresAt === "string"
        ? { frame: { type: "renewed", expiresAt: header.expiresAt }, payload }
        : null;
    case "notice":
      return typeof header.message === "string"
        ? { frame: { type: "notice", message: header.message }, payload }
        : null;
    default:
      return null;
  }
}
