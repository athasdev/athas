import {
  CheckIcon as Check,
  LockIcon as Lock,
  WarningCircleIcon as WarningCircle,
} from "@/ui/icons";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Button, buttonVariants } from "@/ui/button";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import { cn } from "@/utils/cn";
import { matchesSearchQuery } from "@/utils/search-match";
import {
  chatComposerControlClassName,
  chatComposerDropdownClassName,
  chatSettingsSelectorTriggerClassName,
} from "../input/chat-composer-control-styles";

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
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  const triggerInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { isPro } = useProFeature();
  const subscription = useAuthStore((state) => state.subscription);
  const { dynamicModels, setDynamicModels } = useAIChatStore();
  const customModelId = useSettingsStore((state) => state.settings.aiCustomModelId);
  const autocompleteCustomModelId = useSettingsStore(
    (state) => state.settings.aiAutocompleteCustomModelId,
  );

  const provider = useProviderById(providerId);
  const isComposer = appearance === "composer";
  const isCustomProvider = providerId === "custom";

  const setOpen = (nextOpen: boolean) => {
    if (disabled && nextOpen) return;
    if (!nextOpen) {
      setQuery("");
      setActiveIndex(0);
    }
    if (open === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const fetchDynamicModels = useCallback(async () => {
    if (providerId === "custom") return;

    const config = getProviderById(providerId);
    const instance = getProvider(providerId);

    setModelFetchError(null);
    if (!instance?.getModels) return;

    const apiKey = config?.requiresApiKey ? await getProviderApiToken(providerId) : undefined;
    const canFetchWithoutApiKey = providerId === "openrouter";
    const canUseWithoutApiKey = canUseProviderWithoutApiKey({
      providerId,
      subscription,
      hasStoredKey: !!apiKey,
      requiresApiKey: config?.requiresApiKey ?? true,
    });
    if (config?.requiresApiKey && !canUseWithoutApiKey && !canFetchWithoutApiKey) {
      return;
    }

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
  }, [providerId, setDynamicModels, subscription]);

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
      if (!mergedModels.has(model.id)) {
        mergedModels.set(model.id, model);
      }
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

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => triggerInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const currentModelName = useMemo(() => {
    const selectedModel = availableModels.find((model) => model.id === modelId);
    if (selectedModel) return selectedModel.name;
    if (isLoadingModels) return "Loading models...";
    if ((providerId === "openrouter" || providerId === "custom") && modelId.trim().length > 0) {
      return modelId;
    }
    return "Select model";
  }, [availableModels, isLoadingModels, modelId, providerId]);

  const filteredModels = useMemo(() => {
    return availableModels.filter((model) => {
      return matchesSearchQuery(query, [model.name, model.id]);
    });
  }, [availableModels, query]);
  const customQueryModelId = query.trim();
  const canUseCustomQueryModel =
    isCustomProvider &&
    customQueryModelId.length > 0 &&
    !availableModels.some((model) => model.id === customQueryModelId);

  const selectableModelIndexes = useMemo(() => {
    const indexes = filteredModels.reduce<number[]>((modelIndexes, model, index) => {
      if (!(model.proOnly && !isPro)) modelIndexes.push(index);
      return modelIndexes;
    }, []);
    if (canUseCustomQueryModel) {
      indexes.push(filteredModels.length);
    }
    return indexes;
  }, [canUseCustomQueryModel, filteredModels, isPro]);
  useEffect(() => {
    if (!isOpen) return;
    const currentIndex = filteredModels.findIndex((model) => model.id === modelId);
    if (currentIndex >= 0 && selectableModelIndexes.includes(currentIndex)) {
      setActiveIndex(currentIndex);
      return;
    }
    setActiveIndex(selectableModelIndexes[0] ?? 0);
  }, [filteredModels, isOpen, modelId, selectableModelIndexes]);

  useEffect(() => {
    if (!isOpen) return;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const triggerClass = cn(
    isComposer
      ? chatComposerControlClassName("max-w-[176px]")
      : chatSettingsSelectorTriggerClassName("w-[260px]"),
    triggerClassName,
  );

  const handleTriggerInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (selectableModelIndexes.length === 0) return;

    const activeSelectableIndex = selectableModelIndexes.indexOf(activeIndex);
    const currentSelectableIndex = activeSelectableIndex >= 0 ? activeSelectableIndex : 0;

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const nextSelectableIndex = Math.min(
          currentSelectableIndex + 1,
          selectableModelIndexes.length - 1,
        );
        setActiveIndex(selectableModelIndexes[nextSelectableIndex] ?? 0);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const nextSelectableIndex = Math.max(currentSelectableIndex - 1, 0);
        setActiveIndex(selectableModelIndexes[nextSelectableIndex] ?? 0);
        break;
      }
      case "Home":
        event.preventDefault();
        setActiveIndex(selectableModelIndexes[0] ?? 0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(selectableModelIndexes[selectableModelIndexes.length - 1] ?? 0);
        break;
      case "Enter": {
        event.preventDefault();
        if (canUseCustomQueryModel) {
          onChange(customQueryModelId);
          setOpen(false);
          break;
        }
        const selectedModel =
          filteredModels[activeIndex] ?? filteredModels[selectableModelIndexes[0] ?? 0];
        if (!selectedModel || (selectedModel.proOnly && !isPro)) return;
        onChange(selectedModel.id);
        setOpen(false);
        break;
      }
    }
  };

  return (
    <div className={className}>
      {isOpen ? (
        <div
          ref={(node) => {
            triggerRef.current = node;
          }}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => triggerInputRef.current?.focus()}
          className={cn(
            buttonVariants({
              variant: isComposer ? "ghost" : "default",
              size: "xs",
            }),
            triggerClass,
            "relative cursor-text",
          )}
        >
          <span className="invisible block min-w-0 truncate text-text">{currentModelName}</span>
          <input
            ref={triggerInputRef}
            type="text"
            value={query}
            disabled={disabled}
            placeholder={currentModelName}
            aria-label="Search AI models"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleTriggerInputKeyDown}
            className="font-sans absolute top-1/2 inset-x-1.5 min-w-0 -translate-y-1/2 truncate bg-transparent p-0 text-left text-text outline-none placeholder:text-text disabled:pointer-events-none"
          />
        </div>
      ) : (
        <Button
          ref={(node) => {
            triggerRef.current = node;
          }}
          type="button"
          variant={isComposer ? "ghost" : "default"}
          size="xs"
          disabled={disabled}
          tooltip={tooltip}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label="Select AI model"
          onClick={() => setOpen(!isOpen)}
          className={triggerClass}
        >
          <span className="block min-w-0 truncate text-text">{currentModelName}</span>
        </Button>
      )}

      <Dropdown
        isOpen={isOpen}
        anchorRef={triggerRef}
        anchorSide="bottom"
        onClose={() => setOpen(false)}
        className={cn(
          isComposer
            ? chatComposerDropdownClassName("min-w-0 p-0")
            : "min-w-0 overflow-hidden rounded-xl p-0",
        )}
        portalContainer={triggerRef.current?.closest(".ai-chat-container")}
        style={{ maxHeight: "280px", minWidth: 0 }}
        matchAnchorWidth
        anchorMinWidth={isComposer ? 260 : 0}
        animated={!isComposer}
      >
        <div
          className="custom-scrollbar-thin max-h-72 overflow-y-auto overscroll-contain p-1"
          onWheel={(event) => event.stopPropagation()}
        >
          {modelFetchError && (
            <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-warning/10 px-2 py-1.5 text-text-lighter ui-text-sm">
              <WarningCircle className="shrink-0 text-warning" />
              <span>{modelFetchError}</span>
            </div>
          )}

          {filteredModels.length === 0 && !canUseCustomQueryModel ? (
            <div className="p-4 text-center text-text-lighter ui-text-sm">
              {isCustomProvider ? "Type a model name and press Enter" : "No models found"}
            </div>
          ) : (
            <>
              {filteredModels.map((model) => {
                const isCurrent = model.id === modelId;
                const isLocked = Boolean(model.proOnly && !isPro);
                const index = filteredModels.indexOf(model);
                const isActive = activeIndex === index;

                return (
                  <button
                    key={model.id}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    onClick={() => {
                      if (isLocked) return;
                      onChange(model.id);
                      setOpen(false);
                    }}
                    onMouseEnter={() => {
                      if (!isLocked) setActiveIndex(index);
                    }}
                    onPointerMove={() => {
                      if (!isLocked) setActiveIndex(index);
                    }}
                    disabled={isLocked}
                    className={cn(
                      dropdownItemClassName(),
                      "mb-1 min-h-8 gap-2 py-2 ui-text-sm last:mb-0",
                      isActive && "bg-hover",
                      isCurrent && "bg-selected/90 ring-1 ring-accent/10",
                    )}
                  >
                    {isLocked && <Lock className="shrink-0 text-text-lighter" />}
                    <span className="min-w-0 flex-1 truncate text-text">{model.name}</span>
                    {model.proOnly && <ProBadge />}
                    {isCurrent && <Check className="shrink-0 text-accent" />}
                  </button>
                );
              })}
              {canUseCustomQueryModel && (
                <button
                  key="custom-query-model"
                  ref={(node) => {
                    itemRefs.current[filteredModels.length] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onChange(customQueryModelId);
                    setOpen(false);
                  }}
                  onMouseEnter={() => setActiveIndex(filteredModels.length)}
                  onPointerMove={() => setActiveIndex(filteredModels.length)}
                  className={cn(
                    dropdownItemClassName(),
                    "mb-1 min-h-8 gap-2 py-2 ui-text-sm last:mb-0",
                    activeIndex === filteredModels.length && "bg-hover",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-text">
                    Use {customQueryModelId}
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      </Dropdown>
    </div>
  );
}
