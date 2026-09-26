import { formatApiError } from "../lib/api-error";
import { resolveAgentModel } from "../intelligence/lib/resolve-agent-model";
import {
  assertIntelligenceConnectionAllowed,
  getIntelligenceConnection,
} from "../intelligence/services/intelligence-connection";
import { loadWorkspaceTeamContext } from "@/features/workspace/team/services/workspace-team-context";
import { tauriFetch } from "@/utils/tauri-fetch";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatMode, OutputStyle } from "@/features/ai/types/ai-chat.types";
import type { AcpEvent } from "@/features/ai/types/acp.types";
import type { AgentCompletionResult } from "@/features/ai/types/agent-completion.types";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import type { AIMessage } from "@/features/ai/types/messages.types";
import { getProviderById } from "@/features/ai/types/providers.types";
import {
  buildProviderSystemPromptContext,
  getProvider,
  shouldUseTauriFetchForProvider,
} from "@/features/ai/services/providers/ai-provider-registry";
import { isOllamaCloudUrl } from "@/features/ai/lib/ollama-endpoint";
import { processStreamingResponse } from "@/utils/stream-utils";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { resolveChatCompletionTokenLimit } from "@/features/ai/lib/chat-completion-budget";
import {
  getCustomProviderApiToken,
  resolveCustomProviderBaseUrl,
} from "@/features/ai/lib/custom-provider-config";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { AcpStreamHandler } from "./acp-stream-handler";
import { buildContextPrompt, buildSystemPrompt } from "../utils/ai-context-builder";
import { isTerminalAgent } from "../lib/terminal-agents";
import { setCustomProviderBaseUrl } from "./providers/ai-provider-registry";
import { CODEX_INTEGRATION_ID } from "../integrations/integration-registry";
import { CodexIntegrationService } from "../integrations/codex/codex-integration-service";

// Check if an agent uses ACP (CLI-based) vs HTTP API
export const isAcpAgent = (agentId: AgentType): boolean => {
  return agentId !== "custom" && agentId !== CODEX_INTEGRATION_ID && !isTerminalAgent(agentId);
};

// Generic streaming chat completion function that works with any agent/provider
export const getChatCompletionStream = async (
  agentId: AgentType,
  providerId: string,
  modelId: string,
  userMessage: string,
  context: ContextInfo,
  onChunk: (chunk: string) => void,
  onComplete: (result?: AgentCompletionResult) => void,
  onError: (error: string, canReconnect?: boolean) => void,
  conversationHistory?: AIMessage[],
  onResponseContinuation?: () => void,
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
  systemPromptOverride?: string,
  onResponsePhase?: (phase: "starting" | "waiting" | "stalled") => void,
): Promise<void> => {
  try {
    if (context.projectRoot) {
      const team = await loadWorkspaceTeamContext(context.projectRoot);
      context = { ...context, teamInstructions: team?.instructions };
    }
    if (agentId === CODEX_INTEGRATION_ID) {
      const integration = new CodexIntegrationService(
        {
          onChunk,
          onComplete,
          onError,
          onResponseContinuation,
          onToolUse,
          onToolComplete,
          onPermissionRequest,
          onEvent: onAcpEvent,
        },
        chatId,
      );
      const contextPrompt = buildContextPrompt(context);
      await integration.start(
        contextPrompt ? `${contextPrompt}\n\nUser request:\n${userMessage}` : userMessage,
        context,
      );
      return;
    }

    // Handle ACP-based coding agents.
    if (isAcpAgent(agentId)) {
      const handler = new AcpStreamHandler(
        agentId,
        {
          onChunk,
          onComplete,
          onError,
          onResponseContinuation,
          onToolUse,
          onToolUpdate,
          onToolComplete,
          onPermissionRequest,
          onEvent: onAcpEvent,
          onImageChunk,
          onResourceChunk,
          onResponsePhase,
        },
        chatId,
      );
      await handler.start(userMessage, context);
      return;
    }

    await getIntelligenceConnection("agent");
    assertIntelligenceConnectionAllowed(providerId, "agent");
    const provider = getProviderById(providerId);
    const settings = useSettingsStore.getState().settings;
    const model = resolveAgentModel({
      provider,
      modelId,
      dynamicModels: useAIChatStore.getState().dynamicModels[providerId] ?? [],
      customDefault: settings.aiCustomModelId || settings.aiAutocompleteCustomModelId,
    });
    if (model) modelId = model.id;

    if (providerId === "custom" && !model) {
      throw new Error("Custom provider model is required. Add one in Settings -> Agent.");
    }

    if (!provider || !model) {
      throw new Error(`Provider or model not found: ${providerId}/${modelId}`);
    }

    const customProviderBaseUrl =
      providerId === "custom" ? resolveCustomProviderBaseUrl(settings) : "";
    const apiKey =
      providerId === "custom"
        ? await getCustomProviderApiToken()
        : await getProviderApiToken(providerId);
    if (!apiKey && provider.requiresApiKey) {
      throw new Error(`${provider.name} API key not found`);
    }

    if (providerId === "custom" && !customProviderBaseUrl) {
      throw new Error("Custom provider base URL is required. Add one in Settings -> Agent.");
    }
    if (providerId === "custom") {
      setCustomProviderBaseUrl(customProviderBaseUrl);
    }

    // Ollama Cloud requires auth even though the provider config marks the
    // key as optional (since local Ollama doesn't need one).
    if (providerId === "ollama" && !apiKey) {
      const ollamaBaseUrl = useSettingsStore.getState().settings.ollamaBaseUrl;
      if (ollamaBaseUrl && isOllamaCloudUrl(ollamaBaseUrl)) {
        throw new Error(
          "Ollama Cloud requires an API key. Add one in Settings -> Agent -> Ollama.",
        );
      }
    }

    const contextPrompt = buildContextPrompt(context);
    let systemPrompt = systemPromptOverride || buildSystemPrompt(contextPrompt, mode, outputStyle);
    const providerSystemPromptContext = await buildProviderSystemPromptContext(
      providerId,
      settings,
    );
    if (providerSystemPromptContext) {
      systemPrompt = `${systemPrompt}\n\n${providerSystemPromptContext}`;
    }

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
      ...(context.images?.length ? { images: context.images } : {}),
    });

    if (
      [
        "athas",
        "anthropic",
        "openai",
        "openrouter",
        "vercel",
        "gemini",
        "grok",
        "mistral",
        "deepseek",
        "qwen",
        "ollama",
        "custom",
      ].includes(providerId)
    ) {
      const { runIntelligenceAgent } = await import("../intelligence/services/intelligence-agent");
      const result = await runIntelligenceAgent({
        sessionId: chatId || crypto.randomUUID(),
        providerId,
        modelId,
        messages,
        root: context.projectRoot,
        readOnly: mode === "plan",
        onChunk,
        onToolUse,
        onToolComplete,
        onPermissionRequest,
      });
      onComplete(result);
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
      maxTokens: resolveChatCompletionTokenLimit(model.maxOutputTokens ?? model.maxTokens),
      temperature: 0.7,
      apiKey: apiKey || undefined,
    };

    const headers = await providerImpl.buildHeaders(apiKey || undefined);
    const payload = await providerImpl.buildPayload(streamRequest);
    const url = providerImpl.buildUrl
      ? await providerImpl.buildUrl(streamRequest)
      : provider.apiUrl;

    console.log(`Making ${provider.name} streaming chat request with model ${model.name}...`);

    // Use Tauri's fetch for providers that don't support browser CORS
    const needsTauriFetch = shouldUseTauriFetchForProvider(providerId);
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
    onError(formatApiError(providerId, error));
  }
};
