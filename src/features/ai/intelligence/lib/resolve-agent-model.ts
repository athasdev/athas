import type { Model, ModelProvider } from "@/features/ai/types/providers.types";

export function resolveAgentModel(params: {
  provider: ModelProvider | undefined;
  modelId: string;
  dynamicModels: Model[];
  customDefault?: string;
}): Model | undefined {
  if (!params.provider) return undefined;
  const modelId =
    params.modelId.trim() || (params.provider.id === "custom" ? params.customDefault?.trim() : "");
  if (!modelId) return undefined;
  const known =
    params.provider.models.find((model) => model.id === modelId) ??
    params.dynamicModels.find((model) => model.id === modelId);
  return known
    ? { ...known, maxOutputTokens: known.maxOutputTokens ?? known.maxTokens ?? 4096 }
    : { id: modelId, name: modelId, maxOutputTokens: 4096 };
}
