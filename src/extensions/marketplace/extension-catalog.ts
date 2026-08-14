import { getServiceUrls } from "@/config/services";

const CDN_BASE_URL = getServiceUrls().extensionsCdnBaseUrl;
const USE_LOCAL_SOURCES = import.meta.env.VITE_EXTENSION_MARKETPLACE_LOCAL === "true";

function withCacheBuster(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

const CATALOG_SOURCES =
  import.meta.env.DEV && USE_LOCAL_SOURCES
    ? [
        "http://localhost:3000/api/extensions/manifests",
        "http://localhost:3001/manifests.json",
        withCacheBuster(`${CDN_BASE_URL}/manifests.json`),
      ]
    : [withCacheBuster(`${CDN_BASE_URL}/manifests.json`)];

export async function fetchFirstAvailableExtensionCatalog<T>(
  urls: string[],
  fetcher: typeof fetch = fetch,
): Promise<Record<string, T>> {
  const errors: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetcher(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return (await response.json()) as Record<string, T>;
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Failed to load extension catalog. ${errors.join("; ")}`);
}

let catalogPromise: Promise<Record<string, unknown>> | null = null;

export function loadExtensionCatalog<T>(options: { fresh?: boolean } = {}) {
  if (!catalogPromise || options.fresh) {
    catalogPromise = fetchFirstAvailableExtensionCatalog<unknown>(CATALOG_SOURCES);
  }

  return catalogPromise as Promise<Record<string, T>>;
}
