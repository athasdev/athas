import { File, Folder, FolderOpen } from "lucide-react";
import type { IconThemeDefinition } from "../types";

export const minimalIconTheme: IconThemeDefinition = {
  id: "minimal",
  name: "Minimal Icons",
  description: "Simple monochrome file icons",
  getFileIcon: (_fileName: string, isDir: boolean, isExpanded = false, _isSymlink = false) => {
    if (isDir) {
      const Icon = isExpanded ? FolderOpen : Folder;
      return {
        component: <Icon size={14} />,
      };
    }

    return {
      component: <File size={14} />,
    };
  },
};
