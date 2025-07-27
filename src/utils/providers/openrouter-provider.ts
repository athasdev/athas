import { AIProvider, type ProviderHeaders, type StreamRequest } from "./provider-interface";

export class OpenRouterProvider extends AIProvider {
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
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://localhost",
          "X-Title": "Code Editor",
        },
      });

      if (response.ok) {
        return true;
      } else {
        console.error(`${this.name} API validation error:`, response.status);
        return false;
      }
    } catch (error) {
      console.error(`${this.id} API key validation error:`, error);
      return false;
    }
  }
}
