/**
 * Parser for VS Code-style keyboard shortcuts
 * Examples: "cmd+s", "ctrl+shift+p", "cmd+k cmd+t"
 */

import { normalizeKey } from "./platform";

export interface ParsedKey {
  modifiers: string[];
  key: string;
}

export interface ParsedKeybinding {
  parts: ParsedKey[];
  isChord: boolean;
}

const MODIFIER_KEYS = ["ctrl", "cmd", "alt", "shift", "meta"];
const SPECIAL_KEYS: Record<string, string> = {
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  space: " ",
  backspace: "Backspace",
  delete: "Delete",
  escape: "Escape",
  esc: "Escape",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  insert: "Insert",
};

/**
 * Parse a key combination string like "cmd+s" or "ctrl+shift+p"
 */
export function parseKeyCombination(combo: string): ParsedKey {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((p) => p.trim());
  const modifiers: string[] = [];
  let key = "";

  for (const part of parts) {
    if (MODIFIER_KEYS.includes(part)) {
      if (!modifiers.includes(part)) {
        modifiers.push(part);
      }
    } else {
      key = part;
    }
  }

  // Normalize special keys
  if (SPECIAL_KEYS[key]) {
    key = SPECIAL_KEYS[key];
  }

  // Sort modifiers for consistent comparison
  modifiers.sort();

  return { modifiers, key };
}

/**
 * Parse a full keybinding string (may include chords like "cmd+k cmd+t")
 */
export function parseKeybinding(binding: string): ParsedKeybinding {
  // Normalize for platform (cmd -> ctrl on Windows/Linux)
  const normalized = normalizeKey(binding);

  // Split by space to detect chords
  const parts = normalized
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .map(parseKeyCombination);

  return {
    parts,
    isChord: parts.length > 1,
  };
}

/**
 * Convert ParsedKey back to string for display
 */
export function stringifyKeyCombination(parsed: ParsedKey): string {
  const parts = [...parsed.modifiers];
  if (parsed.key) {
    parts.push(parsed.key);
  }
  return parts.join("+");
}

/**
 * Convert ParsedKeybinding back to string
 */
export function stringifyKeybinding(parsed: ParsedKeybinding): string {
  return parsed.parts.map(stringifyKeyCombination).join(" ");
}
