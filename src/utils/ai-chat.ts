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
// Re-export types and legacy functions;

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
  onToolUse?: (toolName: string, toolInput?: any) => void,
  onToolComplete?: (toolName: string) => void,
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void,
  onAcpEvent?: (event: AcpEvent) => void,
  mode: ChatMode = "chat",
  outputStyle: OutputStyle = "default",
  onImageChunk?: (data: string, mediaType: string) => void,
  onResourceChunk?: (uri: string, name: string | null) => void,
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
        onImageChunk,
        onResourceChunk,
      });
      await handler.start(userMessage, context);
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
    console.error(`${providerId} streaming chat completion error:`, error);
    onError(`Failed to connect to ${providerId} API: ${error.message || error}`);
  }
};
