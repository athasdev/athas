import {
  openStandaloneContentWindow,
  openTerminalWindow,
} from "@/features/window/detached/standalone-content-service";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { ArrowsInIcon, ArrowsOutIcon } from "@/ui/icons";
import type { Action } from "../types/action.types";

interface WindowActionsParams {
  onClose: () => void;
}

export const createWindowActions = (params: WindowActionsParams): Action[] => {
  const { onClose } = params;

  return [
    ...(
      [
        ["terminal", "Terminal"],
        ["settings", "Settings"],
        ["extensions", "Extensions"],
      ] as const
    )
      .filter(
        ([type]) =>
          type !== "terminal" || useSettingsStore.getState().settings.coreFeatures.terminal,
      )
      .map(([type, label]): Action => ({
        id: `window-new-${type}`,
        label: `Window: New ${label} Window`,
        description: `Open ${label.toLowerCase()} in its own window`,
        icon: <ArrowsOutIcon />,
        category: "Window",
        action: async () => {
          onClose();
          if (type === "terminal") await openTerminalWindow();
          else await openStandaloneContentWindow({ type });
        },
      })),
    {
      id: "window-minimize",
      label: "Window: Minimize",
      description: "Minimize the window",
      icon: <ArrowsInIcon />,
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
      icon: <ArrowsOutIcon />,
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
      icon: <ArrowsOutIcon />,
      category: "Window",
      commandId: "window.toggleFullscreen",
      action: () => {
        window.dispatchEvent(new CustomEvent("toggle-fullscreen"));
        onClose();
      },
    },
  ];
};
