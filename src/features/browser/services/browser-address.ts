export const BLANK_PAGE_URL = "about:blank";

const SEARCH_URL = "https://www.google.com/search?q=";
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const LOCAL_HOST_PATTERN =
  /^(localhost|\[[0-9a-f:]+\]|(\d{1,3}\.){3}\d{1,3}|[\w-]+\.(localhost|local|test|internal))(:\d+)?([/?#]|$)/i;
const DOMAIN_PATTERN = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]|$)/i;

/**
 * Turns what the user typed into the address bar into a URL to load: a web address as typed, a
 * host without a scheme (`localhost:5173`, `athas.dev/docs`), or a web search for anything else.
 */
export function resolveBrowserAddress(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  if (value.startsWith(":") && /^:\d+/.test(value)) {
    return `http://localhost${value}`;
  }

  if (SCHEME_PATTERN.test(value) && !/^[^:]+:\d/.test(value)) {
    const scheme = value.slice(0, value.indexOf(":")).toLowerCase();
    if (scheme === "http" || scheme === "https") return value;
    if (value.toLowerCase() === BLANK_PAGE_URL) return BLANK_PAGE_URL;
    return `${SEARCH_URL}${encodeURIComponent(value)}`;
  }

  if (!/\s/.test(value)) {
    if (LOCAL_HOST_PATTERN.test(value)) return `http://${value}`;
    if (DOMAIN_PATTERN.test(value)) return `https://${value}`;
  }

  return `${SEARCH_URL}${encodeURIComponent(value)}`;
}

export function isBlankPage(url: string | undefined): boolean {
  return !url || url === BLANK_PAGE_URL;
}

/** The address as the address bar shows it while the user is not editing it. */
export function formatBrowserAddress(url: string): string {
  return isBlankPage(url) ? "" : url;
}

/** Name of a browser tab: the page title, or its host until the page has one. */
export function getBrowserTabName(url: string, title?: string): string {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) return trimmedTitle;
  if (isBlankPage(url)) return "New Tab";
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function isSecureAddress(url: string): boolean {
  return url.startsWith("https://");
}
