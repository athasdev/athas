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
} from "@/features/ai/services/custom-provider-config";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { normalizeOllamaBaseUrl } from "@/features/ai/services/ollama-endpoint";
import { getApiBase } from "@/utils/api-base";
import { commands } from "@/bindings/commands";
import { createIntelligenceModelFetch } from "./intelligence-model-fetch";

interface IntelligenceSdkModelOptions {
  /** Called with the cost, in US dollars, of each model response that reports one. */
  onCost?: (usd: number) => void;
}

export async function getIntelligenceSdkModel(
  providerId: string,
  modelId: string,
  task?: string,
  options: IntelligenceSdkModelOptions = {},
) {
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
  const athas = providerId === "athas";
  // One id per model instance, which is one agent run: with the request index it gives each
  // step a stable Idempotency-Key, so a retried step is never billed twice.
  const runId = crypto.randomUUID();
  const retryingFetch = createIntelligenceModelFetch({
    fetch: tauriFetch as typeof fetch,
    // The Athas token and team scope are read again for every request, not once per run.
    headers: athas ? async () => provider.buildHeaders(undefined) : undefined,
    refreshToken: athas ? () => commands.getAuthToken() : undefined,
    idempotencyKey: athas ? (index) => `${runId}-${index}` : undefined,
    onCost: options.onCost,
  });
  if (providerId === "anthropic") return createAnthropic({ apiKey, fetch: retryingFetch })(modelId);
  if (providerId === "gemini") return createGoogle({ apiKey, fetch: retryingFetch })(modelId);
  if (providerId === "openai") return createOpenAI({ apiKey, fetch: retryingFetch }).chat(modelId);
  let baseURL = provider.apiUrl.replace(/\/chat\/completions\/?$/, "");
  if (providerId === "ollama")
    baseURL = `${normalizeOllamaBaseUrl(useSettingsStore.getState().settings.ollamaBaseUrl)}/v1`;
  if (athas) baseURL = `${getApiBase()}/api/ai`;
  if (providerId === "custom")
    baseURL = (legacyAutocomplete || resolveCustomProviderBaseUrl(settings))
      .replace(/\/chat\/completions\/?$/, "")
      .replace(/\/$/, "");
  if (!baseURL) throw new Error("Configure the provider endpoint in AI settings.");
  // Athas headers are read per request by the retrying fetch; checking them here still fails
  // fast when the user is signed out.
  const headers = await provider.buildHeaders(apiKey);
  let chosenModel: string | null = null;
  const modelFetch: typeof fetch = (async (input, init) => {
    if (athas && modelId === "auto" && chosenModel && typeof init?.body === "string") {
      const body = JSON.parse(init.body);
      init = { ...init, body: JSON.stringify({ ...body, model: chosenModel }) };
    }
    const response = await retryingFetch(input, init);
    if (athas && response.ok) chosenModel = response.headers.get("x-athas-model") || chosenModel;
    return response;
  }) as typeof fetch;
  return createOpenAICompatible({
    name: providerId,
    baseURL,
    apiKey,
    headers,
    fetch: modelFetch,
    // Token usage (and OpenRouter's cost) arrive in a final chunk only when asked for; these
    // endpoints are known to accept `stream_options`.
    includeUsage: ["athas", "openrouter", "ollama"].includes(providerId),
  }).chatModel(modelId);
}
