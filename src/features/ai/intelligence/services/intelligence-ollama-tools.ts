import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { fetchOllamaModelCapabilities } from "@/features/ai/services/providers/ollama-provider";
import {
  getOllamaToolSupport,
  type OllamaToolSupport,
} from "@/features/ai/lib/ollama-tool-support";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

/** Asks the configured Ollama server, local or custom host, whether `modelId` can call tools. */
export async function resolveOllamaToolSupport(modelId: string): Promise<OllamaToolSupport> {
  const baseUrl = useSettingsStore.getState().settings.ollamaBaseUrl;
  const apiKey = await getProviderApiToken("ollama").catch(() => null);
  return getOllamaToolSupport(await fetchOllamaModelCapabilities(baseUrl, modelId, apiKey));
}
