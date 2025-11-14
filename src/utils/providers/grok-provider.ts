import { AIProvider, type ProviderHeaders, type StreamRequest } from "./provider-interface";

export class GrokProvider extends AIProvider {
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
