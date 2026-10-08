import { lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const CustomView = lazy(() =>
  import("../components/custom-view").then((module) => ({ default: module.CustomView })),
);
const ViewsSidebar = lazy(() =>
  import("../components/views-sidebar").then((module) => ({ default: module.ViewsSidebar })),
);

export function registerCustomViews() {
  registerPaneView("customView", { component: CustomView, getProps: (buffer) => ({ buffer }) });
  registerSidebarView({
    id: "views",
    order: 30,
    component: ViewsSidebar,
    getProps: ({ rootFolderPath }) => ({ projectPath: rootFolderPath ?? null }),
    loadsOnDemand: true,
    suspendWhenHidden: true,
  });
}
