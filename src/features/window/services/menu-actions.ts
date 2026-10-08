import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * The one event every native menu, Dock menu and in-window menu bar action arrives through,
 * sent to the window it applies to.
 */
const MENU_ACTION_EVENT = "menu://action";

interface MenuAction {
  action: string;
  /** The command id or theme id for the actions that carry one. */
  value?: string | null;
}

/** Sends a menu action to the current window, as the in-window menu bar does. */
export function emitMenuAction(action: string, value?: string) {
  const currentWindow = getCurrentWebviewWindow();
  return currentWindow.emitTo(currentWindow.label, MENU_ACTION_EVENT, {
    action,
    value: value ?? null,
  } satisfies MenuAction);
}

/** Calls `handler` for every menu action sent to the current window. */
export function listenToMenuActions(handler: (action: MenuAction) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<MenuAction>(MENU_ACTION_EVENT, (event) =>
    handler(event.payload),
  );
}
