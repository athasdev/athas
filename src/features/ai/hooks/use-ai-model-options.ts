import { useCallback, useEffect, useMemo, useState } from "react";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { useProviderById } from "@/features/ai/hooks/use-available-providers";
import { getCustomModelOptions } from "@/features/ai/lib/custom-model-options";
import { canUseProviderWithoutApiKey } from "@/features/ai/lib/provider-access";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { getProvider } from "@/features/ai/services/providers/ai-provider-registry";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { getProviderById } from "@/features/ai/types/providers.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";

export interface AIModelOption {
  id: string;
  name: string;
  maxTokens?: number;
  proOnly?: boolean;
}

export function useAIModelOptions(
  providerId: string,
  modelId: string,
  onChange?: (modelId: string) => void,
) {
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const { hasHostedAi } = useProFeature();
  const subscription = useAuthStore((state) => state.subscription);
  const dynamicModels = useAIChatStore((state) => state.dynamicModels);
  const setDynamicModels = useAIChatStore((state) => state.actions.setDynamicModels);
  const customModelId = useSettingsStore((state) => state.settings.aiCustomModelId);
  const autocompleteCustomModelId = useSettingsStore(
    (state) => state.settings.aiAutocompleteCustomModelId,
  );
  const provider = useProviderById(providerId);
  const isCustomProvider = providerId === "custom";

  const fetchDynamicModels = useCallback(async () => {
    if (isCustomProvider) return;

    const config = getProviderById(providerId);
    const instance = getProvider(providerId);

    setModelFetchError(null);
    if (!instance?.getModels) return;

    const apiKey = config?.requiresApiKey ? await getProviderApiToken(providerId) : undefined;
    const canFetchWithoutApiKey = providerId === "openrouter";
    const canUseWithoutApiKey = canUseProviderWithoutApiKey({
      providerId,
      subscription,
      hasStoredKey: Boolean(apiKey),
      requiresApiKey: config?.requiresApiKey ?? true,
    });
    if (config?.requiresApiKey && !canUseWithoutApiKey && !canFetchWithoutApiKey) return;

    setIsLoadingModels(true);
    try {
      const models = await instance.getModels(apiKey || undefined);
      setDynamicModels(providerId, models);
      if (models.length === 0) {
        setModelFetchError(
          providerId === "ollama"
            ? "No models detected. Please install a model in Ollama."
            : "No models found.",
        );
      }
    } catch {
      setModelFetchError("Failed to fetch models");
    } finally {
      setIsLoadingModels(false);
    }
  }, [isCustomProvider, providerId, setDynamicModels, subscription]);

  useEffect(() => {
    void fetchDynamicModels();
  }, [fetchDynamicModels]);

  const availableModels = useMemo(() => {
    const staticModels = provider?.models || [];
    const fetchedModels = dynamicModels[providerId] || [];
    const customModels = getCustomModelOptions({
      providerId,
      modelId,
      customModelId,
      autocompleteCustomModelId,
    });
    const mergedModels = new Map<string, AIModelOption>(
      staticModels.map((model) => [model.id, model]),
    );

    for (const model of fetchedModels) {
      const existingModel = mergedModels.get(model.id);
      mergedModels.set(model.id, {
        id: model.id,
        name: model.name,
        proOnly: existingModel?.proOnly,
        maxTokens: model.maxTokens ?? existingModel?.maxTokens ?? 4096,
      });
    }
    for (const model of customModels) {
      if (!mergedModels.has(model.id)) mergedModels.set(model.id, model);
    }

    return Array.from(mergedModels.values());
  }, [
    autocompleteCustomModelId,
    customModelId,
    dynamicModels,
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
    if (isLoadingModels) return "Loading models...";
    if ((providerId === "openrouter" || isCustomProvider) && modelId.trim()) return modelId;
    return "Select model";
  }, [availableModels, isCustomProvider, isLoadingModels, modelId, providerId]);

  return {
    availableModels,
    currentModelName,
    hasHostedAi,
    isCustomProvider,
    isLoadingModels,
    modelFetchError,
  };
}
