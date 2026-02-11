export type KairoThinkingEffort = "low" | "medium" | "high" | "max";

export type KairoReasoningSupport =
  | "gpt_reasoning_level"
  | "claude_opus_46"
  | "claude_binary"
  | "model_defined";

const GPT_REASONING_MODELS = new Set(["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano"]);

const CLAUDE_OPUS_46_MODELS = new Set(["claude-opus-4.6"]);
const CLAUDE_BINARY_MODELS = new Set(["claude-opus-4.5", "claude-sonnet-4.5"]);
const MODEL_DEFINED_MODELS = new Set([
  "grok-4-fast-reasoning",
  "grok-4-fast-non-reasoning",
  "deepseek-v3.2",
  "deepseek-v3.2-speciale",
  "kimi-k2.5",
  "kimi-k2-thinking",
]);

export const clampKairoReasoningLevel = (value: number): number => {
  if (!Number.isFinite(value)) return 2;
  return Math.min(3, Math.max(0, Math.round(value)));
};

export const normalizeKairoThinkingEffort = (
  value: string | null | undefined,
): KairoThinkingEffort => {
  switch (value) {
    case "low":
    case "medium":
    case "high":
    case "max":
      return value;
    default:
      return "high";
  }
};

export const getKairoReasoningSupport = (modelId: string): KairoReasoningSupport => {
  const normalized = modelId.trim().toLowerCase();

  if (CLAUDE_OPUS_46_MODELS.has(normalized)) {
    return "claude_opus_46";
  }

  if (CLAUDE_BINARY_MODELS.has(normalized)) {
    return "claude_binary";
  }

  if (GPT_REASONING_MODELS.has(normalized)) {
    return "gpt_reasoning_level";
  }

  if (MODEL_DEFINED_MODELS.has(normalized)) {
    return "model_defined";
  }

  // Default to reasoning-level support for unknown future models.
  return "gpt_reasoning_level";
};

export const buildKairoReasoningRequest = (
  modelId: string,
  reasoningLevel: number,
  thinkingEffort: string | null | undefined,
): {
  reasoningLevel?: number;
  thinkingEffort?: KairoThinkingEffort;
} => {
  const support = getKairoReasoningSupport(modelId);
  const level = clampKairoReasoningLevel(reasoningLevel);
  const effort = normalizeKairoThinkingEffort(thinkingEffort);

  switch (support) {
    case "gpt_reasoning_level":
      return { reasoningLevel: level };
    case "claude_opus_46":
      if (level <= 0) {
        return { reasoningLevel: 0 };
      }
      return {
        reasoningLevel: 1,
        thinkingEffort: effort,
      };
    case "claude_binary":
      return { reasoningLevel: level > 0 ? 1 : 0 };
    case "model_defined":
      return {};
    default:
      return {};
  }
};
