import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useAIChatStore } from "@/features/ai/store/store";
import type { ChatMode, OutputStyle } from "@/features/ai/store/types";
import type { AcpEvent } from "@/features/ai/types/acp";
import type { ContextInfo } from "@/features/ai/types/ai-context";
import { AGENT_OPTIONS, type AgentType } from "@/features/ai/types/ai-chat";
import type { AIMessage } from "@/features/ai/types/messages";
import {
  getAvailableProviders,
  getModelById,
  getProviderById,
} from "@/features/ai/types/providers";
import { getProvider } from "@/features/ai/services/providers/ai-provider-registry";
import { isOllamaCloudUrl } from "@/features/ai/services/providers/ollama-provider";
import { processStreamingResponse } from "@/utils/stream-utils";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { canUseHostedProvider } from "@/features/ai/lib/provider-access";
import { useSettingsStore } from "@/features/settings/store";
import { getAuthToken } from "@/features/window/services/auth-api";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { getApiBase } from "@/utils/api-base";
import { AcpStreamHandler } from "./acp-stream-handler";
import { buildContextPrompt, buildSystemPrompt } from "../utils/ai-context-builder";

// Check if an agent uses ACP (CLI-based) vs HTTP API
export const isAcpAgent = (agentId: AgentType): boolean => {
  const agent = AGENT_OPTIONS.find((a) => a.id === agentId);
  return agent?.isAcp ?? false;
};

function resolveProviderModelPair(providerId: string, modelId: string) {
  const requestedProvider = getProviderById(providerId);
  const requestedStaticModel = getModelById(providerId, modelId);
  if (requestedProvider && requestedStaticModel) {
    return {
      providerId,
      modelId,
      provider: requestedProvider,
      model: requestedStaticModel,
    };
  }

  const { dynamicModels } = useAIChatStore.getState();
  const requestedDynamicModel = dynamicModels[providerId]?.find((model) => model.id === modelId);
  if (requestedProvider && requestedDynamicModel) {
    return {
      providerId,
      modelId,
      provider: requestedProvider,
      model: {
        ...requestedDynamicModel,
        maxTokens: requestedDynamicModel.maxTokens || 4096,
      },
    };
  }

  if (requestedProvider?.id === "openrouter" && modelId.trim().length > 0) {
    return {
      providerId,
      modelId,
      provider: requestedProvider,
      model: {
        id: modelId,
        name: modelId,
        maxTokens: 4096,
      },
    };
  }

  for (const provider of getAvailableProviders()) {
    const staticModel = provider.models.find((model) => model.id === modelId);
    if (staticModel) {
      return {
        providerId: provider.id,
        modelId,
        provider,
        model: staticModel,
      };
    }

    const dynamicModel = dynamicModels[provider.id]?.find((model) => model.id === modelId);
    if (dynamicModel) {
      return {
        providerId: provider.id,
        modelId,
        provider,
        model: {
          ...dynamicModel,
          maxTokens: dynamicModel.maxTokens || 4096,
        },
      };
    }
  }

  return {
    providerId,
    modelId,
    provider: requestedProvider,
    model: undefined,
  };
}

// Generic streaming chat completion function that works with any agent/provider
export const getChatCompletionStream = async (
  agentId: AgentType,
  providerId: string,
  modelId: string,
  userMessage: string,
  context: ContextInfo,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: string, canReconnect?: boolean) => void,
  conversationHistory?: AIMessage[],
  onNewMessage?: () => void,
  onToolUse?: (event: Extract<AcpEvent, { type: "tool_start" }>) => void,
  onToolUpdate?: (event: Extract<AcpEvent, { type: "tool_update" }>) => void,
  onToolComplete?: (toolName: string, toolId?: string, output?: unknown, error?: string) => void,
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void,
  onAcpEvent?: (event: AcpEvent) => void,
  mode: ChatMode = "chat",
  outputStyle: OutputStyle = "default",
  onImageChunk?: (data: string, mediaType: string) => void,
  onResourceChunk?: (uri: string, name: string | null) => void,
  chatId?: string,
): Promise<void> => {
  try {
    // Handle ACP-based CLI agents (Claude Code, Gemini CLI, Codex CLI)
    if (isAcpAgent(agentId)) {
      const handler = new AcpStreamHandler(
        agentId,
        {
          onChunk,
          onComplete,
          onError,
          onNewMessage,
          onToolUse,
          onToolUpdate,
          onToolComplete,
          onPermissionRequest,
          onEvent: onAcpEvent,
          onImageChunk,
          onResourceChunk,
        },
        chatId,
      );
      await handler.start(userMessage, context);
      return;
    }

    // For "custom" agent, use HTTP API providers. Resolve stale provider/model
    // pairs defensively so a recent selector change cannot call the wrong API.
    const resolved = resolveProviderModelPair(providerId, modelId);
    providerId = resolved.providerId;
    modelId = resolved.modelId;
    const provider = resolved.provider;
    const model = resolved.model;

    if (!provider || !model) {
      throw new Error(`Provider or model not found: ${providerId}/${modelId}`);
    }

    const apiKey = await getProviderApiToken(providerId);
    const subscription = useAuthStore.getState().subscription;
    const useHostedOpenRouter = !apiKey && canUseHostedProvider(providerId, subscription);
    if (!apiKey && provider.requiresApiKey && !useHostedOpenRouter) {
      throw new Error(`${provider.name} API key not found`);
    }

    // Ollama Cloud requires auth even though the provider config marks the
    // key as optional (since local Ollama doesn't need one).
    if (providerId === "ollama" && !apiKey) {
      const ollamaBaseUrl = useSettingsStore.getState().settings.ollamaBaseUrl;
      if (ollamaBaseUrl && isOllamaCloudUrl(ollamaBaseUrl)) {
        throw new Error("Ollama Cloud requires an API key. Add one in Settings → AI → Ollama.");
      }
    }

    const contextPrompt = buildContextPrompt(context);
    const systemPrompt = buildSystemPrompt(contextPrompt, mode, outputStyle);

    // Build messages array with conversation history
    const messages: AIMessage[] = [
      {
        role: "system" as const,
        content: systemPrompt,
      },
    ];

    // Add conversation history if provided
    if (conversationHistory && conversationHistory.length > 0) {
      messages.push(...conversationHistory);
    }

    // Add the current user message
    messages.push({
      role: "user" as const,
      content: userMessage,
    });

    if (useHostedOpenRouter) {
      const token = await getAuthToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      const response = await tauriFetch(`${getApiBase()}/api/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        onError(errorText || `Hosted Athas Agent request failed (${response.status})`);
        return;
      }

      await processStreamingResponse(response, onChunk, onComplete, onError);
      return;
    }

    // Use provider abstraction
    const providerImpl = getProvider(providerId);
    if (!providerImpl) {
      throw new Error(`Provider implementation not found: ${providerId}`);
    }

    const streamRequest = {
      modelId,
      messages,
      maxTokens: Math.min(1000, Math.floor(model.maxTokens * 0.25)),
      temperature: 0.7,
      apiKey: apiKey || undefined,
    };

    const headers = providerImpl.buildHeaders(apiKey || undefined);
    const payload = providerImpl.buildPayload(streamRequest);
    const url = providerImpl.buildUrl ? providerImpl.buildUrl(streamRequest) : provider.apiUrl;

    console.log(`Making ${provider.name} streaming chat request with model ${model.name}...`);

    // Use Tauri's fetch for providers that don't support browser CORS
    const needsTauriFetch =
      providerId === "gemini" || providerId === "ollama" || providerId === "anthropic";
    const fetchFn = needsTauriFetch ? tauriFetch : fetch;
    const response = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`${provider.name} API error:`, response.status, response.statusText);
      const errorText = await response.text();
      console.error("Error details:", errorText);
      // Pass error details in a structured format
      onError(`${provider.name} API error: ${response.status}|||${errorText}`);
      return;
    }

    await processStreamingResponse(response, onChunk, onComplete, onError);
  } catch (error: any) {
    console.error(`${providerId} streaming chat completion error:`, error);
    onError(`Failed to connect to ${providerId} API: ${error.message || error}`);
  }
};
