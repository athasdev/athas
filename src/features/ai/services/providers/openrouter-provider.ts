import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  AIProvider,
  type ProviderHeaders,
  type ProviderModel,
  type StreamRequest,
} from "./ai-provider-interface";

export class OpenRouterProvider extends AIProvider {
  async getModels(apiKey?: string): Promise<ProviderModel[]> {
    try {
      const response = await tauriFetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: this.buildHeaders(apiKey),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          name?: string;
          top_provider?: { max_completion_tokens?: number };
        }>;
      };

      return (data.data || []).map((model) => ({
        id: model.id,
        name: model.name || model.id,
        maxTokens: model.top_provider?.max_completion_tokens,
      }));
    } catch (error) {
      console.error(`${this.id} model fetch error:`, error);
      return [];
    }
  }

  buildHeaders(apiKey?: string): ProviderHeaders {
    const headers: ProviderHeaders = {
      "Content-Type": "application/json",
      "HTTP-Referer": "https://localhost",
      "X-Title": "Code Editor",
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  buildPayload(request: StreamRequest): any {
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
      const response = await tauriFetch("https://openrouter.ai/api/v1/key", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      return response.ok;
    } catch (error) {
      console.error(`${this.id} API key validation error:`, error);
      return false;
    }
  }
}
