import { toOpenAIMessage } from "@/features/ai/lib/image-attachments";
import {
  AIProvider,
  type ProviderHeaders,
  type ProviderModel,
  type StreamRequest,
} from "./ai-provider-interface";
import { providerFetch } from "./provider-fetch";

export class OpenRouterProvider extends AIProvider {
  async getModels(apiKey?: string): Promise<ProviderModel[]> {
    try {
      const response = await providerFetch("https://openrouter.ai/api/v1/models", {
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
          context_length?: number;
          top_provider?: { max_completion_tokens?: number };
        }>;
      };

      return (data.data || []).map((model) => ({
        id: model.id,
        name: model.name || model.id,
        contextWindow: model.context_length,
        maxOutputTokens: model.top_provider?.max_completion_tokens,
      }));
    } catch (error) {
      console.error(`${this.id} model fetch error:`, error);
      return [];
    }
  }

  buildHeaders(apiKey?: string): ProviderHeaders {
    const headers: ProviderHeaders = {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
      "HTTP-Referer": "https://localhost",
      "X-Title": "Athas",
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  buildPayload(request: StreamRequest): any {
    return {
      model: request.modelId,
      messages: request.messages.map(toOpenAIMessage),
      max_completion_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: true,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await providerFetch("https://openrouter.ai/api/v1/key", {
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
