import { useIntelligenceSettingsStore } from "@/features/ai/intelligence/stores/intelligence-settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { getApiBase } from "@/utils/api-base";
import { getAuthToken } from "@/features/window/services/auth-api";
import { tauriFetch } from "@/utils/tauri-fetch";
import {
  AIProvider,
  type StreamRequest,
  type ProviderHeaders,
  type ProviderModel,
} from "./ai-provider-interface";
import { toOpenAIMessage } from "@/features/ai/lib/image-attachments";

/**
 * The server offers hosted models only to accounts with Athas Pro or a prepaid usage balance.
 * Carries a 402 so chat recovery offers billing instead of provider settings.
 */
export class HostedEntitlementError extends Error {
  readonly status = 402;
  readonly code = "entitlement_required";

  constructor() {
    super(
      "Hosted models need Athas Pro or a prepaid usage balance. Upgrade or top up in billing to use them.",
    );
    this.name = "HostedEntitlementError";
  }
}

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
    if (response.status === 402) throw new HostedEntitlementError();
    if (!response.ok) throw new Error(`Could not connect to Athas (${response.status}).`);
    const result = (await response.json()) as { enabled: boolean; data: ProviderModel[] };
    if (!result.enabled) {
      // A Pro account is entitled; then the server itself has hosted models turned off.
      if (useAuthStore.getState().subscription?.status === "pro")
        throw new Error("Hosted models are not available on this Athas server.");
      throw new HostedEntitlementError();
    }
    return result.data;
  }

  async validateApiKey(): Promise<boolean> {
    return Boolean(await getAuthToken());
  }
}
