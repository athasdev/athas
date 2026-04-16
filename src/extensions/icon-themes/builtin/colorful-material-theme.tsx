import { Folder, FolderOpen } from "lucide-react";
import { getIcon } from "material-file-icons";
import type { IconThemeDefinition } from "../types";

export const colorfulMaterialIconTheme: IconThemeDefinition = {
  id: "material",
  name: "Material Icons",
  description: "Material Design file icons",
  getFileIcon: (fileName: string, isDir: boolean, isExpanded = false, _isSymlink = false) => {
    if (isDir) {
      const Icon = isExpanded ? FolderOpen : Folder;
      return {
        component: <Icon />,
      };
    }

    const icon = getIcon(fileName);
    // Keep original colors - don't replace fill/stroke attributes
    return { svg: icon.svg };
  },
};
