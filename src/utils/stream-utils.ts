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
    delta?: OpenAIMessageContent;
    message?: OpenAIMessageContent;
    text?: unknown;
    finish_reason?: string | null;
    error?: SSEError;
  }>;
  error?: SSEError;
  response?: {
    error?: SSEError;
  };
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

interface SSEError {
  code?: string | number;
  message?: string;
}

interface OpenAIMessageContent {
  content?: unknown;
  refusal?: unknown;
  reasoning?: unknown;
  reasoning_details?: unknown;
  tool_calls?: unknown;
}

class SSEStreamParser {
  private buffer = "";
  private decoder = new TextDecoder();
  private isComplete = false;
  private streamFormat: "unknown" | "sse" | "json" = "unknown";
  private sseDataLines: string[] = [];
  private jsonBuffer = "";
  private hasVisibleContent = false;
  private hasReasoning = false;
  private hasToolCalls = false;
  private finishReason: string | null = null;
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

        this.buffer += this.decoder.decode(value, { stream: true });
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";

        for (const line of lines) {
          this.processTransportLine(line);
        }
      }

      this.buffer += this.decoder.decode();
      if (this.buffer) {
        this.processTransportLine(this.buffer);
      }
      this.buffer = "";

      if (this.streamFormat === "sse") {
        this.dispatchSSEEvent();
      } else if (this.streamFormat === "json") {
        this.dispatchJSONBuffer(true);
      }

      this.complete();
    } catch (streamError) {
      console.error("Streaming error:", streamError);
      this.handlers.onError("Error reading stream");
    } finally {
      reader.releaseLock();
    }
  }

  private processTransportLine(line: string): void {
    if (this.isComplete) return;

    const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
    const trimmedLine = normalizedLine.trim();

    if (this.streamFormat === "unknown") {
      if (!trimmedLine) return;
      this.streamFormat = isSSEField(trimmedLine) ? "sse" : "json";
    }

    if (this.streamFormat === "json") {
      this.jsonBuffer += `${normalizedLine}\n`;
      this.dispatchJSONBuffer(false);
      return;
    }

    if (!trimmedLine) {
      this.dispatchSSEEvent();
      return;
    }
    if (trimmedLine.startsWith(":")) return;
    if (trimmedLine.startsWith("data:")) {
      this.sseDataLines.push(trimmedLine.slice(5).trimStart());
    }
  }

  private dispatchSSEEvent(): void {
    if (this.isComplete || this.sseDataLines.length === 0) return;
    const payload = this.sseDataLines.join("\n");
    this.sseDataLines = [];
    this.processPayloadText(payload);
  }

  private dispatchJSONBuffer(isFinal: boolean): void {
    if (this.isComplete || !this.jsonBuffer.trim()) return;

    try {
      const payload = JSON.parse(this.jsonBuffer) as unknown;
      this.jsonBuffer = "";
      this.processPayload(payload);
    } catch (parseError) {
      if (!isFinal) return;
      console.warn("Failed to parse streaming JSON:", parseError);
      this.fail("The provider returned a malformed JSON response.");
    }
  }

  private processPayloadText(jsonPayload: string): void {
    if (this.isComplete) return;
    if (!jsonPayload.trim()) return;

    if (jsonPayload === "[DONE]") {
      this.complete();
      return;
    }

    try {
      this.processPayload(JSON.parse(jsonPayload) as unknown);
    } catch (parseError) {
      console.warn("Failed to parse SSE data:", parseError, "Raw data:", jsonPayload);
      this.fail("The provider returned a malformed streaming event.");
    }
  }

  private processPayload(payload: unknown): void {
    if (this.isComplete) return;

    if (Array.isArray(payload)) {
      for (const item of payload) {
        this.processPayload(item);
      }
      return;
    }
    if (!isRecord(payload)) return;

    const data = payload as SSEData;

    const firstChoice = data.choices?.[0];
    const streamError = data.error || data.response?.error || firstChoice?.error;
    if (streamError) {
      const code = streamError.code ?? "unknown";
      const message = streamError.message?.trim();
      this.fail(
        `Streaming API error: ${code}${message ? ` ${message}` : ""}|||${JSON.stringify(streamError)}`,
      );
      return;
    }

    let content = "";

    if (data.type === "connected") return;
    if (data.type === "done") {
      this.complete();
      return;
    }
    if (data.object === "chat") {
      const chatSummary = formatV0ChatSummary(data);
      if (chatSummary && chatSummary !== this.v0LastChatSummary) {
        this.v0LastChatSummary = chatSummary;
        this.emitContent(`${this.v0PlainText ? "\n\n" : ""}${chatSummary}`);
      }
      if (isTerminalV0ChatEvent(data)) {
        this.complete();
      }
      return;
    }

    if (firstChoice) {
      const message = firstChoice.delta || firstChoice.message;
      content = extractVisibleMessageText(message) || extractTextContent(firstChoice.text);
      this.hasReasoning ||= hasResponseValue(message?.reasoning, message?.reasoning_details);
      this.hasToolCalls ||= hasResponseValue(message?.tool_calls);
      this.finishReason = firstChoice.finish_reason ?? this.finishReason;
      if (this.finishReason === "error") {
        this.fail("The provider ended the stream with an unspecified generation error.");
        return;
      }
    } else if (data.type === "content_block_delta" && data.delta?.text) {
      content = data.delta.text;
    } else if (data.candidates?.[0]?.content?.parts) {
      content = data.candidates[0].content.parts
        .map((part) => extractTextContent(part.text))
        .join("");
    } else if (data.delta) {
      this.v0Content = applyV0Delta(this.v0Content, data.delta);
      const nextText = extractV0PlainText(this.v0Content);
      content = nextText.startsWith(this.v0PlainText)
        ? nextText.slice(this.v0PlainText.length)
        : nextText;
      this.v0PlainText = nextText;
    }

    if (content) {
      this.emitContent(content);
    }
  }

  private emitContent(content: string): void {
    this.hasVisibleContent ||= Boolean(content.trim());
    this.handlers.onChunk(content);
  }

  private complete(): void {
    if (this.isComplete) return;

    if (!this.hasVisibleContent && this.finishReason === "length") {
      this.fail(
        "The model reached its completion token limit before producing visible answer text.",
      );
      return;
    }
    if (!this.hasVisibleContent && this.hasToolCalls) {
      this.fail("The provider returned a tool call that Athas did not request or cannot execute.");
      return;
    }
    if (!this.hasVisibleContent && this.hasReasoning) {
      this.fail("The model returned reasoning data but no visible answer text.");
      return;
    }

    this.isComplete = true;
    this.handlers.onComplete();
  }

  private fail(error: string): void {
    if (this.isComplete) return;
    this.isComplete = true;
    this.handlers.onError(error);
  }
}

function isSSEField(line: string): boolean {
  return line.startsWith(":") || /^(data|event|id|retry):/.test(line);
}

function extractVisibleMessageText(message: OpenAIMessageContent | undefined): string {
  if (!message) return "";
  return extractTextContent(message.content) || extractTextContent(message.refusal);
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractTextContent).join("");
  if (!isRecord(value)) return "";

  if (typeof value.text === "string") return value.text;
  if (isRecord(value.text) && typeof value.text.value === "string") return value.text.value;
  if (typeof value.content === "string") return value.content;
  return "";
}

function hasResponseValue(...values: unknown[]): boolean {
  return values.some((value) => {
    if (typeof value === "string") return Boolean(value.trim());
    if (Array.isArray(value)) return value.length > 0;
    return isRecord(value) && Object.keys(value).length > 0;
  });
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
