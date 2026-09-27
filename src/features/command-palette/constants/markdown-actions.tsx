import { EyeIcon, PenIcon } from "@/ui/icons";
import { toggleMarkdownPreview } from "@/features/editor/markdown/toggle-markdown-preview";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { Action } from "../types/action.types";

interface MarkdownActionsParams {
  isMarkdownFile: boolean;
  activeBuffer: PaneContent | null;
  onClose: () => void;
}

export const createMarkdownActions = (params: MarkdownActionsParams): Action[] => {
  const { isMarkdownFile, activeBuffer, onClose } = params;

  if (!isMarkdownFile || activeBuffer?.type !== "editor") {
    return [];
  }

  return [
    {
      id: "markdown-preview",
      label: activeBuffer.isMarkdownPreview
        ? "Markdown: Show Source"
        : "Markdown: Preview Markdown",
      description: "Toggle Markdown preview in the current tab",
      icon: activeBuffer.isMarkdownPreview ? <PenIcon /> : <EyeIcon />,
      category: "Markdown",
      action: () => {
        toggleMarkdownPreview(activeBuffer.id);
        onClose();
      },
    },
  ];
};
