import type { ReactNode } from "react";
import { useState } from "react";
import { Tool, ToolContent, ToolTrigger } from "@/features/ai/components/elements/tool";

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
  state = "info",
  actions,
  children,
}: ChatActivityLineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canExpand = Boolean(children);

  return (
    <Tool>
      <div className="flex min-w-0 items-center gap-1">
        <ToolTrigger
          icon={icon}
          title={title}
          detail={detail}
          state={state}
          expanded={isExpanded}
          canExpand={canExpand}
          onClick={() => setIsExpanded((current) => !current)}
        />
        {actions ? <span className="shrink-0">{actions}</span> : null}
      </div>
      {canExpand && isExpanded ? <ToolContent>{children}</ToolContent> : null}
    </Tool>
  );
}
