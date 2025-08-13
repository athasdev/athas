import { GeminiProvider } from "./gemini-provider";
import { OpenAIProvider } from "./openai-provider";
import { OpenRouterProvider } from "./openrouter-provider";
import type { AIProvider, ProviderConfig } from "./provider-interface";

const providers = new Map<string, AIProvider>();

// Initialize providers
function initializeProviders(): void {
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

  const geminiConfig: ProviderConfig = {
    id: "gemini",
    name: "Google Gemini",
    // Base URL; final request will append :stream?key=<API_KEY>
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    requiresApiKey: true,
    maxTokens: 4096,
  };
  providers.set("gemini", new GeminiProvider(geminiConfig));
}

export function getProvider(providerId: string): AIProvider | undefined {
  if (providers.size === 0) {
    initializeProviders();
  }
  return providers.get(providerId);
}
