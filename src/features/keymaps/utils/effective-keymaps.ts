import { getKeybindingPresetDefinition } from "@/features/keymaps/defaults/keybinding-presets";
import type { Keybinding } from "@/features/keymaps/types/keymaps.types";
import type { Settings } from "@/features/settings/types/settings.types";
import { parseKeybinding } from "./parser";

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
