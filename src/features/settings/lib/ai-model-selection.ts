import type { Settings } from "@/features/settings/types/settings.types";

export function getAIModelSelectionPatch(
  settings: Settings,
  changedKey: keyof Settings,
): Partial<Pick<Settings, "aiModelId">> {
  if (changedKey === "aiProviderId" && settings.aiProviderId === "custom") {
    return { aiModelId: settings.aiCustomModelId || settings.aiAutocompleteCustomModelId };
  }

  if (settings.aiProviderId !== "custom") {
    return {};
  }

  if (changedKey === "aiCustomModelId") {
    return { aiModelId: settings.aiCustomModelId || settings.aiAutocompleteCustomModelId };
  }

  if (changedKey === "aiAutocompleteCustomModelId" && !settings.aiCustomModelId) {
    return { aiModelId: settings.aiAutocompleteCustomModelId };
  }

  return {};
}
