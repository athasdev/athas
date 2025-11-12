import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { AIProvider, type ProviderHeaders, type StreamRequest } from "./provider-interface";

export class GeminiProvider extends AIProvider {
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
    return {
      contents: request.messages
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        })),
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await tauriFetch("https://generativelanguage.googleapis.com/v1beta/models", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
      });

      if (response.ok) {
        return true;
      }
      console.error(`${this.name} API validation error:`, response.status);
      return false;
    } catch (error) {
      console.error(`${this.id} API key validation error:`, error);
      return false;
    }
  }
}
