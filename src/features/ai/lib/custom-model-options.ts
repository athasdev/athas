import type { ProviderModel } from "@/features/ai/services/providers/ai-provider-interface";

interface CustomModelOptionInput {
  providerId: string;
  modelId?: string;
  customModelId?: string;
  autocompleteCustomModelId?: string;
}

export function getCustomModelOptions({
  providerId,
  modelId,
  customModelId,
  autocompleteCustomModelId,
}: CustomModelOptionInput): ProviderModel[] {
  if (providerId !== "custom") return [];

  const seen = new Set<string>();
  const modelIds = [modelId, customModelId, autocompleteCustomModelId]
    .map((candidate) => candidate?.trim() || "")
    .filter((candidate) => {
      if (!candidate || seen.has(candidate)) return false;
      seen.add(candidate);
      return true;
    });

  return modelIds.map((id) => ({
    id,
    name: id,
    maxTokens: 4096,
  }));
}
