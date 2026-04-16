import { getProviderById } from "@/features/ai/types/providers";
import {
  DEFAULT_AI_AUTOCOMPLETE_MODEL_ID,
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PROVIDER_ID,
} from "@/features/settings/config/default-settings";
import { normalizeUiFontSize } from "@/features/settings/lib/ui-font-size";
import type { Settings } from "@/features/settings/types/settings";

const AI_MODEL_MIGRATIONS: Record<string, Record<string, string>> = {
  anthropic: {
    "claude-sonnet-4-5": "claude-sonnet-4-6",
  },
  gemini: {
    "gemini-3-pro-preview": "gemini-3.1-pro-preview",
    "gemini-2.5-pro": "gemini-3.1-pro-preview",
    "gemini-2.5-flash": "gemini-3-flash-preview",
    "gemini-2.5-flash-lite": "gemini-3-flash-preview",
    "gemini-2.0-flash": "gemini-3-flash-preview",
  },
  openai: {
    "o1-mini": "o3-mini",
  },
  openrouter: {
    "anthropic/claude-sonnet-4.5": "anthropic/claude-sonnet-4.6",
    "google/gemini-3-pro-preview": "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-pro": "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-flash": "google/gemini-3-flash-preview",
  },
};

const AI_AUTOCOMPLETE_MODEL_MIGRATIONS: Record<string, string> = {
  "google/gemini-2.5-flash-lite": "google/gemini-3-flash-preview",
};

function normalizeAISettings(settings: Settings): Settings {
  const normalizedSettings = { ...settings };
  const provider =
    getProviderById(normalizedSettings.aiProviderId) || getProviderById(DEFAULT_AI_PROVIDER_ID);

  if (!provider) {
    return {
      ...normalizedSettings,
      aiProviderId: DEFAULT_AI_PROVIDER_ID,
      aiModelId: DEFAULT_AI_MODEL_ID,
      aiAutocompleteModelId:
        AI_AUTOCOMPLETE_MODEL_MIGRATIONS[normalizedSettings.aiAutocompleteModelId] ||
        normalizedSettings.aiAutocompleteModelId ||
        DEFAULT_AI_AUTOCOMPLETE_MODEL_ID,
    };
  }

  normalizedSettings.aiProviderId = provider.id;
  normalizedSettings.aiModelId =
    AI_MODEL_MIGRATIONS[provider.id]?.[normalizedSettings.aiModelId] ||
    normalizedSettings.aiModelId;

  if (
    provider.models.length > 0 &&
    !provider.models.some((model) => model.id === normalizedSettings.aiModelId)
  ) {
    normalizedSettings.aiModelId = provider.models[0].id;
  }

  normalizedSettings.aiAutocompleteModelId =
    AI_AUTOCOMPLETE_MODEL_MIGRATIONS[normalizedSettings.aiAutocompleteModelId] ||
    normalizedSettings.aiAutocompleteModelId ||
    DEFAULT_AI_AUTOCOMPLETE_MODEL_ID;

  return normalizedSettings;
}

export function normalizeSettings(settings: Settings): Settings {
  const normalizedSettings = normalizeAISettings(settings);
  const persistedGitPanelMode = (normalizedSettings as { gitLastPanelMode?: string })
    .gitLastPanelMode;

  if (
    persistedGitPanelMode === "none" ||
    (persistedGitPanelMode &&
      !["changes", "stash", "history", "worktrees"].includes(persistedGitPanelMode))
  ) {
    normalizedSettings.gitLastPanelMode = "changes";
  }

  normalizedSettings.uiFontSize = normalizeUiFontSize(normalizedSettings.uiFontSize);
  if (
    normalizedSettings.iconTheme === "colorful-material" ||
    normalizedSettings.iconTheme === "seti"
  ) {
    normalizedSettings.iconTheme = "material";
  }

  return normalizedSettings;
}

export function normalizeSettingValue<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Settings[K] {
  if (key === "uiFontSize") {
    return normalizeUiFontSize(value as number) as Settings[K];
  }

  if (key === "iconTheme" && (value === "colorful-material" || value === "seti")) {
    return "material" as Settings[K];
  }

  return value;
}
