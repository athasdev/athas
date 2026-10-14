import { formatAcpTerminalText } from "@/features/ai/lib/acp-terminal-output";

const LOCAL_SERVER_URL =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[a-z0-9-]+\.localhost):(\d{2,5})(\/[^\s"'`<>()[\]{}\\]*)?/gi;

/**
 * Local server addresses a command printed, such as Vite's "Local: http://localhost:5173/",
 * normalized to localhost so the same server is found once. Addresses bound to every interface
 * (0.0.0.0) open on localhost.
 */
export function extractLocalServerUrls(text: string): string[] {
  const clean = formatAcpTerminalText(text);
  const urls: string[] = [];
  for (const match of clean.matchAll(LOCAL_SERVER_URL)) {
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    let url: URL;
    try {
      url = new URL(match[0].replace(/[.,;:!?]+$/, ""));
    } catch {
      continue;
    }
    if (url.hostname === "0.0.0.0" || url.hostname === "[::]" || url.hostname === "[::1]") {
      url.hostname = "localhost";
    }
    const normalized = url.pathname === "/" && !url.search ? `${url.origin}/` : url.toString();
    if (!urls.includes(normalized)) urls.push(normalized);
  }
  return urls;
}

/** The port of a local server address, or null when the address is not on this computer. */
export function getLocalServerPort(address: string): number | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname;
  const isLocal =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]";
  if (!isLocal) return null;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/** Every string inside a tool call's input or output, for scanning what a command printed. */
export function collectText(value: unknown, depth = 0): string {
  if (value === null || value === undefined || depth > 6) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => collectText(item, depth + 1)).join("\n");
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((item) => collectText(item, depth + 1))
      .join("\n");
  }
  return "";
}
