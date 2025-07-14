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
        id: "o3",
        name: "o3",
        maxTokens: 200000,
        costPer1kTokens: 0.002,
        description: "Well-rounded and powerful across all domains",
      },
      {
        id: "o3-mini",
        name: "o3 Mini",
        maxTokens: 200000,
        costPer1kTokens: 0.0011,
        description: "Cost-efficient model optimized for STEM reasoning",
      },
      {
        id: "o4-mini",
        name: "o4 Mini",
        maxTokens: 200000,
        costPer1kTokens: 0.0011,
        description: "Compact reasoning model with multimodal capabilities",
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        maxTokens: 1048576,
        costPer1kTokens: 0.002,
        description: "Flagship model optimized for software engineering",
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        maxTokens: 1048576,
        costPer1kTokens: 0.0004,
        description: "Mid-sized model competitive with GPT-4o at lower cost",
      },
      {
        id: "gpt-4.1-nano",
        name: "GPT-4.1 Nano",
        maxTokens: 1048576,
        costPer1kTokens: 0.0001,
        description: "Fastest and cheapest model for low latency tasks",
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        maxTokens: 128000,
        costPer1kTokens: 0.0025,
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
        id: "o1",
        name: "o1",
        maxTokens: 200000,
        costPer1kTokens: 0.015,
        description: "Advanced reasoning model for complex tasks",
      },
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
        costPer1kTokens: 0.0011,
        description: "Faster reasoning model for coding and math",
      },
      {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        maxTokens: 128000,
        costPer1kTokens: 0.01,
        description: "Enhanced GPT-4 with improved efficiency",
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
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
        costPer1kTokens: 0.00125,
        description: "State-of-the-art model with thinking capabilities",
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        maxTokens: 1048576,
        costPer1kTokens: 0.0003,
        description: "Advanced reasoning and coding workhorse model",
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        maxTokens: 1000000,
        costPer1kTokens: 0.0001,
        description: "Faster TTFT with enhanced multimodal understanding",
      },
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        maxTokens: 2097152,
        costPer1kTokens: 0.00125,
        description: "Advanced reasoning with large context",
      },
      {
        id: "gemini-1.5-flash",
        name: "Gemini 1.5 Flash",
        maxTokens: 1048576,
        costPer1kTokens: 0.00015,
        description: "Fast and efficient multimodal model",
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
        id: "claude-opus-4",
        name: "Claude Opus 4",
        maxTokens: 200000,
        costPer1kTokens: 0.015,
        description: "World's best coding model with sustained performance",
      },
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        maxTokens: 200000,
        costPer1kTokens: 0.003,
        description: "State-of-the-art coding and reasoning performance",
      },
      {
        id: "claude-3-7-sonnet",
        name: "Claude 3.7 Sonnet",
        maxTokens: 200000,
        costPer1kTokens: 0.003,
        description: "Hybrid reasoning approach with extended processing",
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        maxTokens: 200000,
        costPer1kTokens: 0.003,
        description: "Excellent coding and reasoning",
      },
      {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        maxTokens: 200000,
        costPer1kTokens: 0.0008,
        description: "Fastest model with enhanced coding and tool use",
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        maxTokens: 200000,
        costPer1kTokens: 0.015,
        description: "Most capable Claude 3 model",
      },
      {
        id: "claude-3-haiku-20240307",
        name: "Claude 3 Haiku",
        maxTokens: 200000,
        costPer1kTokens: 0.00025,
        description: "Fast and affordable",
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
        costPer1kTokens: 0,
        description: "Latest flagship model optimized for software engineering",
      },
      {
        id: "claude-opus-4",
        name: "Claude Opus 4 (Copilot)",
        maxTokens: 200000,
        costPer1kTokens: 0,
        description: "World's best coding model with sustained performance",
      },
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4 (Copilot)",
        maxTokens: 200000,
        costPer1kTokens: 0,
        description: "State-of-the-art coding and reasoning performance",
      },
      {
        id: "o3",
        name: "o3 (Copilot)",
        maxTokens: 200000,
        costPer1kTokens: 0,
        description: "Well-rounded and powerful across all domains",
      },
      {
        id: "o4-mini",
        name: "o4 Mini (Copilot)",
        maxTokens: 200000,
        costPer1kTokens: 0,
        description: "Compact reasoning model with multimodal capabilities",
      },
      {
        id: "o3-mini",
        name: "o3 Mini (Copilot)",
        maxTokens: 200000,
        costPer1kTokens: 0,
        description: "Cost-efficient model optimized for STEM reasoning",
      },
      {
        id: "gpt-4o",
        name: "GPT-4o (Copilot)",
        maxTokens: 128000,
        costPer1kTokens: 0,
        description: "Latest multimodal flagship model",
      },
      {
        id: "claude-3.7-sonnet",
        name: "Claude 3.7 Sonnet (Copilot)",
        maxTokens: 200000,
        costPer1kTokens: 0,
        description: "Hybrid reasoning approach with extended processing",
      },
      {
        id: "claude-3.7-sonnet-thinking",
        name: "Claude 3.7 Sonnet Thinking (Copilot)",
        maxTokens: 200000,
        costPer1kTokens: 0,
        description: "Extended reasoning mode for complex tasks",
      },
      {
        id: "claude-3.5-sonnet",
        name: "Claude 3.5 Sonnet (Copilot)",
        maxTokens: 200000,
        costPer1kTokens: 0,
        description: "Excellent coding and reasoning",
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro (Copilot)",
        maxTokens: 1048576,
        costPer1kTokens: 0,
        description: "Advanced reasoning and thinking capabilities",
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash (Copilot)",
        maxTokens: 1000000,
        costPer1kTokens: 0,
        description: "Enhanced multimodal understanding and coding",
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
