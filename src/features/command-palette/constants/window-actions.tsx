import { Maximize, Minimize } from "lucide-react";
import type { Action } from "../models/action.types";

interface WindowActionsParams {
  onClose: () => void;
}

export const createWindowActions = (params: WindowActionsParams): Action[] => {
  const { onClose } = params;

  return [
    {
      id: "window-minimize",
      label: "Window: Minimize",
      description: "Minimize the window",
      icon: <Minimize size={14} />,
      category: "Window",
      action: () => {
        window.dispatchEvent(new CustomEvent("minimize-window"));
        onClose();
      },
    },
    {
      id: "window-maximize",
      label: "Window: Maximize",
      description: "Maximize or restore the window",
      icon: <Maximize size={14} />,
      category: "Window",
      action: () => {
        window.dispatchEvent(new CustomEvent("maximize-window"));
        onClose();
      },
    },
    {
      id: "window-fullscreen",
      label: "Window: Toggle Fullscreen",
      description: "Enter or exit fullscreen mode",
      icon: <Maximize size={14} />,
      category: "Window",
      keybinding: ["F11"],
      action: () => {
        window.dispatchEvent(new CustomEvent("toggle-fullscreen"));
        onClose();
      },
    },
  ];
};
