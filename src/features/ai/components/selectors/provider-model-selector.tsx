import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  CheckCircle,
  ChevronDown,
  Eye,
  EyeOff,
  Globe,
  Key,
  Lock,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAIChatStore } from "@/features/ai/store/store";
import {
  getAvailableProviders,
  getModelById,
  getProviderById,
} from "@/features/ai/types/providers";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { ProBadge } from "@/extensions/ui/components/pro-badge";
import { useSettingsStore } from "@/features/settings/store";
import Input from "@/ui/input";
import { Button } from "@/ui/button";
import { controlFieldSizeVariants, controlFieldSurfaceVariants } from "@/ui/control-field";
import { MenuPopover } from "@/ui/dropdown";
import { cn } from "@/utils/cn";
import {
  getProvider,
  setOllamaBaseUrl,
} from "@/features/ai/services/providers/ai-provider-registry";
import { checkOllamaConnection } from "@/features/ai/services/providers/ollama-provider";

interface ProviderModelSelectorProps {
  providerId: string;
  modelId: string;
  onProviderChange: (id: string) => void;
  onModelChange: (id: string) => void;
  disabled?: boolean;
}

interface DropdownPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

interface FilteredItem {
  type: "provider" | "model";
  id: string;
  name: string;
  providerId: string;
  requiresApiKey?: boolean;
  hasKey?: boolean;
  isCurrent?: boolean;
  proOnly?: boolean;
}

export function ProviderModelSelector({
  providerId,
  modelId,
  onProviderChange,
  onModelChange,
  disabled,
}: ProviderModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<{
    providerId: string | null;
    status: "valid" | "invalid" | null;
    message?: string;
  }>({ providerId: null, status: null });
  const [ollamaUrlInput, setOllamaUrlInput] = useState("");
  const [ollamaUrlStatus, setOllamaUrlStatus] = useState<"idle" | "checking" | "ok" | "error">(
    "idle",
  );

  const { isPro } = useProFeature();
  const { dynamicModels, setDynamicModels } = useAIChatStore();
  const hasProviderApiKey = useAIChatStore((state) => state.hasProviderApiKey);
  const saveApiKey = useAIChatStore((state) => state.saveApiKey);
  const removeApiKey = useAIChatStore((state) => state.removeApiKey);
  const { settings, updateSetting } = useSettingsStore();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  const providers = getAvailableProviders();
  const currentProvider = getProviderById(providerId);
  const currentModel = getModelById(providerId, modelId);
  const providerInstance = getProvider(providerId);
  const supportsDynamicModels = !!providerInstance?.getModels;

  const currentModelName = useMemo(() => {
    const dynamic = dynamicModels[providerId]?.find((model) => model.id === modelId);
    if (dynamic) return dynamic.name;
    return currentModel?.name || modelId;
  }, [currentModel, dynamicModels, modelId, providerId]);

  const fetchDynamicModels = useCallback(async () => {
    const config = getProviderById(providerId);
    const instance = getProvider(providerId);

    setModelFetchError(null);

    if (!instance?.getModels || config?.requiresApiKey) {
      return;
    }

    setIsLoadingModels(true);
    try {
      const models = await instance.getModels();
      if (models.length > 0) {
        setDynamicModels(providerId, models);
        if (!models.find((model) => model.id === modelId)) {
          onModelChange(models[0].id);
        }
      } else {
        setDynamicModels(providerId, []);
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
  }, [modelId, onModelChange, providerId, setDynamicModels]);

  useEffect(() => {
    void fetchDynamicModels();
  }, [fetchDynamicModels]);

  useEffect(() => {
    setOllamaUrlInput(settings.ollamaBaseUrl || "http://localhost:11434");
  }, [settings.ollamaBaseUrl]);

  const filteredItems = useMemo(() => {
    const items: FilteredItem[] = [];
    const searchLower = search.toLowerCase();

    for (const provider of providers) {
      const providerHasKey = !provider.requiresApiKey || hasProviderApiKey(provider.id);
      const models = dynamicModels[provider.id] || provider.models;
      const providerNameMatches = provider.name.toLowerCase().includes(searchLower);

      const matchingModels = models.filter(
        (model) =>
          !search ||
          providerNameMatches ||
          model.name.toLowerCase().includes(searchLower) ||
          model.id.toLowerCase().includes(searchLower),
      );

      if (matchingModels.length > 0 || !search || providerNameMatches) {
        items.push({
          type: "provider",
          id: `provider-${provider.id}`,
          name: provider.name,
          providerId: provider.id,
          requiresApiKey: provider.requiresApiKey,
          hasKey: providerHasKey,
        });

        for (const model of matchingModels) {
          items.push({
            type: "model",
            id: model.id,
            name: model.name,
            providerId: provider.id,
            isCurrent: providerId === provider.id && modelId === model.id,
            proOnly: "proOnly" in model ? Boolean(model.proOnly) : false,
          });
        }
      }
    }

    return items;
  }, [dynamicModels, hasProviderApiKey, modelId, providerId, providers, search]);

  const selectableItems = useMemo(
    () => filteredItems.filter((item) => item.type === "model"),
    [filteredItems],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      return;
    }

    setSearch("");
    setSelectedIndex(0);
    setEditingProvider(null);
    setApiKeyInput("");
    setShowKey(false);
    setValidationStatus({ providerId: null, status: null });
    setOllamaUrlStatus("idle");
  }, [isOpen]);

  useEffect(() => {
    if (editingProvider) {
      apiKeyInputRef.current?.focus();
    }
  }, [editingProvider]);

  const updateDropdownPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const minWidth = Math.max(rect.width, 300);
    const maxWidth = Math.min(420, window.innerWidth - viewportPadding * 2);
    const safeWidth = Math.max(Math.min(minWidth, maxWidth), Math.min(280, maxWidth));
    const estimatedHeight = 480;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openUp =
      availableBelow < Math.min(estimatedHeight, 240) && availableAbove > availableBelow;
    const maxHeight = Math.max(
      160,
      Math.min(estimatedHeight, openUp ? availableAbove - 6 : availableBelow - 6),
    );
    const measuredHeight = dropdownRef.current?.getBoundingClientRect().height ?? estimatedHeight;
    const visibleHeight = Math.min(maxHeight, measuredHeight);
    const left = Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - safeWidth - viewportPadding),
    );
    const top = openUp ? Math.max(viewportPadding, rect.top - visibleHeight - 6) : rect.bottom + 6;

    setPosition({ left, top, width: safeWidth, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
  }, [editingProvider, filteredItems.length, isOpen, search, updateDropdownPosition]);

  useEffect(() => {
    if (!isOpen) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (editingProvider) {
        setEditingProvider(null);
        setApiKeyInput("");
        setShowKey(false);
        setValidationStatus({ providerId: null, status: null });
        setOllamaUrlStatus("idle");
      } else {
        setIsOpen(false);
      }
    };

    const handleReposition = () => updateDropdownPosition();

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [editingProvider, isOpen, updateDropdownPosition]);

  const handleModelSelect = useCallback(
    (selectedProviderId: string, selectedModelId: string) => {
      if (selectedProviderId !== providerId) {
        onProviderChange(selectedProviderId);
      }
      onModelChange(selectedModelId);
      setIsOpen(false);
    },
    [onModelChange, onProviderChange, providerId],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (editingProvider) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, selectableItems.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          event.preventDefault();
          if (selectableItems[selectedIndex]) {
            const item = selectableItems[selectedIndex];
            handleModelSelect(item.providerId, item.id);
          }
          break;
        case "Escape":
          event.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [editingProvider, handleModelSelect, selectableItems, selectedIndex],
  );

  const startEditing = (targetProviderId: string) => {
    setEditingProvider(targetProviderId);
    setApiKeyInput("");
    setShowKey(false);
    setValidationStatus({ providerId: null, status: null });
    setOllamaUrlStatus("idle");
  };

  const cancelEditing = () => {
    setEditingProvider(null);
    setApiKeyInput("");
    setShowKey(false);
    setValidationStatus({ providerId: null, status: null });
    setOllamaUrlStatus("idle");
  };

  const handleSaveKey = async (targetProviderId: string) => {
    if (!apiKeyInput.trim()) {
      setValidationStatus({
        providerId: targetProviderId,
        status: "invalid",
        message: "Please enter an API key",
      });
      return;
    }

    setIsValidating(true);
    setValidationStatus({ providerId: null, status: null });

    try {
      const isValid = await saveApiKey(targetProviderId, apiKeyInput);
      if (isValid) {
        setValidationStatus({
          providerId: targetProviderId,
          status: "valid",
          message: "Saved",
        });
        window.setTimeout(() => cancelEditing(), 1000);
      } else {
        setValidationStatus({
          providerId: targetProviderId,
          status: "invalid",
          message: "Invalid API key",
        });
      }
    } catch {
      setValidationStatus({
        providerId: targetProviderId,
        status: "invalid",
        message: "Failed to validate",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveKey = async (targetProviderId: string) => {
    try {
      await removeApiKey(targetProviderId);
      setValidationStatus({
        providerId: targetProviderId,
        status: "valid",
        message: "Key removed",
      });
      window.setTimeout(() => {
        setValidationStatus({ providerId: null, status: null });
      }, 1500);
    } catch {
      setValidationStatus({
        providerId: targetProviderId,
        status: "invalid",
        message: "Failed to remove",
      });
    }
  };

  const handleSaveOllamaUrl = async (url: string) => {
    const trimmed = url.replace(/\/+$/, "") || "http://localhost:11434";
    setOllamaUrlStatus("checking");
    const ok = await checkOllamaConnection(trimmed);
    if (ok) {
      setOllamaUrlStatus("ok");
      updateSetting("ollamaBaseUrl", trimmed);
      setOllamaBaseUrl(trimmed);
      setOllamaUrlInput(trimmed);
      void fetchDynamicModels();
      window.setTimeout(() => cancelEditing(), 1000);
    } else {
      setOllamaUrlStatus("error");
    }
  };

  let selectableIndex = -1;

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen((open) => !open)}
        disabled={disabled}
        className={cn(
          controlFieldSurfaceVariants({ variant: "secondary" }),
          controlFieldSizeVariants({ size: "sm" }),
          "inline-flex w-[min(360px,100%)] min-w-0 items-center justify-between gap-2 px-2 text-left",
        )}
        aria-label="Select AI provider and model"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ProviderIcon providerId={providerId} size={14} className="text-text-lighter" />
          <span className="min-w-0 truncate text-left text-text">
            {currentProvider?.name || providerId}
            <span className="text-text-lighter"> / </span>
            {currentModelName}
          </span>
        </span>
        <ChevronDown
          className={cn("text-text-lighter transition-transform", isOpen && "rotate-180")}
        />
      </button>

      <MenuPopover
        isOpen={isOpen && !!position}
        menuRef={dropdownRef}
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="z-[10030] flex max-w-[min(420px,calc(100vw-16px))] flex-col overflow-hidden rounded-2xl bg-primary-bg/95 p-0 shadow-xl"
        style={
          position
            ? {
                left: `${position.left}px`,
                top: `${position.top}px`,
                width: `${position.width}px`,
                maxHeight: `${position.maxHeight}px`,
              }
            : undefined
        }
      >
        <div className="border-border/60 border-b px-1.5 py-1.5">
          <div className="flex items-center gap-1.5 rounded-lg bg-secondary-bg/70 pr-1.5">
            <Input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search providers and models..."
              variant="ghost"
              leftIcon={Search}
              className="min-w-0 flex-1 py-2"
            />
            {supportsDynamicModels && (
              <Button
                type="button"
                onClick={() => void fetchDynamicModels()}
                disabled={isLoadingModels}
                variant="ghost"
                size="icon-sm"
                className="rounded-md text-text-lighter"
                aria-label="Refresh models"
              >
                <RefreshCw className={cn(isLoadingModels && "animate-spin")} />
              </Button>
            )}
            <Button
              type="button"
              onClick={() => setIsOpen(false)}
              variant="ghost"
              size="icon-sm"
              className="rounded-md text-text-lighter"
              aria-label="Close model selector"
            >
              <X />
            </Button>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto p-1.5 [overscroll-behavior:contain]"
          onWheelCapture={(event) => event.stopPropagation()}
        >
          {modelFetchError && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-2 text-red-400 text-xs">
              <AlertCircle className="shrink-0" />
              <span>{modelFetchError}</span>
            </div>
          )}

          {filteredItems.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">No models found</div>
          ) : (
            filteredItems.map((item) => {
              if (item.type === "provider") {
                const isEditing = editingProvider === item.providerId;
                const hasKey = item.hasKey;
                const showingValidation =
                  validationStatus.providerId === item.providerId && validationStatus.status;
                const isCurrentProvider = item.providerId === providerId;

                return (
                  <div key={item.id} className="mb-1 last:mb-0">
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <span
                        className={cn(
                          "flex items-center gap-2 font-medium text-[11px] uppercase tracking-wide",
                          isCurrentProvider ? "text-text" : "text-text-lighter",
                        )}
                      >
                        <ProviderIcon
                          providerId={item.providerId}
                          size={14}
                          className="text-text-lighter"
                        />
                        {item.name}
                      </span>

                      <div className="flex items-center gap-1">
                        {item.requiresApiKey &&
                          !isEditing &&
                          (hasKey ? (
                            <>
                              <Button
                                type="button"
                                onClick={() => startEditing(item.providerId)}
                                variant="ghost"
                                size="xs"
                                className="h-auto px-1.5 text-[10px] text-text-lighter"
                                aria-label={`Edit ${item.name} API key`}
                              >
                                Edit Key
                              </Button>
                              <Button
                                type="button"
                                onClick={() => void handleRemoveKey(item.providerId)}
                                variant="ghost"
                                size="icon-sm"
                                className="rounded-md text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                aria-label={`Remove ${item.name} API key`}
                              >
                                <Trash2 />
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              onClick={() => startEditing(item.providerId)}
                              variant="primary"
                              size="xs"
                              className="h-auto gap-1 px-1.5 text-[10px]"
                              aria-label={`Set ${item.name} API key`}
                            >
                              <Key />
                              Set Key
                            </Button>
                          ))}

                        {item.providerId === "ollama" && !isEditing && (
                          <Button
                            type="button"
                            onClick={() => startEditing(item.providerId)}
                            variant="primary"
                            size="xs"
                            className="h-auto gap-1 px-1.5 text-[10px]"
                            aria-label="Set Ollama URL"
                          >
                            <Globe />
                            Set URL
                          </Button>
                        )}
                      </div>
                    </div>

                    <AnimatePresence initial={false}>
                      {isEditing && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="overflow-hidden"
                        >
                          <div className="mb-1 rounded-xl border border-border/70 bg-secondary-bg/55 p-1.5">
                            {item.providerId === "ollama" ? (
                              <>
                                <div className="flex items-center gap-1.5">
                                  <Globe className="ml-1 shrink-0 text-text-lighter" />
                                  <Input
                                    ref={apiKeyInputRef}
                                    type="text"
                                    value={ollamaUrlInput}
                                    onChange={(event) => {
                                      setOllamaUrlInput(event.target.value);
                                      setOllamaUrlStatus("idle");
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void handleSaveOllamaUrl(ollamaUrlInput);
                                      }
                                      if (event.key === "Escape") {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        cancelEditing();
                                      }
                                    }}
                                    placeholder="http://localhost:11434"
                                    spellCheck={false}
                                    variant="ghost"
                                    className="min-w-0 flex-1 py-2"
                                    disabled={ollamaUrlStatus === "checking"}
                                  />
                                  {ollamaUrlStatus === "ok" && (
                                    <CheckCircle className="shrink-0 text-green-500" />
                                  )}
                                  {ollamaUrlStatus === "error" && (
                                    <AlertCircle className="shrink-0 text-red-400" />
                                  )}
                                  <Button
                                    type="button"
                                    onClick={() => void handleSaveOllamaUrl(ollamaUrlInput)}
                                    disabled={ollamaUrlStatus === "checking"}
                                    variant="primary"
                                    size="xs"
                                    className="shrink-0 px-2"
                                  >
                                    {ollamaUrlStatus === "checking" ? "..." : "Save"}
                                  </Button>
                                  <Button
                                    type="button"
                                    onClick={cancelEditing}
                                    variant="ghost"
                                    size="icon-sm"
                                    className="mr-1 shrink-0 rounded-md text-text-lighter"
                                    aria-label="Cancel editing"
                                  >
                                    <X />
                                  </Button>
                                </div>

                                {ollamaUrlStatus === "error" && (
                                  <div className="flex items-center gap-1 px-2 pt-1 text-[10px] text-red-400">
                                    <span>Could not connect to Ollama at this URL</span>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="flex items-center gap-1.5">
                                  <Key className="ml-1 shrink-0 text-text-lighter" />
                                  <div className="relative min-w-0 flex-1">
                                    <Input
                                      ref={apiKeyInputRef}
                                      type={showKey ? "text" : "password"}
                                      value={apiKeyInput}
                                      onChange={(event) => setApiKeyInput(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" && apiKeyInput.trim()) {
                                          event.preventDefault();
                                          void handleSaveKey(item.providerId);
                                        }
                                        if (event.key === "Escape") {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          cancelEditing();
                                        }
                                      }}
                                      placeholder={`${item.name} API key...`}
                                      variant="ghost"
                                      className="w-full py-2 pr-6"
                                      disabled={isValidating}
                                    />
                                    <Button
                                      type="button"
                                      onClick={() => setShowKey((visible) => !visible)}
                                      variant="ghost"
                                      size="icon-xs"
                                      className="-translate-y-1/2 absolute top-1/2 right-0 size-5 p-0 text-text-lighter"
                                      aria-label={showKey ? "Hide key" : "Show key"}
                                    >
                                      {showKey ? <EyeOff /> : <Eye />}
                                    </Button>
                                  </div>

                                  {showingValidation &&
                                    (validationStatus.status === "valid" ? (
                                      <CheckCircle className="shrink-0 text-green-500" />
                                    ) : (
                                      <AlertCircle className="shrink-0 text-red-400" />
                                    ))}

                                  <Button
                                    type="button"
                                    onClick={() => void handleSaveKey(item.providerId)}
                                    disabled={!apiKeyInput.trim() || isValidating}
                                    variant="primary"
                                    size="xs"
                                    className="shrink-0 px-2"
                                  >
                                    {isValidating ? "..." : "Save"}
                                  </Button>
                                  <Button
                                    type="button"
                                    onClick={cancelEditing}
                                    variant="ghost"
                                    size="icon-sm"
                                    className="mr-1 shrink-0 rounded-md text-text-lighter"
                                    aria-label="Cancel editing"
                                  >
                                    <X />
                                  </Button>
                                </div>

                                {showingValidation && validationStatus.message && (
                                  <div
                                    className={cn(
                                      "flex items-center gap-1 px-2 pt-1 text-[10px]",
                                      validationStatus.status === "valid"
                                        ? "text-green-500"
                                        : "text-red-400",
                                    )}
                                  >
                                    <span>{validationStatus.message}</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              }

              selectableIndex += 1;
              const itemIndex = selectableIndex;
              const isHighlighted = itemIndex === selectedIndex;

              const isLocked = item.proOnly && !isPro;

              return (
                <Button
                  key={`${item.providerId}-${item.id}`}
                  type="button"
                  onClick={() => !isLocked && handleModelSelect(item.providerId, item.id)}
                  onMouseEnter={() => setSelectedIndex(itemIndex)}
                  variant="ghost"
                  size="sm"
                  disabled={isLocked}
                  className={cn(
                    "mb-1 h-auto w-full justify-start rounded-lg px-2.5 py-2 text-left text-xs last:mb-0",
                    isHighlighted ? "bg-hover" : "bg-transparent",
                    item.isCurrent && "bg-accent/10",
                    isLocked && "opacity-60",
                  )}
                >
                  {isLocked && <Lock className="shrink-0 text-text-lighter" />}
                  <span className="flex-1 truncate text-text">{item.name}</span>
                  {item.proOnly && <ProBadge />}
                  {item.isCurrent && <Check className="shrink-0 text-accent" />}
                </Button>
              );
            })
          )}
        </div>
      </MenuPopover>
    </div>
  );
}
