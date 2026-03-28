import { Eye } from "lucide-react";
import type { PaneContent } from "@/features/panes/types/pane-content";
import type { Action } from "../models/action.types";

interface MarkdownActionsParams {
  isMarkdownFile: boolean;
  activeBuffer: PaneContent | null;
  openBuffer: (
    path: string,
    name: string,
    content: string,
    isImage?: boolean,
    databaseType?: any,
    isDiff?: boolean,
    isVirtual?: boolean,
    diffData?: any,
    isMarkdownPreview?: boolean,
    isHtmlPreview?: boolean,
    isCsvPreview?: boolean,
    sourceFilePath?: string,
  ) => string;
  onClose: () => void;
}

export const createMarkdownActions = (params: MarkdownActionsParams): Action[] => {
  const { isMarkdownFile, activeBuffer, openBuffer, onClose } = params;

  if (!isMarkdownFile || !activeBuffer) {
    return [];
  }

  return [
    {
      id: "markdown-preview",
      label: "Markdown: Preview Markdown",
      description: "Open markdown preview in a new tab",
      icon: <Eye />,
      category: "Markdown",
      action: () => {
        // Create a virtual path for the preview
        const previewPath = `${activeBuffer.path}:preview`;
        const previewName = `${activeBuffer.name} (Preview)`;

        // Open a new buffer for the preview
        const content = activeBuffer.type === "editor" ? activeBuffer.content : "";
        openBuffer(
          previewPath,
          previewName,
          content,
          false, // isImage
          undefined, // databaseType
          false, // isDiff
          true, // isVirtual
          undefined, // diffData
          true, // isMarkdownPreview
          false, // isHtmlPreview
          false, // isCsvPreview
          activeBuffer.path, // sourceFilePath
        );
        onClose();
      },
    },
  ];
};
