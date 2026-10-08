import type { SettingsTab } from "@/features/layout/stores/ui-state/types/ui-state.types";
import { settingsTabLabels } from "@/features/settings/config/settings-tabs";

/** The id of the command that opens settings at `tab`. */
export const getSettingsTabCommandId = (tab: SettingsTab) => `preferences.openSettingsTab.${tab}`;

/** The settings tabs that get an open command; `language` is an alias of the editor tab. */
export const settingsCommandTabs = (Object.keys(settingsTabLabels) as SettingsTab[]).filter(
  (tab) => tab !== "language",
);

export const settingsTabCommandIds = settingsCommandTabs.map(getSettingsTabCommandId);
