import { Folder, FolderOpen } from "lucide-react";
import { getIcon } from "material-file-icons";
import type { IconThemeDefinition } from "../types";

export const colorfulMaterialIconTheme: IconThemeDefinition = {
  id: "colorful-material",
  name: "Material Icons (Colorful)",
  description: "Material Design file icons with original colors",
  getFileIcon: (fileName: string, isDir: boolean, isExpanded = false, _isSymlink = false) => {
    if (isDir) {
      const Icon = isExpanded ? FolderOpen : Folder;
      return {
        component: <Icon size={14} />,
      };
    }

    const icon = getIcon(fileName);
    // Keep original colors - don't replace fill/stroke attributes
    return { svg: icon.svg };
  },
};
