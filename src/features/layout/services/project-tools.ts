import { normalizeProjectTabPath } from "@/features/workspace/services/project-tab-path";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { getResponsiveWorkbenchLayout } from "../hooks/use-responsive-workbench-layout";
import { useDockLayoutStore } from "../stores/dock-layout.store";
import { useUIState } from "../stores/ui-state.store";
import { useWorkbenchSidebarStore } from "../stores/workbench-sidebar.store";
import type { DockOwner } from "../types/dock.types";
import type { SidebarView } from "../types/sidebar.types";

/**
 * The sidebar shows one view at a time, picked from the activity bar: the agents, or one of the
 * project tools (Files, Search, Source Control, GitHub and the rest). These are the ways in for
 * commands and menus. In a narrow window the sidebar has no column, so it floats over the centre.
 */

function isNarrowWindow() {
  return typeof window !== "undefined" && getResponsiveWorkbenchLayout(window.innerWidth).narrow;
}

function isSidebarOut(): boolean {
  return isNarrowWindow()
    ? useWorkbenchSidebarStore.getState().overlayOpen
    : useUIState.getState().isSidebarVisible;
}

function setSidebarOut(out: boolean) {
  if (isNarrowWindow()) useWorkbenchSidebarStore.getState().actions.setOverlayOpen(out);
  else useUIState.getState().setIsSidebarVisible(out);
}

/** Brings the sidebar out or puts it away, on whatever view it shows. */
export function toggleWorkbenchSidebar() {
  setSidebarOut(!isSidebarOut());
}

/** Shows `view` in the sidebar, bringing the sidebar out, and gives it focus. */
export function showSidebarView(view: string, options: { focus?: boolean } = {}) {
  useWorkbenchSidebarStore.getState().actions.showView(view, { focus: options.focus ?? true });
  setSidebarOut(true);
}

/** Whether `view` shows in the sidebar now. */
export function isSidebarViewShowing(view: string): boolean {
  return useWorkbenchSidebarStore.getState().activeView === view && isSidebarOut();
}

/** Shows `view`, or puts the sidebar away when it already shows it. */
export function toggleSidebarView(view: string) {
  if (isSidebarViewShowing(view)) setSidebarOut(false);
  else showSidebarView(view);
}

/** The dock owner a project tool's commands act for: the dock's owner, else the active project. */
export function getProjectToolOwner(): DockOwner | null {
  const current = useDockLayoutStore.getState().currentOwner;
  if (current) return current;
  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  return rootFolderPath ? { kind: "project", id: normalizeProjectTabPath(rootFolderPath) } : null;
}

export function showProjectTool(view: SidebarView, options: { focus?: boolean } = {}) {
  showSidebarView(view, options);
}

export function isProjectToolShowing(view: SidebarView): boolean {
  return isSidebarViewShowing(view);
}

export function toggleProjectTool(view: SidebarView) {
  toggleSidebarView(view);
}

/** The project tool views showing now. */
export function getOpenProjectTools(): string[] {
  return isSidebarOut() ? [useWorkbenchSidebarStore.getState().activeView] : [];
}
