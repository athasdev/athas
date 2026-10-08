import { lazy } from "react";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const loadGlobalSearchBuffer = () => import("../components/global-search-buffer");
const GlobalSearchBuffer = lazy(loadGlobalSearchBuffer);

export function registerGlobalSearchViews() {
  registerPaneView("globalSearch", {
    component: GlobalSearchBuffer,
    getProps: () => ({}),
    prefetch: loadGlobalSearchBuffer,
  });
}
