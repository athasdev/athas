import {
  defaultSettings,
  getDefaultSettingsSnapshot,
} from "@/features/settings/config/default-settings";
import {
  getSettingsSchemaVersion,
  migrateSettingsRecord,
  SETTINGS_SCHEMA_VERSION,
} from "@/features/settings/lib/settings-migrations";
import { normalizeSettings } from "@/features/settings/lib/settings-normalization";
import type { Settings } from "@/features/settings/types/settings.types";

const SETTINGS_EXPORT_FORMAT = "athas.settings";

export interface SettingsExportPayload {
  format: typeof SETTINGS_EXPORT_FORMAT;
  version: typeof SETTINGS_SCHEMA_VERSION;
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

function getSettingsCandidate(value: unknown): {
  settings: unknown;
  schemaVersion: number;
} | null {
  if (isRecord(value) && value.format === SETTINGS_EXPORT_FORMAT) {
    const schemaVersion = getSettingsSchemaVersion(value.version);
    if (schemaVersion === 0 || schemaVersion > SETTINGS_SCHEMA_VERSION) {
      return null;
    }

    return { settings: value.settings, schemaVersion };
  }

  return { settings: value, schemaVersion: 0 };
}

export function createSettingsExportPayload(settings: Settings): SettingsExportPayload {
  return {
    format: SETTINGS_EXPORT_FORMAT,
    version: SETTINGS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: cloneSettings(settings),
  };
}

export function parseSettingsImportJson(jsonString: string): Settings | null {
  const parsed = JSON.parse(jsonString);
  const candidate = getSettingsCandidate(parsed);
  const importedSettings = candidate ? pickSettings(candidate.settings) : null;

  if (!importedSettings || Object.keys(importedSettings).length === 0) {
    return null;
  }

  const migratedSettings = migrateSettingsRecord(
    importedSettings as Record<string, unknown>,
    candidate?.schemaVersion ?? 0,
  ) as Partial<Settings>;

  if (
    migratedSettings.rightSidebarWidth === undefined &&
    migratedSettings.sidebarWidth !== undefined
  ) {
    migratedSettings.rightSidebarWidth = migratedSettings.sidebarWidth;
  }

  return normalizeSettings({
    ...getDefaultSettingsSnapshot(),
    ...migratedSettings,
  });
}
