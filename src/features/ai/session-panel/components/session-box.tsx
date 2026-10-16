import { type ReactNode, useId } from "react";
import { SidebarSectionHeader } from "@/ui/sidebar";
import { useSessionPanelStore } from "../stores/session-panel.store";
import type { SessionBoxId } from "../types/session-panel.types";

interface SessionBoxProps {
  id: SessionBoxId;
  title: string;
  /** A short reading beside the title, such as `24%` or the diff size; it stays when folded. */
  summary?: ReactNode;
  /** Controls at the end of the header, such as opening the box's tool. */
  action?: ReactNode;
  children: ReactNode;
}

/** One box of a session's details: a section with a header that folds it away, remembered. */
export function SessionBox({ id, title, summary, action, children }: SessionBoxProps) {
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

  const expanded = !collapsed;
  return (
    <section
      data-slot="session-box"
      data-box={id}
      data-collapsed={collapsed || undefined}
      className="flex min-w-0 shrink-0 flex-col p-1"
    >
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
    </section>
  );
}
