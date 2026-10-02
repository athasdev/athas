import type { Keybinding } from "@/features/keymaps/types/keymaps.types";
import { normalizeKeybindingForComparison } from "./effective-keymaps";

interface KeybindingConflictQuery {
  keybinding: string;
  commandId: string;
  when?: string;
  effectiveKeybindings: Keybinding[];
}

function normalizeWhenClause(when: string | undefined): string {
  return when?.replace(/\s+/g, "") ?? "";
}

/**
 * Finds the effective bindings that fire on the same key in the same context
 * as `keybinding`. The dispatcher runs the first enabled match, so two commands
 * sharing a key and an identical when clause shadow each other. Different when
 * clauses are not reported: they are scoped on purpose, and whether they
 * overlap depends on runtime context.
 */
export function findConflictingKeybindings({
  keybinding,
  commandId,
  when,
  effectiveKeybindings,
}: KeybindingConflictQuery): Keybinding[] {
  if (!keybinding.trim()) return [];

  const normalizedKey = normalizeKeybindingForComparison(keybinding);
  const normalizedWhen = normalizeWhenClause(when);
  const seenCommands = new Set<string>();

  return effectiveKeybindings.filter((binding) => {
    if (binding.command === commandId || binding.enabled === false) return false;
    if (seenCommands.has(binding.command)) return false;
    if (normalizeKeybindingForComparison(binding.key) !== normalizedKey) return false;
    if (normalizeWhenClause(binding.when) !== normalizedWhen) return false;

    seenCommands.add(binding.command);
    return true;
  });
}
