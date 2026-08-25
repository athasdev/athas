import { useEffect, useMemo, useState } from "react";
import { useProviderById } from "@/features/ai/hooks/use-available-providers";
import { getCustomModelOptions } from "@/features/ai/lib/custom-model-options";
import { resolveModelOptions } from "@/features/ai/lib/model-options";
import { canUseProviderWithoutApiKey } from "@/features/ai/lib/provider-access";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { getProvider } from "@/features/ai/services/providers/ai-provider-registry";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { getProviderById } from "@/features/ai/types/providers.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";

export function useAIModelOptions(
  providerId: string,
  modelId: string,
  onChange?: (modelId: string) => void,
) {
  const [modelLoadState, setModelLoadState] = useState<{
    providerId: string;
    status: "loading" | "settled";
  }>({ providerId: "", status: "loading" });
  const [modelFetchError, setModelFetchError] = useState<{
    providerId: string;
    message: string;
  }>();
  const subscription = useAuthStore((state) => state.subscription);
  const dynamicModels = useAIChatStore((state) => state.dynamicModels);
  const setDynamicModels = useAIChatStore((state) => state.actions.setDynamicModels);
  const customModelId = useSettingsStore((state) => state.settings.aiCustomModelId);
  const autocompleteCustomModelId = useSettingsStore(
    (state) => state.settings.aiAutocompleteCustomModelId,
  );
  const provider = useProviderById(providerId);
  const isCustomProvider = providerId === "custom";
  const providerInstance = getProvider(providerId);
  const fetchedModels = dynamicModels[providerId];
  const hasCachedDynamicModels = fetchedModels !== undefined;
  const canFetchDynamicModels = !isCustomProvider && Boolean(providerInstance?.getModels);
  const isLoadingModels =
    canFetchDynamicModels &&
    !hasCachedDynamicModels &&
    (modelLoadState.providerId !== providerId || modelLoadState.status === "loading");
  const visibleModelFetchError =
    modelFetchError?.providerId === providerId ? modelFetchError.message : null;

  useEffect(() => {
    let isCurrent = true;
    const config = getProviderById(providerId);
    const getModels = providerInstance?.getModels;

    if (!canFetchDynamicModels || hasCachedDynamicModels || !providerInstance || !getModels) {
      setModelLoadState({ providerId, status: "settled" });
      return;
    }

    setModelFetchError(undefined);
    setModelLoadState({ providerId, status: "loading" });
    const loadModels = async () => {
      try {
        const apiKey = config?.requiresApiKey ? await getProviderApiToken(providerId) : undefined;
        const canFetchWithoutApiKey = providerId === "openrouter";
        const canUseWithoutApiKey = canUseProviderWithoutApiKey({
          providerId,
          subscription,
          hasStoredKey: Boolean(apiKey),
          requiresApiKey: config?.requiresApiKey ?? true,
        });
        if (config?.requiresApiKey && !canUseWithoutApiKey && !canFetchWithoutApiKey) return;

        const models = await getModels.call(providerInstance, apiKey || undefined);
        if (!isCurrent) return;
        setDynamicModels(providerId, models);
        if (models.length === 0) {
          setModelFetchError({
            providerId,
            message:
              providerId === "ollama"
                ? "No models detected. Please install a model in Ollama."
                : "No models found.",
          });
        }
      } catch {
        if (isCurrent) {
          setModelFetchError({ providerId, message: "Failed to fetch models" });
        }
      } finally {
        if (isCurrent) setModelLoadState({ providerId, status: "settled" });
      }
    };

    void loadModels();

    return () => {
      isCurrent = false;
    };
  }, [
    canFetchDynamicModels,
    hasCachedDynamicModels,
    providerId,
    providerInstance,
    setDynamicModels,
    subscription,
  ]);

  const availableModels = useMemo(() => {
    const staticModels = provider?.models || [];
    const resolvedFetchedModels = fetchedModels || [];
    const customModels = getCustomModelOptions({
      providerId,
      modelId,
      customModelId,
      autocompleteCustomModelId,
    });
    return resolveModelOptions({
      staticModels,
      fetchedModels: resolvedFetchedModels,
      customModels,
      isLoading: isLoadingModels,
    });
  }, [
    autocompleteCustomModelId,
    customModelId,
    fetchedModels,
    isLoadingModels,
    modelId,
    provider?.models,
    providerId,
  ]);

  useEffect(() => {
    if (!onChange || availableModels.length === 0) return;
    if (!availableModels.some((model) => model.id === modelId)) {
      onChange(availableModels[0].id);
    }
  }, [availableModels, modelId, onChange]);

  const currentModelName = useMemo(() => {
    const selectedModel = availableModels.find((model) => model.id === modelId);
    if (selectedModel) return selectedModel.name;
    if (isLoadingModels) return "Loading models…";
    if ((providerId === "openrouter" || isCustomProvider) && modelId.trim()) return modelId;
    return "Select model";
  }, [availableModels, isCustomProvider, isLoadingModels, modelId, providerId]);

  return {
    availableModels,
    currentModelName,
    isCustomProvider,
    isLoadingModels,
    modelFetchError: visibleModelFetchError,
  };
}
