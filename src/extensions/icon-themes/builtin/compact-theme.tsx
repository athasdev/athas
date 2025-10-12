import { File, Folder, FolderOpen } from "lucide-react";
import type { IconThemeDefinition } from "../types";

export const compactIconTheme: IconThemeDefinition = {
  id: "compact",
  name: "Compact",
  description: "Smaller, space-efficient icons",
  getFileIcon: (_fileName: string, isDir: boolean, isExpanded = false) => {
    if (isDir) {
      const Icon = isExpanded ? FolderOpen : Folder;
      return {
        component: <Icon size={12} strokeWidth={2} />,
      };
    }

    return {
      component: <File size={12} strokeWidth={2} />,
    };
  },
};
