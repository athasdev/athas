import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useAIChatStore } from "@/features/ai/store/store";
import type { ChatMode, OutputStyle } from "@/features/ai/store/types";
import type { AcpEvent } from "@/features/ai/types/acp";
import { AGENT_OPTIONS, type AgentType } from "@/features/ai/types/ai-chat";
import type { AIMessage } from "@/features/ai/types/messages";
import { getModelById, getProviderById } from "@/features/ai/types/providers";
import { useSettingsStore } from "@/features/settings/store";
import { AcpStreamHandler } from "./acp-handler";
import { buildContextPrompt, buildSystemPrompt } from "./context-builder";
import {
  clearKairoTokens,
  getValidKairoAccessToken,
  KAIRO_BASE_URL,
  KAIRO_CLIENT_NAME,
  KAIRO_CLIENT_PLATFORM,
  KAIRO_CLIENT_VERSION,
} from "./kairo-auth";
import { buildKairoReasoningRequest } from "./kairo-reasoning";
import { getProvider } from "./providers";
import { processStreamingResponse } from "./stream-utils";
import { getProviderApiToken } from "./token-manager";
import type { ContextInfo } from "./types";

// Check if an agent uses ACP (CLI-based) vs HTTP API
export const isAcpAgent = (agentId: AgentType): boolean => {
  const agent = AGENT_OPTIONS.find((a) => a.id === agentId);
  return agent?.isAcp ?? false;
};

export {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
  validateProviderApiKey,
} from "./token-manager";

// Re-export types and legacy functions;

const buildKairoPrompt = (
  systemPrompt: string,
  userMessage: string,
  conversationHistory?: AIMessage[],
): string => {
  const sections: string[] = [];

  if (systemPrompt.trim()) {
    sections.push(`SYSTEM INSTRUCTIONS:\n${systemPrompt}`);
  }

  if (conversationHistory && conversationHistory.length > 0) {
    const history = conversationHistory
      .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
      .join("\n\n");
    sections.push(`CONVERSATION HISTORY:\n${history}`);
  }

  sections.push(`USER:\n${userMessage}`);

  return sections.join("\n\n");
};

// Generic streaming chat completion function that works with any agent/provider
export const getChatCompletionStream = async (
  agentId: AgentType,
  providerId: string,
  modelId: string,
  userMessage: string,
  context: ContextInfo,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  conversationHistory?: AIMessage[],
  onNewMessage?: () => void,
  onToolUse?: (toolName: string, toolInput?: any) => void,
  onToolComplete?: (toolName: string) => void,
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void,
  onAcpEvent?: (event: AcpEvent) => void,
  mode: ChatMode = "chat",
  outputStyle: OutputStyle = "default",
): Promise<void> => {
  try {
    // Handle ACP-based CLI agents (Claude Code, Gemini CLI, Codex CLI)
    if (isAcpAgent(agentId)) {
      const handler = new AcpStreamHandler(agentId, {
        onChunk,
        onComplete,
        onError,
        onNewMessage,
        onToolUse,
        onToolComplete,
        onPermissionRequest,
        onEvent: onAcpEvent,
      });
      await handler.start(userMessage, context);
      return;
    }

    if (agentId === "kairo-code") {
      const accessToken = await getValidKairoAccessToken();
      if (!accessToken) {
        throw new Error(
          "Kairo Code is not connected. Login in Settings > AI > Agent Authentication.",
        );
      }

      const contextPrompt = buildContextPrompt(context);
      const systemPrompt = buildSystemPrompt(contextPrompt, mode, outputStyle);
      const kairoPrompt = buildKairoPrompt(systemPrompt, userMessage, conversationHistory);
      const { aiReasoningLevel, aiThinkingEffort } = useSettingsStore.getState().settings;
      const reasoningPayload = buildKairoReasoningRequest(
        modelId || "gpt-5.2",
        aiReasoningLevel,
        aiThinkingEffort,
      );

      const response = await tauriFetch(`${KAIRO_BASE_URL}/api/kairo/code/stream`, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "x-coline-client": KAIRO_CLIENT_NAME,
          "x-coline-client-version": KAIRO_CLIENT_VERSION,
          "x-coline-client-platform": KAIRO_CLIENT_PLATFORM,
        },
        body: JSON.stringify({
          modelType: modelId || "gpt-5.2",
          ...reasoningPayload,
          contents: [
            {
              role: "user",
              parts: [{ text: kairoPrompt }],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 401 || response.status === 403) {
          await clearKairoTokens();
          onError(
            "Kairo Code authorization expired. Reconnect in Settings > AI > Agent Authentication.",
          );
          return;
        }

        onError(`Kairo Code API error: ${response.status}|||${errorText}`);
        return;
      }

      await processStreamingResponse(response, onChunk, onComplete, onError);
      return;
    }

    // For "custom" agent, use HTTP API providers
    const provider = getProviderById(providerId);

    // Check for model in static list or dynamic store
    let model = getModelById(providerId, modelId);
    if (!model) {
      const { dynamicModels } = useAIChatStore.getState();
      const providerModels = dynamicModels[providerId];
      const dynamicModel = providerModels?.find((m) => m.id === modelId);
      if (dynamicModel) {
        model = {
          ...dynamicModel,
          maxTokens: dynamicModel.maxTokens || 4096, // Default max tokens if missing
        };
      }
    }

    if (!provider || !model) {
      throw new Error(`Provider or model not found: ${providerId}/${modelId}`);
    }

    const apiKey = await getProviderApiToken(providerId);
    if (!apiKey && provider.requiresApiKey) {
      throw new Error(`${provider.name} API key not found`);
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

    // Use Tauri's fetch for Gemini and Ollama to bypass CORS restrictions
    const fetchFn = providerId === "gemini" || providerId === "ollama" ? tauriFetch : fetch;
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
    const target = agentId === "kairo-code" ? "kairo-code" : providerId;
    console.error(`${target} streaming chat completion error:`, error);
    onError(`Failed to connect to ${target} API: ${error.message || error}`);
  }
};
