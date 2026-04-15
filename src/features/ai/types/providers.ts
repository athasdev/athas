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

export const AI_AGENTS: AIAgent[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    binaryName: "claude-code-acp",
    description: "Anthropic's Claude Code ACP adapter",
    installed: false,
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    binaryName: "codex-acp",
    description: "OpenAI Codex agent via ACP adapter",
    installed: false,
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    binaryName: "gemini",
    description: "Google's Gemini CLI agent",
    installed: false,
  },
  {
    id: "kimi-cli",
    name: "Kimi CLI",
    binaryName: "kimi",
    description: "Moonshot Kimi CLI agent",
    installed: false,
  },
  {
    id: "opencode",
    name: "OpenCode",
    binaryName: "opencode",
    description: "SST OpenCode agent",
    installed: false,
  },
  {
    id: "qwen-code",
    name: "Qwen Code",
    binaryName: "qwen",
    description: "Alibaba Qwen Code agent",
    installed: false,
  },
];

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
  for (const update of agents) {
    const agent = AI_AGENTS.find((a) => a.id === update.id);
    if (agent) {
      agent.installed = update.installed;
    }
  }
};

export const AI_PROVIDERS: ModelProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    apiUrl: "https://api.anthropic.com/v1/messages",
    requiresApiKey: true,
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
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
        id: "gpt-5.4",
        name: "GPT-5.4",
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
        maxTokens: 1047576,
      },
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        maxTokens: 400000,
      },
      {
        id: "gpt-5.1",
        name: "GPT-5.1",
        maxTokens: 400000,
      },
      {
        id: "gpt-5",
        name: "GPT-5",
        maxTokens: 400000,
      },
      {
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        maxTokens: 400000,
      },
      {
        id: "gpt-5-nano",
        name: "GPT-5 Nano",
        maxTokens: 400000,
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        maxTokens: 1047576,
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        maxTokens: 1047576,
      },
      {
        id: "gpt-4.1-nano",
        name: "GPT-4.1 Nano",
        maxTokens: 1047576,
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        maxTokens: 128000,
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        maxTokens: 128000,
      },
      {
        id: "o3",
        name: "o3",
        maxTokens: 200000,
      },
      {
        id: "o3-mini",
        name: "o3 Mini",
        maxTokens: 200000,
      },
      {
        id: "o4-mini",
        name: "o4 Mini",
        maxTokens: 200000,
      },
      {
        id: "o1",
        name: "o1",
        maxTokens: 200000,
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
        id: "gemini-3.1-flash-lite-preview",
        name: "Gemini 3.1 Flash-Lite Preview",
        maxTokens: 1048576,
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview",
        maxTokens: 1048576,
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        maxTokens: 1048576,
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
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
        id: "grok-4.20-reasoning",
        name: "Grok 4.20 Reasoning",
        maxTokens: 2000000,
      },
      {
        id: "grok-4.20-non-reasoning",
        name: "Grok 4.20 Non-Reasoning",
        maxTokens: 2000000,
      },
      {
        id: "grok-4.20-multi-agent",
        name: "Grok 4.20 Multi-Agent",
        maxTokens: 2000000,
      },
      {
        id: "grok-4-1-fast-reasoning",
        name: "Grok 4.1 Fast Reasoning",
        maxTokens: 2000000,
      },
      {
        id: "grok-4-1-fast-non-reasoning",
        name: "Grok 4.1 Fast Non-Reasoning",
        maxTokens: 2000000,
      },
      {
        id: "grok-4-fast-reasoning",
        name: "Grok 4 Fast Reasoning",
        maxTokens: 2000000,
      },
      {
        id: "grok-4-fast-non-reasoning",
        name: "Grok 4 Fast Non-Reasoning",
        maxTokens: 2000000,
      },
      {
        id: "grok-code-fast-1",
        name: "Grok Code Fast 1",
        maxTokens: 256000,
      },
      {
        id: "grok-4",
        name: "Grok 4",
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
        id: "deepseek-chat",
        name: "DeepSeek V3.2",
        maxTokens: 128000,
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek V3.2 Reasoner",
        maxTokens: 128000,
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
        id: "mistral-large-3-25-12",
        name: "Mistral Large 3",
        maxTokens: 131072,
      },
      {
        id: "mistral-medium-3-1-25-08",
        name: "Mistral Medium 3.1",
        maxTokens: 131072,
      },
      {
        id: "mistral-small-4-0-26-03",
        name: "Mistral Small 4",
        maxTokens: 131072,
      },
      {
        id: "codestral-25-08",
        name: "Codestral",
        maxTokens: 256000,
      },
      {
        id: "devstral-2-25-12",
        name: "Devstral 2",
        maxTokens: 131072,
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
        id: "qwen3.6-plus",
        name: "Qwen 3.6 Plus",
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
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    requiresApiKey: true,
    models: [
      {
        id: "anthropic/claude-opus-4.6",
        name: "Claude Opus 4.6",
        maxTokens: 1000000,
      },
      {
        id: "anthropic/claude-sonnet-4.6",
        name: "Claude Sonnet 4.6",
        maxTokens: 1000000,
      },
      {
        id: "anthropic/claude-haiku-4.5",
        name: "Claude Haiku 4.5",
        maxTokens: 200000,
      },
      {
        id: "openai/gpt-5.4",
        name: "GPT-5.4",
        maxTokens: 1047576,
      },
      {
        id: "openai/gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        maxTokens: 1047576,
      },
      {
        id: "openai/gpt-5.4-nano",
        name: "GPT-5.4 Nano",
        maxTokens: 1047576,
      },
      {
        id: "openai/gpt-5.2",
        name: "GPT-5.2",
        maxTokens: 400000,
      },
      {
        id: "openai/gpt-5-mini",
        name: "GPT-5 Mini",
        maxTokens: 400000,
      },
      {
        id: "openai/gpt-5-nano",
        name: "GPT-5 Nano",
        maxTokens: 400000,
      },
      {
        id: "google/gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        maxTokens: 1048576,
      },
      {
        id: "google/gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview",
        maxTokens: 1048576,
      },
      {
        id: "google/gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        maxTokens: 1048576,
      },
      {
        id: "google/gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        maxTokens: 1048576,
      },
      {
        id: "deepseek/deepseek-v3.2",
        name: "DeepSeek V3.2",
        maxTokens: 128000,
      },
      {
        id: "x-ai/grok-4.20-reasoning",
        name: "Grok 4.20 Reasoning",
        maxTokens: 2000000,
      },
      {
        id: "x-ai/grok-4",
        name: "Grok 4",
        maxTokens: 256000,
      },
      {
        id: "x-ai/grok-4-fast",
        name: "Grok 4 Fast",
        maxTokens: 2000000,
      },
      {
        id: "mistralai/mistral-large-3",
        name: "Mistral Large 3",
        maxTokens: 131072,
      },
      {
        id: "mistralai/mistral-small-4",
        name: "Mistral Small 4",
        maxTokens: 131072,
      },
      {
        id: "mistralai/codestral",
        name: "Codestral",
        maxTokens: 256000,
      },
      {
        id: "qwen/qwen3.6-plus",
        name: "Qwen 3.6 Plus",
        maxTokens: 1000000,
      },
      {
        id: "qwen/qwen3.5-plus",
        name: "Qwen 3.5 Plus",
        maxTokens: 1000000,
      },
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    apiUrl: "http://localhost:11434/v1/chat/completions",
    requiresApiKey: false,
    models: [],
  },
];

// Get all API providers (no longer includes Claude Code since it's now an agent)
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
