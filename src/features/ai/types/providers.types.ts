interface ModelProvider {
  id: string;
  name: string;
  apiUrl: string;
  requiresApiKey: boolean;
  requiresAuth?: boolean;
  models: Model[];
}

interface Model {
  id: string;
  name: string;
  maxTokens: number;
  proOnly?: boolean;
}

// CLI Agents that use Agent Client Protocol (ACP)
export interface AIAgent {
  id: string;
  name: string;
  binaryName: string;
  description: string;
  installed?: boolean;
}

export const AI_AGENTS: AIAgent[] = [];

// Helper to check if a provider ID is an agent
export const isAgentProvider = (id: string): boolean => {
  return AI_AGENTS.some((agent) => agent.id === id);
};

// Get agent by ID
export const getAgentById = (id: string): AIAgent | undefined => {
  return AI_AGENTS.find((agent) => agent.id === id);
};

// Update agent installation status
export const updateAgentStatus = (agents: Array<{ id: string; installed: boolean }>) => {
  void agents;
};

export const AI_PROVIDERS: ModelProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    apiUrl: "https://api.anthropic.com/v1/messages",
    requiresApiKey: true,
    models: [
      {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        maxTokens: 1000000,
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        maxTokens: 1000000,
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        maxTokens: 200000,
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
        id: "gpt-5.5",
        name: "GPT-5.5",
        maxTokens: 1047576,
      },
      {
        id: "gpt-5.5-pro",
        name: "GPT-5.5 Pro",
        maxTokens: 1047576,
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        maxTokens: 1047576,
      },
      {
        id: "gpt-5.4-pro",
        name: "GPT-5.4 Pro",
        maxTokens: 1047576,
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        maxTokens: 1047576,
      },
      {
        id: "gpt-5.4-nano",
        name: "GPT-5.4 Nano",
        maxTokens: 400000,
      },
    ],
  },
  {
    id: "v0",
    name: "v0",
    apiUrl: "https://api.v0.dev/v1/chats",
    requiresApiKey: true,
    models: [
      {
        id: "v0-auto",
        name: "v0 Auto",
        maxTokens: 50000,
      },
      {
        id: "v0-mini",
        name: "v0 Mini",
        maxTokens: 50000,
      },
      {
        id: "v0-pro",
        name: "v0 Pro",
        maxTokens: 50000,
      },
      {
        id: "v0-max",
        name: "v0 Max",
        maxTokens: 50000,
      },
      {
        id: "v0-max-fast",
        name: "v0 Max Fast",
        maxTokens: 50000,
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
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        maxTokens: 1048576,
      },
      {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        maxTokens: 1048576,
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview",
        maxTokens: 1048576,
      },
      {
        id: "gemini-3.1-flash-lite",
        name: "Gemini 3.1 Flash-Lite",
        maxTokens: 1048576,
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
        id: "grok-4.3",
        name: "Grok 4.3",
        maxTokens: 1000000,
      },
      {
        id: "grok-build-0.1",
        name: "Grok Build 0.1",
        maxTokens: 256000,
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
        maxTokens: 1000000,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        maxTokens: 1000000,
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
        id: "mistral-medium-2604",
        name: "Mistral Medium 3.5",
        maxTokens: 262144,
      },
      {
        id: "mistral-small-2603",
        name: "Mistral Small 4",
        maxTokens: 262144,
      },
      {
        id: "mistral-large-2512",
        name: "Mistral Large 3",
        maxTokens: 262144,
      },
      {
        id: "codestral-2508",
        name: "Codestral",
        maxTokens: 256000,
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
        id: "qwen3-max",
        name: "Qwen 3 Max",
        maxTokens: 1000000,
      },
      {
        id: "qwen3.5-plus",
        name: "Qwen 3.5 Plus",
        maxTokens: 1000000,
      },
      {
        id: "qwen3.5-flash",
        name: "Qwen 3.5 Flash",
        maxTokens: 1000000,
      },
      {
        id: "qwen3-coder-plus",
        name: "Qwen 3 Coder Plus",
        maxTokens: 1000000,
      },
      {
        id: "qwen3-coder-flash",
        name: "Qwen 3 Coder Flash",
        maxTokens: 1000000,
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

// Get all API providers. CLI agents are handled by the agent selector.
export const getAvailableProviders = (): ModelProvider[] => {
  return AI_PROVIDERS;
};

// Get installed agents only
export const getInstalledAgents = (): AIAgent[] => {
  return AI_AGENTS.filter((agent) => agent.installed);
};

export const getProviderById = (id: string): ModelProvider | undefined => {
  return AI_PROVIDERS.find((provider) => provider.id === id);
};

export const getModelById = (providerId: string, modelId: string): Model | undefined => {
  const provider = getProviderById(providerId);
  return provider?.models.find((model) => model.id === modelId);
};
