import { ArrowLeft, ArrowRight, RotateCcw, X } from "lucide-react";
import type { Action } from "@/features/command-palette/models/action.types";

interface TabActionsParams {
  activeBufferId: string | null;
  closeBuffer: (bufferId: string) => void;
  switchToNextBuffer: () => void;
  switchToPreviousBuffer: () => void;
  reopenClosedTab: () => Promise<void>;
  onClose: () => void;
}

export const createTabActions = (params: TabActionsParams): Action[] => {
  const {
    activeBufferId,
    closeBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    reopenClosedTab,
    onClose,
  } = params;

  return [
    {
      id: "tab-close",
      label: "Tab: Close Tab",
      description: "Close current tab",
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
      id: "tab-next",
      label: "Tab: Next Tab",
      description: "Switch to the next open tab",
      icon: <ArrowRight size={14} />,
      category: "File",
      keybinding: ["Ctrl", "⇟"],
      action: () => {
        switchToNextBuffer();
        onClose();
      },
    },
    {
      id: "tab-previous",
      label: "Tab: Previous Tab",
      description: "Switch to the previous open tab",
      icon: <ArrowLeft size={14} />,
      category: "File",
      keybinding: ["Ctrl", "⇞"],
      action: () => {
        switchToPreviousBuffer();
        onClose();
      },
    },
    {
      id: "tab-reopen",
      label: "Tab: Reopen Closed Tab",
      description: "Reopen the most recently closed tab",
      icon: <RotateCcw size={14} />,
      category: "File",
      keybinding: ["⌘", "Shift", "T"],
      action: async () => {
        await reopenClosedTab();
        onClose();
      },
    },
  ];
};
