import type { ProviderModel } from "./provider-interface";
import { AIProvider, type ProviderHeaders, type StreamRequest } from "./provider-interface";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export class OllamaProvider extends AIProvider {
  private baseUrl: string = DEFAULT_OLLAMA_BASE_URL;

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, "") || DEFAULT_OLLAMA_BASE_URL;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  buildHeaders(): ProviderHeaders {
    return {
      "Content-Type": "application/json",
    };
  }

  buildPayload(request: StreamRequest) {
    return {
      model: request.modelId,
      messages: request.messages,
      stream: true,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }

  buildUrl(): string {
    return `${this.baseUrl}/v1/chat/completions`;
  }

  async getModels(): Promise<ProviderModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return [];

      const data = await response.json();
      return data.models.map((model: { name: string }) => ({
        id: model.name,
        name: model.name,
        maxTokens: 4096,
      }));
    } catch {
      return [];
    }
  }
}
