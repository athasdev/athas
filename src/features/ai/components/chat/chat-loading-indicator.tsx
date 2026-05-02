import type { CSSProperties } from "react";
import { cn } from "@/utils/cn";

const GRID_CELLS = Array.from({ length: 15 }, (_, index) => index);

interface ChatLoadingIndicatorProps {
  label?: string;
  showLabel?: boolean;
  compact?: boolean;
  className?: string;
}

export function ChatLoadingIndicator({
  label = "loading",
  showLabel = false,
  compact = false,
  className,
}: ChatLoadingIndicatorProps) {
  return (
    <div
      className={cn(
        "editor-font inline-flex items-center gap-2 text-text-lighter",
        compact ? "ui-text-xs" : "ui-text-sm",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span
        className={cn(
          "ai-chat-loading-grid",
          compact ? "ai-chat-loading-grid-compact" : "ai-chat-loading-grid-default",
        )}
        aria-hidden="true"
      >
        {GRID_CELLS.map((index) => (
          <span
            key={index}
            className="ai-chat-loading-cell"
            style={{ "--ai-loading-delay": `${index * 42}ms` } as CSSProperties}
          />
        ))}
      </span>
      {showLabel ? (
        <span className="inline-flex items-center gap-1">
          <span className="text-accent/80">&gt;</span>
          <span>{label}</span>
          <span className="ai-chat-loading-cursor" aria-hidden="true" />
        </span>
      ) : null}
    </div>
  );
}
