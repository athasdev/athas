import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  AIProvider,
  type ProviderHeaders,
  type ProviderModel,
  type StreamRequest,
} from "./ai-provider-interface";

function trimTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizeChatCompletionsUrl(baseUrl: string): string {
  const trimmed = trimTrailingSlashes(baseUrl);
  if (!trimmed) {
    throw new Error("Custom provider base URL is required.");
  }

  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function modelsUrlFromChatUrl(chatUrl: string): string {
  if (chatUrl.endsWith("/chat/completions")) {
    return chatUrl.slice(0, -"/chat/completions".length) + "/models";
  }
  return `${trimTrailingSlashes(chatUrl)}/models`;
}

export class OpenAICompatibleProvider extends AIProvider {
  private baseUrlOverride = "";

  setBaseUrl(baseUrl: string): void {
    this.baseUrlOverride = trimTrailingSlashes(baseUrl);
  }

  getBaseUrl(): string {
    return this.baseUrlOverride || this.config.apiUrl;
  }

  buildHeaders(apiKey?: string): ProviderHeaders {
    return {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
  }

  buildPayload(request: StreamRequest): any {
    return {
      model: request.modelId,
      messages: request.messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: true,
      ...(request.responseFormat ? { response_format: { type: request.responseFormat } } : {}),
    };
  }

  buildUrl(): string {
    return normalizeChatCompletionsUrl(this.getBaseUrl());
  }

  async getModels(apiKey?: string): Promise<ProviderModel[]> {
    const response = await tauriFetch(modelsUrlFromChatUrl(this.buildUrl()), {
      method: "GET",
      headers: this.buildHeaders(apiKey),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      data?: Array<{ id?: string; name?: string; max_context_length?: number }>;
      models?: Array<{ id?: string; name?: string; max_context_length?: number }>;
    };
    const models = Array.isArray(data.data) ? data.data : data.models || [];
    const parsedModels: ProviderModel[] = [];
    for (const model of models) {
      const id = model.id?.trim() || "";
      if (!id) continue;
      parsedModels.push({
        id,
        name: model.name || id,
        maxTokens: model.max_context_length,
      });
    }
    return parsedModels;
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey.trim()) return false;

    try {
      const response = await tauriFetch(modelsUrlFromChatUrl(this.buildUrl()), {
        method: "GET",
        headers: this.buildHeaders(apiKey),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
