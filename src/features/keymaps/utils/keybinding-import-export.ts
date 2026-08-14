import {
  isKeybindingPreset,
  type KeybindingPreset,
} from "@/features/keymaps/defaults/keybinding-presets";
import type { Keybinding } from "@/features/keymaps/types/keymaps.types";
import { currentPlatform } from "@/utils/platform";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import {
  getDefaultImportCommandIds,
  importVsCodeKeybindings,
  type KeybindingImportIssue,
  type KeybindingImportPlatform,
} from "./vscode-keybinding-import";

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
  format: "athas" | "vscode";
  keybindingPreset?: KeybindingPreset;
  keybindings: Keybinding[];
  issues: KeybindingImportIssue[];
}

export interface KeybindingsImportOptions {
  commandIds?: Iterable<string>;
  platform?: KeybindingImportPlatform;
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

  if (value.replaceDefaults === false) {
    keybinding.replaceDefaults = false;
  }

  return keybinding;
}

export function getExportableUserKeybindings(keybindings: Keybinding[]): Keybinding[] {
  return keybindings
    .map((keybinding) => normalizeUserKeybinding(keybinding))
    .filter((keybinding): keybinding is Keybinding => keybinding !== null);
}

export function mergeImportedUserKeybindings(
  currentKeybindings: Keybinding[],
  importedKeybindings: Keybinding[],
): Keybinding[] {
  const imported = getExportableUserKeybindings(importedKeybindings);
  const importedCommandIds = new Set(imported.map((keybinding) => keybinding.command));

  return [
    ...imported,
    ...getExportableUserKeybindings(currentKeybindings).filter(
      (keybinding) => !importedCommandIds.has(keybinding.command),
    ),
  ];
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

function getCurrentImportPlatform(): KeybindingImportPlatform {
  if (currentPlatform === "macos" || currentPlatform === "windows") return currentPlatform;
  return "linux";
}

function parseJsonWithComments(jsonString: string): unknown {
  const errors: ParseError[] = [];
  const parsed = parse(jsonString.replace(/^\uFEFF/, ""), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    const firstError = errors[0];
    throw new SyntaxError(
      `${printParseErrorCode(firstError.error)} at offset ${firstError.offset}`,
    );
  }

  return parsed;
}

export function parseKeybindingsImportJson(
  jsonString: string,
  options: KeybindingsImportOptions = {},
): KeybindingsImport | null {
  const parsed = parseJsonWithComments(jsonString);
  const candidate = getKeybindingsCandidate(parsed);

  if (!candidate) {
    return null;
  }

  if (!Array.isArray(parsed)) {
    const keybindings: Keybinding[] = [];
    const issues: KeybindingImportIssue[] = [];

    candidate.keybindings.forEach((value, index) => {
      const keybinding = normalizeUserKeybinding(value);
      if (keybinding) {
        keybindings.push(keybinding);
      } else {
        issues.push({ index, reason: "invalid-entry" });
      }
    });

    return {
      format: "athas",
      keybindingPreset: candidate.keybindingPreset,
      keybindings,
      issues,
    };
  }

  const commandIds = new Set(options.commandIds ?? getDefaultImportCommandIds());
  const imported = importVsCodeKeybindings(candidate.keybindings, {
    commandIds,
    platform: options.platform ?? getCurrentImportPlatform(),
  });

  return {
    format: imported.format,
    keybindings: imported.keybindings,
    issues: imported.issues,
  };
}
