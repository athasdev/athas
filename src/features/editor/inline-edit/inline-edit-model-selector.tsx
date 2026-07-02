import {
  CaretLeftIcon as CaretLeft,
  CheckIcon as Check,
  MagnifyingGlassIcon as Search,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { ProviderApiKeyCommand } from "@/features/ai/components/provider-api-key-command";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import { canUseProviderWithoutApiKey } from "@/features/ai/lib/provider-access";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { getProvider } from "@/features/ai/services/providers/ai-provider-registry";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { getProviderById } from "@/features/ai/types/providers.types";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Button } from "@/ui/button";
import Command, {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandHeader,
  CommandHeaderAction,
  CommandInput,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import { matchesSearchQuery } from "@/utils/search-match";

interface InlineEditModelSelectorProps {
  providerId: string;
  modelId: string;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

export const InlineEditModelSelector = ({
  providerId,
  modelId,
  onProviderChange,
  onModelChange,
  disabled = false,
}: InlineEditModelSelectorProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [isApiKeyOpen, setIsApiKeyOpen] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const subscription = useAuthStore((state) => state.subscription);
  const { dynamicModels, setDynamicModels, hasProviderApiKey } = useAIChatStore();

  const providers = useAvailableProviders();
  const currentProvider = getProviderById(providerId);
  const currentProviderName = currentProvider?.name ?? providerId;
  const selectedProvider = selectedProviderId ? getProviderById(selectedProviderId) : null;
  const activeProviderId = selectedProvider?.id ?? providerId;
  const activeProvider = selectedProvider ?? currentProvider;

  const fetchDynamicModels = useCallback(
    async (nextProviderId: string) => {
      if (nextProviderId === "custom") return;

      const config = getProviderById(nextProviderId);
      const instance = getProvider(nextProviderId);
      if (!instance?.getModels) return;

      const apiKey = config?.requiresApiKey ? await getProviderApiToken(nextProviderId) : undefined;
      const canFetchWithoutApiKey = nextProviderId === "openrouter";
      const canUseWithoutApiKey = canUseProviderWithoutApiKey({
        providerId: nextProviderId,
        subscription,
        hasStoredKey: !!apiKey,
        requiresApiKey: config?.requiresApiKey ?? true,
      });
      if (config?.requiresApiKey && !canUseWithoutApiKey && !canFetchWithoutApiKey) return;

      setIsLoadingModels(true);
      try {
        const models = await instance.getModels(apiKey || undefined);
        setDynamicModels(nextProviderId, models);
      } finally {
        setIsLoadingModels(false);
      }
    },
    [setDynamicModels, subscription],
  );

  useEffect(() => {
    if (!isOpen || !selectedProviderId) return;
    void fetchDynamicModels(selectedProviderId);
  }, [fetchDynamicModels, isOpen, selectedProviderId]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelectedProviderId(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const availableModels = useMemo(() => {
    const staticModels = activeProvider?.models ?? [];
    const fetchedModels = dynamicModels[activeProviderId] ?? [];
    if (fetchedModels.length === 0) return staticModels;

    const mergedModels = new Map(staticModels.map((model) => [model.id, model]));
    for (const model of fetchedModels) {
      const existingModel = mergedModels.get(model.id);
      mergedModels.set(model.id, {
        id: model.id,
        name: model.name,
        maxTokens: model.maxTokens ?? existingModel?.maxTokens ?? 4096,
        proOnly: existingModel?.proOnly,
      });
    }
    return Array.from(mergedModels.values());
  }, [activeProvider?.models, activeProviderId, dynamicModels]);

  const currentModelName = useMemo(() => {
    const staticModel = currentProvider?.models.find((model) => model.id === modelId);
    const dynamicModel = dynamicModels[providerId]?.find((model) => model.id === modelId);
    return staticModel?.name ?? dynamicModel?.name ?? modelId;
  }, [currentProvider?.models, dynamicModels, modelId, providerId]);

  const filteredProviders = useMemo(
    () => providers.filter((provider) => matchesSearchQuery(query, [provider.name, provider.id])),
    [providers, query],
  );

  const filteredModels = useMemo(
    () => availableModels.filter((model) => matchesSearchQuery(query, [model.name, model.id])),
    [availableModels, query],
  );

  const providerNeedsApiKey = Boolean(
    selectedProvider?.requiresApiKey &&
    !canUseProviderWithoutApiKey({
      providerId: selectedProvider.id,
      subscription,
      hasStoredKey: hasProviderApiKey(selectedProvider.id),
      requiresApiKey: selectedProvider.requiresApiKey,
    }),
  );

  const openSelector = () => {
    if (disabled) return;
    setIsOpen(true);
  };

  const closeSelector = () => {
    setIsOpen(false);
    setQuery("");
    setSelectedProviderId(null);
  };

  const handleProviderSelect = (nextProviderId: string) => {
    setSelectedProviderId(nextProviderId);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleBack = () => {
    setSelectedProviderId(null);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleModelSelect = (nextModelId: string) => {
    if (!selectedProviderId) return;
    onProviderChange(selectedProviderId);
    onModelChange(nextModelId);
    closeSelector();
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        compact
        onClick={openSelector}
        disabled={disabled}
        className="max-w-[144px] justify-start px-1.5 text-text"
        tooltip="Inline edit model"
      >
        <span className="truncate ui-text-base">
          {currentProviderName} / {currentModelName}
        </span>
      </Button>

      <Command
        isVisible={isOpen}
        onClose={closeSelector}
        className="inline-edit-model-command max-h-[420px] w-[480px]"
        title="Inline edit model"
      >
        <CommandHeader onClose={closeSelector}>
          {selectedProvider ? (
            <CommandHeaderAction type="button" onClick={handleBack} aria-label="Back to providers">
              <CaretLeft />
            </CommandHeaderAction>
          ) : (
            <Search className="shrink-0 text-text-lighter" size={14} />
          )}
          <CommandInput
            ref={inputRef}
            value={query}
            onChange={setQuery}
            placeholder={selectedProvider ? "Search models..." : "Pick a provider..."}
          />
        </CommandHeader>

        {selectedProvider ? (
          <>
            <CommandList>
              {isLoadingModels ? (
                <CommandEmpty>Loading models...</CommandEmpty>
              ) : filteredModels.length === 0 ? (
                <CommandEmpty>No models found</CommandEmpty>
              ) : (
                filteredModels.map((model) => {
                  const isSelected = selectedProvider.id === providerId && model.id === modelId;
                  return (
                    <CommandItemRow
                      key={model.id}
                      isSelected={isSelected}
                      onClick={() => handleModelSelect(model.id)}
                      icon={
                        <ProviderIcon
                          providerId={selectedProvider.id}
                          size={14}
                          className="text-text-lighter"
                        />
                      }
                      title={model.name}
                      accessory={isSelected ? <Check className="text-accent" size={13} /> : null}
                    />
                  );
                })
              )}
            </CommandList>
            {providerNeedsApiKey && (
              <CommandFooter>
                <CommandFooterAction type="button" onClick={() => setIsApiKeyOpen(true)}>
                  Add API key
                </CommandFooterAction>
              </CommandFooter>
            )}
          </>
        ) : (
          <CommandList>
            {filteredProviders.length === 0 ? (
              <CommandEmpty>No providers found</CommandEmpty>
            ) : (
              filteredProviders.map((provider) => (
                <CommandItemRow
                  key={provider.id}
                  onClick={() => handleProviderSelect(provider.id)}
                  icon={
                    <ProviderIcon
                      providerId={provider.id}
                      size={14}
                      className="text-text-lighter"
                    />
                  }
                  title={provider.name}
                />
              ))
            )}
          </CommandList>
        )}
      </Command>

      <ProviderApiKeyCommand
        isOpen={isApiKeyOpen}
        onClose={() => setIsApiKeyOpen(false)}
        initialProviderId={selectedProviderId ?? providerId}
      />
    </>
  );
};
