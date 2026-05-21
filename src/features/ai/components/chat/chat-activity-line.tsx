import { CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/utils/cn";

interface ChatActivityLineProps {
  icon?: ReactNode;
  title: string;
  detail?: string | null;
  state?: "running" | "success" | "error" | "info";
  actions?: ReactNode;
  children?: ReactNode;
}

export function ChatActivityLine({
  icon,
  title,
  detail,
  actions,
  children,
}: ChatActivityLineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canExpand = Boolean(children);
  const summary = detail ? `${title}: ${detail}` : title;
  const contentClassName =
    "ui-font ui-text-xs flex h-6 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md px-0 text-text-lighter/55";

  return (
    <div className="select-none">
      <div className="flex min-w-0 items-center gap-1">
        {canExpand ? (
          <button
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
            className={cn(
              contentClassName,
              "hover:bg-transparent hover:text-text-lighter/75 focus-visible:outline-none",
            )}
            aria-expanded={isExpanded}
          >
            {icon ? (
              <span className="flex size-4 shrink-0 items-center justify-center opacity-60">
                {icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
            <CaretRight
              size={12}
              className={cn("shrink-0 opacity-35 transition-transform", isExpanded && "rotate-90")}
            />
          </button>
        ) : (
          <div className={contentClassName}>
            {icon ? (
              <span className="flex size-4 shrink-0 items-center justify-center opacity-60">
                {icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
          </div>
        )}
        {actions ? <span className="shrink-0">{actions}</span> : null}
      </div>
      {canExpand && isExpanded ? (
        <div className="ui-text-xs editor-font mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-text-lighter/45">
          {children}
        </div>
      ) : null}
    </div>
  );
}
