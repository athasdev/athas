import { lazy } from "react";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const ReferencesBuffer = lazy(() => import("../components/references-buffer"));

export function registerReferencesViews() {
  registerPaneView("references", { component: ReferencesBuffer, getProps: () => ({}) });
}
