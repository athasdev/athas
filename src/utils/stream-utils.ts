/**
 * Stream processing utilities for SSE (Server-Sent Events) parsing
 * Used by AI providers that return streaming responses
 */

interface StreamHandlers {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

interface StreamParserOptions {
  textMode?: "snapshot" | "delta";
}

// TODO(delete-debug): Remove temporary SSE parser debug logs after chat-stream regression is resolved.
const KAIRO_SSE_DEBUG_LOGS = false;

const logSseDebug = (message: string, data?: unknown): void => {
  if (!KAIRO_SSE_DEBUG_LOGS) {
    return;
  }
  if (data === undefined) {
    console.debug(`[delete-me][kairo-sse-debug] ${message}`);
    return;
  }
  console.debug(`[delete-me][kairo-sse-debug] ${message}`, data);
};

interface SSEPart {
  text?: string;
  thought?: boolean;
  thinking?: boolean;
  type?: string;
  role?: string;
}

interface SSEData {
  text?: string;
  error?: string;
  code?: string;
  type?: string;
  event?: string;
  is_reasoning?: boolean;
  structured_tool_result?: {
    type?: string;
    code?: string;
    message?: string;
  };
  tool_error?: {
    name?: string;
    code?: string;
    error?: string;
  };
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
  }>;
  candidate_content?: {
    parts?: SSEPart[];
  };
  candidates?: Array<{
    content?: {
      parts?: SSEPart[];
    };
  }>;
}

type SSEContentMode =
  | "text"
  | "openai_delta"
  | "openai_message"
  | "kairo_candidate"
  | "gemini_candidate";

class SSEStreamParser {
  private buffer = "";
  private decoder = new TextDecoder();
  private isCompleted = false;
  private contentMode: SSEContentMode | null = null;
  private currentEventName: string | null = null;
  private emittedSnapshots: Partial<Record<SSEContentMode, string>> = {};

  constructor(
    private handlers: StreamHandlers,
    private options: StreamParserOptions = {},
  ) {}

  async processStream(response: Response): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      this.handlers.onError("No response body reader available");
      return;
    }

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Decode the chunk and add to buffer
        this.buffer += this.decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || ""; // Keep the incomplete line in buffer

        for (const line of lines) {
          this.processLine(line);
        }
      }

      this.completeOnce();
    } catch (streamError) {
      console.error("Streaming error:", streamError);
      this.handlers.onError("Error reading stream");
    } finally {
      reader.releaseLock();
    }
  }

  private processLine(line: string): void {
    const trimmedLine = line.trim();

    if (trimmedLine === "") {
      this.currentEventName = null;
      return;
    }
    if (trimmedLine.startsWith("event:")) {
      const eventName = trimmedLine.slice(6).trim();
      this.currentEventName = eventName || null;
      logSseDebug("event line", { eventName: this.currentEventName });
      return;
    }

    if (trimmedLine.startsWith("data:")) {
      try {
        const jsonStr = trimmedLine.slice(5).trimStart(); // Remove 'data:' prefix
        if (jsonStr === "[DONE]") {
          this.completeOnce();
          return;
        }

        const data = JSON.parse(jsonStr) as SSEData;

        if (this.isReasoningPayload(data)) {
          logSseDebug("filtered reasoning payload", {
            currentEventName: this.currentEventName,
            type: data.type,
            event: data.event,
            hasCandidateContent: Boolean(data.candidate_content?.parts?.length),
            hasText: typeof data.text === "string",
          });
          return;
        }

        const workspaceUnavailableMessage = this.extractWorkspaceUnavailableMessage(data);
        if (workspaceUnavailableMessage) {
          this.handlers.onError(`workspace_unavailable|||${workspaceUnavailableMessage}`);
          return;
        }

        if (data.error) {
          this.handlers.onError(data.error);
          return;
        }

        // Generic text stream payload
        if (typeof data.text === "string") {
          logSseDebug("processing generic text payload", {
            length: data.text.length,
            preview: data.text.slice(0, 120),
          });
          this.emitContent("text", data.text);
          return;
        }

        // OpenAI/OpenRouter format
        if (data.choices?.[0]) {
          const choice = data.choices[0];
          if (choice.delta?.content) {
            logSseDebug("processing openai delta payload", {
              length: choice.delta.content.length,
              preview: choice.delta.content.slice(0, 120),
            });
            this.emitContent("openai_delta", choice.delta.content);
            return;
          } else if (choice.message?.content) {
            logSseDebug("processing openai message payload", {
              length: choice.message.content.length,
              preview: choice.message.content.slice(0, 120),
            });
            this.emitContent("openai_message", choice.message.content);
            return;
          }
        }

        // Kairo candidate_content format
        if (data.candidate_content?.parts) {
          const content = this.extractVisibleParts(data.candidate_content.parts);
          if (!content) {
            logSseDebug("kairo candidate payload had no visible content");
            return;
          }
          logSseDebug("processing kairo candidate payload", {
            length: content.length,
            preview: content.slice(0, 120),
          });
          this.emitContent("kairo_candidate", content);
          return;
        }

        // Gemini format
        if (data.candidates?.[0]?.content?.parts) {
          const content = this.extractVisibleParts(data.candidates[0].content.parts);
          if (!content) {
            logSseDebug("gemini candidate payload had no visible content");
            return;
          }
          logSseDebug("processing gemini candidate payload", {
            length: content.length,
            preview: content.slice(0, 120),
          });
          this.emitContent("gemini_candidate", content);
          return;
        }
      } catch (parseError) {
        console.warn("Failed to parse SSE data:", parseError, "Raw data:", trimmedLine);
      }
    }
  }

  private completeOnce(): void {
    if (this.isCompleted) return;
    this.isCompleted = true;
    logSseDebug("stream marked complete");
    this.handlers.onComplete();
  }

  private isSnapshotMode(mode: SSEContentMode): boolean {
    if (mode === "text" && this.options.textMode === "delta") {
      return false;
    }
    return (
      mode === "text" ||
      mode === "openai_message" ||
      mode === "kairo_candidate" ||
      mode === "gemini_candidate"
    );
  }

  private getModePriority(mode: SSEContentMode): number {
    switch (mode) {
      case "openai_delta":
        return 4;
      case "text":
        return 3;
      case "openai_message":
        return 2;
      case "kairo_candidate":
      case "gemini_candidate":
        return 1;
      default:
        return 0;
    }
  }

  private shouldAcceptMode(mode: SSEContentMode): boolean {
    if (!this.contentMode) {
      return true;
    }
    if (this.contentMode === mode) {
      return true;
    }
    return this.getModePriority(mode) > this.getModePriority(this.contentMode);
  }

  private looksLikeReasoning(value?: string | null): boolean {
    if (!value) return false;
    const normalized = value.toLowerCase();
    return (
      normalized.includes("reasoning") ||
      normalized.includes("thinking") ||
      normalized.includes("thought")
    );
  }

  private isWorkspaceUnavailableCode(value?: string | null): boolean {
    return typeof value === "string" && value.trim().toLowerCase() === "workspace_unavailable";
  }

  private looksLikeWorkspaceUnavailableMessage(value?: string | null): boolean {
    if (typeof value !== "string") return false;
    const normalized = value.toLowerCase();
    return normalized.includes("workspace") && normalized.includes("available");
  }

  private extractWorkspaceUnavailableMessage(data: SSEData): string | null {
    const structured = data.structured_tool_result;
    const toolError = data.tool_error;

    if (structured?.type === "workspace_unavailable") {
      return (
        structured.message ||
        "No workspace binding is available for this session. Connect the workspace bridge and retry."
      );
    }

    if (this.isWorkspaceUnavailableCode(structured?.code)) {
      return (
        structured?.message ||
        "No workspace binding is available for this session. Connect the workspace bridge and retry."
      );
    }

    if (this.isWorkspaceUnavailableCode(toolError?.code)) {
      return (
        toolError?.error ||
        "No workspace binding is available for this session. Connect the workspace bridge and retry."
      );
    }

    if (this.isWorkspaceUnavailableCode(data.code) && data.error) {
      return data.error;
    }

    if (this.looksLikeWorkspaceUnavailableMessage(data.error)) {
      return data.error || null;
    }

    return null;
  }

  private isReasoningPayload(data: SSEData): boolean {
    if (this.looksLikeReasoning(this.currentEventName)) {
      return true;
    }
    if (this.looksLikeReasoning(data.type) || this.looksLikeReasoning(data.event)) {
      return true;
    }
    return data.is_reasoning === true;
  }

  private extractVisibleParts(parts: SSEPart[]): string {
    return parts
      .filter((part) => {
        if (!part?.text?.trim()) return false;
        if (part.thought || part.thinking) return false;
        if (this.looksLikeReasoning(part.type) || this.looksLikeReasoning(part.role)) {
          return false;
        }
        return true;
      })
      .map((part) => part.text || "")
      .join("");
  }

  private emitContent(mode: SSEContentMode, content: string): void {
    if (!content) return;

    if (!this.shouldAcceptMode(mode)) {
      logSseDebug("skipping payload due to mode priority", {
        incomingMode: mode,
        activeMode: this.contentMode,
        length: content.length,
      });
      return;
    }

    if (this.contentMode !== mode) {
      logSseDebug("switching stream mode", {
        from: this.contentMode,
        to: mode,
      });
    }
    this.contentMode = mode;

    if (!this.isSnapshotMode(mode)) {
      this.handlers.onChunk(content);
      return;
    }

    const previousSnapshot = this.emittedSnapshots[mode] || "";
    this.emittedSnapshots[mode] = content;

    if (!previousSnapshot) {
      this.handlers.onChunk(content);
      return;
    }

    if (content.startsWith(previousSnapshot)) {
      const delta = content.slice(previousSnapshot.length);
      if (delta) {
        logSseDebug("emitting snapshot delta", {
          mode,
          deltaLength: delta.length,
        });
        this.handlers.onChunk(delta);
      }
      return;
    }

    // Ignore exact or suffix duplicates that can appear in terminal snapshot events.
    if (previousSnapshot.endsWith(content)) {
      return;
    }

    this.handlers.onChunk(content);
  }
}

// Helper function to process a streaming response
export async function processStreamingResponse(
  response: Response,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  options?: StreamParserOptions,
): Promise<void> {
  const parser = new SSEStreamParser({ onChunk, onComplete, onError }, options);
  await parser.processStream(response);
}
