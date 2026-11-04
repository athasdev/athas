import { selectDockLayout, useDockLayoutStore } from "../stores/dock-layout.store";
import type { DockOwner } from "../types/dock.types";
import { getProjectToolOwner } from "./project-tools";

/**
 * Whether the dock beside the centre is out for `owner`: not put away, and holding a pane or, for
 * a session, its details.
 */
export function isDockShown(owner: DockOwner | null = getProjectToolOwner()): boolean {
  const state = useDockLayoutStore.getState();
  if (!owner || state.hidden) return false;
  return owner.kind === "session" || selectDockLayout(state, owner).panes.length > 0;
}

/** Shows the dock or puts it away. A project's dock with nothing in it stays away. */
export function toggleDock() {
  const owner = getProjectToolOwner();
  if (!owner) return;
  const { actions } = useDockLayoutStore.getState();
  if (isDockShown(owner)) {
    actions.setHidden(true);
    return;
  }
  if (
    owner.kind === "project" &&
    selectDockLayout(useDockLayoutStore.getState(), owner).panes.length === 0
  ) {
    return;
  }
  actions.setHidden(false);
}
