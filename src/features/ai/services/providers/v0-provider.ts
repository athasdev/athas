import { AIProvider, type ProviderHeaders, type StreamRequest } from "./ai-provider-interface";

export class V0Provider extends AIProvider {
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
      stream: true,
      max_completion_tokens: request.maxTokens,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(this.config.apiUrl, {
        method: "POST",
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify({
          model: "v0-1.5-md",
          messages: [{ role: "user", content: "ping" }],
          stream: false,
          max_completion_tokens: 1,
        }),
      });

      return response.ok;
    } catch (error) {
      console.error(`${this.id} API key validation error:`, error);
      return false;
    }
  }
}
