import type { BrowserKeyBinding } from "@/bindings/commands";
import { useKeymapStore } from "@/features/keymaps/stores/keymaps.store";
import type { Keybinding } from "@/features/keymaps/types/keymaps.types";
import { evaluateWhenClause } from "@/features/keymaps/utils/context";
import { getEffectiveKeybindings } from "@/features/keymaps/utils/effective-keymaps";
import { parseKeybinding } from "@/utils/keyboard/keybinding-parser";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

/**
 * Workbench commands a focused page hands back to Athas. Pages receive every other key, so web
 * apps keep their own shortcuts; these are the ones that move between tabs and panes, open the
 * workbench's pickers, or drive the browser tab itself.
 */
const PAGE_FORWARDED_COMMANDS = new Set([
  "workbench.commandPalette",
  "file.quickOpen",
  "workbench.newTab",
  "workbench.newWindow",
  "workbench.closeWindow",
  "file.close",
  "file.reopenClosed",
  "workbench.nextTab",
  "workbench.previousTab",
  "workbench.nextTabCtrlTab",
  "workbench.previousTabCtrlTab",
  ...Array.from({ length: 9 }, (_, index) => `workbench.switchToTab${index + 1}`),
  "workbench.toggleSidebar",
  "workbench.toggleTerminal",
  "workbench.showGlobalSearch",
  "workbench.zoomIn",
  "workbench.zoomOut",
  "workbench.zoomReset",
  "browser.focusAddressBar",
  "browser.reload",
  "browser.back",
  "browser.forward",
  "browser.openDevTools",
]);

/** Keys a page reports by physical position, because Shift or the layout changes their character. */
const KEY_TO_CODE: Record<string, string> = {
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
};

export function toBrowserKeyBinding(binding: Pick<Keybinding, "key" | "command">) {
  const { parts, isChord } = parseKeybinding(binding.key);
  const [part] = parts;
  if (isChord || !part?.key) return null;

  const key = part.key.toLowerCase();
  const digit = /^[0-9]$/.test(key) ? `Digit${key}` : null;
  return {
    command: binding.command,
    key,
    code: KEY_TO_CODE[key] ?? digit,
    meta: part.modifiers.includes("cmd") || part.modifiers.includes("meta"),
    ctrl: part.modifiers.includes("ctrl"),
    alt: part.modifiers.includes("alt"),
    shift: part.modifiers.includes("shift"),
  } satisfies BrowserKeyBinding;
}

/** The current bindings of the forwarded commands, as a browser tab's page should match them. */
export function getBrowserKeyBindings(): BrowserKeyBinding[] {
  const { settings } = useSettingsStore.getState();
  const keybindings = getEffectiveKeybindings({
    preset: settings.keybindingPreset,
    registryKeybindings: keymapRegistry.getAllKeybindings(),
    userKeybindings: useKeymapStore.getState().keybindings,
  });
  const contexts = { browserFocus: true };

  return keybindings.flatMap((binding) => {
    if (!PAGE_FORWARDED_COMMANDS.has(binding.command)) return [];
    if (binding.enabled === false) return [];
    if (binding.when && !evaluateWhenClause(binding.when, contexts)) return [];
    const browserBinding = toBrowserKeyBinding(binding);
    return browserBinding ? [browserBinding] : [];
  });
}

/** Forwarded commands that act on the page itself, so the page keeps keyboard focus. */
export function isPageCommand(command: string): boolean {
  return (
    command.startsWith("browser.") ||
    command === "workbench.zoomIn" ||
    command === "workbench.zoomOut" ||
    command === "workbench.zoomReset"
  );
}
