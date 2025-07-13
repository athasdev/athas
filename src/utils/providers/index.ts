import { OpenAIProvider } from "./openai-provider";
import { OpenRouterProvider } from "./openrouter-provider";
import type { AIProvider, ProviderConfig } from "./provider-interface";

const providers = new Map<string, AIProvider>();

// Initialize providers
export function initializeProviders(): void {
  const openAIConfig: ProviderConfig = {
    id: "openai",
    name: "OpenAI",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    requiresApiKey: true,
    maxTokens: 4096,
  };
  providers.set("openai", new OpenAIProvider(openAIConfig));

  const openRouterConfig: ProviderConfig = {
    id: "openrouter",
    name: "OpenRouter",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    requiresApiKey: true,
    maxTokens: 4096,
  };
  providers.set("openrouter", new OpenRouterProvider(openRouterConfig));
}

export function getProvider(providerId: string): AIProvider | undefined {
  if (providers.size === 0) {
    initializeProviders();
  }
  return providers.get(providerId);
}

export {
  AIProvider,
  type ProviderConfig,
  type ProviderHeaders,
  type StreamRequest,
} from "./provider-interface";
