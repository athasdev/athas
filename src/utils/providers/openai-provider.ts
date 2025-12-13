import { AIProvider, type ProviderHeaders, type StreamRequest } from "./provider-interface";

// Models that require max_completion_tokens instead of max_tokens
const MODELS_REQUIRING_MAX_COMPLETION_TOKENS = [
  "gpt-5",
  "gpt-5-pro",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "o1",
  "o1-mini",
  "o1-preview",
  "o3",
  "o3-mini",
  "o4-mini",
];

// Models that don't support custom temperature (only default 1)
const MODELS_WITHOUT_TEMPERATURE_SUPPORT = [
  "gpt-5",
  "gpt-5-pro",
  "gpt-5-mini",
  "gpt-5-nano",
  "o1",
  "o1-mini",
  "o1-preview",
  "o3",
  "o3-mini",
  "o4-mini",
];

export class OpenAIProvider extends AIProvider {
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
    const useMaxCompletionTokens = MODELS_REQUIRING_MAX_COMPLETION_TOKENS.some((model) =>
      request.modelId.startsWith(model),
    );
    const supportsTemperature = !MODELS_WITHOUT_TEMPERATURE_SUPPORT.some((model) =>
      request.modelId.startsWith(model),
    );

    const payload: Record<string, unknown> = {
      model: request.modelId,
      messages: request.messages,
      stream: true,
    };

    // Only include temperature for models that support it
    if (supportsTemperature) {
      payload.temperature = request.temperature;
    }

    if (useMaxCompletionTokens) {
      payload.max_completion_tokens = request.maxTokens;
    } else {
      payload.max_tokens = request.maxTokens;
    }

    return payload;
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      return response.ok;
    } catch (error) {
      console.error(`${this.id} API key validation error:`, error);
      return false;
    }
  }
}
