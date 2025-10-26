import { FilePlus } from "lucide-react";
import { createTabActions } from "@/features/tabs/constants/tab-actions";
import type { Buffer } from "@/types/buffer";
import type { Action } from "../models/action.types";

interface FileActionsParams {
  activeBufferId: string | null;
  buffers: Buffer[];
  closeBuffer: (bufferId: string) => void;
  switchToNextBuffer: () => void;
  switchToPreviousBuffer: () => void;
  setActiveBuffer: (bufferId: string) => void;
  onClose: () => void;
}

export const createFileActions = (params: FileActionsParams): Action[] => {
  const { onClose } = params;

  const baseActions: Action[] = [
    {
      id: "file-save-as",
      label: "File: Save As",
      description: "Save current file with a new name",
      icon: <FilePlus size={14} />,
      category: "File",
      keybinding: ["⌘", "⇧", "S"],
      action: () => {
        onClose();
        window.dispatchEvent(new CustomEvent("menu-save-as"));
      },
    },
  ];

  // Include tab actions from the tabs feature
  const tabActions = createTabActions(params);

  return [...baseActions, ...tabActions];
};
