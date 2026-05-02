import {
  AIProvider,
  type ProviderHeaders,
  type ProviderModel,
  type StreamRequest,
} from "./ai-provider-interface";

export class GrokProvider extends AIProvider {
  async getModels(apiKey?: string): Promise<ProviderModel[]> {
    if (!apiKey) {
      return [];
    }

    try {
      const response = await fetch("https://api.x.ai/v1/language-models", {
        method: "GET",
        headers: this.buildHeaders(apiKey),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        models?: Array<{ id: string; aliases?: string[] }>;
      };

      return (data.models || []).flatMap((model) => {
        const ids = [model.id, ...(model.aliases || [])].filter(Boolean);
        return ids.map((id) => ({
          id,
          name: formatGrokModelName(id),
        }));
      });
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
      const response = await fetch("https://api.x.ai/v1/api-key", {
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

function formatGrokModelName(modelId: string): string {
  return modelId
    .split("-")
    .map((part) => (part === "grok" ? "Grok" : part.length <= 3 ? part.toUpperCase() : part))
    .join(" ");
}
