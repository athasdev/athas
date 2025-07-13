export interface ModelProvider {
  id: string;
  name: string;
  apiUrl: string;
  requiresApiKey: boolean;
  models: Model[];
}

export interface Model {
  id: string;
  name: string;
  maxTokens: number;
  costPer1kTokens?: number;
  description?: string;
}

export interface ProviderConfig {
  provider: ModelProvider;
  model: Model;
  apiKey?: string;
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
        description: "Claude running locally via Claude Code CLI",
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
        id: "gpt-4o",
        name: "GPT-4o",
        maxTokens: 128000,
        costPer1kTokens: 0.005,
        description: "Latest multimodal flagship model with enhanced reasoning",
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        maxTokens: 128000,
        costPer1kTokens: 0.00015,
        description: "Cost-effective model with strong performance",
      },
      {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        maxTokens: 128000,
        costPer1kTokens: 0.01,
        description: "Enhanced GPT-4 with improved efficiency",
      },
      {
        id: "gpt-4",
        name: "GPT-4",
        maxTokens: 128000,
        costPer1kTokens: 0.03,
        description: "Most capable reasoning model",
      },
      {
        id: "gpt-3.5-turbo",
        name: "GPT-3.5 Turbo",
        maxTokens: 16000,
        costPer1kTokens: 0.0015,
        description: "Fast and cost-effective for simple tasks",
      },
      // Preview models (latest experimental)
      {
        id: "o1-preview",
        name: "o1 Preview",
        maxTokens: 128000,
        costPer1kTokens: 0.015,
        description: "Reasoning model with enhanced problem-solving",
      },
      {
        id: "o1-mini",
        name: "o1 Mini",
        maxTokens: 128000,
        costPer1kTokens: 0.003,
        description: "Faster reasoning model for coding and math",
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter (BYOK)",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    requiresApiKey: true,
    models: [
      // Top Weekly Models
      {
        id: "openai/gpt-4o-mini",
        name: "GPT-4o Mini",
        maxTokens: 128000,
        costPer1kTokens: 0.00015,
        description: "Most advanced small model",
      },
      {
        id: "google/gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash",
        maxTokens: 1048576,
        costPer1kTokens: 0.0001,
        description: "Enhanced multimodal understanding",
      },
      {
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        maxTokens: 200000,
        costPer1kTokens: 0.003,
        description: "State-of-the-art coding performance",
      },
      {
        id: "google/gemini-2.5-pro-preview-0506",
        name: "Gemini 2.5 Pro",
        maxTokens: 1048576,
        costPer1kTokens: 0.00125,
        description: "Advanced reasoning and thinking",
      },
      {
        id: "google/gemini-2.5-flash-preview-0520",
        name: "Gemini 2.5 Flash",
        maxTokens: 1048576,
        costPer1kTokens: 0.00015,
        description: "Thinking-enabled workhorse",
      },
      {
        id: "anthropic/claude-3.7-sonnet",
        name: "Claude 3.7 Sonnet",
        maxTokens: 200000,
        costPer1kTokens: 0.003,
        description: "Hybrid reasoning approach",
      },
      {
        id: "deepseek/deepseek-v3-0324",
        name: "DeepSeek V3",
        maxTokens: 164000,
        costPer1kTokens: 0.0003,
        description: "685B parameter MoE model",
      },
      {
        id: "deepseek/deepseek-v3-0324:free",
        name: "DeepSeek V3 Free",
        maxTokens: 164000,
        costPer1kTokens: 0,
        description: "Free flagship model",
      },
      {
        id: "google/gemini-2.5-flash-preview-0417",
        name: "Gemini 2.5 Flash (Apr)",
        maxTokens: 1048576,
        costPer1kTokens: 0.00015,
        description: "Earlier Flash preview",
      },
      {
        id: "deepseek/deepseek-r1-0528:free",
        name: "DeepSeek R1 Free",
        maxTokens: 164000,
        costPer1kTokens: 0,
        description: "Open reasoning model",
      },

      // Other Models
      {
        id: "anthropic/claude-3.5-sonnet",
        name: "Claude 3.5 Sonnet",
        maxTokens: 200000,
        costPer1kTokens: 0.003,
        description: "Excellent coding and reasoning",
      },
      {
        id: "anthropic/claude-3-opus",
        name: "Claude 3 Opus",
        maxTokens: 200000,
        costPer1kTokens: 0.015,
        description: "Most capable Claude model",
      },
      {
        id: "anthropic/claude-3-haiku",
        name: "Claude 3 Haiku",
        maxTokens: 200000,
        costPer1kTokens: 0.00025,
        description: "Fast and affordable",
      },
      {
        id: "meta-llama/llama-3.1-405b-instruct",
        name: "Llama 3.1 405B",
        maxTokens: 131072,
        costPer1kTokens: 0.005,
        description: "Largest open source model",
      },
      {
        id: "meta-llama/llama-3.1-70b-instruct",
        name: "Llama 3.1 70B",
        maxTokens: 131072,
        costPer1kTokens: 0.0005,
        description: "Balanced open source",
      },
      {
        id: "openai/gpt-4o",
        name: "GPT-4o",
        maxTokens: 128000,
        costPer1kTokens: 0.005,
        description: "Latest OpenAI flagship",
      },
    ],
  },
];

export const getProviderById = (id: string): ModelProvider | undefined => {
  return AI_PROVIDERS.find(provider => provider.id === id);
};

export const getModelById = (providerId: string, modelId: string): Model | undefined => {
  const provider = getProviderById(providerId);
  return provider?.models.find(model => model.id === modelId);
};
