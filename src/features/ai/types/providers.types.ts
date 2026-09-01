export interface ModelProvider {
  id: string;
  name: string;
  apiUrl: string;
  requiresApiKey: boolean;
  requiresAuth?: boolean;
  apiKeyUrl?: string;
  apiKeyPlaceholder?: string;
  maxTokens?: number;
  models: Model[];
}

export interface Model {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  maxTokens?: number;
  proOnly?: boolean;
}

// Helper to check if a provider ID is an agent

// Get agent by ID

// Update agent installation status

const AI_PROVIDERS: ModelProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    apiUrl: "https://api.anthropic.com/v1/messages",
    requiresApiKey: true,
    models: [
      {
        id: "claude-fable-5-1",
        name: "Claude Fable 5.1",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
      },
      {
        id: "claude-opus-5",
        name: "Claude Opus 5",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
      },
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        contextWindow: 1000000,
        maxOutputTokens: 128000,
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    requiresApiKey: true,
    models: [
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        contextWindow: 1050000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5.6-terra",
        name: "GPT-5.6 Terra",
        contextWindow: 1050000,
        maxOutputTokens: 128000,
      },
      {
        id: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        contextWindow: 1050000,
        maxOutputTokens: 128000,
      },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    requiresApiKey: true,
    models: [
      {
        id: "gemini-3.7-flash",
        name: "Gemini 3.7 Flash",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
      {
        id: "gemini-3.6-flash",
        name: "Gemini 3.6 Flash",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
      {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
      {
        id: "gemini-3.5-flash-lite",
        name: "Gemini 3.5 Flash-Lite",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
    ],
  },
  {
    id: "grok",
    name: "xAI Grok",
    apiUrl: "https://api.x.ai/v1/chat/completions",
    requiresApiKey: true,
    models: [
      {
        id: "grok-4.6",
        name: "Grok 4.6",
        contextWindow: 500000,
        maxOutputTokens: 131072,
      },
      {
        id: "grok-build-0.1",
        name: "Grok Build 0.1",
        contextWindow: 256000,
        maxOutputTokens: 131072,
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    apiUrl: "https://api.deepseek.com/chat/completions",
    requiresApiKey: true,
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        contextWindow: 1000000,
        maxOutputTokens: 384000,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        contextWindow: 1000000,
        maxOutputTokens: 384000,
      },
    ],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    apiUrl: "https://api.mistral.ai/v1/chat/completions",
    requiresApiKey: true,
    models: [
      {
        id: "mistral-medium-3-5",
        name: "Mistral Medium 3.5",
        contextWindow: 262144,
        maxOutputTokens: 131072,
      },
      {
        id: "mistral-small-2603",
        name: "Mistral Small 4",
        contextWindow: 262144,
        maxOutputTokens: 131072,
      },
      {
        id: "mistral-large-2512",
        name: "Mistral Large 3",
        contextWindow: 262144,
        maxOutputTokens: 131072,
      },
      {
        id: "codestral-2508",
        name: "Codestral",
        contextWindow: 128000,
        maxOutputTokens: 65536,
      },
    ],
  },
  {
    id: "qwen",
    name: "Qwen",
    apiUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    requiresApiKey: true,
    models: [
      {
        id: "qwen3.8-max",
        name: "Qwen 3.8 Max",
        contextWindow: 1000000,
        maxOutputTokens: 131072,
      },
      {
        id: "qwen3.8-flash",
        name: "Qwen 3.8 Flash",
        contextWindow: 1000000,
        maxOutputTokens: 131072,
      },
      {
        id: "qwen3.7-plus",
        name: "Qwen 3.7 Plus",
        contextWindow: 1000000,
        maxOutputTokens: 65536,
      },
      {
        id: "qwen3.7-flash",
        name: "Qwen 3.7 Flash",
        contextWindow: 1000000,
        maxOutputTokens: 65536,
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    requiresApiKey: true,
    models: [],
  },
  {
    id: "custom",
    name: "Custom",
    apiUrl: "",
    requiresApiKey: false,
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama",
    apiUrl: "http://localhost:11434/v1/chat/completions",
    requiresApiKey: false,
    models: [],
  },
];

const extensionProviders = new Map<string, ModelProvider>();
const providerIdsByExtension = new Map<string, Set<string>>();
const providerListeners = new Set<() => void>();
let availableProvidersSnapshot: ModelProvider[] | null = null;

function emitProvidersChanged() {
  availableProvidersSnapshot = null;
  providerListeners.forEach((listener) => listener());
}

export function subscribeToAvailableProviders(listener: () => void): () => void {
  providerListeners.add(listener);
  return () => providerListeners.delete(listener);
}

export function registerModelProviderExtension(extensionId: string, provider: ModelProvider): void {
  extensionProviders.set(provider.id, provider);

  const extensionProviderIds = providerIdsByExtension.get(extensionId) ?? new Set<string>();
  extensionProviderIds.add(provider.id);
  providerIdsByExtension.set(extensionId, extensionProviderIds);

  emitProvidersChanged();
}

export function unregisterModelProviderExtensions(extensionId: string): void {
  const providerIds = providerIdsByExtension.get(extensionId);
  if (!providerIds) return;

  providerIds.forEach((providerId) => extensionProviders.delete(providerId));
  providerIdsByExtension.delete(extensionId);
  emitProvidersChanged();
}

// Get all API providers. CLI agents are handled by the agent selector.
export const getAvailableProviders = (): ModelProvider[] => {
  if (!availableProvidersSnapshot) {
    availableProvidersSnapshot = [...AI_PROVIDERS, ...extensionProviders.values()];
  }

  return availableProvidersSnapshot;
};

// Get installed agents only

export const getProviderById = (id: string): ModelProvider | undefined => {
  return getAvailableProviders().find((provider) => provider.id === id);
};

export const getModelById = (providerId: string, modelId: string): Model | undefined => {
  const provider = getProviderById(providerId);
  return provider?.models.find((model) => model.id === modelId);
};
