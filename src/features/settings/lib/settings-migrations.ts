export const SETTINGS_SCHEMA_VERSION = 3;
export const SETTINGS_SCHEMA_VERSION_KEY = "settingsSchemaVersion";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getSettingsSchemaVersion(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function migrateSettingsRecord(
  settings: Record<string, unknown>,
  schemaVersion: number,
): Record<string, unknown> {
  const migratedSettings = { ...settings };

  if (schemaVersion < 2) {
    migratedSettings.coreFeatures = {
      ...(isRecord(migratedSettings.coreFeatures) ? migratedSettings.coreFeatures : {}),
      debugger: true,
    };
  }

  if (schemaVersion < 3) {
    const hiddenGitSidebarItems = Array.isArray(migratedSettings.hiddenGitSidebarItems)
      ? migratedSettings.hiddenGitSidebarItems
      : [];
    migratedSettings.hiddenGitSidebarItems =
      migratedSettings.showActivityRailWorktrees === false
        ? Array.from(new Set([...hiddenGitSidebarItems, "worktrees"]))
        : hiddenGitSidebarItems;
    delete migratedSettings.showActivityRailWorktrees;
  }

  return migratedSettings;
}
