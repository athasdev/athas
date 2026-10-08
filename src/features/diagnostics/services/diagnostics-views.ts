import { lazy } from "react";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const DiagnosticsBuffer = lazy(() => import("../components/diagnostics-buffer"));

export function registerDiagnosticsViews() {
  registerPaneView("diagnostics", { component: DiagnosticsBuffer, getProps: () => ({}) });
}
