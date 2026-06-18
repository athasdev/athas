import { AIProvider, type ProviderHeaders, type StreamRequest } from "./ai-provider-interface";
import { providerFetch } from "./provider-fetch";

const V0_API_BASE_URL = "https://api.v0.dev/v1";
const V0_MODEL_CONFIGURATION_IDS = new Set([
  "v0-auto",
  "v0-mini",
  "v0-pro",
  "v0-max",
  "v0-max-fast",
]);

export class V0Provider extends AIProvider {
  buildHeaders(apiKey?: string): ProviderHeaders {
    const headers: ProviderHeaders = {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  buildPayload(request: StreamRequest): Record<string, unknown> {
    const systemMessage = request.messages.find((message) => message.role === "system");
    const conversationMessages = request.messages.filter((message) => message.role !== "system");
    const payload: Record<string, unknown> = {
      message: formatV0ConversationMessage(conversationMessages),
      responseMode: "experimental_stream",
      chatPrivacy: "private",
    };

    if (systemMessage?.content.trim()) {
      payload.system = `${systemMessage.content}

v0 Platform API rules:
- Generate and edit inside the remote v0 sandbox.
- Do not claim that you created, edited, or inspected files on the user's local filesystem.
- If the user asks for local filesystem changes, explain that this v0 provider can generate the app remotely and return the v0 chat or preview link.`;
    }

    if (V0_MODEL_CONFIGURATION_IDS.has(request.modelId)) {
      payload.modelConfiguration = { modelId: request.modelId };
    }

    return payload;
  }

  buildUrl(): string {
    return this.config.apiUrl;
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey.trim()) return false;

    try {
      const response = await providerFetch(`${V0_API_BASE_URL}/user`, {
        method: "GET",
        headers: this.buildHeaders(apiKey),
      });

      return response.ok;
    } catch (error) {
      console.error(`${this.id} API key validation error:`, error);
      return false;
    }
  }
}

function formatV0ConversationMessage(messages: StreamRequest["messages"]): string {
  if (messages.length === 0) return "";

  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (messages.length === 1 && latestUserMessage) {
    return latestUserMessage.content;
  }

  return messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}:\n${message.content}`)
    .join("\n\n");
}
