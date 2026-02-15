import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useAIChatStore } from "@/features/ai/store/store";
import type { ChatMode, OutputStyle } from "@/features/ai/store/types";
import type { AcpEvent } from "@/features/ai/types/acp";
import { AGENT_OPTIONS, type AgentType } from "@/features/ai/types/ai-chat";
import type { AIMessage } from "@/features/ai/types/messages";
import { getModelById, getProviderById } from "@/features/ai/types/providers";
import { AcpStreamHandler } from "./acp-handler";
import { buildContextPrompt, buildSystemPrompt } from "./context-builder";
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

interface AvailableAcpAgent {
  id: string;
  installed: boolean;
}

let kairoAcpInstalledCache: { installed: boolean; checkedAt: number } | null = null;
const KAIRO_ACP_CACHE_TTL_MS = 15_000;

const isKairoAcpInstalled = async (): Promise<boolean> => {
  const now = Date.now();
  if (kairoAcpInstalledCache && now - kairoAcpInstalledCache.checkedAt < KAIRO_ACP_CACHE_TTL_MS) {
    return kairoAcpInstalledCache.installed;
  }

  try {
    const agents = await invoke<AvailableAcpAgent[]>("get_available_agents");
    const installed = agents.find((agent) => agent.id === "kairo-code")?.installed === true;
    kairoAcpInstalledCache = { installed, checkedAt: now };
    return installed;
  } catch {
    // If detection fails, prefer stable behavior over hard-failing ACP startup.
    kairoAcpInstalledCache = { installed: false, checkedAt: now };
    return false;
  }
};

const MAX_HISTORY_MESSAGES = 40;

const isAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }
  if (error instanceof Error) {
    return error.name === "AbortError";
  }
  return false;
};

const normalizeConversationHistory = (
  conversationHistory: AIMessage[] | undefined,
  userMessage: string,
): AIMessage[] => {
  if (!conversationHistory || conversationHistory.length === 0) {
    return [];
  }

  const normalized = conversationHistory
    .filter(
      (message) =>
        (message.role === "system" || message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
    })) as AIMessage[];

  if (normalized.length === 0) {
    return [];
  }

  const trimmedUserMessage = userMessage.trim();
  if (trimmedUserMessage) {
    const last = normalized[normalized.length - 1];
    if (last.role === "user" && last.content.trim() === trimmedUserMessage) {
      normalized.pop();
    }
  }

  if (normalized.length > MAX_HISTORY_MESSAGES) {
    return normalized.slice(normalized.length - MAX_HISTORY_MESSAGES);
  }

  return normalized;
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
  onToolUse?: (
    toolName: string,
    toolInput?: any,
    toolId?: string,
    event?: Extract<AcpEvent, { type: "tool_start" }>,
  ) => void,
  onToolComplete?: (toolName: string, event?: Extract<AcpEvent, { type: "tool_complete" }>) => void,
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void,
  onAcpEvent?: (event: AcpEvent) => void,
  mode: ChatMode = "chat",
  outputStyle: OutputStyle = "default",
  _sessionId?: string,
  abortSignal?: AbortSignal,
): Promise<void> => {
  try {
    const normalizedConversationHistory = normalizeConversationHistory(
      conversationHistory,
      userMessage,
    );

    // Handle ACP-based CLI agents.
    // Kairo Code is ACP-only in Athas; do not silently degrade to HTTP mode.
    if (agentId === "kairo-code") {
      const installed = await isKairoAcpInstalled();
      if (!installed) {
        onError(
          "Kairo Code ACP adapter is not installed. Run: bun add -g --no-cache @colineapp/kairo-code-acp",
        );
        return;
      }
    }

    const shouldUseAcp = isAcpAgent(agentId);
    if (shouldUseAcp) {
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
      await handler.start(userMessage, context, { mode, outputStyle });
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
    if (normalizedConversationHistory.length > 0) {
      messages.push(...normalizedConversationHistory);
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
      ...(providerId !== "gemini" && providerId !== "ollama" && abortSignal
        ? { signal: abortSignal }
        : {}),
    } as any);

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
    if (isAbortError(error)) {
      return;
    }
    const target = agentId === "kairo-code" ? "kairo-code" : providerId;
    console.error(`${target} streaming chat completion error:`, error);
    onError(`Failed to connect to ${target} API: ${error.message || error}`);
  }
};
