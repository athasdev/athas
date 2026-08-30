import {
  AIProvider,
  type ProviderConfig,
  type ProviderHeaders,
  type ProviderModel,
  type StreamRequest,
} from "./ai-provider-interface";
import { registerAIProviderExtension, unregisterAIProviderExtension } from "./ai-provider-registry";
import {
  registerAIProviderIconUrl,
  unregisterAIProviderIconsByExtension,
} from "./ai-provider-icon-registry";
import {
  registerAIProviderSettingsAction,
  unregisterAIProviderSettingsActionsByExtension,
} from "./ai-provider-settings-registry";
import { getManifestAIProviderContributions } from "@/extensions/types/extension-contributions";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";

type ExtensionRequest = (method: string, params?: unknown[]) => Promise<unknown>;

function providerHeaders(value: unknown): ProviderHeaders {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External AI provider returned invalid headers");
  }

  return Object.fromEntries(Object.entries(value).map(([key, header]) => [key, String(header)]));
}

function providerModels(value: unknown): ProviderModel[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((model) => {
    if (!model || typeof model !== "object" || Array.isArray(model)) return [];
    const record = model as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) return [];

    return [
      {
        id,
        name: typeof record.name === "string" && record.name.trim() ? record.name : id,
        contextWindow: typeof record.contextWindow === "number" ? record.contextWindow : undefined,
        maxOutputTokens:
          typeof record.maxOutputTokens === "number" ? record.maxOutputTokens : undefined,
        maxTokens: typeof record.maxTokens === "number" ? record.maxTokens : undefined,
      },
    ];
  });
}

class ExternalAIProvider extends AIProvider {
  constructor(
    config: ProviderConfig,
    private readonly request: ExtensionRequest,
  ) {
    super(config);
  }

  async buildHeaders(apiKey?: string): Promise<ProviderHeaders> {
    return providerHeaders(await this.request("aiProvider.buildHeaders", [this.id, apiKey]));
  }

  buildPayload(request: StreamRequest): Promise<unknown> {
    return this.request("aiProvider.buildPayload", [this.id, request]);
  }

  async buildUrl(request: StreamRequest): Promise<string> {
    const value = await this.request("aiProvider.buildUrl", [this.id, request]);
    return typeof value === "string" && value.trim() ? value : this.apiUrl;
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    return (await this.request("aiProvider.validateApiKey", [this.id, apiKey])) === true;
  }

  async getModels(apiKey?: string): Promise<ProviderModel[]> {
    return providerModels(await this.request("aiProvider.getModels", [this.id, apiKey]));
  }
}

export function registerExternalAIProvider(params: {
  extensionId: string;
  manifest: ExtensionManifest;
  providerId: string;
  request: ExtensionRequest;
}): void {
  const provider = getManifestAIProviderContributions(params.manifest).find(
    (candidate) => candidate.id === params.providerId,
  );
  if (!provider) {
    throw new Error(`Extension does not contribute AI provider ${params.providerId}`);
  }

  registerAIProviderExtension({
    extensionId: params.extensionId,
    provider,
    createProvider: (config) => new ExternalAIProvider(config, params.request),
    useTauriFetch: provider.transport === "tauri",
    buildSystemPromptContext: async () => {
      const value = await params.request("aiProvider.getSystemPromptContext", [provider.id]);
      return typeof value === "string" ? value : "";
    },
  });

  if (params.manifest.icon) {
    registerAIProviderIconUrl({
      extensionId: params.extensionId,
      providerId: provider.id,
      url: params.manifest.icon,
    });
  }
}

export function registerExternalAIProviderSettingsAction(params: {
  extensionId: string;
  manifest: ExtensionManifest;
  providerId: string;
  id: string;
  label: string;
  buttonLabel: string;
  description?: string;
  icon?: "palette" | "sparkles";
  execute: () => void | Promise<void>;
}): void {
  if (
    !getManifestAIProviderContributions(params.manifest).some(
      (provider) => provider.id === params.providerId,
    )
  ) {
    throw new Error(`Extension does not contribute AI provider ${params.providerId}`);
  }
  registerAIProviderSettingsAction({
    id: params.id,
    extensionId: params.extensionId,
    providerId: params.providerId,
    label: params.label,
    buttonLabel: params.buttonLabel,
    description: params.description,
    icon: params.icon,
    execute: params.execute,
  });
}

export function unregisterExternalAIProviders(extensionId: string): void {
  unregisterAIProviderExtension(extensionId);
  unregisterAIProviderIconsByExtension(extensionId);
  unregisterAIProviderSettingsActionsByExtension(extensionId);
}
