/**
 * Keyboard event matcher
 * Matches KeyboardEvent against parsed keybindings
 */

import type { ParsedKey } from "./parser";
import { parseKeybinding } from "./parser";

/**
 * Map of event.code to logical key name for special keys
 * This helps handle keys that might report "Dead" or other values for event.key
 */
const CODE_TO_KEY: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/**
 * Convert KeyboardEvent to ParsedKey format
 */
export function eventToKey(event: KeyboardEvent): ParsedKey {
  const modifiers: string[] = [];

  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.metaKey) modifiers.push("cmd");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");

  modifiers.sort();

  // Use event.key by default, but fall back to code mapping for special keys
  // This handles cases where event.key returns "Dead" or other non-character values
  let key = event.key;
  if (key === "Dead" || key === "Unidentified") {
    key = CODE_TO_KEY[event.code] || event.code;
  }

  return {
    modifiers,
    key,
  };
}

/**
 * Check if two ParsedKey objects match
 */
export function keysMatch(a: ParsedKey, b: ParsedKey): boolean {
  if (a.key.toLowerCase() !== b.key.toLowerCase()) return false;
  if (a.modifiers.length !== b.modifiers.length) return false;

  for (let i = 0; i < a.modifiers.length; i++) {
    if (a.modifiers[i] !== b.modifiers[i]) return false;
  }

  return true;
}

/**
 * Check if a keyboard event matches a keybinding string
 * Returns true for single-key bindings, or chord index for multi-key bindings
 */
export function matchKeybinding(
  event: KeyboardEvent,
  keybinding: string,
  chordState?: ParsedKey[],
): { matched: boolean; partialMatch?: boolean; nextChordIndex?: number } {
  const parsed = parseKeybinding(keybinding);
  const eventKey = eventToKey(event);

  if (!parsed.isChord) {
    // Simple single-key binding - only match if not in chord mode
    if (chordState && chordState.length > 0) {
      return { matched: false };
    }
    return { matched: keysMatch(eventKey, parsed.parts[0]) };
  }

  // Multi-key chord binding
  const currentIndex = chordState ? chordState.length : 0;

  if (currentIndex >= parsed.parts.length) {
    // Already completed the chord or exceeded
    return { matched: false };
  }

  const expectedKey = parsed.parts[currentIndex];
  const matches = keysMatch(eventKey, expectedKey);

  if (!matches) {
    return { matched: false };
  }

  // Check if this completes the chord
  if (currentIndex === parsed.parts.length - 1) {
    return { matched: true };
  }

  // Partial match - waiting for next key in chord
  return {
    matched: false,
    partialMatch: true,
    nextChordIndex: currentIndex + 1,
  };
}
