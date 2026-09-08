import { ClipboardTextIcon, CodeIcon, PlayIcon, TrashIcon, XIcon } from "@/ui/icons";
import { Button } from "@/ui/button";
import { formatSqlHistoryPreview } from "../lib/sql-history";
import { writeDatabaseClipboardText } from "../utils/clipboard";
import { cn } from "@/utils/cn";
import { databaseCardClassName } from "../utils/database-surface";

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
        <div className="px-2 py-1 font-sans ui-text-sm text-subtle-foreground uppercase">
          {title} ({queries.length})
        </div>
        <Button
          type="button"
          onClick={onClear}
          variant="ghost"
          iconOnly
          aria-label="Clear recent queries"
          tooltip="Clear recent queries"
        >
          <TrashIcon />
        </Button>
      </div>
      <div className={cn("overflow-y-auto pb-1", compact ? "max-h-32" : "max-h-56 px-1")}>
        {queries.map((query) => {
          const preview = formatSqlHistoryPreview(query);
          return (
            <div
              key={query}
              className="group mx-1 flex items-center gap-1 rounded-lg hover:bg-accent"
            >
              <Button
                type="button"
                onClick={() => onSelect(query)}
                variant="list"
                width="grow"
                align="start"
                truncate
                tooltip={query}
                aria-label={`Open query: ${preview}`}
              >
                <CodeIcon className="mr-1.5 shrink-0" />
                <span className="truncate">{preview}</span>
              </Button>
              {onRun && (
                <span className="inline-flex min-w-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRun(query);
                    }}
                    variant="ghost"
                    iconOnly
                    aria-label={`Run query from history: ${preview}`}
                    tooltip="Run query"
                  >
                    <PlayIcon />
                  </Button>
                </span>
              )}
              <span className="inline-flex min-w-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <Button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void writeDatabaseClipboardText(query);
                  }}
                  variant="ghost"
                  iconOnly
                  aria-label={`Copy query from history: ${preview}`}
                  tooltip="Copy query"
                >
                  <ClipboardTextIcon />
                </Button>
              </span>
              <span className="inline-flex min-w-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <Button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(query);
                  }}
                  variant="ghost"
                  iconOnly
                  aria-label={`Remove query from history: ${preview}`}
                  tooltip="Remove from history"
                >
                  <XIcon />
                </Button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
