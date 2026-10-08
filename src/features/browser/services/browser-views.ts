import { lazy } from "react";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const loadBrowserTabManager = () => import("./browser-tab-manager");
const BrowserView = lazy(() =>
  import("../components/browser-view").then((module) => ({ default: module.BrowserView })),
);

export function registerBrowserViews() {
  registerPaneView("browser", {
    component: BrowserView,
    getProps: (buffer, host) => ({
      buffer,
      paneId: host.paneId ?? "",
      isActive: host.isActive ?? false,
    }),
    onClose: (buffer) => {
      void loadBrowserTabManager().then(({ browserTabManager }) => {
        browserTabManager.close(buffer.id);
      });
    },
    reload: (buffer) => {
      void loadBrowserTabManager().then(({ browserTabManager }) =>
        browserTabManager.perform(buffer.id, "reload"),
      );
    },
  });
}
