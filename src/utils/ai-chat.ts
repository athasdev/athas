import type { AIMessage } from "@/types/ai-chat";
import { getModelById, getProviderById } from "../types/ai-provider";
import { ClaudeCodeStreamHandler } from "./claude-code-handler";
import { buildContextPrompt, buildSystemPrompt } from "./context-builder";
import { getProvider } from "./providers";
import { processStreamingResponse } from "./stream-utils";
import { getProviderApiToken } from "./token-manager";
import type { ContextInfo } from "./types";

export {
  analyzeCurrentFile,
  explainCode,
  getDebuggingHelp,
  getOpenAIChatCompletion,
  getOpenAIChatCompletionStream,
} from "./ai-chat-legacy";
export {
  getOpenAIToken,
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
  validateProviderApiKey,
} from "./token-manager";
// Re-export types and legacy functions
export type { ContextInfo } from "./types";

// Generic streaming chat completion function that works with any provider
export const getChatCompletionStream = async (
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
): Promise<void> => {
  try {
    const provider = getProviderById(providerId);
    const model = getModelById(providerId, modelId);

    if (!provider || !model) {
      throw new Error(`Provider or model not found: ${providerId}/${modelId}`);
    }

    // Handle Claude Code provider differently
    if (providerId === "claude-code") {
      const handler = new ClaudeCodeStreamHandler({
        onChunk,
        onComplete,
        onError,
        onNewMessage,
        onToolUse,
        onToolComplete,
      });
      await handler.start(userMessage, context);
      return;
    }

    const apiKey = await getProviderApiToken(providerId);
    if (!apiKey && provider.requiresApiKey) {
      throw new Error(`${provider.name} API key not found`);
    }

    const contextPrompt = buildContextPrompt(context);
    const systemPrompt = buildSystemPrompt(contextPrompt);

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

    const headers = providerImpl.buildHeaders(apiKey || undefined);
    const payload = providerImpl.buildPayload({
      modelId,
      messages,
      maxTokens: Math.min(1000, Math.floor(model.maxTokens * 0.25)),
      temperature: 0.7,
      apiKey: apiKey || undefined,
    });

    console.log(`🤖 Making ${provider.name} streaming chat request with model ${model.name}...`);

    const response = await fetch(provider.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`❌ ${provider.name} API error:`, response.status, response.statusText);
      const errorText = await response.text();
      console.error("❌ Error details:", errorText);
      onError(`${provider.name} API error: ${response.status}`);
      return;
    }

    // Use stream processing utility
    await processStreamingResponse(response, onChunk, onComplete, onError);
  } catch (error) {
    console.error(`❌ ${providerId} streaming chat completion error:`, error);
    onError(`Failed to connect to ${providerId} API`);
  }
};
