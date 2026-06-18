import { AnthropicProvider } from "./anthropic-provider";
import { GeminiProvider } from "./gemini-provider";
import { GrokProvider } from "./grok-provider";
import { MistralProvider } from "./mistral-provider";
import { OllamaProvider } from "./ollama-provider";
import { OpenAIProvider } from "./openai-provider";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
import { OpenRouterProvider } from "./openrouter-provider";
import type { AIProvider, ProviderConfig } from "./ai-provider-interface";
import type { Settings } from "@/features/settings/types/settings.types";
import {
  registerModelProviderExtension,
  unregisterModelProviderExtensions,
  type ModelProvider,
} from "@/features/ai/types/providers.types";

const providers = new Map<string, AIProvider>();
const extensionProviderIds = new Map<string, Set<string>>();
const providerFetchModes = new Map<string, boolean>();
const providerSystemPromptBuilders = new Map<string, (settings: Settings) => string>();

export interface AIProviderRuntimeContribution {
  extensionId: string;
  provider: ModelProvider;
  createProvider: (config: ProviderConfig) => AIProvider;
  useTauriFetch?: boolean;
  buildSystemPromptContext?: (settings: Settings) => string;
}

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

function ensureProvidersInitialized(): void {
  if (providers.size === 0) {
    initializeProviders();
  }
}

export function registerAIProviderExtension(contribution: AIProviderRuntimeContribution): void {
  ensureProvidersInitialized();

  const maxTokens =
    contribution.provider.maxTokens ??
    Math.max(4096, ...contribution.provider.models.map((model) => model.maxTokens));
  const config: ProviderConfig = {
    id: contribution.provider.id,
    name: contribution.provider.name,
    apiUrl: contribution.provider.apiUrl,
    requiresApiKey: contribution.provider.requiresApiKey,
    maxTokens,
  };

  providers.set(contribution.provider.id, contribution.createProvider(config));
  providerFetchModes.set(contribution.provider.id, Boolean(contribution.useTauriFetch));

  if (contribution.buildSystemPromptContext) {
    providerSystemPromptBuilders.set(
      contribution.provider.id,
      contribution.buildSystemPromptContext,
    );
  } else {
    providerSystemPromptBuilders.delete(contribution.provider.id);
  }

  const providerIds = extensionProviderIds.get(contribution.extensionId) ?? new Set<string>();
  providerIds.add(contribution.provider.id);
  extensionProviderIds.set(contribution.extensionId, providerIds);
  registerModelProviderExtension(contribution.extensionId, contribution.provider);
}

export function unregisterAIProviderExtension(extensionId: string): void {
  ensureProvidersInitialized();

  const providerIds = extensionProviderIds.get(extensionId);
  if (!providerIds) return;

  providerIds.forEach((providerId) => {
    providers.delete(providerId);
    providerFetchModes.delete(providerId);
    providerSystemPromptBuilders.delete(providerId);
  });
  extensionProviderIds.delete(extensionId);
  unregisterModelProviderExtensions(extensionId);
}

export function shouldUseTauriFetchForProvider(providerId: string): boolean {
  if (providerFetchModes.has(providerId)) {
    return providerFetchModes.get(providerId) ?? false;
  }

  return providerId === "gemini" || providerId === "ollama" || providerId === "anthropic";
}

export function buildProviderSystemPromptContext(providerId: string, settings: Settings): string {
  return providerSystemPromptBuilders.get(providerId)?.(settings) ?? "";
}

export function getProvider(providerId: string): AIProvider | undefined {
  ensureProvidersInitialized();
  return providers.get(providerId);
}

function getOllamaProvider(): OllamaProvider | undefined {
  ensureProvidersInitialized();
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
  ensureProvidersInitialized();
  const custom = providers.get("custom");
  return custom instanceof OpenAICompatibleProvider ? custom : undefined;
}

export function setCustomProviderBaseUrl(baseUrl: string): void {
  getCustomProvider()?.setBaseUrl(baseUrl);
}
