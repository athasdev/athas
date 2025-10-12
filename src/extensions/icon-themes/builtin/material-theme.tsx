import { Folder, FolderOpen } from "lucide-react";
import { getIcon } from "material-file-icons";
import type { IconThemeDefinition } from "../types";

export const materialIconTheme: IconThemeDefinition = {
  id: "material",
  name: "Material Icons",
  description: "Material Design file icons",
  getFileIcon: (fileName: string, isDir: boolean, isExpanded = false) => {
    if (isDir) {
      const Icon = isExpanded ? FolderOpen : Folder;
      return {
        component: <Icon size={14} />,
      };
    }

    const icon = getIcon(fileName);
    const svgContent = icon.svg
      .replace(/fill="[^"]*"/g, 'fill="currentColor"')
      .replace(/stroke="[^"]*"/g, 'stroke="currentColor"');

    return { svg: svgContent };
  },
};
