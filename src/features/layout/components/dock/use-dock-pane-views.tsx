import { createElement, useMemo } from "react";
import { getDockPanes } from "@/features/layout/services/dock-pane-registry";
import type { DockOwner, DockPaneId } from "@/features/layout/types/dock.types";
import type { DockPaneView } from "./dock-pane-frame";
import { useProjectTools } from "./project-tools";

/** The panes the owner's dock can show, by id: the session's own tools, then project tools. */
export function useDockPaneViews(owner: DockOwner): Map<DockPaneId, DockPaneView> {
  const projectTools = useProjectTools();
  return useMemo(() => {
    const views = new Map<DockPaneId, DockPaneView>();
    for (const pane of getDockPanes()) {
      if (pane.scope === "session" && owner.kind !== "session") continue;
      const { component, HeaderDetail, HeaderActions } = pane;
      views.set(pane.id, {
        id: pane.id,
        title: pane.title,
        icon: pane.icon,
        render: (props) => createElement(component, props),
        renderDetail: HeaderDetail ? (props) => createElement(HeaderDetail, props) : undefined,
        renderActions: HeaderActions ? (props) => createElement(HeaderActions, props) : undefined,
        hostsViewChrome: pane.hostsViewChrome,
      });
    }
    for (const tool of projectTools) {
      views.set(tool.paneId, {
        id: tool.paneId,
        title: tool.title,
        icon: tool.icon,
        render: tool.render,
        hostsViewChrome: true,
      });
    }
    return views;
  }, [owner.kind, projectTools]);
}
