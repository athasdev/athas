/**
 * Stream processing utilities for SSE (Server-Sent Events) parsing
 * Used by AI providers that return streaming responses
 */

interface StreamHandlers {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

interface SSEData {
  text?: string;
  error?: string;
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
  }>;
  candidate_content?: {
    parts?: Array<{ text?: string }>;
  };
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
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
  private emittedSnapshots: Partial<Record<SSEContentMode, string>> = {};

  constructor(private handlers: StreamHandlers) {}

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

    if (trimmedLine === "") return;
    if (trimmedLine === "data: [DONE]") {
      this.completeOnce();
      return;
    }

    if (trimmedLine.startsWith("data: ")) {
      try {
        const jsonStr = trimmedLine.slice(6); // Remove 'data: ' prefix
        const data = JSON.parse(jsonStr) as SSEData;

        if (data.error) {
          this.handlers.onError(data.error);
          return;
        }

        // Generic text stream payload
        if (typeof data.text === "string") {
          this.emitContent("text", data.text);
          return;
        }

        // OpenAI/OpenRouter format
        if (data.choices?.[0]) {
          const choice = data.choices[0];
          if (choice.delta?.content) {
            this.emitContent("openai_delta", choice.delta.content);
            return;
          } else if (choice.message?.content) {
            this.emitContent("openai_message", choice.message.content);
            return;
          }
        }

        // Kairo candidate_content format
        if (data.candidate_content?.parts) {
          const content = data.candidate_content.parts
            .map((part) => part.text || "")
            .filter(Boolean)
            .join("");
          this.emitContent("kairo_candidate", content);
          return;
        }

        // Gemini format
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
          this.emitContent("gemini_candidate", data.candidates[0].content.parts[0].text);
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
    this.handlers.onComplete();
  }

  private isSnapshotMode(mode: SSEContentMode): boolean {
    return (
      mode === "text" ||
      mode === "openai_message" ||
      mode === "kairo_candidate" ||
      mode === "gemini_candidate"
    );
  }

  private emitContent(mode: SSEContentMode, content: string): void {
    if (!content) return;

    // Some providers include both delta and full-content payload shapes in one stream.
    // Lock to the first observed content mode to prevent duplicate rendering.
    if (this.contentMode && this.contentMode !== mode) {
      return;
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
): Promise<void> {
  const parser = new SSEStreamParser({ onChunk, onComplete, onError });
  await parser.processStream(response);
}
