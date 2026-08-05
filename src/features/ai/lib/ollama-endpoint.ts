export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const OLLAMA_CLOUD_BASE_URL = "https://ollama.com";

const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:\/\//i;

export function resolveOllamaBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = URL_SCHEME_PATTERN.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
      return null;
    }
    if (url.search || url.hash) {
      return null;
    }

    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function normalizeOllamaBaseUrl(value: string): string {
  return resolveOllamaBaseUrl(value) ?? DEFAULT_OLLAMA_BASE_URL;
}

export function isOllamaCloudUrl(value: string): boolean {
  const normalized = resolveOllamaBaseUrl(value);
  if (!normalized) return false;

  const { hostname } = new URL(normalized);
  return hostname === "ollama.com" || hostname.endsWith(".ollama.com");
}
