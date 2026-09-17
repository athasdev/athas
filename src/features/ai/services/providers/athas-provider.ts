import { useIntelligenceSettingsStore } from "@/features/ai/intelligence/stores/intelligence-settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
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
    const userId = useAuthStore.getState().user?.id;
    const scope = useIntelligenceSettingsStore.getState().scope;
    const token = await getAuthToken();
    if (
      useAuthStore.getState().user?.id !== userId ||
      useIntelligenceSettingsStore.getState().scope !== scope
    )
      throw new Error("The active account or team changed. Try again.");
    if (!token) throw new Error("Sign in to Athas to use hosted models.");
    return {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
      Authorization: `Bearer ${token}`,
      "X-Athas-Intelligence-Scope": scope,
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
    const response = await tauriFetch(this.buildUrl(), {
      headers: await this.buildHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401)
      throw new Error("Your Athas session has expired. Sign out and sign in again.");
    if (!response.ok) throw new Error(`Could not connect to Athas (${response.status}).`);
    const result = (await response.json()) as { enabled: boolean; data: ProviderModel[] };
    if (!result.enabled) throw new Error("Athas Agent is not enabled on this server.");
    return result.data;
  }

  async validateApiKey(): Promise<boolean> {
    return Boolean(await getAuthToken());
  }
}
