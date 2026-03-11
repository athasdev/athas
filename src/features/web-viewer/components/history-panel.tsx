import { Clock, Globe, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryEntry } from "../types";
import { useWebViewerStore } from "../stores/web-viewer-store";
import { extractHostname } from "../utils/url";

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (url: string) => void;
}

function groupByDate(entries: HistoryEntry[]): { label: string; entries: HistoryEntry[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const lastWeek = today - 7 * 86400000;

  const groups: Record<string, HistoryEntry[]> = {
    Today: [],
    Yesterday: [],
    "Last 7 days": [],
    Older: [],
  };

  for (const entry of entries) {
    if (entry.timestamp >= today) {
      groups["Today"].push(entry);
    } else if (entry.timestamp >= yesterday) {
      groups["Yesterday"].push(entry);
    } else if (entry.timestamp >= lastWeek) {
      groups["Last 7 days"].push(entry);
    } else {
      groups["Older"].push(entry);
    }
  }

  return Object.entries(groups)
    .filter(([, entries]) => entries.length > 0)
    .map(([label, entries]) => ({ label, entries }));
}

export function HistoryPanel({ isOpen, onClose, onNavigate }: HistoryPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const history = useWebViewerStore.use.history();
  const { clearHistory, removeHistoryEntry } = useWebViewerStore.use.actions();

  const filteredHistory = searchQuery
    ? history.filter(
        (e) =>
          e.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : history;

  const sortedHistory = [...filteredHistory].reverse();
  const dateGroups = groupByDate(sortedHistory);

  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
    } else {
      setSearchQuery("");
      setShowClearConfirm(false);
    }
  }, [isOpen]);

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, handleClickOutside]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleNavigate = (url: string) => {
    onNavigate(url);
    onClose();
  };

  const handleClear = () => {
    if (showClearConfirm) {
      clearHistory();
      setShowClearConfirm(false);
    } else {
      setShowClearConfirm(true);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "numeric",
    }).format(timestamp);
  };

  return (
    <div
      ref={panelRef}
      className="absolute top-full right-0 z-50 mt-1 w-80 overflow-hidden rounded-lg border border-border bg-primary-bg shadow-lg"
      role="dialog"
      aria-label="Browsing history"
    >
      <div className="flex items-center gap-2 border-border border-b p-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2 -translate-y-1/2 text-text-lighter" size={12} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search history..."
            className="h-7 w-full rounded border border-border bg-secondary-bg pl-7 pr-2 text-xs text-text placeholder:text-text-lighter focus:border-accent focus:outline-none"
            aria-label="Search browsing history"
          />
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="flex h-7 items-center gap-1 rounded px-2 text-xs text-text-lighter transition-colors hover:bg-hover hover:text-warning"
          title={showClearConfirm ? "Click again to confirm" : "Clear all history"}
          aria-label={showClearConfirm ? "Confirm clear history" : "Clear all history"}
        >
          <Trash2 size={12} />
          {showClearConfirm ? "Confirm?" : "Clear"}
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {dateGroups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-text-lighter">
            <Clock size={24} />
            <span className="text-xs">No browsing history</span>
          </div>
        ) : (
          dateGroups.map((group) => (
            <div key={group.label}>
              <div className="sticky top-0 bg-secondary-bg px-3 py-1.5 text-[10px] font-medium text-text-lighter">
                {group.label}
              </div>
              {group.entries.map((entry) => (
                <div
                  key={`${entry.url}-${entry.timestamp}`}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-hover"
                >
                  <button
                    type="button"
                    onClick={() => handleNavigate(entry.url)}
                    className="flex min-w-0 flex-1 items-center gap-2"
                    aria-label={`Navigate to ${entry.title}`}
                  >
                    <img
                      src={entry.favicon}
                      alt=""
                      className="h-4 w-4 shrink-0 rounded"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                    <Globe size={16} className="hidden shrink-0 text-text-lighter" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-text">{entry.title}</div>
                      <div className="truncate text-[10px] text-text-lighter">
                        {extractHostname(entry.url)}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] text-text-lighter">
                      {formatTime(entry.timestamp)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeHistoryEntry(entry.url, entry.timestamp)}
                    className="hidden shrink-0 rounded p-0.5 text-text-lighter transition-colors hover:text-warning group-hover:flex"
                    title="Remove from history"
                    aria-label="Remove from history"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
