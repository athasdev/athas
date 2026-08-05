import { LockIcon as Lock, WarningCircleIcon as WarningCircle } from "@/ui/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProBadge } from "@/extensions/ui/components/pro-badge";
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
import { Alert, AlertDescription } from "@/ui/alert";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";

type SelectorModel = {
  id: string;
  name: string;
  maxTokens?: number;
  proOnly?: boolean;
};

interface ModelSelectorProps {
  providerId: string;
  modelId: string;
  onChange: (modelId: string) => void;
  appearance?: "settings" | "composer";
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tooltip?: string;
}

export function ModelSelector({
  providerId,
  modelId,
  onChange,
  appearance = "settings",
  disabled,
  className,
  triggerClassName,
  open,
  onOpenChange,
  tooltip,
}: ModelSelectorProps) {
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
  const isComposer = appearance === "composer";
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
    const mergedModels = new Map<string, SelectorModel>(
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
    if (availableModels.length === 0) return;
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

  return (
    <Select
      value={modelId}
      onChange={onChange}
      options={availableModels.map((model) => {
        const locked = Boolean(model.proOnly && !hasHostedAi);
        return {
          value: model.id,
          label: model.name,
          keywords: [model.id],
          disabled: locked,
          icon: locked ? <Lock className="text-subtle-foreground" /> : undefined,
          accessory: model.proOnly ? <ProBadge /> : undefined,
        };
      })}
      placeholder={currentModelName}
      aria-label="Select AI model"
      searchable
      searchableTrigger={isComposer ? "input" : "menu"}
      openDirection={isComposer ? "up" : "down"}
      allowCustomValue={isCustomProvider}
      customValueLabel={(customValue) => `Use ${customValue}`}
      emptyLabel={isCustomProvider ? "Type a model name and press Enter" : "No models found"}
      hideChevron={isComposer}
      size="xs"
      variant={isComposer ? "ghost" : "default"}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      tooltip={tooltip}
      className={cn(!isComposer && "w-fit max-w-full", className)}
      triggerClassName={cn(isComposer ? "max-w-[176px]" : "w-fit max-w-full", triggerClassName)}
      menuClassName="w-fit min-w-0 max-w-[var(--available-width)] p-0"
      menuMinWidth={isComposer ? 260 : 0}
      menuAnimated={!isComposer}
      menuHeader={
        modelFetchError ? (
          <Alert tone="warning" role="status" className="m-1 w-auto">
            <WarningCircle />
            <AlertDescription>{modelFetchError}</AlertDescription>
          </Alert>
        ) : undefined
      }
    />
  );
}
