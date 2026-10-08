import { lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";
import { DatabaseBufferView } from "../components/database-buffer-view";

const DatabaseSidebar = lazy(() =>
  import("../components/database-sidebar").then((module) => ({
    default: module.DatabaseSidebar,
  })),
);

export function registerDatabaseViews() {
  registerPaneView("database", {
    component: DatabaseBufferView,
    getProps: (buffer) => ({
      databaseType: buffer.databaseType,
      path: buffer.path,
      connectionId: buffer.connectionId,
    }),
  });
  registerSidebarView({
    id: "databases",
    order: 60,
    component: DatabaseSidebar,
    loadsOnDemand: true,
    suspendWhenHidden: true,
  });
}
