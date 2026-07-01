import { eventToKey, keysMatch } from "./matcher";
import { parseKeybinding } from "./parser";

const NATIVE_MENU_ACCELERATORS = [
  "cmd+n",
  "cmd+shift+n",
  "cmd+o",
  "cmd+s",
  "cmd+shift+s",
  "cmd+alt+s",
  "cmd+w",
  "cmd+shift+t",
  "cmd+q",
  "cmd+f",
  "cmd+alt+f",
  "cmd+/",
  "cmd+shift+k",
  "shift+alt+f",
  // Command palette stays in the frontend pipeline so Ctrl+Shift+P can cancel
  // the webview print shortcut before any browser default handling runs.
  "cmd+b",
  "cmd+j",
  "cmd+shift+f",
  "cmd+shift+j",
  "cmd+shift+e",
  "cmd+shift+g",
  "cmd+r",
  "cmd+shift+space",
  "cmd+i",
  "alt+m",
  "cmd+p",
  "cmd+g",
  "f12",
  "shift+f12",
  "f2",
  "cmd+alt+right",
  "cmd+alt+left",
  "f5",
  "shift+f5",
  "f9",
  "cmd+m",
  "alt+f9",
  "alt+f10",
  "cmd+alt+z",
  "f11",
  "cmd+ctrl+f",
] as const;

const parsedNativeMenuAccelerators = NATIVE_MENU_ACCELERATORS.map((shortcut) =>
  parseKeybinding(shortcut, { normalize: false }),
);

export function isNativeMenuAccelerator(event: KeyboardEvent) {
  const eventKey = eventToKey(event);
  return parsedNativeMenuAccelerators.some((shortcut) => {
    if (shortcut.isChord) return false;
    return keysMatch(eventKey, shortcut.parts[0]);
  });
}
