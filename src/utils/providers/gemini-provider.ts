import { AIProvider, type ProviderHeaders, type StreamRequest } from "./provider-interface";

/**
 * Google Gemini provider implementation
 * - Uses x-goog-api-key header for auth
 * - Validation hits the public models endpoint
 * - Payload maps OpenAI-like messages to Gemini contents structure
 */
export class GeminiProvider extends AIProvider {
  buildHeaders(_apiKey?: string): ProviderHeaders {
    const headers: ProviderHeaders = {
      "Content-Type": "application/json",
    };

    return headers;
  }

  buildPayload(request: StreamRequest): any {
    // Separate optional system message
    const systemMessage = request.messages.find((m) => m.role === "system");
    const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

    // Convert messages to Gemini contents format
    const contents = nonSystemMessages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    const payload: any = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
      },
    };

    if (systemMessage) {
      payload.systemInstruction = {
        parts: [{ text: systemMessage.content }],
      };
    }

    return payload;
  }

  getRequestUrl(modelId: string, apiKey?: string): string {
    const base = this.apiUrl.replace(/\/$/, "");
    const path = `${base}/${encodeURIComponent(modelId)}:generateContent`;
    return apiKey ? `${path}?key=${encodeURIComponent(apiKey)}` : path;
  }

  supportsSSE(): boolean {
    return false;
  }

  parseResponseJson(json: any): string {
    const parts = Array.isArray(json?.candidates) ? json.candidates[0]?.content?.parts || [] : [];
    return parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // List models as a lightweight validation check
      const url = "https://generativelanguage.googleapis.com/v1beta/models";
      const response = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
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
