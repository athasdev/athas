export const SETTINGS_SCHEMA_VERSION = 5;
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

  if (schemaVersion < 4) {
    migratedSettings.compactFoldersInFileTree = false;
  }

  if (schemaVersion < 5) {
    // The activity rail is always collapsed now; drop the settings that only shaped the expanded rail.
    for (const key of [
      "activityRailExpanded",
      "activityRailWidth",
      "showActivityRailAgentHistory",
      "showActivityRailTerminals",
      "showActivityRailProjectIcons",
      "collapsedActivityRailSections",
    ]) {
      delete migratedSettings[key];
    }
  }

  return migratedSettings;
}
