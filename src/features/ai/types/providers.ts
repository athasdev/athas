interface ModelProvider {
  id: string;
  name: string;
  apiUrl: string;
  requiresApiKey: boolean;
  models: Model[];
}

interface Model {
  id: string;
  name: string;
  maxTokens: number;
}

export const AI_PROVIDERS: ModelProvider[] = [
  {
    id: "claude-code",
    name: "Claude Code (Local)",
    apiUrl: "local",
    requiresApiKey: false,
    models: [
      {
        id: "claude-code",
        name: "Claude Code",
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
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        maxTokens: 1000000,
      },
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        maxTokens: 2097152,
      },
      {
        id: "gemini-1.5-flash",
        name: "Gemini 1.5 Flash",
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
        id: "claude-opus-4-1-20250805	",
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
    id: "copilot",
    name: "GitHub Copilot",
    apiUrl: "https://api.githubcopilot.com/chat/completions",
    requiresApiKey: true,
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
];

// Track Claude Code availability
let claudeCodeAvailable = false;

export const setClaudeCodeAvailability = (available: boolean) => {
  claudeCodeAvailable = available;
};

export const getAvailableProviders = (): ModelProvider[] => {
  if (claudeCodeAvailable) {
    return AI_PROVIDERS;
  }
  // Filter out Claude Code if not available
  return AI_PROVIDERS.filter((provider) => provider.id !== "claude-code");
};

export const getProviderById = (id: string): ModelProvider | undefined => {
  return AI_PROVIDERS.find((provider) => provider.id === id);
};

export const getModelById = (providerId: string, modelId: string): Model | undefined => {
  const provider = getProviderById(providerId);
  return provider?.models.find((model) => model.id === modelId);
};
