import type { ModelProvider } from "@/features/ai/types/providers.types";

const DASHBOARD_LINKS: Partial<Record<string, string>> = {
  vercel: "https://vercel.com/dashboard/ai-gateway",
  openrouter: "https://openrouter.ai/keys",
  grok: "https://console.x.ai",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/app/apikey",
  mistral: "https://console.mistral.ai/api-keys",
};

/** Where to create a key for a provider, from its own metadata or the built-in list. */
export function getProviderApiKeyUrl(provider: Pick<ModelProvider, "id" | "apiKeyUrl">) {
  return provider.apiKeyUrl || DASHBOARD_LINKS[provider.id];
}
