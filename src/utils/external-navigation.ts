const EXTERNAL_BROWSER_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const EXTERNAL_WEB_PROTOCOLS = new Set(["http:", "https:"]);

function getDefaultBaseUrl(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.href;
}

export function resolveExternalBrowserUrl(
  value: string | URL | null | undefined,
  baseUrl = getDefaultBaseUrl(),
): string | null {
  if (value instanceof URL) {
    return EXTERNAL_BROWSER_PROTOCOLS.has(value.protocol) ? value.toString() : null;
  }

  const trimmedValue = value?.trim();
  if (!trimmedValue) return null;

  if (trimmedValue.startsWith("//")) {
    let protocol = "https:";
    if (baseUrl) {
      try {
        const baseProtocol = new URL(baseUrl).protocol;
        protocol = EXTERNAL_WEB_PROTOCOLS.has(baseProtocol) ? baseProtocol : protocol;
      } catch {
        protocol = "https:";
      }
    }
    return `${protocol}${trimmedValue}`;
  }

  if (!URL_SCHEME_PATTERN.test(trimmedValue)) return null;

  try {
    const url = new URL(trimmedValue);
    return EXTERNAL_BROWSER_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function openExternalBrowserUrl(value: string | URL): Promise<boolean> {
  const url = resolveExternalBrowserUrl(value);
  if (!url) return false;

  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
  return true;
}
