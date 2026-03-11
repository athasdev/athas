export const DEFAULT_DEV_LINKS = [
  { label: "localhost:3000", url: "http://localhost:3000" },
  { label: "localhost:5173", url: "http://localhost:5173" },
  { label: "localhost:8080", url: "http://localhost:8080" },
  { label: "localhost:4321", url: "http://localhost:4321" },
] as const;

export const SEARCH_ENGINES = {
  google: { name: "Google", urlTemplate: "https://www.google.com/search?q={query}" },
  duckduckgo: { name: "DuckDuckGo", urlTemplate: "https://duckduckgo.com/?q={query}" },
  bing: { name: "Bing", urlTemplate: "https://www.bing.com/search?q={query}" },
} as const;

export const MAX_HISTORY_ENTRIES = 1000;
export const MAX_RECENT_SITES = 8;
