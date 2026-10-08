import { getServiceUrls } from "@/config/services";
import { queryClient } from "@/utils/query-client";

const CDN_BASE_URL = getServiceUrls().extensionsCdnBaseUrl;
const USE_LOCAL_SOURCES = import.meta.env.VITE_EXTENSION_MARKETPLACE_LOCAL === "true";
const LOCAL_CDN_BASE_URL = "http://localhost:14321";

export const EXTENSION_ASSET_BASE_URL =
  import.meta.env.DEV && USE_LOCAL_SOURCES ? LOCAL_CDN_BASE_URL : CDN_BASE_URL;

function withCacheBuster(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

function getCatalogSources() {
  return import.meta.env.DEV && USE_LOCAL_SOURCES
    ? [
        "http://localhost:3000/api/extensions/manifests",
        `${LOCAL_CDN_BASE_URL}/manifests.json`,
        withCacheBuster(`${CDN_BASE_URL}/manifests.json`),
      ]
    : [withCacheBuster(`${CDN_BASE_URL}/manifests.json`)];
}

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

  throw new Error(`Failed to load integration catalog. ${errors.join("; ")}`);
}

const CATALOG_QUERY_KEY = ["extensions", "catalog"] as const;

/**
 * The catalog is loaded once per session and shared by every reader; concurrent loads join one
 * request, including a `fresh` one. A failed load is not kept, so the next read tries again.
 */
export function loadExtensionCatalog<T>(options: { fresh?: boolean } = {}) {
  return queryClient.query({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: () => fetchFirstAvailableExtensionCatalog<unknown>(getCatalogSources()),
    staleTime: options.fresh ? 0 : Infinity,
    gcTime: Infinity,
    retry: false,
  }) as Promise<Record<string, T>>;
}
