import { GridIcon } from "@/ui/icons";
import { createElement, lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const WorkspaceManagementView = lazy(() => import("../components/workspace-management-view"));
const WorkspaceSidebar = lazy(() =>
  import("../components/workspace-sidebar").then((module) => ({
    default: module.WorkspaceSidebar,
  })),
);

export function registerWorkspaceViews() {
  registerPaneView("workspaces", { component: WorkspaceManagementView, getProps: () => ({}) });
  registerSidebarView({
    id: "workspaces",
    title: "Workspaces",
    icon: createElement(GridIcon),
    order: 50,
    component: WorkspaceSidebar,
  });
}
