import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AIMessage } from "@/types/ai-chat";
import type { ClaudeStatus, InterceptorMessage } from "@/types/claude";
import { getModelById, getProviderById } from "../types/ai-provider";
import { isTauri } from "./platform";

interface ContextInfo {
  activeBuffer?: {
    id: string;
    path: string;
    name: string;
    content: string;
    isDirty: boolean;
    isSQLite: boolean;
    isActive: boolean;
  };
  openBuffers?: Array<{
    id: string;
    path: string;
    name: string;
    content: string;
    isDirty: boolean;
    isSQLite: boolean;
    isActive: boolean;
  }>;
  selectedFiles?: string[];
  projectRoot?: string;
  language?: string;
}

// Get API token for a specific provider
export const getProviderApiToken = async (providerId: string): Promise<string | null> => {
  try {
    if (isTauri()) {
      // For now, use the same storage key but we could extend this
      // to support multiple providers with different storage keys
      const storageKey = providerId === "openai" ? "get_github_token" : `get_${providerId}_token`;

      try {
        const token = (await invoke(storageKey)) as string | null;
        return token;
      } catch (_error) {
        // Fallback to github token for backward compatibility
        if (providerId !== "openai") {
          const token = (await invoke("get_github_token")) as string | null;
          return token;
        }
        return null;
      }
    }
    return null;
  } catch (_error) {
    console.error(`Error getting ${providerId} API token:`, _error);
    return null;
  }
};

// Store API token for a specific provider
export const storeProviderApiToken = async (providerId: string, token: string): Promise<void> => {
  try {
    if (isTauri()) {
      // For now, use the same storage method but we could extend this
      const storageKey =
        providerId === "openai" ? "store_github_token" : `store_${providerId}_token`;

      try {
        await invoke(storageKey, { token });
      } catch (_error) {
        // Fallback to github token storage for backward compatibility
        await invoke("store_github_token", { token });
      }
    }
  } catch (_error) {
    console.error(`Error storing ${providerId} API token:`, _error);
    throw _error;
  }
};

// Remove API token for a specific provider
export const removeProviderApiToken = async (providerId: string): Promise<void> => {
  try {
    if (isTauri()) {
      const storageKey =
        providerId === "openai" ? "remove_github_token" : `remove_${providerId}_token`;

      try {
        await invoke(storageKey);
      } catch (_error) {
        // Fallback to github token removal for backward compatibility
        await invoke("remove_github_token");
      }
    }
  } catch (_error) {
    console.error(`Error removing ${providerId} API token:`, _error);
    throw _error;
  }
};

// Validate API key for a specific provider
export const validateProviderApiKey = async (
  providerId: string,
  apiKey: string,
): Promise<boolean> => {
  try {
    const provider = getProviderById(providerId);
    if (!provider) return false;

    let validateUrl: string;
    let headers: Record<string, string>;

    switch (providerId) {
      case "openai":
        validateUrl = "https://api.openai.com/v1/models";
        headers = {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        };
        break;

      case "openrouter":
        validateUrl = "https://openrouter.ai/api/v1/models";
        headers = {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://localhost",
          "X-Title": "Code Editor",
        };
        break;

      default:
        return false;
    }

    const response = await fetch(validateUrl, {
      method: "GET",
      headers,
    });

    if (response.ok) {
      console.log(`${provider.name} API key validated successfully`);
      return true;
    } else {
      console.error(`${provider.name} API validation error:`, response.status);
      return false;
    }
  } catch (error) {
    console.error(`${providerId} API key validation error:`, error);
    return false;
  }
};

// Legacy function for backward compatibility
export const getOpenAIToken = async (): Promise<string | null> => {
  return getProviderApiToken("openai");
};

// Build a comprehensive context prompt for the AI
const buildContextPrompt = (context: ContextInfo): string => {
  let contextPrompt = "";

  // Project information
  if (context.projectRoot) {
    const projectName = context.projectRoot.split("/").pop() || "Unknown Project";
    contextPrompt += `Project: ${projectName}\n`;
  }

  // Currently active file
  if (context.activeBuffer) {
    contextPrompt += `\nCurrently editing: ${context.activeBuffer.name}`;
    if (context.language && context.language !== "Text") {
      contextPrompt += ` (${context.language})`;
    }

    if (context.activeBuffer.isDirty) {
      contextPrompt += " [unsaved changes]";
    }

    // Include relevant portions of the active file content
    if (context.activeBuffer.content && !context.activeBuffer.isSQLite) {
      const lines = context.activeBuffer.content.split("\n");
      if (lines.length <= 100) {
        // Include the whole file if it's small
        contextPrompt += `\n\nFile content:\n\`\`\`${context.language?.toLowerCase() || "text"}\n${context.activeBuffer.content}\n\`\`\``;
      } else {
        // Include first 50 lines and last 20 lines for larger files
        const preview = [
          ...lines.slice(0, 50),
          "... (content truncated) ...",
          ...lines.slice(-20),
        ].join("\n");
        contextPrompt += `\n\nFile content (preview):\n\`\`\`${context.language?.toLowerCase() || "text"}\n${preview}\n\`\`\``;
      }
    }
  }

  // Other open files
  if (context.openBuffers && context.openBuffers.length > 1) {
    const otherFiles = context.openBuffers
      .filter(buffer => buffer.id !== context.activeBuffer?.id)
      .map(buffer => `${buffer.name}${buffer.isDirty ? " [modified]" : ""}`)
      .slice(0, 10); // Limit to first 10 files

    if (otherFiles.length > 0) {
      contextPrompt += `\n\nOther open files: ${otherFiles.join(", ")}`;
      if (context.openBuffers.length > 11) {
        contextPrompt += ` and ${context.openBuffers.length - 11} more`;
      }
    }
  }

  return contextPrompt;
};

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
  if (!isTauri()) {
    onError("Not in Tauri environment, skipping API call");
    return;
  }

  try {
    const provider = getProviderById(providerId);
    const model = getModelById(providerId, modelId);

    if (!provider || !model) {
      throw new Error(`Provider or model not found: ${providerId}/${modelId}`);
    }

    // Handle Claude Code provider differently
    if (providerId === "claude-code") {
      await handleClaudeCodeStream(
        userMessage,
        context,
        onChunk,
        onComplete,
        onError,
        onNewMessage,
        onToolUse,
        onToolComplete,
      );
      return;
    }

    const apiKey = await getProviderApiToken(providerId);
    if (!apiKey && provider.requiresApiKey) {
      throw new Error(`${provider.name} API key not found`);
    }

    const contextPrompt = buildContextPrompt(context);

    const systemPrompt = `You are an expert coding assistant integrated into a code editor. You have access to the user's current project context and open files.

Key capabilities:
- Code analysis, debugging, and optimization
- Explaining complex programming concepts
- Suggesting best practices and improvements
- Helping with errors and troubleshooting
- Code generation and refactoring
- Architecture and design guidance

Guidelines:
- Be concise but thorough in your explanations
- Provide practical, actionable advice
- Reference the user's actual code when relevant
- Offer multiple solutions when appropriate
- Use proper formatting for code snippets
- Ask clarifying questions if needed

Current context:
${contextPrompt}`;

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

    // Prepare headers based on provider
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add provider-specific headers
    if (providerId === "openrouter") {
      headers.Authorization = `Bearer ${apiKey}`;
      headers["HTTP-Referer"] = "https://localhost";
      headers["X-Title"] = "Code Editor";
    } else if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const payload = {
      model: modelId,
      messages,
      max_tokens: Math.min(1000, Math.floor(model.maxTokens * 0.25)), // Use 25% of max tokens for response
      temperature: 0.7,
      stream: true,
    };

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

    const reader = response.body?.getReader();
    if (!reader) {
      onError("No response body reader available");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep the incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();
          console.log("🔍 Processing line:", trimmedLine);

          if (trimmedLine === "") continue;
          if (trimmedLine === "data: [DONE]") {
            console.log("✅ Received [DONE] signal");
            onComplete();
            return;
          }

          if (trimmedLine.startsWith("data: ")) {
            try {
              const jsonStr = trimmedLine.slice(6); // Remove 'data: ' prefix
              console.log("🔍 Parsing SSE data:", jsonStr);
              const data = JSON.parse(jsonStr);
              console.log("🔍 Parsed data:", data);

              // Handle different response formats
              let content = "";
              if (data.choices?.[0]) {
                const choice = data.choices[0];
                console.log("🔍 Choice data:", choice);
                if (choice.delta?.content) {
                  content = choice.delta.content;
                  console.log("🔍 Delta content found:", content);
                } else if (choice.message?.content) {
                  content = choice.message.content;
                  console.log("🔍 Message content found:", content);
                }
              }

              if (content) {
                console.log("✅ Sending chunk to callback:", content);
                onChunk(content);
              } else {
                console.log("! No content found in chunk");
              }
            } catch (parseError) {
              console.warn("❌ Failed to parse SSE data:", parseError, "Raw data:", trimmedLine);
            }
          }
        }
      }

      onComplete();
    } catch (streamError) {
      console.error("❌ Streaming error:", streamError);
      onError("Error reading stream");
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    console.error(`❌ ${providerId} streaming chat completion error:`, error);
    onError(`Failed to connect to ${providerId} API`);
  }
};

// Legacy function for backward compatibility
export const getOpenAIChatCompletionStream = async (
  userMessage: string,
  context: ContextInfo,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<void> => {
  return getChatCompletionStream(
    "openai",
    "gpt-3.5-turbo",
    userMessage,
    context,
    onChunk,
    onComplete,
    onError,
    conversationHistory,
  );
};

// Main function to get AI chat completion (non-streaming fallback)
export const getOpenAIChatCompletion = async (
  userMessage: string,
  context: ContextInfo,
): Promise<string | null> => {
  if (!isTauri()) {
    console.log("❌ Not in Tauri environment, skipping OpenAI API");
    return null;
  }

  try {
    const apiKey = await getOpenAIToken();
    if (!apiKey) {
      throw new Error("OpenAI API key not found");
    }

    const contextPrompt = buildContextPrompt(context);

    const systemPrompt = `You are an expert coding assistant integrated into a code editor. You have access to the user's current project context and open files.

Key capabilities:
- Code analysis, debugging, and optimization
- Explaining complex programming concepts
- Suggesting best practices and improvements
- Helping with errors and troubleshooting
- Code generation and refactoring
- Architecture and design guidance

Guidelines:
- Be concise but thorough in your explanations
- Provide practical, actionable advice
- Reference the user's actual code when relevant
- Offer multiple solutions when appropriate
- Use proper formatting for code snippets
- Ask clarifying questions if needed

Current context:
${contextPrompt}`;

    const payload = {
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
      stream: false,
    };

    console.log("🤖 Making OpenAI chat request...");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("❌ OpenAI API error:", response.status, response.statusText);
      const errorText = await response.text();
      console.error("❌ Error details:", errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result = await response.json();

    if (result.choices && result.choices.length > 0) {
      const completion = result.choices[0].message.content.trim();
      console.log("✅ OpenAI chat completion received");
      return completion;
    }

    console.log("❌ No choices in OpenAI response");
    return null;
  } catch (error) {
    console.error("❌ OpenAI chat completion error:", error);
    throw error;
  }
};

// Quick context analysis for specific queries
export const analyzeCurrentFile = async (context: ContextInfo): Promise<string | null> => {
  if (!context.activeBuffer || context.activeBuffer.isSQLite) {
    return "No suitable file is currently open for analysis.";
  }

  const analysisPrompt = `Please analyze this ${context.language || "code"} file and provide:
1. A brief summary of what the code does
2. Any potential issues or improvements
3. Code quality assessment
4. Suggestions for optimization or best practices

Focus on actionable insights.`;

  return getOpenAIChatCompletion(analysisPrompt, context);
};

// Help with debugging
export const getDebuggingHelp = async (
  error: string,
  context: ContextInfo,
): Promise<string | null> => {
  const debugPrompt = `I'm encountering this error: "${error}"

Can you help me debug this issue? Please provide:
1. Possible causes of this error
2. How to fix it step by step
3. Prevention strategies for the future

If you can see relevant code in the context, please point out specific lines or patterns that might be causing the issue.`;

  return getOpenAIChatCompletion(debugPrompt, context);
};

// Code explanation
export const explainCode = async (
  codeSnippet: string,
  context: ContextInfo,
): Promise<string | null> => {
  const explainPrompt = `Please explain this code snippet:

\`\`\`${context.language?.toLowerCase() || "text"}
${codeSnippet}
\`\`\`

Please provide:
1. What this code does line by line
2. The overall purpose and functionality
3. Any important patterns or concepts used
4. How it fits into the larger context (if visible)`;

  return getOpenAIChatCompletion(explainPrompt, context);
};

interface ClaudeCodeHandlers {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  onNewMessage?: () => void;
  onToolUse?: (toolName: string, toolInput?: any) => void;
  onToolComplete?: (toolName: string) => void;
}

interface ClaudeListeners {
  interceptor?: () => void;
}

class ClaudeCodeStreamHandler {
  private currentStopReason: string | null = null;
  private listeners: ClaudeListeners = {};
  private timeout?: NodeJS.Timeout;
  private expectingMoreMessages = false;
  private lastActivityTime = Date.now();
  private messageCount = 0;
  private isFirstMessage = true;
  private currentToolName: string | null = null;

  constructor(private handlers: ClaudeCodeHandlers) {}

  async start(userMessage: string, context: ContextInfo): Promise<void> {
    try {
      await this.ensureClaudeCodeRunning();
      const fullMessage = this.buildMessage(userMessage, context);
      await this.setupListeners();
      await invoke("send_claude_input", { input: fullMessage });
      this.setupTimeout();
    } catch (error) {
      console.error("❌ Claude Code error:", error);
      this.handlers.onError(`Claude Code error: ${error}`);
    }
  }

  private async ensureClaudeCodeRunning(): Promise<void> {
    const status = await invoke<ClaudeStatus>("get_claude_status");

    if (!status.running) {
      console.log("🚀 Starting Claude Code...");
      const startStatus = await invoke<ClaudeStatus>("start_claude_code");

      if (!startStatus.running) {
        throw new Error("Failed to start Claude Code. Please check your setup.");
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private buildMessage(userMessage: string, context: ContextInfo): string {
    const contextPrompt = buildContextPrompt(context);
    return contextPrompt ? `${contextPrompt}\n\n${userMessage}` : userMessage;
  }

  private async setupListeners(): Promise<void> {
    this.listeners.interceptor = await listen<InterceptorMessage>("claude-message", event => {
      this.handleInterceptorMessage(event.payload);
    });
  }

  private handleInterceptorMessage(message: InterceptorMessage): void {
    console.log(
      "📡 Interceptor message type:",
      message.type,
      "request_id:",
      message.request_id || message.data?.id,
    );

    switch (message.type) {
      case "stream_chunk":
        this.handleStreamChunk(message.chunk);
        break;
      case "response":
        this.handleResponse(message.data?.parsed_response);
        break;
      case "error":
        console.log("❌ Error from interceptor, cleaning up...");
        this.cleanup();
        this.handlers.onError(message.error || "Unknown error from interceptor");
        break;
    }
  }

  private handleStreamChunk(chunk: any): void {
    if (!chunk) return;

    this.lastActivityTime = Date.now();

    if (chunk.type === "message_start" && chunk.message) {
      this.currentStopReason = chunk.message.stop_reason || null;
      console.log("📋 message_start with stop_reason:", this.currentStopReason);

      // If this is not the first message, signal a new message
      if (!this.isFirstMessage && this.handlers.onNewMessage) {
        console.log("📝 Starting new message in conversation");
        this.handlers.onNewMessage();
      }
      this.isFirstMessage = false;
      this.messageCount++;
    }

    // Handle tool use blocks
    if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
      this.currentToolName = chunk.content_block.name || "unknown";
      if (this.handlers.onToolUse) {
        this.handlers.onToolUse(this.currentToolName!, chunk.content_block.input);
      }
    }

    // Handle tool completion
    if (chunk.type === "content_block_stop") {
      if (this.currentToolName && this.handlers.onToolComplete) {
        this.handlers.onToolComplete(this.currentToolName!);
      }
      this.currentToolName = null;
    }

    if (chunk.delta?.text) {
      this.handlers.onChunk(chunk.delta.text);
    }

    if (chunk.type === "message_stop") {
      console.log("🛑 message_stop in stream_chunk, stop_reason was:", this.currentStopReason);

      if (this.currentStopReason === "tool_use") {
        console.log("🔧 Tool use detected, expecting more messages...");
        this.expectingMoreMessages = true;
        this.currentStopReason = null;
      } else if (this.expectingMoreMessages) {
        console.log("📝 Follow-up message complete after tool use");
        this.expectingMoreMessages = false;
        // Don't cleanup yet - there might be more messages
      } else {
        console.log(
          "⏳ Message complete, but not cleaning up yet - waiting for explicit completion signal",
        );
        // Don't cleanup on message_stop anymore
      }
      this.currentStopReason = null;
    }
  }

  private handleResponse(response: any): void {
    if (!response) return;

    this.lastActivityTime = Date.now();

    console.log("📨 Response data:", {
      stop_reason: response.stop_reason,
      usage: response.usage,
      content_blocks: response.content?.length,
    });

    if (response.content) {
      for (const block of response.content) {
        if (block.type === "text" && block.text) {
          this.handlers.onChunk(block.text);
        }
      }
    }

    if (response.stop_reason === "tool_use") {
      console.log("🔧 Tool use detected in response, expecting more messages...");
      this.expectingMoreMessages = true;
    } else {
      console.log("📨 Response received, but not cleaning up - waiting for activity timeout");
      // Don't cleanup immediately - wait for inactivity timeout
    }
  }

  private setupTimeout(): void {
    // Check for inactivity every second
    const checkInactivity = () => {
      const now = Date.now();
      const inactiveTime = now - this.lastActivityTime;

      // If no activity for 5 seconds and not expecting more messages, complete
      if (inactiveTime > 5000 && !this.expectingMoreMessages) {
        console.log("✅ No activity for 5 seconds, conversation appears complete");
        this.cleanup();
        this.handlers.onComplete();
        return;
      }

      // If still expecting messages but no activity for 30 seconds, timeout
      if (inactiveTime > 30000) {
        console.log("⏰ Timeout: No activity for 30 seconds");
        this.cleanup();
        this.handlers.onError("Request timed out - no activity");
        return;
      }

      // Continue checking
      this.timeout = setTimeout(checkInactivity, 1000);
    };

    this.timeout = setTimeout(checkInactivity, 1000);
  }

  private cleanup(): void {
    console.log("Cleaning up Claude Code listeners...");

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    Object.values(this.listeners).forEach(unlisten => {
      if (unlisten) unlisten();
    });

    this.listeners = {};
  }
}

// Handle Claude Code streaming
async function handleClaudeCodeStream(
  userMessage: string,
  context: ContextInfo,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  onNewMessage?: () => void,
  onToolUse?: (toolName: string, toolInput?: any) => void,
  onToolComplete?: (toolName: string) => void,
): Promise<void> {
  const handler = new ClaudeCodeStreamHandler({
    onChunk,
    onComplete,
    onError,
    onNewMessage,
    onToolUse,
    onToolComplete,
  });
  await handler.start(userMessage, context);
}
