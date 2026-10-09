import { isValidPort } from "../services/preview-proxy";
import type { Preview } from "../types/previews.types";

/** The port typed into the share dialog, or null until it is a whole number from 1 to 65535. */
export function parsePortInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return isValidPort(port) ? port : null;
}

/** "localhost:5173 · 12 requests · until 18:30", or the sandbox port for a cloud agent. */
export function describePreview(preview: Preview, requests: number, locale?: string) {
  const source =
    preview.kind === "local" ? `localhost:${preview.port}` : `Cloud agent port ${preview.port}`;
  const count = `${requests} ${requests === 1 ? "request" : "requests"}`;
  const until = new Date(preview.expiresAt).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${source} · ${count} · until ${until}`;
}
