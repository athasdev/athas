import { GlobeIcon } from "@/ui/icons";
import type { Command } from "../types/keymaps.types";
import {
  focusBrowserAddressBar,
  openNewBrowserTab,
  openUrlInBrowserTab,
  runActiveBrowserAction,
} from "./browser-command-actions";

export const browserCommands: Command[] = [
  {
    id: "browser.newTab",
    title: "New Browser Tab",
    category: "Browser",
    description: "Browse the web or a local server in a tab",
    icon: <GlobeIcon />,
    palette: { label: "Browser: New Browser Tab" },
    execute: () => openNewBrowserTab(),
  },
  {
    id: "browser.openUrl",
    title: "Open URL in Browser Tab",
    category: "Browser",
    description: "Open an address or a web search in a new browser tab",
    icon: <GlobeIcon />,
    palette: { label: "Browser: Open URL..." },
    execute: openUrlInBrowserTab,
  },
  {
    id: "browser.focusAddressBar",
    title: "Focus Address Bar",
    category: "Browser",
    execute: focusBrowserAddressBar,
  },
  {
    id: "browser.reload",
    title: "Reload Page",
    category: "Browser",
    execute: () => runActiveBrowserAction("reload"),
  },
  {
    id: "browser.back",
    title: "Go Back",
    category: "Browser",
    execute: () => runActiveBrowserAction("back"),
  },
  {
    id: "browser.forward",
    title: "Go Forward",
    category: "Browser",
    execute: () => runActiveBrowserAction("forward"),
  },
  {
    id: "browser.openDevTools",
    title: "Open Page Developer Tools",
    category: "Browser",
    execute: () => runActiveBrowserAction("devtools"),
  },
];
