import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  AIProvider,
  type ProviderHeaders,
  type ProviderModel,
  type StreamRequest,
} from "./ai-provider-interface";

export class GeminiProvider extends AIProvider {
  async getModels(apiKey?: string): Promise<ProviderModel[]> {
    if (!apiKey) {
      return [];
    }

    try {
      const response = await tauriFetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        {
          method: "GET",
        },
      );

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        models?: Array<{
          name: string;
          displayName?: string;
          outputTokenLimit?: number;
          supportedGenerationMethods?: string[];
        }>;
      };

      return (data.models || [])
        .filter((model) => {
          const modelId = model.name.replace(/^models\//, "");
          return (
            model.supportedGenerationMethods?.includes("generateContent") &&
            (modelId.startsWith("gemini-") || modelId.startsWith("learnlm-"))
          );
        })
        .map((model) => ({
          id: model.name.replace(/^models\//, ""),
          name: model.displayName || model.name.replace(/^models\//, ""),
          maxTokens: model.outputTokenLimit,
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
      headers["x-goog-api-key"] = apiKey;
    }
    return headers;
  }

  buildUrl(request: StreamRequest): string {
    return `${this.config.apiUrl}/${request.modelId}:streamGenerateContent`;
  }

  buildPayload(request: StreamRequest): any {
    const systemMessage = request.messages.find((msg) => msg.role === "system");

    const generationConfig: Record<string, unknown> = {
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
    };

    if (request.responseFormat === "json_object") {
      generationConfig.responseMimeType = "application/json";
    }

    const payload: Record<string, unknown> = {
      contents: request.messages
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        })),
      generationConfig,
    };

    if (systemMessage) {
      payload.systemInstruction = {
        parts: [{ text: systemMessage.content }],
      };
    }

    return payload;
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await tauriFetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        {
          method: "GET",
        },
      );

      return response.ok;
    } catch (error) {
      console.error(`${this.id} API key validation error:`, error);
      return false;
    }
  }
}
