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
    binaryName: "claude",
    description: "Anthropic's Claude Code CLI agent",
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
    id: "codex-cli",
    name: "Codex CLI",
    binaryName: "codex-acp",
    description: "OpenAI Codex agent via ACP adapter",
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
    id: "openai",
    name: "OpenAI",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    requiresApiKey: true,
    models: [
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
      {
        id: "o1-mini",
        name: "o1 Mini",
        maxTokens: 128000,
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
        id: "anthropic/claude-opus-4.6",
        name: "Claude Opus 4.6",
        maxTokens: 200000,
      },
      {
        id: "anthropic/claude-sonnet-4.5",
        name: "Claude Sonnet 4.5",
        maxTokens: 200000,
      },
      {
        id: "anthropic/claude-haiku-4.5",
        name: "Claude Haiku 4.5",
        maxTokens: 200000,
      },
      {
        id: "google/gemini-3-pro-preview",
        name: "Gemini 3 Pro Preview",
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
        maxTokens: 163840,
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
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    requiresApiKey: true,
    models: [
      {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro Preview",
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
      {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash Lite",
        maxTokens: 1048576,
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        maxTokens: 1048576,
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    apiUrl: "https://api.anthropic.com/v1/messages",
    requiresApiKey: true,
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        maxTokens: 200000,
      },
      {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        maxTokens: 200000,
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        maxTokens: 200000,
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
    id: "ollama",
    name: "Ollama (Local)",
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
