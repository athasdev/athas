import { EyeIcon } from "@/ui/icons";
import { openMarkdownPreview } from "@/features/editor/markdown/open-markdown-preview";
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
      label: "Markdown: Preview Markdown",
      description: "Open markdown preview in a new tab",
      icon: <EyeIcon />,
      category: "Markdown",
      action: () => {
        openMarkdownPreview(activeBuffer);
        onClose();
      },
    },
  ];
};
