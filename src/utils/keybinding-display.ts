import { IS_MAC } from "@/utils/platform";
import { parseKeybinding } from "@/features/keymaps/utils/parser";

function formatModifier(modifier: string) {
  if (modifier === "cmd" && IS_MAC) return "⌘";
  if (modifier === "cmd") return "Ctrl";
  if (modifier === "ctrl") return "Ctrl";
  if (modifier === "alt") return IS_MAC ? "⌥" : "Alt";
  if (modifier === "shift") return IS_MAC ? "⇧" : "Shift";
  if (modifier === "meta") return IS_MAC ? "⌘" : "Meta";
  return modifier;
}

function formatKey(key: string) {
  if (key === " ") return "Space";
  if (key.startsWith("Arrow")) return key.replace("Arrow", "");
  if (key.length === 1) return key.toUpperCase();
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  return key;
}

export function keybindingToDisplay(binding: string): string[] {
  return keybindingToDisplayParts(binding).flat();
}

export function keybindingToDisplayParts(binding: string): string[][] {
  const parsed = parseKeybinding(binding.replace(/\bmod\b/gi, "cmd"));
  const parts: string[][] = [];

  for (const part of parsed.parts) {
    const keys = part.modifiers.map(formatModifier);
    if (part.key) {
      keys.push(formatKey(part.key));
    }
    parts.push(keys);
  }

  return parts;
}

export function keysToDisplayParts(keys: string[]): string[][] {
  return [keys];
}
