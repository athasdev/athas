import type { Settings } from "@/features/settings/types/settings";
import { defaultKeymaps } from "./default-keymaps";
import type { Keybinding } from "../types";

export type KeybindingPreset = Settings["keybindingPreset"];

export interface KeybindingPresetDefinition {
  label: string;
  description: string;
  overrides: Keybinding[];
  disabledCommands: string[];
}

export interface KeybindingPresetCoverageReport {
  coveredCommandIds: string[];
  missingCommandIds: string[];
  totalCommandCount: number;
  isComplete: boolean;
}

export interface KeybindingPresetDiffReport {
  changedCommandIds: string[];
  unchangedCommandIds: string[];
}

const defaultPresetBindings = new Map<string, Keybinding>();

for (const binding of defaultKeymaps) {
  if (!defaultPresetBindings.has(binding.command)) {
    defaultPresetBindings.set(binding.command, { ...binding, source: "preset" });
  }
}

const defaultPresetCommandIds = [...defaultPresetBindings.keys()];

function createPresetDefinition({
  label,
  description,
  overrides = [],
  disabledCommands = [],
}: {
  label: string;
  description: string;
  overrides?: Keybinding[];
  disabledCommands?: string[];
}): KeybindingPresetDefinition {
  const overrideByCommand = new Map(
    overrides.map((binding) => [binding.command, { ...binding, source: "preset" as const }]),
  );
  const disabledCommandIds = new Set(disabledCommands);

  return {
    label,
    description,
    overrides: defaultPresetCommandIds
      .filter((commandId) => !disabledCommandIds.has(commandId))
      .map((commandId) => overrideByCommand.get(commandId) ?? defaultPresetBindings.get(commandId)!)
      .concat(
        overrides
          .map((binding) => ({ ...binding, source: "preset" as const }))
          .filter((binding) => !defaultPresetBindings.has(binding.command)),
      ),
    disabledCommands,
  };
}

export const keybindingPresetDefinitions: Record<KeybindingPreset, KeybindingPresetDefinition> = {
  none: {
    label: "None",
    description: "Use Athas built-in shortcuts.",
    overrides: [],
    disabledCommands: [],
  },
  vscode: createPresetDefinition({
    label: "VS Code",
    description: "Match common VS Code shortcuts.",
    overrides: [
      { key: "cmd+n", command: "file.new", source: "preset" },
      { key: "ctrl+g", command: "editor.goToLine", source: "preset" },
      { key: "cmd+alt+f", command: "workbench.showFindReplace", source: "preset" },
      { key: "cmd+shift+m", command: "workbench.toggleDiagnostics", source: "preset" },
    ],
  }),
  jetbrains: createPresetDefinition({
    label: "JetBrains",
    description: "Match common JetBrains IDE shortcuts.",
    overrides: [
      { key: "cmd+shift+a", command: "workbench.commandPalette", source: "preset" },
      { key: "cmd+shift+n", command: "file.quickOpen", source: "preset" },
      { key: "cmd+l", command: "editor.goToLine", source: "preset" },
      { key: "cmd+1", command: "workbench.showFileExplorer", source: "preset" },
      { key: "cmd+9", command: "workbench.showSourceControl", source: "preset" },
      { key: "cmd+b", command: "editor.goToDefinition", source: "preset" },
      { key: "alt+F7", command: "editor.goToReferences", source: "preset" },
      { key: "cmd+e", command: "file.reopenClosed", source: "preset" },
    ],
  }),
  sublime: createPresetDefinition({
    label: "Sublime Text",
    description: "Match common Sublime Text shortcuts.",
    overrides: [
      { key: "cmd+shift+d", command: "editor.duplicateLine", source: "preset" },
      { key: "cmd+k cmd+b", command: "workbench.toggleSidebar", source: "preset" },
      { key: "cmd+shift+p", command: "workbench.commandPalette", source: "preset" },
      { key: "ctrl+g", command: "editor.goToLine", source: "preset" },
      { key: "cmd+shift+f", command: "workbench.showGlobalSearch", source: "preset" },
    ],
  }),
  xcode: createPresetDefinition({
    label: "Xcode",
    description: "Match common Xcode shortcuts.",
    overrides: [
      { key: "cmd+shift+a", command: "workbench.commandPalette", source: "preset" },
      { key: "cmd+shift+o", command: "file.quickOpen", source: "preset" },
      { key: "cmd+1", command: "workbench.showFileExplorer", source: "preset" },
      { key: "cmd+5", command: "workbench.toggleDiagnostics", source: "preset" },
      { key: "cmd+0", command: "workbench.toggleSidebar", source: "preset" },
      { key: "cmd+shift+f", command: "workbench.showGlobalSearch", source: "preset" },
      { key: "cmd+l", command: "editor.goToLine", source: "preset" },
    ],
  }),
  atom: createPresetDefinition({
    label: "Atom",
    description: "Match common Atom shortcuts.",
    overrides: [
      { key: "cmd+shift+p", command: "workbench.commandPalette", source: "preset" },
      { key: "cmd+\\", command: "workbench.toggleSidebar", source: "preset" },
      { key: "cmd+shift+f", command: "workbench.showGlobalSearch", source: "preset" },
      { key: "cmd+alt+f", command: "workbench.showFindReplace", source: "preset" },
      { key: "ctrl+`", command: "workbench.toggleTerminalAlt", source: "preset" },
      { key: "cmd+shift+d", command: "editor.duplicateLine", source: "preset" },
      { key: "ctrl+g", command: "editor.goToLine", source: "preset" },
    ],
  }),
  emacs: createPresetDefinition({
    label: "Emacs",
    description: "Match common Emacs shortcuts.",
    overrides: [
      { key: "alt+x", command: "workbench.commandPalette", source: "preset" },
      { key: "ctrl+x ctrl+f", command: "file.open", source: "preset" },
      { key: "ctrl+x ctrl+s", command: "file.save", source: "preset" },
      { key: "ctrl+x k", command: "file.close", source: "preset" },
      { key: "ctrl+/", command: "editor.undo", source: "preset" },
      { key: "alt+w", command: "editor.copy", source: "preset" },
      { key: "ctrl+w", command: "editor.cut", source: "preset" },
      { key: "ctrl+y", command: "editor.paste", source: "preset" },
      { key: "ctrl+s", command: "workbench.showFind", source: "preset" },
      { key: "alt+g g", command: "editor.goToLine", source: "preset" },
    ],
  }),
  zed: createPresetDefinition({
    label: "Zed",
    description: "Match common Zed shortcuts.",
    overrides: [
      { key: "cmd+shift+p", command: "workbench.commandPalette", source: "preset" },
      { key: "cmd+p", command: "file.quickOpen", source: "preset" },
      { key: "cmd+shift+f", command: "workbench.showGlobalSearch", source: "preset" },
      { key: "cmd+b", command: "workbench.toggleSidebar", source: "preset" },
      { key: "cmd+j", command: "workbench.toggleTerminal", source: "preset" },
      { key: "cmd+shift+e", command: "workbench.showFileExplorer", source: "preset" },
      { key: "cmd+shift+g", command: "workbench.showSourceControl", source: "preset" },
    ],
  }),
};

export const keybindingPresetOptions = Object.entries(keybindingPresetDefinitions).map(
  ([value, definition]) => ({
    value: value as KeybindingPreset,
    label: definition.label,
  }),
);

export function isKeybindingPreset(value: string): value is KeybindingPreset {
  return value in keybindingPresetDefinitions;
}

export function getKeybindingPresetCoverageReport(
  preset: KeybindingPreset,
): KeybindingPresetCoverageReport {
  if (preset === "none") {
    return {
      coveredCommandIds: [],
      missingCommandIds: [],
      totalCommandCount: defaultPresetCommandIds.length,
      isComplete: true,
    };
  }

  const definition = keybindingPresetDefinitions[preset];
  const coveredCommandIds = defaultPresetCommandIds.filter(
    (commandId) =>
      definition.disabledCommands.includes(commandId) ||
      definition.overrides.some((binding) => binding.command === commandId),
  );
  const missingCommandIds = defaultPresetCommandIds.filter(
    (commandId) => !coveredCommandIds.includes(commandId),
  );

  return {
    coveredCommandIds,
    missingCommandIds,
    totalCommandCount: defaultPresetCommandIds.length,
    isComplete: missingCommandIds.length === 0,
  };
}

export function getKeybindingPresetDiffReport(
  preset: KeybindingPreset,
): KeybindingPresetDiffReport {
  if (preset === "none") {
    return {
      changedCommandIds: [],
      unchangedCommandIds: [...defaultPresetCommandIds],
    };
  }

  const definition = keybindingPresetDefinitions[preset];
  const changedCommandIds = defaultPresetCommandIds.filter((commandId) => {
    if (definition.disabledCommands.includes(commandId)) {
      return true;
    }

    const defaultBinding = defaultPresetBindings.get(commandId);
    const presetBinding = definition.overrides.find((binding) => binding.command === commandId);
    if (!defaultBinding || !presetBinding) {
      return false;
    }

    return (
      defaultBinding.key !== presetBinding.key ||
      defaultBinding.when !== presetBinding.when ||
      JSON.stringify(defaultBinding.args) !== JSON.stringify(presetBinding.args)
    );
  });

  return {
    changedCommandIds,
    unchangedCommandIds: defaultPresetCommandIds.filter(
      (commandId) => !changedCommandIds.includes(commandId),
    ),
  };
}

export function getKeybindingPresetDefinition(
  preset: KeybindingPreset,
): KeybindingPresetDefinition {
  return keybindingPresetDefinitions[preset] ?? keybindingPresetDefinitions.none;
}
