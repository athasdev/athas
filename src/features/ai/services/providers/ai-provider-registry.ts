import { AnthropicProvider } from "./anthropic-provider";
import { GeminiProvider } from "./gemini-provider";
import { GrokProvider } from "./grok-provider";
import { MistralProvider } from "./mistral-provider";
import { OllamaProvider } from "./ollama-provider";
import { OpenAIProvider } from "./openai-provider";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
import { OpenRouterProvider } from "./openrouter-provider";
import { V0Provider } from "./v0-provider";
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

  const v0Config: ProviderConfig = {
    id: "v0",
    name: "v0",
    apiUrl: "https://api.v0.dev/v1/chat/completions",
    requiresApiKey: true,
    maxTokens: 32768,
  };
  providers.set("v0", new V0Provider(v0Config));

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

  const mistralConfig: ProviderConfig = {
    id: "mistral",
    name: "Mistral AI",
    apiUrl: "https://api.mistral.ai/v1/chat/completions",
    requiresApiKey: true,
    maxTokens: 131072,
  };
  providers.set("mistral", new MistralProvider(mistralConfig));

  const deepSeekConfig: ProviderConfig = {
    id: "deepseek",
    name: "DeepSeek",
    apiUrl: "https://api.deepseek.com/chat/completions",
    requiresApiKey: true,
    maxTokens: 128000,
  };
  providers.set("deepseek", new OpenAICompatibleProvider(deepSeekConfig));

  const qwenConfig: ProviderConfig = {
    id: "qwen",
    name: "Qwen",
    apiUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    requiresApiKey: true,
    maxTokens: 1000000,
  };
  providers.set("qwen", new OpenAICompatibleProvider(qwenConfig));

  const customConfig: ProviderConfig = {
    id: "custom",
    name: "Custom",
    apiUrl: "",
    requiresApiKey: false,
    maxTokens: 4096,
  };
  providers.set("custom", new OpenAICompatibleProvider(customConfig));

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

function getOllamaProvider(): OllamaProvider | undefined {
  if (providers.size === 0) {
    initializeProviders();
  }
  const ollama = providers.get("ollama");
  return ollama instanceof OllamaProvider ? ollama : undefined;
}

export function setOllamaBaseUrl(baseUrl: string): void {
  getOllamaProvider()?.setBaseUrl(baseUrl);
}

export function setOllamaApiKey(apiKey: string | null): void {
  getOllamaProvider()?.setApiKey(apiKey);
}

function getCustomProvider(): OpenAICompatibleProvider | undefined {
  if (providers.size === 0) {
    initializeProviders();
  }
  const custom = providers.get("custom");
  return custom instanceof OpenAICompatibleProvider ? custom : undefined;
}

export function setCustomProviderBaseUrl(baseUrl: string): void {
  getCustomProvider()?.setBaseUrl(baseUrl);
}
