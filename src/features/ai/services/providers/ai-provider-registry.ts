import { AnthropicProvider } from "./anthropic-provider";
import { GeminiProvider } from "./gemini-provider";
import { GrokProvider } from "./grok-provider";
import { OllamaProvider } from "./ollama-provider";
import { OpenAIProvider } from "./openai-provider";
import { OpenRouterProvider } from "./openrouter-provider";
import type { AIProvider, ProviderConfig } from "./ai-provider-interface";

const providers = new Map<string, AIProvider>();

function initializeProviders(): void {
  const anthropicConfig: ProviderConfig = {
    id: "anthropic",
    name: "Anthropic",
    apiUrl: "https://api.anthropic.com/v1/messages",
    requiresApiKey: true,
    maxTokens: 200000,
  };
  providers.set("anthropic", new AnthropicProvider(anthropicConfig));

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
    name: "Gemini",
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    requiresApiKey: true,
    maxTokens: 65536,
  };
  providers.set("gemini", new GeminiProvider(geminiConfig));

  const grokConfig: ProviderConfig = {
    id: "grok",
    name: "xAI Grok",
    apiUrl: "https://api.x.ai/v1/chat/completions",
    requiresApiKey: true,
    maxTokens: 131072,
  };
  providers.set("grok", new GrokProvider(grokConfig));

  const ollamaConfig: ProviderConfig = {
    id: "ollama",
    name: "Ollama",
    apiUrl: "http://localhost:11434/v1/chat/completions",
    requiresApiKey: false,
    maxTokens: 4096,
  };
  providers.set("ollama", new OllamaProvider(ollamaConfig));
}

export function getProvider(providerId: string): AIProvider | undefined {
  if (providers.size === 0) {
    initializeProviders();
  }
  return providers.get(providerId);
}

export function setOllamaBaseUrl(baseUrl: string): void {
  if (providers.size === 0) {
    initializeProviders();
  }
  const ollama = providers.get("ollama");
  if (ollama instanceof OllamaProvider) {
    ollama.setBaseUrl(baseUrl);
  }
}
