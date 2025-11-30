import { Circle, Folder, FolderOpen } from "lucide-react";
import type { IconThemeDefinition } from "../types";

// Seti-inspired theme with simple colored dots for file types
export const setiIconTheme: IconThemeDefinition = {
  id: "seti",
  name: "Seti",
  description: "Simple colored dots inspired by Seti UI",
  getFileIcon: (fileName: string, isDir: boolean, isExpanded = false, _isSymlink = false) => {
    if (isDir) {
      const Icon = isExpanded ? FolderOpen : Folder;
      return {
        component: <Icon size={14} />,
      };
    }

    // Get file extension
    const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : "";

    // Color mapping based on file type (inspired by Seti)
    const colorMap: Record<string, string> = {
      // JavaScript/TypeScript
      js: "#f7df1e",
      jsx: "#61dafb",
      ts: "#3178c6",
      tsx: "#3178c6",
      // Web
      html: "#e34c26",
      css: "#563d7c",
      scss: "#c6538c",
      sass: "#c6538c",
      less: "#1d365d",
      // Config
      json: "#cbcb41",
      yaml: "#cb171e",
      yml: "#cb171e",
      toml: "#9c4221",
      xml: "#0060ac",
      // Markup
      md: "#083fa1",
      markdown: "#083fa1",
      // Programming
      py: "#3572A5",
      rb: "#701516",
      java: "#b07219",
      go: "#00add8",
      rs: "#dea584",
      c: "#555555",
      cpp: "#f34b7d",
      h: "#a8b9cc",
      // Shell
      sh: "#89e051",
      bash: "#89e051",
      zsh: "#89e051",
      // Data
      sql: "#e38c00",
      db: "#e38c00",
      sqlite: "#e38c00",
      // Images
      png: "#a074c4",
      jpg: "#a074c4",
      jpeg: "#a074c4",
      gif: "#a074c4",
      svg: "#ffb13b",
      // Other
      txt: "#8a8a8a",
    };

    const color = extension ? colorMap[extension] || "#4d9375" : "#4d9375";

    return {
      component: <Circle size={12} fill={color} color={color} />,
    };
  },
};
