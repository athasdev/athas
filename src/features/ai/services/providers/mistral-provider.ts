import {
  AIProvider,
  type ProviderHeaders,
  type ProviderModel,
  type StreamRequest,
} from "./ai-provider-interface";
import { providerFetch } from "./provider-fetch";

export class MistralProvider extends AIProvider {
  async getModels(apiKey?: string): Promise<ProviderModel[]> {
    if (!apiKey) {
      return [];
    }

    try {
      const response = await providerFetch("https://api.mistral.ai/v1/models", {
        method: "GET",
        headers: this.buildHeaders(apiKey),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        data?: Array<{ id: string; name?: string; max_context_length?: number }>;
      };

      return (data.data || [])
        .filter((model) => Boolean(model.id))
        .map((model) => ({
          id: model.id,
          name: model.name || formatMistralModelName(model.id),
          maxTokens: model.max_context_length,
        }));
    } catch (error) {
      console.error(`${this.id} model fetch error:`, error);
      return [];
    }
  }

  buildHeaders(apiKey?: string): ProviderHeaders {
    const headers: ProviderHeaders = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  buildPayload(request: StreamRequest): Record<string, unknown> {
    return {
      model: request.modelId,
      messages: request.messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: true,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await providerFetch("https://api.mistral.ai/v1/models", {
        method: "GET",
        headers: this.buildHeaders(apiKey),
      });

      return response.ok;
    } catch (error) {
      console.error(`${this.id} API key validation error:`, error);
      return false;
    }
  }
}

function formatMistralModelName(modelId: string): string {
  return modelId
    .split("-")
    .map((part) => {
      if (/^\d+$/.test(part)) return part;
      if (part.length <= 3) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
