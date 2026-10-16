import { normalizeProjectTabPath } from "@/features/workspace/services/project-tab-path";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { selectDockLayout, useDockLayoutStore } from "../stores/dock-layout.store";
import type { DockOwner } from "../types/dock.types";
import type { SidebarView } from "../types/sidebar.types";
import { getProjectToolPaneId, getProjectToolView } from "./dock-pane-registry";

/**
 * Files, Source Control, GitHub and the other project tools open as panes of the dock, for the
 * session or project the dock shows. These are the ways in for commands and menus.
 */

/** Whose dock a project tool opens in: the dock's owner, else the active project. */
export function getProjectToolOwner(): DockOwner | null {
  const current = useDockLayoutStore.getState().currentOwner;
  if (current) return current;
  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  return rootFolderPath ? { kind: "project", id: normalizeProjectTabPath(rootFolderPath) } : null;
}

/** Opens `view` in the dock, or brings it forward, and gives it focus. */
export function showProjectTool(view: SidebarView, options: { focus?: boolean } = {}) {
  const owner = getProjectToolOwner();
  if (!owner) return;
  useDockLayoutStore
    .getState()
    .actions.open(owner, getProjectToolPaneId(view), { focus: options.focus ?? true });
}

/** Whether `view` shows in the dock now. */
export function isProjectToolShowing(view: SidebarView): boolean {
  const state = useDockLayoutStore.getState();
  return (
    !state.hidden &&
    selectDockLayout(state, getProjectToolOwner()).panes.includes(getProjectToolPaneId(view))
  );
}

/** Opens `view` in the dock, or closes it when it shows. */
export function toggleProjectTool(view: SidebarView) {
  const owner = getProjectToolOwner();
  if (!owner) return;
  const { actions } = useDockLayoutStore.getState();
  if (isProjectToolShowing(view)) actions.close(owner, getProjectToolPaneId(view));
  else actions.open(owner, getProjectToolPaneId(view), { focus: true });
}

/** The project tool views open in the dock now, top to bottom. */
export function getOpenProjectTools(): string[] {
  const state = useDockLayoutStore.getState();
  return selectDockLayout(state, getProjectToolOwner()).panes.flatMap((pane) => {
    const view = getProjectToolView(pane);
    return view ? [view] : [];
  });
}
