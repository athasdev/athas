import {
  isKeybindingPreset,
  type KeybindingPreset,
} from "@/features/keymaps/defaults/keybinding-presets";
import type { Keybinding } from "@/features/keymaps/types";

const KEYBINDINGS_EXPORT_FORMAT = "athas.keybindings";
const KEYBINDINGS_EXPORT_VERSION = 1;

export interface KeybindingsExportPayload {
  format: typeof KEYBINDINGS_EXPORT_FORMAT;
  version: typeof KEYBINDINGS_EXPORT_VERSION;
  exportedAt: string;
  keybindingPreset: KeybindingPreset;
  keybindings: Keybinding[];
}

export interface KeybindingsImport {
  keybindingPreset?: KeybindingPreset;
  keybindings: Keybinding[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getKeybindingsCandidate(value: unknown): {
  keybindingPreset?: KeybindingPreset;
  keybindings: unknown[];
} | null {
  if (Array.isArray(value)) {
    return { keybindings: value };
  }

  if (
    isRecord(value) &&
    value.format === KEYBINDINGS_EXPORT_FORMAT &&
    value.version === KEYBINDINGS_EXPORT_VERSION &&
    Array.isArray(value.keybindings)
  ) {
    return {
      keybindingPreset:
        typeof value.keybindingPreset === "string" && isKeybindingPreset(value.keybindingPreset)
          ? value.keybindingPreset
          : undefined,
      keybindings: value.keybindings,
    };
  }

  return null;
}

export function normalizeUserKeybinding(value: unknown): Keybinding | null {
  if (!isRecord(value) || typeof value.key !== "string" || typeof value.command !== "string") {
    return null;
  }

  const key = value.key.trim();
  const command = value.command.trim();

  if (!key || !command) {
    return null;
  }

  const keybinding: Keybinding = {
    key,
    command,
    source: "user",
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
  };

  if (typeof value.when === "string" && value.when.trim()) {
    keybinding.when = value.when.trim();
  }

  if ("args" in value) {
    keybinding.args = value.args;
  }

  return keybinding;
}

export function getExportableUserKeybindings(keybindings: Keybinding[]): Keybinding[] {
  return keybindings
    .map((keybinding) => normalizeUserKeybinding(keybinding))
    .filter((keybinding): keybinding is Keybinding => keybinding !== null);
}

export function createKeybindingsExportPayload({
  keybindingPreset,
  keybindings,
}: {
  keybindingPreset: KeybindingPreset;
  keybindings: Keybinding[];
}): KeybindingsExportPayload {
  return {
    format: KEYBINDINGS_EXPORT_FORMAT,
    version: KEYBINDINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    keybindingPreset,
    keybindings: getExportableUserKeybindings(keybindings),
  };
}

export function parseKeybindingsImportJson(jsonString: string): KeybindingsImport | null {
  const parsed = JSON.parse(jsonString);
  const candidate = getKeybindingsCandidate(parsed);

  if (!candidate) {
    return null;
  }

  return {
    keybindingPreset: candidate.keybindingPreset,
    keybindings: candidate.keybindings
      .map((keybinding) => normalizeUserKeybinding(keybinding))
      .filter((keybinding): keybinding is Keybinding => keybinding !== null),
  };
}
