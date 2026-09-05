import type { CodexModelOption, CodexThreadSettings } from "./codex-types";

export function getCodexModelPatch(
  modelId: string | undefined,
  models: CodexModelOption[],
  settings: CodexThreadSettings,
): Partial<CodexThreadSettings> {
  const model = models.find((item) => (modelId ? item.id === modelId : item.isDefault));
  if (!model) return { model: modelId };
  const supported = model.reasoningEfforts;
  const effort =
    supported.find((option) => option.value === settings.effort)?.value ??
    supported.find((option) => option.value === model.defaultReasoningEffort)?.value ??
    supported[0]?.value;
  return { model: modelId, effort };
}
