import { type ReactNode, useId } from "react";
import { Card } from "@/ui/card";
import { SidebarSectionHeader, SidebarSectionLabel } from "@/ui/sidebar";
import { useSessionPanelStore } from "../stores/session-panel.store";
import type { SessionBoxId } from "../types/session-panel.types";

interface SessionBoxProps {
  id: SessionBoxId;
  title: string;
  /** A short reading beside the title, such as `24%` or the diff size; it stays when folded. */
  summary?: ReactNode;
  /** Controls at the end of the header, such as opening the box's tool. */
  action?: ReactNode;
  /** `column`: folds to its header and remembers it; `popover`: always open, opened from the rail. */
  placement: "column" | "popover";
  children: ReactNode;
}

/** One box beside an agent session: a small card with a header that folds it away. */
export function SessionBox({ id, title, summary, action, placement, children }: SessionBoxProps) {
  const collapsed = useSessionPanelStore((state) => Boolean(state.collapsedBoxes[id]));
  const { toggleBoxCollapsed } = useSessionPanelStore.use.actions();
  const contentId = useId();
  const trailing =
    summary || action ? (
      <span className="flex min-w-0 items-center gap-chrome-tight">
        {summary ? (
          <span className="min-w-0 truncate tabular-nums text-subtle-foreground ui-text-sm">
            {summary}
          </span>
        ) : null}
        {action}
      </span>
    ) : null;

  if (placement === "popover") {
    return (
      <section data-slot="session-box" data-box={id} className="flex min-w-0 flex-col gap-1">
        <SidebarSectionLabel trailing={trailing}>{title}</SidebarSectionLabel>
        {children}
      </section>
    );
  }

  const expanded = !collapsed;
  return (
    <Card
      layout="flush"
      data-slot="session-box"
      data-box={id}
      data-collapsed={collapsed || undefined}
      className="shrink-0"
    >
      <div className="flex min-w-0 flex-col p-1">
        <SidebarSectionHeader
          expanded={expanded}
          aria-controls={contentId}
          onToggle={() => toggleBoxCollapsed(id)}
          action={trailing}
        >
          {title}
        </SidebarSectionHeader>
        {expanded ? (
          <div id={contentId} className="flex min-w-0 flex-col pt-0.5">
            {children}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
