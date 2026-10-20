import { getKeybindingPresetDefinition } from "@/features/keymaps/constants/keybinding-presets";
import type { Keybinding } from "@/features/keymaps/types/keymaps.types";
import type { Settings } from "@/features/settings/types/settings.types";
import { parseKeybinding } from "@/utils/keyboard/keybinding-parser";

interface EffectiveKeybindingsInput {
  preset: Settings["keybindingPreset"];
  registryKeybindings: Keybinding[];
  userKeybindings: Keybinding[];
}

function normalizeKeybindingForComparison(keybinding: string): string {
  return parseKeybinding(keybinding)
    .parts.map((part) => `${part.modifiers.join("+")}+${part.key.toLowerCase()}`)
    .join(" ");
}

function getBaseKeybindingsForPreset(
  preset: Settings["keybindingPreset"],
  registryKeybindings: Keybinding[],
): Keybinding[] {
  const { overrides, disabledCommands } = getKeybindingPresetDefinition(preset);
  const disabledCommandIds = new Set(disabledCommands);
  const overrideByCommand = new Map(overrides.map((binding) => [binding.command, binding]));

  const baseKeybindings = registryKeybindings
    .filter((binding) => !disabledCommandIds.has(binding.command))
    .map((binding) => overrideByCommand.get(binding.command) ?? binding);

  for (const override of overrides) {
    if (!baseKeybindings.some((binding) => binding.command === override.command)) {
      baseKeybindings.push(override);
    }
  }

  return baseKeybindings;
}

export function getEffectiveKeybindings({
  preset,
  registryKeybindings,
  userKeybindings,
}: EffectiveKeybindingsInput): Keybinding[] {
  const baseKeybindings = getBaseKeybindingsForPreset(preset, registryKeybindings);
  const replacedCommandIds = new Set(
    userKeybindings
      .filter((binding) => binding.replaceDefaults !== false)
      .map((binding) => binding.command),
  );
  const removalRules = userKeybindings
    .filter((binding) => binding.enabled === false && binding.replaceDefaults === false)
    .map((binding) => ({
      binding,
      normalizedKey: normalizeKeybindingForComparison(binding.key),
    }));

  return [
    ...userKeybindings,
    ...baseKeybindings.filter((binding) => {
      if (replacedCommandIds.has(binding.command)) return false;
      if (removalRules.length === 0) return true;

      const normalizedKey = normalizeKeybindingForComparison(binding.key);
      return !removalRules.some(
        (removal) =>
          removal.binding.command === binding.command &&
          removal.normalizedKey === normalizedKey &&
          (!removal.binding.when || removal.binding.when === binding.when),
      );
    }),
  ];
}

export function getEffectiveKeybindingForCommand({
  commandId,
  preset,
  registryKeybindings,
  userKeybindings,
}: EffectiveKeybindingsInput & { commandId: string }): Keybinding | undefined {
  const matchingKeybindings = getEffectiveKeybindings({
    preset,
    registryKeybindings,
    userKeybindings,
  }).filter((binding) => binding.command === commandId);

  return matchingKeybindings.find((binding) => binding.enabled !== false) ?? matchingKeybindings[0];
}

export function getEffectiveShortcutsByCommand(
  input: EffectiveKeybindingsInput,
): Map<string, string> {
  const shortcuts = new Map<string, string>();

  for (const binding of getEffectiveKeybindings(input)) {
    if (binding.enabled === false || shortcuts.has(binding.command)) continue;
    shortcuts.set(binding.command, binding.key);
  }

  return shortcuts;
}

/**
 * Each command's effective binding in one pass: the first enabled one, else its first. Lists that
 * show every command read from this instead of resolving each command on its own.
 */
export function getEffectiveKeybindingsByCommand(
  input: EffectiveKeybindingsInput,
): Map<string, Keybinding> {
  const byCommand = new Map<string, Keybinding>();
  for (const binding of getEffectiveKeybindings(input)) {
    const current = byCommand.get(binding.command);
    if (!current || (current.enabled === false && binding.enabled !== false)) {
      byCommand.set(binding.command, binding);
    }
  }
  return byCommand;
}

/**
 * The commands each command shares a key with, among the bindings in effect: both enabled, on the
 * same key, in the same context (or both in none). Keys compare after normalizing, so `Cmd+S` and
 * `cmd+s` collide.
 */
export function getKeybindingConflicts(bindings: Iterable<Keybinding>): Map<string, string[]> {
  const commandsBySlot = new Map<string, Set<string>>();
  for (const binding of bindings) {
    if (binding.enabled === false || !binding.key) continue;
    const slot = `${normalizeKeybindingForComparison(binding.key)}\u0000${binding.when ?? ""}`;
    const commands = commandsBySlot.get(slot) ?? new Set<string>();
    commands.add(binding.command);
    commandsBySlot.set(slot, commands);
  }

  const conflicts = new Map<string, string[]>();
  for (const commands of commandsBySlot.values()) {
    if (commands.size < 2) continue;
    for (const command of commands) {
      const others = [...commands].filter((other) => other !== command);
      conflicts.set(command, [...(conflicts.get(command) ?? []), ...others]);
    }
  }
  return conflicts;
}
