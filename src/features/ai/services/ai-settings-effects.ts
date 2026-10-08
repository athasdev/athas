import { registerSettingsEffect } from "@/features/settings/services/settings-effect-registry";

// The provider registry loads on demand, so the settings never pull the AI providers into startup.
const loadProviderRegistry = () => import("./providers/ai-provider-registry");

function syncOllamaBaseUrl(baseUrl: string) {
  if (!baseUrl) {
    return;
  }

  void loadProviderRegistry().then(({ setOllamaBaseUrl }) => {
    setOllamaBaseUrl(baseUrl);
  });
}

function syncCustomProviderBaseUrl(baseUrl: string) {
  void loadProviderRegistry().then(({ setCustomProviderBaseUrl }) => {
    setCustomProviderBaseUrl(baseUrl);
  });
}

/**
 * Pushes the Ollama API key (stored in Tauri's secure storage) into the
 * singleton provider instance so `getModels`, connection checks, and other
 * non-streaming calls can authenticate with Ollama Cloud.
 */
async function syncOllamaApiKey() {
  const [{ setOllamaApiKey }, { getProviderApiToken }] = await Promise.all([
    loadProviderRegistry(),
    import("./ai-token-service"),
  ]);
  const token = await getProviderApiToken("ollama");
  setOllamaApiKey(token);
}

const aiProviderSettingsEffect = {
  applyAll: (settings: { ollamaBaseUrl: string; aiCustomBaseUrl: string }) => {
    syncOllamaBaseUrl(settings.ollamaBaseUrl);
    syncCustomProviderBaseUrl(settings.aiCustomBaseUrl);
    void syncOllamaApiKey();
  },
  applyChange: (key: string, value: unknown) => {
    if (key === "ollamaBaseUrl") syncOllamaBaseUrl(value as string);
    if (key === "aiCustomBaseUrl") syncCustomProviderBaseUrl(value as string);
  },
};

/** Keeps the AI providers on the endpoints in the settings; every window registers this. */
export function registerAiSettingsEffects() {
  registerSettingsEffect(aiProviderSettingsEffect);
}
