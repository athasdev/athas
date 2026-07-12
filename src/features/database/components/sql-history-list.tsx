import {
  ClipboardTextIcon as ClipboardText,
  CodeIcon as Code,
  PlayIcon as Play,
  TrashIcon as Trash,
  XIcon as X,
} from "@/ui/icons";
import { Button } from "@/ui/button";
import { formatSqlHistoryPreview } from "../lib/sql-history";
import { writeDatabaseClipboardText } from "../utils/clipboard";
import { cn } from "@/utils/cn";
import { databaseCardClassName } from "./database-surface";

interface SqlHistoryListProps {
  queries: string[];
  title?: string;
  compact?: boolean;
  onSelect: (query: string) => void;
  onRun?: (query: string) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
}

export default function SqlHistoryList({
  queries,
  title = "Recent",
  compact = false,
  onSelect,
  onRun,
  onRemove,
  onClear,
}: SqlHistoryListProps) {
  if (queries.length === 0) return null;

  return (
    <div className={cn(databaseCardClassName(), compact && "mx-2 mb-2")}>
      <div className="flex items-center justify-between p-2">
        <div className="px-2 py-1 ui-font ui-text-sm text-text-lighter uppercase">
          {title} ({queries.length})
        </div>
        <Button
          type="button"
          onClick={onClear}
          variant="ghost"
          compact
          className="text-text-lighter hover:text-text"
          aria-label="Clear recent queries"
          tooltip="Clear recent queries"
        >
          <Trash />
        </Button>
      </div>
      <div className={cn("overflow-y-auto pb-1", compact ? "max-h-32" : "max-h-56 px-1")}>
        {queries.map((query) => {
          const preview = formatSqlHistoryPreview(query);
          return (
            <div
              key={query}
              className="group mx-1 flex items-center gap-1 rounded-[var(--app-radius-menu-item)] hover:bg-hover"
            >
              <Button
                type="button"
                onClick={() => onSelect(query)}
                variant="ghost"
                compact
                className={cn(
                  "min-w-0 flex-1 justify-start truncate px-2.5 py-1.5 text-left",
                  "ui-text-sm",
                )}
                tooltip={query}
                aria-label={`Open query: ${preview}`}
              >
                <Code className="mr-1.5 shrink-0" />
                <span className="truncate">{preview}</span>
              </Button>
              {onRun && (
                <Button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRun(query);
                  }}
                  variant="ghost"
                  compact
                  className="shrink-0 text-text-lighter opacity-0 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Run query from history: ${preview}`}
                  tooltip="Run query"
                >
                  <Play />
                </Button>
              )}
              <Button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void writeDatabaseClipboardText(query);
                }}
                variant="ghost"
                compact
                className="shrink-0 text-text-lighter opacity-0 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Copy query from history: ${preview}`}
                tooltip="Copy query"
              >
                <ClipboardText />
              </Button>
              <Button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(query);
                }}
                variant="ghost"
                compact
                className="shrink-0 text-text-lighter opacity-0 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Remove query from history: ${preview}`}
                tooltip="Remove from history"
              >
                <X />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
