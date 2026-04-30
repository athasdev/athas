import { CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface ChatActivityLineProps {
  icon: ReactNode;
  title: string;
  detail?: string | null;
  state?: "running" | "success" | "error" | "info";
  children?: ReactNode;
}

export function ChatActivityLine({
  icon,
  title,
  detail,
  state = "info",
  children,
}: ChatActivityLineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canExpand = Boolean(children);
  const summary = detail ? `${title}: ${detail}` : title;

  return (
    <div className="select-none">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => canExpand && setIsExpanded((current) => !current)}
        disabled={!canExpand}
        className={cn(
          "ui-font ui-text-xs h-6 w-full justify-start gap-1.5 rounded-md px-0 text-text-lighter/62 hover:bg-transparent hover:text-text-lighter/85 disabled:cursor-default disabled:opacity-100",
          state === "error" && "text-error/75 hover:text-error/90",
          state === "success" && "text-success/70 hover:text-success/85",
          state === "running" && "text-text-lighter/72",
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center opacity-80">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        {canExpand ? (
          <CaretRight
            size={12}
            className={cn("shrink-0 opacity-45 transition-transform", isExpanded && "rotate-90")}
          />
        ) : null}
      </Button>
      {canExpand && isExpanded ? (
        <div className="ui-text-xs editor-font mt-1 ml-5 max-h-64 overflow-auto whitespace-pre-wrap text-text-lighter/58">
          {children}
        </div>
      ) : null}
    </div>
  );
}
