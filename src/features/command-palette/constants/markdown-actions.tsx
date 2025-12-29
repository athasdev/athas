import { Eye } from "lucide-react";
import type { Buffer } from "@/features/editor/stores/buffer-store";
import type { Action } from "../models/action.types";

interface MarkdownActionsParams {
  isMarkdownFile: boolean;
  activeBuffer: Buffer | null;
  openBuffer: (
    path: string,
    name: string,
    content: string,
    isImage?: boolean,
    isSQLite?: boolean,
    isDiff?: boolean,
    isVirtual?: boolean,
    diffData?: any,
    isMarkdownPreview?: boolean,
    isHtmlPreview?: boolean,
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
      icon: <Eye size={14} />,
      category: "Markdown",
      action: () => {
        // Create a virtual path for the preview
        const previewPath = `${activeBuffer.path}:preview`;
        const previewName = `${activeBuffer.name} (Preview)`;

        // Open a new buffer for the preview
        openBuffer(
          previewPath,
          previewName,
          activeBuffer.content,
          false, // isImage
          false, // isSQLite
          false, // isDiff
          true, // isVirtual
          undefined, // diffData
          true, // isMarkdownPreview
          false, // isHtmlPreview
          activeBuffer.path, // sourceFilePath
        );
        onClose();
      },
    },
  ];
};
