import {
  ArrowLeft,
  ArrowRight,
  ArrowCounterClockwise as RotateCcw,
  X,
} from "@phosphor-icons/react";
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
      icon: <X />,
      category: "File",
      commandId: "file.close",
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
      icon: <ArrowRight />,
      category: "File",
      commandId: "workbench.nextTab",
      action: () => {
        switchToNextBuffer();
        onClose();
      },
    },
    {
      id: "tab-previous",
      label: "Tab: Previous Tab",
      description: "Switch to the previous open tab",
      icon: <ArrowLeft />,
      category: "File",
      commandId: "workbench.previousTab",
      action: () => {
        switchToPreviousBuffer();
        onClose();
      },
    },
    {
      id: "tab-reopen",
      label: "Tab: Reopen Closed Tab",
      description: "Reopen the most recently closed tab",
      icon: <RotateCcw />,
      category: "File",
      commandId: "file.reopenClosed",
      action: async () => {
        await reopenClosedTab();
        onClose();
      },
    },
  ];
};
