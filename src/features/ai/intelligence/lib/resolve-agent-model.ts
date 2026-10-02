import type { Model, ModelProvider } from "@/features/ai/types/providers.types";

export function resolveAgentModel(params: {
  provider: ModelProvider | undefined;
  modelId: string;
  dynamicModels: Model[];
  customDefault?: string;
}): Model | undefined {
  if (!params.provider) return undefined;
  const fallback =
    params.provider.id === "custom"
      ? params.customDefault?.trim()
      : params.provider.id === "athas"
        ? "auto"
        : "";
  const modelId = params.modelId.trim() || fallback;
  if (!modelId) return undefined;
  const fromStatic = params.provider.models.find((model) => model.id === modelId);
  const fromCatalog = params.dynamicModels.find((model) => model.id === modelId);
  // Athas's bundled list is only a placeholder until the server's catalog, with real limits, arrives.
  const known =
    params.provider.id === "athas" ? (fromCatalog ?? fromStatic) : (fromStatic ?? fromCatalog);
  // The Athas server applies each model's own output limit, so it gets no local default.
  const defaultOutput = params.provider.id === "athas" ? undefined : 4096;
  return known
    ? { ...known, maxOutputTokens: known.maxOutputTokens ?? known.maxTokens ?? defaultOutput }
    : { id: modelId, name: modelId, maxOutputTokens: defaultOutput };
}
