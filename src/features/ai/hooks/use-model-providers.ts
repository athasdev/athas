import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";

/**
 * The providers a model menu offers besides Athas: every one the user connected, plus the one
 * currently selected so an existing choice never disappears from its own menu.
 */
export function useConnectedModelProviders(selectedProviderIds: string[] = []) {
  const providers = useAvailableProviders();
  const providerKeys = useAIChatStore((state) => state.providerApiKeys);
  return providers.filter(
    (provider) =>
      provider.id !== "athas" &&
      (selectedProviderIds.includes(provider.id) || providerKeys.get(provider.id)),
  );
}

/** A model's display name, from the fetched catalog first and the static list second. */
export function useModelName(providerId: string, modelId: string) {
  const providers = useAvailableProviders();
  const dynamicModels = useAIChatStore((state) => state.dynamicModels);
  return (
    dynamicModels[providerId]?.find((model) => model.id === modelId)?.name ??
    providers
      .find((provider) => provider.id === providerId)
      ?.models.find((model) => model.id === modelId)?.name ??
    null
  );
}
