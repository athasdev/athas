import type { Settings } from "@/features/settings/types/settings.types";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";

export const CUSTOM_CHAT_PROVIDER_ID = "custom";
const CUSTOM_AUTOCOMPLETE_PROVIDER_ID = "autocomplete-custom";

type CustomEndpointSettings = Pick<Settings, "aiCustomBaseUrl" | "aiAutocompleteCustomBaseUrl">;

export function resolveCustomProviderBaseUrl(settings: CustomEndpointSettings): string {
  return settings.aiCustomBaseUrl || settings.aiAutocompleteCustomBaseUrl;
}

/** Where a provider's fetched models are cached. The custom endpoint's list belongs to its address. */
export function getModelCatalogKey(providerId: string, settings: CustomEndpointSettings): string {
  if (providerId !== CUSTOM_CHAT_PROVIDER_ID) return providerId;
  return `${providerId}:${resolveCustomProviderBaseUrl(settings).trim()}`;
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
