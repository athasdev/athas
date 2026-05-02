import { FileText, Folder, FolderOpen } from "@phosphor-icons/react";
import type { IconThemeDefinition } from "../types";

export const classicIconTheme: IconThemeDefinition = {
  id: "classic",
  name: "Classic",
  description: "Traditional file manager style icons",
  getFileIcon: (_fileName: string, isDir: boolean, isExpanded = false, _isSymlink = false) => {
    if (isDir) {
      const Icon = isExpanded ? FolderOpen : Folder;
      return {
        component: <Icon strokeWidth={1.5} />,
      };
    }

    return {
      component: <FileText strokeWidth={1.5} />,
    };
  },
};
