import type { PaneContent } from "@/features/panes/types/pane-content.types";

function getParentPath(path: string): string | null {
  const lastSlashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastSlashIndex <= 0) return null;

  const parentPath = path.slice(0, lastSlashIndex);
  return parentPath && parentPath !== path ? parentPath : null;
}

export function getAncestorDirectoryPaths(targetPath: string, stopAtPath?: string): string[] {
  const ancestors: string[] = [];
  let currentPath = getParentPath(targetPath);

  while (currentPath) {
    ancestors.unshift(currentPath);
    if (stopAtPath && currentPath === stopAtPath) {
      break;
    }
    currentPath = getParentPath(currentPath);
  }

  return ancestors;
}

export function getExplorerTargetPath(activeBuffer: PaneContent | null): string | undefined {
  if (!activeBuffer) return undefined;

  if (
    activeBuffer.type === "markdownPreview" ||
    activeBuffer.type === "htmlPreview" ||
    activeBuffer.type === "csvPreview"
  ) {
    return activeBuffer.sourceFilePath;
  }

  if (
    activeBuffer.type === "editor" ||
    activeBuffer.type === "image" ||
    activeBuffer.type === "pdf" ||
    activeBuffer.type === "binary" ||
    activeBuffer.type === "database" ||
    activeBuffer.type === "externalEditor"
  ) {
    return activeBuffer.path;
  }

  return undefined;
}
