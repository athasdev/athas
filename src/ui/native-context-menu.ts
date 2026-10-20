import { LogicalPosition } from "@tauri-apps/api/dpi";
import {
  type CheckMenuItemOptions,
  Menu,
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from "@tauri-apps/api/menu";
import { parseKeybinding } from "@/utils/keyboard/keybinding-parser";
import { IS_LINUX, IS_WEB } from "@/utils/platform";

/**
 * A context menu as the OS draws it. Native menus carry text, enabled and checked state, a
 * shortcut hint and submenus; icons and tones have no native equivalent and are left out.
 */
export type NativeMenuEntry =
  | {
      type: "item";
      label: string;
      disabled?: boolean;
      checked?: boolean;
      /** A keybinding such as `cmd+shift+p`, shown as the item's accelerator. */
      shortcut?: string;
      onSelect: () => void;
    }
  | { type: "separator" }
  | { type: "submenu"; label: string; disabled?: boolean; items: NativeMenuEntry[] };

type NativeMenuItemOptions =
  | MenuItemOptions
  | CheckMenuItemOptions
  | PredefinedMenuItemOptions
  | SubmenuOptions;

/**
 * How long a dismissed menu waits for a late item event before it counts as closed without a
 * choice. The popup call returns when the menu closes, and the click arrives on its own channel.
 */
const SELECTION_GRACE_MS = 150;
/** The native menu outlives the grace a little, so a slow item event still finds its handler. */
const RELEASE_DELAY_MS = 2000;

let nativeMenusUnavailable = false;
let activeMenu: Menu | null = null;

/** Whether right-click menus can be drawn by the OS: the desktop app, outside tests and the web build. */
export function canUseNativeContextMenu(): boolean {
  // The flag Tauri's webview sets, read directly (as `isTauri()` does) so modules that mock the
  // core API don't need to provide it.
  return (
    !IS_WEB && !nativeMenusUnavailable && Boolean((globalThis as { isTauri?: boolean }).isTauri)
  );
}

const NAMED_KEYS = new Set([
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Insert",
]);

const ACCELERATOR_MODIFIERS: Record<string, string> = {
  cmd: "CmdOrCtrl",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Super",
};

/**
 * Converts an app keybinding into a native accelerator. The accelerator only labels the item:
 * a context menu is not part of the menu bar, so it never fires the shortcut on its own. Chords
 * and keys the OS can't name have no accelerator.
 */
export function shortcutToAccelerator(binding: string): string | undefined {
  const parsed = parseKeybinding(binding.replace(/\bmod\b/gi, "cmd"));
  if (parsed.parts.length !== 1) return undefined;
  const [{ modifiers, key }] = parsed.parts;

  let nativeKey: string | undefined;
  if (key === " ") nativeKey = "Space";
  else if (/^f\d{1,2}$/i.test(key)) nativeKey = key.toUpperCase();
  else if (key.length === 1) nativeKey = key.toUpperCase();
  else if (NAMED_KEYS.has(key)) nativeKey = key;
  if (!nativeKey) return undefined;

  const nativeModifiers = modifiers.map((modifier) => ACCELERATOR_MODIFIERS[modifier]);
  if (nativeModifiers.some((modifier) => !modifier)) return undefined;
  return [...nativeModifiers, nativeKey].join("+");
}

/** `&` marks a mnemonic in native menu text, so a literal one is doubled. */
function menuText(label: string) {
  return label.replace(/&/g, "&&");
}

/** Drops separators at either end and runs of them, which native menus would draw as is. */
function tidySeparators(entries: readonly NativeMenuEntry[]): NativeMenuEntry[] {
  const tidy: NativeMenuEntry[] = [];
  for (const entry of entries) {
    if (
      entry.type === "separator" &&
      (tidy.length === 0 || tidy[tidy.length - 1]?.type === "separator")
    ) {
      continue;
    }
    tidy.push(entry);
  }
  if (tidy[tidy.length - 1]?.type === "separator") tidy.pop();
  return tidy;
}

/** The option objects `Menu.new` takes for a list of entries. */
export function toNativeMenuItems(
  entries: readonly NativeMenuEntry[],
  onSelect: (entry: Extract<NativeMenuEntry, { type: "item" }>) => void,
): NativeMenuItemOptions[] {
  return tidySeparators(entries).map((entry): NativeMenuItemOptions => {
    if (entry.type === "separator") return { item: "Separator" };

    if (entry.type === "submenu") {
      const items = toNativeMenuItems(entry.items, onSelect);
      if (items.length === 0) return { text: menuText(entry.label), enabled: false };
      return { text: menuText(entry.label), enabled: !entry.disabled, items };
    }

    const accelerator = entry.shortcut ? shortcutToAccelerator(entry.shortcut) : undefined;
    const item: MenuItemOptions = {
      text: menuText(entry.label),
      enabled: !entry.disabled,
      ...(accelerator ? { accelerator } : {}),
      action: () => onSelect(entry),
    };
    return entry.checked === undefined ? item : { ...item, checked: entry.checked };
  });
}

function releaseMenu(menu: Menu) {
  if (activeMenu === menu) activeMenu = null;
  void menu.close().catch(() => undefined);
}

interface ShowNativeContextMenuOptions {
  entries: readonly NativeMenuEntry[];
  /** Where to open, in CSS pixels from the top left of the window. */
  point: { x: number; y: number };
  /** Called once the menu is gone, after the chosen item's action when there was one. */
  onClose?: () => void;
  /** Aborting before the menu shows cancels it; aborting later only skips `onClose`. */
  signal?: AbortSignal;
}

/**
 * Shows `entries` as an OS context menu. Resolves to `false` when the platform can't draw one,
 * so the caller can fall back to the HTML menu.
 */
export async function showNativeContextMenu({
  entries,
  point,
  onClose,
  signal,
}: ShowNativeContextMenuOptions): Promise<boolean> {
  let settled = false;
  let menu: Menu | null = null;
  const settle = () => {
    if (settled) return false;
    settled = true;
    return true;
  };
  const select = (entry: Extract<NativeMenuEntry, { type: "item" }>) => {
    const first = settle();
    try {
      entry.onSelect();
    } finally {
      if (first && !signal?.aborted) onClose?.();
      const selectedMenu = menu;
      if (selectedMenu) setTimeout(() => releaseMenu(selectedMenu), 0);
    }
  };

  try {
    menu = await Menu.new({ items: toNativeMenuItems(entries, select) });
  } catch (error) {
    nativeMenusUnavailable = true;
    console.warn("Native context menus are unavailable, using the in-app menu.", error);
    return false;
  }

  if (signal?.aborted) {
    releaseMenu(menu);
    return true;
  }

  if (activeMenu) releaseMenu(activeMenu);
  activeMenu = menu;

  try {
    await menu.popup(new LogicalPosition(point.x, point.y));
  } catch (error) {
    releaseMenu(menu);
    nativeMenusUnavailable = true;
    console.warn("Native context menus are unavailable, using the in-app menu.", error);
    return false;
  }

  const shownMenu = menu;
  setTimeout(() => {
    if (settle() && !signal?.aborted) onClose?.();
  }, SELECTION_GRACE_MS);
  // On Linux the popup call returns while the menu is still open, so the menu stays alive until
  // the next one replaces it or an item is chosen.
  if (!IS_LINUX) {
    setTimeout(() => {
      if (activeMenu === shownMenu) releaseMenu(shownMenu);
    }, RELEASE_DELAY_MS);
  }
  return true;
}
