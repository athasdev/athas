import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { tauriFetch } from "@/utils/tauri-fetch";
import { getProvider } from "@/features/ai/services/providers/ai-provider-registry";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import {
  getCustomProviderApiToken,
  resolveCustomProviderBaseUrl,
} from "@/features/ai/lib/custom-provider-config";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { normalizeOllamaBaseUrl } from "@/features/ai/lib/ollama-endpoint";
import { getApiBase } from "@/utils/api-base";

export async function getIntelligenceSdkModel(providerId: string, modelId: string, task?: string) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("This provider is not available.");
  const settings = useSettingsStore.getState().settings;
  const legacyAutocomplete =
    providerId === "custom" &&
    task === "autocomplete" &&
    settings.aiAutocompleteProvider === "custom" &&
    modelId === settings.aiAutocompleteCustomModelId &&
    settings.aiAutocompleteCustomBaseUrl;
  const key = legacyAutocomplete
    ? await getProviderApiToken("autocomplete-custom")
    : providerId === "custom"
      ? await getCustomProviderApiToken()
      : await getProviderApiToken(providerId);
  if (provider.requiresApiKey && !key) throw new Error(`${provider.name} API key is required.`);
  const apiKey = key ?? undefined;
  if (providerId === "anthropic")
    return createAnthropic({ apiKey, fetch: tauriFetch as typeof fetch })(modelId);
  if (providerId === "gemini")
    return createGoogle({ apiKey, fetch: tauriFetch as typeof fetch })(modelId);
  if (providerId === "openai")
    return createOpenAI({ apiKey, fetch: tauriFetch as typeof fetch }).chat(modelId);
  let baseURL = provider.apiUrl.replace(/\/chat\/completions\/?$/, "");
  if (providerId === "ollama")
    baseURL = `${normalizeOllamaBaseUrl(useSettingsStore.getState().settings.ollamaBaseUrl)}/v1`;
  if (providerId === "athas") baseURL = `${getApiBase()}/api/ai`;
  if (providerId === "custom")
    baseURL = (legacyAutocomplete || resolveCustomProviderBaseUrl(settings))
      .replace(/\/chat\/completions\/?$/, "")
      .replace(/\/$/, "");
  if (!baseURL) throw new Error("Configure the provider endpoint in AI settings.");
  const headers = await provider.buildHeaders(apiKey);
  let chosenModel: string | null = null;
  const modelFetch: typeof fetch = (async (input, init) => {
    if (
      providerId === "athas" &&
      modelId === "auto" &&
      chosenModel &&
      typeof init?.body === "string"
    ) {
      const body = JSON.parse(init.body);
      init = { ...init, body: JSON.stringify({ ...body, model: chosenModel }) };
    }
    const response = await tauriFetch(input, init as RequestInit);
    if (providerId === "athas" && response.ok)
      chosenModel = response.headers.get("x-athas-model") || chosenModel;
    return response;
  }) as typeof fetch;
  return createOpenAICompatible({
    name: providerId,
    baseURL,
    apiKey,
    headers,
    fetch: modelFetch,
  }).chatModel(modelId);
}
