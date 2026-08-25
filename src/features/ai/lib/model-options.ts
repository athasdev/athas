import type { ProviderModel } from "@/features/ai/services/providers/ai-provider-interface";

export interface AIModelOption extends ProviderModel {
  proOnly?: boolean;
}

export function resolveModelOptions({
  staticModels,
  fetchedModels,
  customModels,
  isLoading,
}: {
  staticModels: AIModelOption[];
  fetchedModels: ProviderModel[];
  customModels: ProviderModel[];
  isLoading: boolean;
}): AIModelOption[] {
  if (isLoading) return [];

  const mergedModels = new Map<string, AIModelOption>(
    staticModels.map((model) => [model.id, model]),
  );

  for (const model of fetchedModels) {
    const existingModel = mergedModels.get(model.id);
    mergedModels.set(model.id, {
      id: model.id,
      name: model.name,
      ...(existingModel?.proOnly === undefined ? {} : { proOnly: existingModel.proOnly }),
      ...((model.contextWindow ?? existingModel?.contextWindow) === undefined
        ? {}
        : { contextWindow: model.contextWindow ?? existingModel?.contextWindow }),
      maxOutputTokens:
        model.maxOutputTokens ??
        model.maxTokens ??
        existingModel?.maxOutputTokens ??
        existingModel?.maxTokens ??
        4096,
    });
  }

  for (const model of customModels) {
    if (!mergedModels.has(model.id)) mergedModels.set(model.id, model);
  }

  return Array.from(mergedModels.values());
}
