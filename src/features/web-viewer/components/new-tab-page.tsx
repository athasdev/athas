import { Globe, Search, Server } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import { DEFAULT_DEV_LINKS, SEARCH_ENGINES } from "../constants";
import { useWebViewerStore } from "../stores/web-viewer-store";
import { extractHostname } from "../utils/url";

interface NewTabPageProps {
  onNavigate: (url: string) => void;
}

export function NewTabPage({ onNavigate }: NewTabPageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchEngine = useWebViewerStore.use.searchEngine();
  const bookmarks = useWebViewerStore.use.bookmarks();
  const { getRecentSites } = useWebViewerStore.use.actions();

  const recentSites = getRecentSites(8);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    if (trimmed.match(/^https?:\/\//) || trimmed.includes(".") || trimmed.startsWith("localhost")) {
      onNavigate(trimmed);
      return;
    }

    const engine = SEARCH_ENGINES[searchEngine as keyof typeof SEARCH_ENGINES];
    const searchUrl = engine.urlTemplate.replace("{query}", encodeURIComponent(trimmed));
    onNavigate(searchUrl);
  };

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto bg-primary-bg pt-[15vh]">
      <div className="w-full max-w-2xl px-6">
        <form onSubmit={handleSearch} className="mb-10">
          <div className="relative">
            <Search className="absolute top-1/2 left-4 -translate-y-1/2 text-text-lighter" size={18} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search with ${SEARCH_ENGINES[searchEngine as keyof typeof SEARCH_ENGINES].name} or enter URL...`}
              className="h-12 w-full rounded-xl border border-border bg-secondary-bg pl-11 pr-4 text-sm text-text placeholder:text-text-lighter focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
              aria-label="Search or enter URL"
            />
          </div>
        </form>

        {recentSites.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-xs font-medium text-text-lighter">Recent Sites</h2>
            <div className="grid grid-cols-4 gap-3">
              {recentSites.map((site) => (
                <button
                  key={`${site.url}-${site.timestamp}`}
                  type="button"
                  onClick={() => onNavigate(site.url)}
                  className="flex flex-col items-center gap-2 rounded-lg border border-border bg-secondary-bg p-3 transition-colors hover:bg-hover"
                  aria-label={`Navigate to ${extractHostname(site.url)}`}
                >
                  <img
                    src={site.favicon}
                    alt=""
                    className="h-6 w-6 rounded"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      e.currentTarget.nextElementSibling?.classList.remove("hidden");
                    }}
                  />
                  <Globe size={24} className="hidden text-text-lighter" />
                  <span className="w-full truncate text-center text-xs text-text-light">
                    {extractHostname(site.url)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {bookmarks.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-xs font-medium text-text-lighter">Bookmarks</h2>
            <div className="flex flex-wrap gap-2">
              {bookmarks.map((bookmark) => (
                <button
                  key={bookmark.id}
                  type="button"
                  onClick={() => onNavigate(bookmark.url)}
                  className="flex items-center gap-2 rounded-lg border border-border bg-secondary-bg px-3 py-2 text-xs text-text-light transition-colors hover:bg-hover"
                  aria-label={`Navigate to ${bookmark.title}`}
                >
                  <img
                    src={bookmark.favicon}
                    alt=""
                    className="h-4 w-4 rounded"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                  <span className="max-w-[120px] truncate">{bookmark.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-xs font-medium text-text-lighter">Dev Servers</h2>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_DEV_LINKS.map((link) => (
              <button
                key={link.url}
                type="button"
                onClick={() => onNavigate(link.url)}
                className="flex items-center gap-2 rounded-lg border border-border bg-secondary-bg px-3 py-2 text-xs text-text-light transition-colors hover:bg-hover"
                aria-label={`Navigate to ${link.label}`}
              >
                <Server size={14} className="text-text-lighter" />
                <span>{link.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
