import { createElement } from "react";
import { FilesIcon } from "@/ui/icons";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";
import { FileExplorerPane } from "../components/file-explorer-pane";

/** The file tree is the default sidebar view, so it loads with the workbench. */
export function registerFileExplorerViews() {
  registerSidebarView({
    id: "files",
    title: "Files",
    icon: createElement(FilesIcon),
    order: 70,
    component: FileExplorerPane,
  });
}
