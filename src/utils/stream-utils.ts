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
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
  }>;
}

class SSEStreamParser {
  private buffer = "";
  private decoder = new TextDecoder();

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

      this.handlers.onComplete();
    } catch (streamError) {
      console.error("❌ Streaming error:", streamError);
      this.handlers.onError("Error reading stream");
    } finally {
      reader.releaseLock();
    }
  }

  private processLine(line: string): void {
    const trimmedLine = line.trim();

    if (trimmedLine === "") return;
    if (trimmedLine === "data: [DONE]") {
      this.handlers.onComplete();
      return;
    }

    if (trimmedLine.startsWith("data: ")) {
      try {
        const jsonStr = trimmedLine.slice(6); // Remove 'data: ' prefix
        const data = JSON.parse(jsonStr) as SSEData;

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
          this.handlers.onChunk(content);
        }
      } catch (parseError) {
        console.warn("❌ Failed to parse SSE data:", parseError, "Raw data:", trimmedLine);
      }
    }
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
