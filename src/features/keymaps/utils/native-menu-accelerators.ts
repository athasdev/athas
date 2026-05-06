import { eventToKey, keysMatch } from "./matcher";
import { parseKeybinding } from "./parser";

const NATIVE_MENU_ACCELERATORS = [
  "cmd+shift+n",
  "cmd+o",
  "cmd+s",
  "cmd+shift+s",
  "cmd+w",
  "cmd+q",
  "cmd+f",
  "cmd+alt+f",
  "cmd+/",
  // Command palette stays in the frontend pipeline so Ctrl+Shift+P can cancel
  // the webview print shortcut before any browser default handling runs.
  "cmd+b",
  "cmd+j",
  "cmd+r",
  "alt+m",
  "cmd+p",
  "cmd+g",
  "cmd+alt+right",
  "cmd+alt+left",
  "cmd+m",
  "alt+f9",
  "alt+f10",
  "cmd+alt+z",
  "f11",
  "cmd+ctrl+f",
] as const;

const parsedNativeMenuAccelerators = NATIVE_MENU_ACCELERATORS.map((shortcut) =>
  parseKeybinding(shortcut),
);

export function isNativeMenuAccelerator(event: KeyboardEvent) {
  const eventKey = eventToKey(event);
  return parsedNativeMenuAccelerators.some((shortcut) => {
    if (shortcut.isChord) return false;
    return keysMatch(eventKey, shortcut.parts[0]);
  });
}
