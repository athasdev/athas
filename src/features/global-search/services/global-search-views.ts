import { createElement, lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";
import { SearchIcon } from "@/ui/icons";

const loadGlobalSearchBuffer = () => import("../components/global-search-buffer");
const GlobalSearchBuffer = lazy(loadGlobalSearchBuffer);
const GlobalSearchPaneActions = lazy(() =>
  import("../components/global-search-pane-actions").then((module) => ({
    default: module.GlobalSearchPaneActions,
  })),
);

export function registerGlobalSearchViews() {
  registerPaneView("globalSearch", {
    component: GlobalSearchBuffer,
    getProps: () => ({}),
    prefetch: loadGlobalSearchBuffer,
  });
  registerSidebarView({
    id: "search",
    title: "Search",
    icon: createElement(SearchIcon),
    order: 5,
    component: GlobalSearchBuffer,
    getProps: ({ focusRequest }) => ({ placement: "dock" as const, focusRequest }),
    HeaderActions: GlobalSearchPaneActions,
  });
}
