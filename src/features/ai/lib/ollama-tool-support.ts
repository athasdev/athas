/** Local models known to call tools well enough to drive the agent. */
const OLLAMA_TOOL_MODEL_SUGGESTIONS = [
  "qwen3-coder",
  "gpt-oss",
  "llama3.1",
  "llama3.3",
  "devstral",
] as const;

export type OllamaToolSupport = "supported" | "unsupported" | "unknown";

/**
 * Reads the `capabilities` list Ollama's `/api/show` reports for a model. Older Ollama versions
 * do not send it, so a missing list is "unknown" and the agent tries tools anyway.
 */
export function getOllamaToolSupport(capabilities: unknown): OllamaToolSupport {
  if (!Array.isArray(capabilities)) return "unknown";
  return capabilities.includes("tools") ? "supported" : "unsupported";
}

export function getOllamaNoToolsMessage(modelId: string): string {
  const suggestions = OLLAMA_TOOL_MODEL_SUGGESTIONS.join(", ");
  return `The Ollama model "${modelId}" does not support tools, so the agent cannot read, create or edit files or run commands with it. Pick a tool-capable model such as ${suggestions} (for example \`ollama pull qwen3-coder\`).`;
}

export function getOllamaReadOnlyNoToolsNotice(modelId: string): string {
  return `${modelId} does not support tools, so it answered without reading the workspace.`;
}

/** Whether a failed Ollama request was rejected because the model cannot take tools. */
export function isOllamaNoToolsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { message, responseBody } = error as { message?: unknown; responseBody?: unknown };
  return [message, responseBody].some(
    (text) => typeof text === "string" && /does not support tools/i.test(text),
  );
}
