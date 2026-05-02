import {
  defaultSettings,
  getDefaultSettingsSnapshot,
} from "@/features/settings/config/default-settings";
import { normalizeSettings } from "@/features/settings/lib/settings-normalization";
import type { Settings } from "@/features/settings/types/settings";

const SETTINGS_EXPORT_FORMAT = "athas.settings";
const SETTINGS_EXPORT_VERSION = 1;

export interface SettingsExportPayload {
  format: typeof SETTINGS_EXPORT_FORMAT;
  version: typeof SETTINGS_EXPORT_VERSION;
  exportedAt: string;
  settings: Settings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSettings(settings: Settings): Settings {
  return JSON.parse(JSON.stringify(settings)) as Settings;
}

function pickSettings(value: unknown): Partial<Settings> | null {
  if (!isRecord(value)) {
    return null;
  }

  const settings: Partial<Settings> = {};

  for (const key of Object.keys(defaultSettings) as Array<keyof Settings>) {
    if (key in value) {
      (settings as Record<string, unknown>)[key] = value[key];
    }
  }

  return settings;
}

function getSettingsCandidate(value: unknown): unknown {
  if (
    isRecord(value) &&
    value.format === SETTINGS_EXPORT_FORMAT &&
    value.version === SETTINGS_EXPORT_VERSION
  ) {
    return value.settings;
  }

  return value;
}

export function createSettingsExportPayload(settings: Settings): SettingsExportPayload {
  return {
    format: SETTINGS_EXPORT_FORMAT,
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: cloneSettings(settings),
  };
}

export function parseSettingsImportJson(jsonString: string): Settings | null {
  const parsed = JSON.parse(jsonString);
  const importedSettings = pickSettings(getSettingsCandidate(parsed));

  if (!importedSettings || Object.keys(importedSettings).length === 0) {
    return null;
  }

  return normalizeSettings({
    ...getDefaultSettingsSnapshot(),
    ...importedSettings,
  });
}
