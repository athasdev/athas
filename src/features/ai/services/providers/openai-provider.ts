import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  AIProvider,
  type ProviderHeaders,
  type ProviderModel,
  type StreamRequest,
} from "./ai-provider-interface";

// Models that require max_completion_tokens instead of max_tokens
const MODELS_REQUIRING_MAX_COMPLETION_TOKENS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.1",
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
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.1",
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
  async getModels(apiKey?: string): Promise<ProviderModel[]> {
    if (!apiKey) {
      return [];
    }

    try {
      const response = await tauriFetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: this.buildHeaders(apiKey),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as { data?: Array<{ id: string }> };
      return (data.data || [])
        .map((model) => model.id)
        .filter((id) => isSupportedOpenAIModel(id))
        .sort(comparePreferredOpenAIModels)
        .map((id) => ({
          id,
          name: formatModelName(id),
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
      const response = await tauriFetch("https://api.openai.com/v1/models", {
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

function isSupportedOpenAIModel(modelId: string): boolean {
  return (
    /^(gpt-|o\d)/.test(modelId) &&
    !modelId.includes("audio") &&
    !modelId.includes("realtime") &&
    !modelId.includes("search-preview") &&
    !modelId.includes("transcribe") &&
    !modelId.includes("tts") &&
    !modelId.includes("chatgpt") &&
    !modelId.includes("image") &&
    !modelId.includes("moderation")
  );
}

function comparePreferredOpenAIModels(a: string, b: string): number {
  return getOpenAIModelRank(a) - getOpenAIModelRank(b) || a.localeCompare(b);
}

function getOpenAIModelRank(modelId: string): number {
  const preferredOrder = [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.2",
    "gpt-5.2-pro",
    "gpt-5.1",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "o3",
    "o3-mini",
    "o4-mini",
    "o1",
  ];
  const index = preferredOrder.indexOf(modelId);
  return index === -1 ? preferredOrder.length + 1 : index;
}

function formatModelName(modelId: string): string {
  return modelId
    .split("-")
    .map((part, index) => {
      if (index === 0) return part.toUpperCase();
      if (part.length <= 2) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
