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
    binaryName: "codex",
    description: "OpenAI's Codex CLI agent",
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
      // Latest flagship models
      {
        id: "gpt-5-pro",
        name: "GPT-5 Pro",
        maxTokens: 128000,
      },
      {
        id: "gpt-5",
        name: "GPT-5",
        maxTokens: 1048576,
      },
      {
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        maxTokens: 1048576,
      },
      {
        id: "gpt-5-nano",
        name: "GPT-5 Nano",
        maxTokens: 1048576,
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
        id: "gpt-4.1",
        name: "GPT-4.1",
        maxTokens: 1048576,
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        maxTokens: 1048576,
      },
      {
        id: "gpt-4.1-nano",
        name: "GPT-4.1 Nano",
        maxTokens: 1048576,
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
        id: "o1",
        name: "o1",
        maxTokens: 200000,
      },
      {
        id: "o1-preview",
        name: "o1 Preview",
        maxTokens: 128000,
      },
      {
        id: "o1-mini",
        name: "o1 Mini",
        maxTokens: 128000,
      },
      {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
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
      // Top Weekly Models (Updated January 2025)
      {
        id: "google/gemini-3-pro-preview",
        name: "Gemini 3 Pro Preview",
        maxTokens: 1048576,
      },
      {
        id: "openai/gpt-4o-mini",
        name: "GPT-4o Mini",
        maxTokens: 128000,
      },
      {
        id: "google/gemini-2.0-flash-exp:free",
        name: "Gemini 2.0 Flash (Free)",
        maxTokens: 1000000,
      },
      {
        id: "anthropic/claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        maxTokens: 200000,
      },
      {
        id: "google/gemini-2.0-flash-thinking-exp:free",
        name: "Gemini 2.0 Flash Thinking (Free)",
        maxTokens: 1000000,
      },
      {
        id: "google/gemini-exp-1206:free",
        name: "Gemini Exp 1206 (Free)",
        maxTokens: 1000000,
      },
      {
        id: "anthropic/claude-3.7-sonnet",
        name: "Claude 3.7 Sonnet",
        maxTokens: 200000,
      },
      {
        id: "deepseek/deepseek-chat",
        name: "DeepSeek Chat",
        maxTokens: 164000,
      },
      {
        id: "x-ai/grok-2-1212",
        name: "Grok 2",
        maxTokens: 131072,
      },
      {
        id: "deepseek/deepseek-r1:free",
        name: "DeepSeek R1 (Free)",
        maxTokens: 164000,
      },
      {
        id: "openai/gpt-4o",
        name: "GPT-4o",
        maxTokens: 128000,
      },
      {
        id: "anthropic/claude-3.5-sonnet",
        name: "Claude 3.5 Sonnet",
        maxTokens: 200000,
      },
      {
        id: "meta-llama/llama-3.3-70b-instruct",
        name: "Llama 3.3 70B",
        maxTokens: 131072,
      },
      {
        id: "anthropic/claude-3-opus",
        name: "Claude 3 Opus",
        maxTokens: 200000,
      },
      {
        id: "google/gemini-pro-1.5",
        name: "Gemini Pro 1.5",
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
      {
        id: "gemini-2.0-flash-lite",
        name: "Gemini 2.0 Flash Lite",
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
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        maxTokens: 200000,
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        maxTokens: 200000,
      },
      {
        id: "claude-opus-4-1-20250805",
        name: "Claude Opus 4.1",
        maxTokens: 200000,
      },
      {
        id: "claude-opus-4",
        name: "Claude Opus 4",
        maxTokens: 200000,
      },
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        maxTokens: 200000,
      },
      {
        id: "claude-3-7-sonnet",
        name: "Claude 3.7 Sonnet",
        maxTokens: 200000,
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        maxTokens: 200000,
      },
      {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        maxTokens: 200000,
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        maxTokens: 200000,
      },
      {
        id: "claude-3-haiku-20240307",
        name: "Claude 3 Haiku",
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
        id: "grok-4-0709",
        name: "Grok 4 (0709)",
        maxTokens: 256000,
      },
      {
        id: "grok-3",
        name: "Grok 3",
        maxTokens: 131072,
      },
      {
        id: "grok-3-mini",
        name: "Grok 3 Mini",
        maxTokens: 131072,
      },
      {
        id: "grok-2-vision-1212",
        name: "Grok 2 Vision (1212)",
        maxTokens: 32768,
      },
      {
        id: "grok-code-fast-1",
        name: "Grok Code Fast 1",
        maxTokens: 256000,
      },
    ],
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    apiUrl: "https://api.githubcopilot.com/chat/completions",
    requiresApiKey: false,
    requiresAuth: true,
    models: [
      {
        id: "gpt-4.1",
        name: "GPT-4.1 (Copilot)",
        maxTokens: 1048576,
      },
      {
        id: "claude-opus-4",
        name: "Claude Opus 4 (Copilot)",
        maxTokens: 200000,
      },
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4 (Copilot)",
        maxTokens: 200000,
      },
      {
        id: "o3",
        name: "o3 (Copilot)",
        maxTokens: 200000,
      },
      {
        id: "o4-mini",
        name: "o4 Mini (Copilot)",
        maxTokens: 200000,
      },
      {
        id: "o3-mini",
        name: "o3 Mini (Copilot)",
        maxTokens: 200000,
      },
      {
        id: "gpt-4o",
        name: "GPT-4o (Copilot)",
        maxTokens: 128000,
      },
      {
        id: "claude-3.7-sonnet",
        name: "Claude 3.7 Sonnet (Copilot)",
        maxTokens: 200000,
      },
      {
        id: "claude-3.7-sonnet-thinking",
        name: "Claude 3.7 Sonnet Thinking (Copilot)",
        maxTokens: 200000,
      },
      {
        id: "claude-3.5-sonnet",
        name: "Claude 3.5 Sonnet (Copilot)",
        maxTokens: 200000,
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro (Copilot)",
        maxTokens: 1048576,
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash (Copilot)",
        maxTokens: 1000000,
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
