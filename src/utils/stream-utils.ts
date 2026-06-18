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
  // OpenAI/OpenRouter format
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
  }>;
  // Gemini format
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  // Anthropic format
  type?: string;
  delta?: { type?: string; text?: string };
  object?: string;
  webUrl?: string;
  latestVersion?: {
    status?: string;
    demoUrl?: string;
    files?: Array<{ name?: string }>;
  };
}

class SSEStreamParser {
  private buffer = "";
  private decoder = new TextDecoder();
  private isComplete = false;
  private v0Content: unknown[] = [];
  private v0PlainText = "";
  private v0LastChatSummary = "";

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

      this.complete();
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
    // Skip SSE event type lines (e.g. "event: content_block_delta")
    if (trimmedLine.startsWith("event:")) return;
    if (trimmedLine === "data: [DONE]") {
      this.complete();
      return;
    }

    if (trimmedLine.startsWith("data: ")) {
      try {
        const jsonStr = trimmedLine.slice(6); // Remove 'data: ' prefix
        const data = JSON.parse(jsonStr) as SSEData;

        // Handle different response formats
        let content = "";

        if (data.type === "connected") {
          return;
        }
        if (data.type === "done") {
          this.complete();
          return;
        }
        if (data.object?.startsWith("chat")) {
          const chatSummary = formatV0ChatSummary(data);
          if (chatSummary && chatSummary !== this.v0LastChatSummary) {
            this.v0LastChatSummary = chatSummary;
            this.handlers.onChunk(`${this.v0PlainText ? "\n\n" : ""}${chatSummary}`);
          }
          if (isTerminalV0ChatEvent(data)) {
            this.complete();
          }
          return;
        }

        // OpenAI/OpenRouter format
        if (data.choices?.[0]) {
          const choice = data.choices[0];
          if (choice.delta?.content) {
            content = choice.delta.content;
          } else if (choice.message?.content) {
            content = choice.message.content;
          }
        }
        // Anthropic format: content_block_delta with delta.text
        else if (data.type === "content_block_delta" && data.delta?.text) {
          content = data.delta.text;
        }
        // Gemini format
        else if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
          content = data.candidates[0].content.parts[0].text;
        }
        // v0 Platform API format: jsondiffpatch deltas over message binary content.
        else if (data.delta) {
          this.v0Content = applyV0Delta(this.v0Content, data.delta);
          const nextText = extractV0PlainText(this.v0Content);
          content = nextText.startsWith(this.v0PlainText)
            ? nextText.slice(this.v0PlainText.length)
            : nextText;
          this.v0PlainText = nextText;
        }

        if (content) {
          this.handlers.onChunk(content);
        }
      } catch (parseError) {
        console.warn("Failed to parse SSE data:", parseError, "Raw data:", trimmedLine);
      }
    }
  }

  private complete(): void {
    if (this.isComplete) return;
    this.isComplete = true;
    this.handlers.onComplete();
  }
}

function applyV0Delta(currentValue: unknown, delta: unknown): unknown[] {
  const patched = applyJsonDiffPatchDelta(currentValue, delta);
  return Array.isArray(patched) ? patched : [];
}

function applyJsonDiffPatchDelta(currentValue: unknown, delta: unknown): unknown {
  if (Array.isArray(delta)) {
    if (delta.length === 1) return cloneJsonValue(delta[0]);
    if (delta.length >= 3 && delta[1] === 0 && delta[2] === 0) return undefined;
    if (delta.length >= 2) return cloneJsonValue(delta[1]);
    return currentValue;
  }

  if (!isRecord(delta)) return currentValue;

  if (delta._t === "a") {
    const nextArray = Array.isArray(currentValue) ? [...currentValue] : [];
    const removals: number[] = [];

    for (const [key, value] of Object.entries(delta)) {
      if (key === "_t" || !key.startsWith("_")) continue;
      const index = Number(key.slice(1));
      if (!Number.isInteger(index)) continue;
      if (Array.isArray(value) && value.length >= 3 && value[1] === 0 && value[2] === 0) {
        removals.push(index);
      }
    }

    removals
      .sort((left, right) => right - left)
      .forEach((index) => {
        nextArray.splice(index, 1);
      });

    for (const [key, value] of Object.entries(delta)) {
      if (key === "_t" || key.startsWith("_")) continue;
      const index = Number(key);
      if (!Number.isInteger(index)) continue;
      const patchedValue = applyJsonDiffPatchDelta(nextArray[index], value);
      if (patchedValue !== undefined) {
        nextArray[index] = patchedValue;
      }
    }

    return nextArray;
  }

  const nextObject: Record<string, unknown> = isRecord(currentValue) ? { ...currentValue } : {};
  for (const [key, value] of Object.entries(delta)) {
    const patchedValue = applyJsonDiffPatchDelta(nextObject[key], value);
    if (patchedValue === undefined) {
      delete nextObject[key];
    } else {
      nextObject[key] = patchedValue;
    }
  }
  return nextObject;
}

function extractV0PlainText(content: unknown[]): string {
  return content
    .map((row) => {
      if (!Array.isArray(row) || row[0] !== 0) return "";
      return extractV0ElementText(row[1]);
    })
    .filter(Boolean)
    .join("\n");
}

function extractV0ElementText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return extractV0ObjectText(value);

  if (isV0ElementTuple(value)) {
    const [tagName, props, ...children] = value;
    if (tagName === "AssistantMessageContentPart") {
      return extractV0ObjectText(isRecord(props) ? props.part : undefined);
    }
    if (tagName === "Codeblock") {
      const language = isRecord(props) && typeof props.lang === "string" ? props.lang : "";
      const code = children.map(extractV0ElementText).join("");
      return language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``;
    }
    return children.map(extractV0ElementText).join("");
  }

  return value.map(extractV0ElementText).join("");
}

function extractV0ObjectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractV0ElementText).join("");
  if (!isRecord(value)) return "";

  const taskText = extractV0TaskPartText(value);
  if (taskText) return taskText;

  for (const key of [
    "content",
    "text",
    "answer",
    "thought",
    "title",
    "query",
    "taskNameComplete",
    "taskNameActive",
  ]) {
    const nestedValue = value[key];
    if (typeof nestedValue === "string") return nestedValue;
  }

  return "";
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isV0ElementTuple(value: unknown[]): value is [string, unknown, ...unknown[]] {
  if (typeof value[0] !== "string") return false;
  if (["AssistantMessageContentPart", "Codeblock", "text"].includes(value[0])) return true;
  return value.length >= 2 && isRecord(value[1]);
}

function extractV0TaskPartText(value: Record<string, unknown>): string {
  const title =
    typeof value.taskNameComplete === "string"
      ? value.taskNameComplete
      : typeof value.taskNameActive === "string"
        ? value.taskNameActive
        : "";
  const parts = Array.isArray(value.parts) ? value.parts : [];
  const partTexts = parts.map(extractV0TaskStatusText).filter(Boolean);

  if (!title) return partTexts.join("\n");
  if (partTexts.length === 0) return title;
  return [title, ...partTexts].join("\n");
}

function extractV0TaskStatusText(value: unknown): string {
  if (!isRecord(value)) return "";

  for (const key of ["answer", "thought", "content", "message"]) {
    const nestedValue = value[key];
    if (typeof nestedValue === "string" && nestedValue.trim()) return nestedValue;
  }

  const type = typeof value.type === "string" ? value.type : "";
  const status = typeof value.status === "string" ? value.status : "";
  const query = typeof value.query === "string" ? value.query : "";
  const count = typeof value.count === "number" ? value.count : undefined;

  if (type === "search-web" && status === "searching" && query) return `Searching "${query}"`;
  if (type === "search-web" && status === "analyzing" && count !== undefined) {
    return `Analyzing ${count} results...`;
  }
  if (type === "search-repo" && status === "searching" && query) return `Searching "${query}"`;
  if (type === "search-repo" && status === "reading") return "Reading files";
  if (type === "diagnostics" && status === "checking") return "Checking for issues...";
  if (type === "diagnostics" && status === "complete" && value.issues === 0) {
    return "No issues found";
  }

  return "";
}

function formatV0ChatSummary(data: SSEData): string {
  if (data.object !== "chat") return "";

  const lines: string[] = [];
  const status = data.latestVersion?.status;
  if (status === "completed") {
    lines.push("v0 sandbox is ready.");
  } else if (status === "failed") {
    lines.push("v0 sandbox generation failed.");
  } else if (data.webUrl || data.latestVersion?.demoUrl) {
    lines.push("v0 sandbox was created.");
  }

  if (data.webUrl) {
    lines.push(`Chat: ${data.webUrl}`);
  }
  if (data.latestVersion?.demoUrl) {
    lines.push(`Preview: ${data.latestVersion.demoUrl}`);
  }

  const fileNames = data.latestVersion?.files
    ?.map((file) => file.name)
    .filter((name): name is string => Boolean(name?.trim()))
    .slice(0, 8);
  if (fileNames && fileNames.length > 0) {
    lines.push(`Files: ${fileNames.join(", ")}`);
  }

  return lines.join("\n");
}

function isTerminalV0ChatEvent(data: SSEData): boolean {
  if (data.object !== "chat") return false;
  const status = data.latestVersion?.status;
  return status === "completed" || status === "failed";
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
