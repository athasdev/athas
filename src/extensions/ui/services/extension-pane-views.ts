import { lazy } from "react";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const ExtensionsView = lazy(() =>
  import("../components/extensions-view").then((module) => ({ default: module.ExtensionsView })),
);
const ExtensionDetails = lazy(() =>
  import("../components/extensions-view").then((module) => ({
    default: module.ExtensionDetails,
  })),
);

/** The extensions views; standalone extension windows register them too. */
export function registerExtensionPaneViews() {
  registerPaneView("extensions", { component: ExtensionsView, getProps: () => ({}) });
  registerPaneView("extension", {
    component: ExtensionDetails,
    getProps: (buffer) => ({ extensionId: buffer.extensionId }),
  });
}
