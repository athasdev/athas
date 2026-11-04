import { createElement, useMemo } from "react";
import { getDockPanes } from "@/features/layout/services/dock-pane-registry";
import type { DockOwner, DockPaneId } from "@/features/layout/types/dock.types";
import type { DockPaneView } from "./dock-pane-frame";

/** The panes the owner's dock can show, by id. Project tools open in the sidebar instead. */
export function useDockPaneViews(owner: DockOwner): Map<DockPaneId, DockPaneView> {
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
      });
    }
    return views;
  }, [owner.kind]);
}
