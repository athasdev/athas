import type { Settings } from "@/features/settings/types/settings.types";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { defaultIntelligencePreferences } from "./intelligence-preferences";

export function migrateLegacyIntelligencePreferences(settings: Settings) {
  const preferences = defaultIntelligencePreferences();
  if (settings.aiAutocompleteProvider === "custom" && settings.aiAutocompleteCustomModelId) {
    preferences.tasks.autocomplete = {
      providerId: "custom",
      modelId: settings.aiAutocompleteCustomModelId,
    };
  } else if (
    settings.aiAutocompleteModelId &&
    settings.aiAutocompleteModelId !== getDefaultSetting("aiAutocompleteModelId")
  ) {
    preferences.tasks.autocomplete = {
      providerId: "openrouter",
      modelId: settings.aiAutocompleteModelId,
    };
  }
  return preferences;
}
