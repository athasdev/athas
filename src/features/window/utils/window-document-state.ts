import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { isVirtualContent } from "@/features/panes/types/pane-content.types";

export interface WindowDocumentState {
  title: string;
  representedPath?: string;
  isEdited: boolean;
}

interface WindowDocumentStateInput {
  activeBuffer: PaneContent | null;
  projectName?: string;
  rootFolderPath?: string;
}

export function getWindowDocumentState({
  activeBuffer,
  projectName,
  rootFolderPath,
}: WindowDocumentStateInput): WindowDocumentState {
  const contextName = rootFolderPath && projectName && projectName !== "Files" ? projectName : null;
  const documentName = activeBuffer?.type === "newTab" ? null : activeBuffer?.name;
  const titleParts = [
    documentName,
    documentName === contextName ? null : contextName,
    "Athas",
  ].filter((part): part is string => Boolean(part));
  const representedPath =
    activeBuffer && activeBuffer.path.startsWith("/") && !isVirtualContent(activeBuffer)
      ? activeBuffer.path
      : undefined;

  return {
    title: titleParts.join(" — "),
    representedPath,
    isEdited: activeBuffer?.type === "editor" && activeBuffer.isDirty,
  };
}
