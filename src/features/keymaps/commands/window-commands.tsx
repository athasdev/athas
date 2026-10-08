import { ArrowsInIcon, ArrowsOutIcon, SettingsIcon } from "@/ui/icons";
import { useUIState } from "@/features/window/stores/ui-state.store";
import type { Command } from "../types/keymaps.types";
import {
  maximizeWindow,
  minimizeWindow,
  minimizeWindowAlt,
  minimizeWindowMac,
  quitApplication,
  toggleFullscreen,
  toggleFullscreenMac,
  toggleNativeMenuBar,
} from "./window-command-actions";

const standaloneContent = () => import("@/features/window/detached/standalone-content-service");

export const windowCommands: Command[] = [
  {
    id: "workbench.openBrowserBilling",
    title: "Manage Athas Cloud Usage",
    category: "Window",
    execute: async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      const { getApiBase } = await import("@/utils/api-base");
      await openUrl(new URL("/dashboard/settings/billing", getApiBase()).toString());
    },
  },
  {
    id: "workbench.openSettings",
    title: "Open Settings",
    category: "Window",
    description: "Open the settings page",
    icon: <SettingsIcon />,
    palette: { label: "Preferences: Open Settings", category: "Settings" },
    execute: () => {
      useUIState.getState().openSettings();
    },
  },
  {
    id: "window.toggleFullscreen",
    title: "Toggle Fullscreen",
    category: "Window",
    description: "Enter or exit fullscreen mode",
    icon: <ArrowsOutIcon />,
    palette: { label: "Window: Toggle Fullscreen" },
    execute: toggleFullscreen,
  },
  {
    id: "window.toggleFullscreenMac",
    title: "Toggle Fullscreen (Mac)",
    category: "Window",
    execute: toggleFullscreenMac,
  },
  {
    id: "window.minimize",
    title: "Minimize Window",
    category: "Window",
    description: "Minimize the window",
    icon: <ArrowsInIcon />,
    palette: { label: "Window: Minimize" },
    execute: minimizeWindow,
  },
  {
    id: "window.minimize.mac",
    title: "Minimize (Mac)",
    category: "Window",
    execute: minimizeWindowMac,
  },
  {
    id: "window.minimize.alt",
    title: "Minimize (Alt)",
    category: "Window",
    execute: minimizeWindowAlt,
  },
  {
    id: "window.maximize",
    title: "Maximize Window",
    category: "Window",
    execute: maximizeWindow,
  },
  {
    id: "window.quit",
    title: "Quit Application",
    category: "Window",
    execute: quitApplication,
  },
  {
    id: "window.toggleMenuBar",
    title: "Toggle Menu Bar",
    category: "Window",
    execute: toggleNativeMenuBar,
  },
  {
    id: "window.newTerminalWindow",
    title: "Window: New Terminal Window",
    category: "Window",
    description: "Open terminal in its own window",
    icon: <ArrowsOutIcon />,
    when: ({ settings }) => settings.coreFeatures.terminal,
    palette: true,
    execute: async () => {
      await (await standaloneContent()).openTerminalWindow();
    },
  },
  {
    id: "window.newSettingsWindow",
    title: "Window: New Settings Window",
    category: "Window",
    description: "Open settings in its own window",
    icon: <ArrowsOutIcon />,
    palette: true,
    execute: async () => {
      await (await standaloneContent()).openStandaloneContentWindow({ type: "settings" });
    },
  },
  {
    id: "window.newExtensionsWindow",
    title: "Window: New Extensions Window",
    category: "Window",
    description: "Open extensions in its own window",
    icon: <ArrowsOutIcon />,
    palette: true,
    execute: async () => {
      await (await standaloneContent()).openStandaloneContentWindow({ type: "extensions" });
    },
  },
  {
    id: "window.toggleMaximize",
    title: "Window: Maximize",
    category: "Window",
    description: "Maximize or restore the window",
    icon: <ArrowsOutIcon />,
    palette: true,
    execute: () => {
      window.dispatchEvent(new CustomEvent("maximize-window"));
    },
  },
];
