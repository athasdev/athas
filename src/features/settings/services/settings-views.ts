import { lazy } from "react";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const loadSettingsWorkbenchView = () => import("../components/settings-workbench-view");
const SettingsWorkbenchView = lazy(loadSettingsWorkbenchView);

/** The settings view; standalone settings windows register it too. */
export function registerSettingsViews() {
  registerPaneView("settings", {
    component: SettingsWorkbenchView,
    getProps: () => ({}),
    prefetch: loadSettingsWorkbenchView,
  });
}
