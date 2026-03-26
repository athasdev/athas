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
  return key;
}

export function keybindingToDisplay(binding: string): string[] {
  const parsed = parseKeybinding(binding.replace(/\bMod\b/g, "cmd"));
  const keys: string[] = [];

  for (const part of parsed.parts) {
    keys.push(...part.modifiers.map(formatModifier));
    if (part.key) {
      keys.push(formatKey(part.key));
    }
  }

  return keys;
}
