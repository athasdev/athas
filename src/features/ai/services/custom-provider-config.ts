import type { Settings } from "@/features/settings/types/settings.types";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";

export const CUSTOM_CHAT_PROVIDER_ID = "custom";
export const CUSTOM_AUTOCOMPLETE_PROVIDER_ID = "autocomplete-custom";

export function resolveCustomProviderBaseUrl(settings: Settings): string {
  return settings.aiCustomBaseUrl || settings.aiAutocompleteCustomBaseUrl;
}

function isKnownNonCustomModelId(modelId: string): boolean {
  return [
    "claude-",
    "gpt-",
    "o1",
    "o3",
    "o4",
    "gemini-",
    "grok-",
    "deepseek-",
    "mistral",
    "codestral",
    "devstral",
    "qwen",
    "v0-",
  ].some((prefix) => modelId.startsWith(prefix));
}

export function resolveCustomProviderModelId(settings: Settings, modelId: string): string {
  const chatModelId = settings.aiCustomModelId.trim();
  const autocompleteModelId = settings.aiAutocompleteCustomModelId.trim();
  const currentModelId = modelId.trim();

  if (chatModelId) return chatModelId;
  if (autocompleteModelId && (!currentModelId || isKnownNonCustomModelId(currentModelId))) {
    return autocompleteModelId;
  }
  return currentModelId || autocompleteModelId;
}

export async function getCustomProviderApiToken(): Promise<string | null> {
  return (
    (await getProviderApiToken(CUSTOM_CHAT_PROVIDER_ID)) ||
    (await getProviderApiToken(CUSTOM_AUTOCOMPLETE_PROVIDER_ID))
  );
}
