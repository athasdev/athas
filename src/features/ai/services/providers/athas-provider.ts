import { getApiBase } from "@/utils/api-base";
import { getAuthToken } from "@/features/window/services/auth-api";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  AIProvider,
  type StreamRequest,
  type ProviderHeaders,
  type ProviderModel,
} from "./ai-provider-interface";
import { toOpenAIMessage } from "@/features/ai/lib/image-attachments";

export class AthasProvider extends AIProvider {
  async buildHeaders(): Promise<ProviderHeaders> {
    const token = await getAuthToken();
    if (!token) throw new Error("Sign in to Athas to use hosted models.");
    return {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  buildPayload(request: StreamRequest) {
    return {
      model: request.modelId,
      messages: request.messages.map(toOpenAIMessage),
      max_completion_tokens: Math.min(request.maxTokens, 4096),
      temperature: request.temperature,
      stream: true,
    };
  }

  buildUrl(): string {
    return `${getApiBase()}/api/ai/chat`;
  }

  override async getModels(): Promise<ProviderModel[]> {
    const response = await tauriFetch(this.buildUrl(), { headers: await this.buildHeaders() });
    if (!response.ok) throw new Error("Could not load Athas models.");
    const result = (await response.json()) as { enabled: boolean; data: ProviderModel[] };
    return result.enabled ? result.data : [];
  }

  async validateApiKey(): Promise<boolean> {
    return Boolean(await getAuthToken());
  }
}
