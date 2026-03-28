import { AIProvider, type ProviderHeaders, type StreamRequest } from "./ai-provider-interface";

export class AnthropicProvider extends AIProvider {
  buildHeaders(apiKey?: string): ProviderHeaders {
    const headers: ProviderHeaders = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };

    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    return headers;
  }

  buildPayload(request: StreamRequest): Record<string, unknown> {
    // Anthropic uses 'system' as a top-level param, not in messages array
    const systemMessage = request.messages.find((m) => m.role === "system");
    const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

    return {
      model: request.modelId,
      max_tokens: request.maxTokens,
      stream: true,
      ...(systemMessage ? { system: systemMessage.content } : {}),
      messages: nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // Send a minimal request to check if the key is valid
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      // 200 = valid key, 401 = invalid key, other errors = network issue but key format ok
      return response.ok || (response.status !== 401 && response.status !== 403);
    } catch (error) {
      console.error(`${this.id} API key validation error:`, error);
      return false;
    }
  }
}
