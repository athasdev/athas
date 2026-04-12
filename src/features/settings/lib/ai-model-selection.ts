import { getProviderById } from "@/features/ai/types/providers";

export interface ResolvedProviderModelSelection {
  providerId: string;
  modelId: string;
}

export function resolveProviderModelSelection(
  providerId: string,
  preferredModelId?: string,
): ResolvedProviderModelSelection {
  const provider = getProviderById(providerId);

  if (!provider) {
    return {
      providerId,
      modelId: preferredModelId || "",
    };
  }

  const modelId =
    preferredModelId && provider.models.some((model) => model.id === preferredModelId)
      ? preferredModelId
      : (provider.models[0]?.id ?? preferredModelId ?? "");

  return {
    providerId: provider.id,
    modelId,
  };
}
