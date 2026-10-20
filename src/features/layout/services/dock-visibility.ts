import { selectDockLayout, useDockLayoutStore } from "../stores/dock-layout.store";
import type { DockOwner } from "../types/dock.types";
import { getProjectToolOwner } from "./project-tools";

/** What a project's dock opens on when the user brings back an empty one. */
const DEFAULT_PROJECT_PANE = "view:files";

/**
 * Whether the dock beside the centre is out for `owner`: not put away, and holding a pane or, for
 * a session, its details.
 */
export function isDockShown(owner: DockOwner | null = getProjectToolOwner()): boolean {
  const state = useDockLayoutStore.getState();
  if (!owner || state.hidden) return false;
  return owner.kind === "session" || selectDockLayout(state, owner).panes.length > 0;
}

/**
 * Shows the dock or puts it away. A project's dock with nothing in it comes back on Files, so the
 * switch always shows something.
 */
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
    actions.open(owner, DEFAULT_PROJECT_PANE);
    return;
  }
  actions.setHidden(false);
}
