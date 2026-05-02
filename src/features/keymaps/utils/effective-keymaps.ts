import { getKeybindingPresetDefinition } from "@/features/keymaps/defaults/keybinding-presets";
import type { Keybinding } from "@/features/keymaps/types";
import type { Settings } from "@/features/settings/types/settings";

interface EffectiveKeybindingsInput {
  preset: Settings["keybindingPreset"];
  registryKeybindings: Keybinding[];
  userKeybindings: Keybinding[];
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
  const userCommandIds = new Set(userKeybindings.map((binding) => binding.command));

  return [
    ...userKeybindings,
    ...baseKeybindings.filter((binding) => !userCommandIds.has(binding.command)),
  ];
}

export function getEffectiveKeybindingForCommand({
  commandId,
  preset,
  registryKeybindings,
  userKeybindings,
}: EffectiveKeybindingsInput & { commandId: string }): Keybinding | undefined {
  return getEffectiveKeybindings({
    preset,
    registryKeybindings,
    userKeybindings,
  }).find((binding) => binding.command === commandId);
}
