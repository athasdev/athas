import { CaretRightIcon as CaretRight } from "@/ui/icons";
import type { ReactNode } from "react";
import { useState } from "react";
import { Marker, MarkerContent, MarkerIcon } from "@/ui/marker";
import { cn } from "@/utils/cn";

type ActivityState = "running" | "success" | "error" | "info";

const stateClassNames: Record<ActivityState, string> = {
  running: "text-accent",
  success: "text-success",
  error: "text-error",
  info: "text-text-lighter/60",
};

interface ChatActivityLineProps {
  icon?: ReactNode;
  title: string;
  detail?: string | null;
  state?: ActivityState;
  actions?: ReactNode;
  children?: ReactNode;
}

export function ChatActivityLine({
  icon,
  title,
  detail,
  state = "info",
  actions,
  children,
}: ChatActivityLineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canExpand = Boolean(children);
  const summary = detail ? `${title}: ${detail}` : title;

  return (
    <div data-ai-element="activity-marker" className="select-none">
      <div className="flex min-w-0 items-center gap-1">
        <Marker
          render={canExpand ? <button type="button" /> : undefined}
          role={state === "running" ? "status" : undefined}
          aria-expanded={canExpand ? isExpanded : undefined}
          onClick={canExpand ? () => setIsExpanded((current) => !current) : undefined}
          className="min-w-0 flex-1"
        >
          <MarkerIcon className={stateClassNames[state]}>
            {icon ?? <span className="size-1.5 rounded-full bg-current" />}
          </MarkerIcon>
          <MarkerContent className="flex flex-1 items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{summary}</span>
            {canExpand ? (
              <CaretRight
                className={cn(
                  "shrink-0 opacity-35 transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
            ) : null}
          </MarkerContent>
        </Marker>
        {actions ? <span className="shrink-0">{actions}</span> : null}
      </div>
      {canExpand && isExpanded ? (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap pl-6 font-mono ui-text-sm text-text-lighter/55">
          {children}
        </pre>
      ) : null}
    </div>
  );
}
