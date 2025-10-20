import { ArrowRight, FilePlus, FileText, X } from "lucide-react";
import type { Buffer } from "@/types/buffer";
import type { Action } from "../../models/action.types";

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
  const {
    activeBufferId,
    buffers,
    closeBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    setActiveBuffer,
    onClose,
  } = params;

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
    {
      id: "file-close",
      label: "File: Close File",
      description: "Close current file",
      icon: <X size={14} />,
      category: "File",
      keybinding: ["⌘", "W"],
      action: () => {
        if (activeBufferId) {
          closeBuffer(activeBufferId);
        }
        onClose();
      },
    },
    {
      id: "view-next-tab",
      label: "View: Next Tab",
      description: "Switch to the next open file",
      icon: <ArrowRight size={14} />,
      category: "File",
      keybinding: ["Ctrl", "Tab"],
      action: () => {
        switchToNextBuffer();
        onClose();
      },
    },
    {
      id: "view-previous-tab",
      label: "View: Previous Tab",
      description: "Switch to the previous open file",
      icon: <ArrowRight size={14} />,
      category: "File",
      keybinding: ["Ctrl", "⇧", "Tab"],
      action: () => {
        switchToPreviousBuffer();
        onClose();
      },
    },
  ];

  // Add tab switching commands (⌘1-9) for first 9 buffers
  const tabSwitchActions: Action[] = buffers.slice(0, 9).map((buffer, index) => ({
    id: `switch-to-tab-${index + 1}`,
    label: `View: Switch to Tab ${index + 1}`,
    description: `Switch to ${buffer.name}`,
    icon: <FileText size={14} />,
    category: "File",
    keybinding: ["⌘", `${index + 1}`],
    action: () => {
      setActiveBuffer(buffer.id);
      onClose();
    },
  }));

  return [...baseActions, ...tabSwitchActions];
};
