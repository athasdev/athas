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
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAIChatStore } from "@/features/ai/store/store";
import {
  getAvailableProviders,
  getModelById,
  getProviderById,
} from "@/features/ai/types/providers";
import { useSettingsStore } from "@/features/settings/store";
import { cn } from "@/utils/cn";
import { getProvider, setOllamaBaseUrl } from "@/utils/providers";

interface AIModelSelectorProps {
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
}

export function AIModelSelector({
  providerId,
  modelId,
  onProviderChange,
  onModelChange,
  disabled,
}: AIModelSelectorProps) {
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

  const { dynamicModels, setDynamicModels } = useAIChatStore();
  const hasProviderApiKey = useAIChatStore((state) => state.hasProviderApiKey);
  const saveApiKey = useAIChatStore((state) => state.saveApiKey);
  const removeApiKey = useAIChatStore((state) => state.removeApiKey);
  const { settings, updateSetting } = useSettingsStore();

  const [ollamaUrlInput, setOllamaUrlInput] = useState(
    settings.ollamaBaseUrl || "http://localhost:11434",
  );
  const [ollamaUrlStatus, setOllamaUrlStatus] = useState<"idle" | "checking" | "ok" | "error">(
    "idle",
  );

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
    const dynamic = dynamicModels[providerId]?.find((m) => m.id === modelId);
    if (dynamic) return dynamic.name;
    return currentModel?.name || modelId;
  }, [dynamicModels, providerId, modelId, currentModel]);

  const fetchDynamicModels = useCallback(async () => {
    const config = getProviderById(providerId);
    const instance = getProvider(providerId);

    setModelFetchError(null);

    if (instance?.getModels && !config?.requiresApiKey) {
      setIsLoadingModels(true);
      try {
        const models = await instance.getModels();
        if (models.length > 0) {
          setDynamicModels(providerId, models);
          if (!models.find((m) => m.id === modelId)) {
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
    }
  }, [providerId, modelId, onModelChange, setDynamicModels]);

  useEffect(() => {
    fetchDynamicModels();
  }, [providerId]);

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
          });
        }
      }
    }

    return items;
  }, [search, providers, dynamicModels, hasProviderApiKey, providerId, modelId]);

  const selectableItems = useMemo(
    () => filteredItems.filter((item) => item.type === "model"),
    [filteredItems],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedIndex(0);
      setEditingProvider(null);
      setApiKeyInput("");
      setShowKey(false);
      setValidationStatus({ providerId: null, status: null });
    }
  }, [isOpen]);

  useEffect(() => {
    if (editingProvider && apiKeyInputRef.current) {
      apiKeyInputRef.current.focus();
    }
  }, [editingProvider]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const updateDropdownPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const width = 360;
    const estimatedHeight = 480;
    const safeWidth = Math.min(width, window.innerWidth - viewportPadding * 2);
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openUp =
      availableBelow < Math.min(estimatedHeight, 280) && availableAbove > availableBelow;
    const maxHeight = Math.max(
      220,
      Math.min(estimatedHeight, openUp ? availableAbove - 6 : availableBelow - 6),
    );
    const measuredHeight = dropdownRef.current?.getBoundingClientRect().height ?? estimatedHeight;
    const visibleHeight = Math.min(maxHeight, measuredHeight);

    const desiredLeft = rect.left;
    const left = Math.max(
      viewportPadding,
      Math.min(desiredLeft, window.innerWidth - safeWidth - viewportPadding),
    );
    const top = openUp ? Math.max(viewportPadding, rect.top - visibleHeight - 6) : rect.bottom + 6;

    setPosition({ left, top, width: safeWidth, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
  }, [isOpen, updateDropdownPosition, search, filteredItems.length, editingProvider]);

  useEffect(() => {
    if (!isOpen) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (editingProvider) {
          setEditingProvider(null);
          setApiKeyInput("");
          setShowKey(false);
          setValidationStatus({ providerId: null, status: null });
        } else {
          setIsOpen(false);
        }
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
  }, [isOpen, updateDropdownPosition, editingProvider]);

  const handleModelSelect = useCallback(
    (selectedProviderId: string, selectedModelId: string) => {
      if (selectedProviderId !== providerId) {
        onProviderChange(selectedProviderId);
      }
      onModelChange(selectedModelId);
      setIsOpen(false);
    },
    [providerId, onProviderChange, onModelChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingProvider) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, selectableItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (selectableItems[selectedIndex]) {
            const item = selectableItems[selectedIndex];
            handleModelSelect(item.providerId, item.id);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [selectableItems, selectedIndex, handleModelSelect, editingProvider],
  );

  const startEditing = (targetProviderId: string) => {
    setEditingProvider(targetProviderId);
    setApiKeyInput("");
    setShowKey(false);
    setValidationStatus({ providerId: null, status: null });
  };

  const cancelEditing = () => {
    setEditingProvider(null);
    setApiKeyInput("");
    setShowKey(false);
    setValidationStatus({ providerId: null, status: null });
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
        setTimeout(() => cancelEditing(), 1000);
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
      setTimeout(() => {
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
    try {
      const response = await fetch(`${trimmed}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        setOllamaUrlStatus("ok");
        updateSetting("ollamaBaseUrl", trimmed);
        setOllamaBaseUrl(trimmed);
        setOllamaUrlInput(trimmed);
        fetchDynamicModels();
        setTimeout(() => cancelEditing(), 1000);
      } else {
        setOllamaUrlStatus("error");
      }
    } catch {
      setOllamaUrlStatus("error");
    }
  };

  let selectableIndex = -1;

  return (
    <div>
      <button
        ref={triggerRef}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex items-center gap-2 rounded-lg border border-border bg-secondary-bg px-3 py-1.5 text-xs transition-colors hover:bg-hover disabled:opacity-50"
        aria-label="Select AI provider and model"
      >
        <ProviderIcon providerId={providerId} size={14} className="text-text-lighter" />
        <span className="text-text">
          {currentProvider?.name || providerId}
          <span className="text-text-lighter"> / </span>
          {currentModelName}
        </span>
        <ChevronDown
          size={12}
          className={cn("text-text-lighter transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen &&
        createPortal(
          <AnimatePresence>
            {position && (
              <motion.div
                ref={dropdownRef}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="fixed z-[10030] flex flex-col overflow-hidden rounded-2xl border border-border bg-primary-bg/95 shadow-xl backdrop-blur-sm"
                style={{
                  left: `${position.left}px`,
                  top: `${position.top}px`,
                  width: `${position.width}px`,
                  maxHeight: `${position.maxHeight}px`,
                }}
              >
                {/* Header */}
                <div className="flex items-center justify-between border-border/70 border-b bg-secondary-bg/75 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <ProviderIcon
                      providerId={providerId}
                      size={14}
                      className="shrink-0 text-text-lighter"
                    />
                    <span className="truncate font-medium text-text text-xs">
                      {currentProvider?.name} / {currentModelName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {supportsDynamicModels && (
                      <button
                        onClick={() => fetchDynamicModels()}
                        disabled={isLoadingModels}
                        className="rounded-md p-1 text-text-lighter hover:bg-hover hover:text-text"
                        aria-label="Refresh models"
                      >
                        <RefreshCw size={12} className={cn(isLoadingModels && "animate-spin")} />
                      </button>
                    )}
                    <button
                      onClick={() => setIsOpen(false)}
                      className="rounded-md p-1 text-text-lighter hover:bg-hover hover:text-text"
                      aria-label="Close model selector"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>

                {/* Search */}
                <div className="relative border-border/60 border-b">
                  <Search
                    size={12}
                    className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 text-text-lighter"
                  />
                  <input
                    ref={inputRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search providers and models..."
                    className="w-full bg-transparent py-2.5 pr-3 pl-8 text-text text-xs placeholder:text-text-lighter focus:outline-none"
                  />
                </div>

                {/* Model list */}
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {modelFetchError && (
                    <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-2 text-red-400 text-xs">
                      <AlertCircle size={12} className="shrink-0" />
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
                          validationStatus.providerId === item.providerId &&
                          validationStatus.status;

                        return (
                          <div key={item.id}>
                            <div className="flex items-center justify-between px-1 pt-2.5 pb-1.5">
                              <span className="flex items-center gap-2 font-medium text-text-lighter text-xs uppercase tracking-wide">
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
                                      <button
                                        onClick={() => startEditing(item.providerId)}
                                        className="rounded px-1.5 py-0.5 text-[10px] text-text-lighter transition-colors hover:bg-hover hover:text-text"
                                        aria-label={`Edit ${item.name} API key`}
                                      >
                                        Edit Key
                                      </button>
                                      <button
                                        onClick={() => handleRemoveKey(item.providerId)}
                                        className="rounded p-0.5 text-red-400 transition-colors hover:bg-red-500/10"
                                        aria-label={`Remove ${item.name} API key`}
                                      >
                                        <Trash2 size={10} />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => startEditing(item.providerId)}
                                      className="flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent transition-colors hover:bg-accent/25"
                                      aria-label={`Set ${item.name} API key`}
                                    >
                                      <Key size={8} />
                                      Set Key
                                    </button>
                                  ))}
                                {item.providerId === "ollama" && !isEditing && (
                                  <button
                                    onClick={() => startEditing(item.providerId)}
                                    className="flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent transition-colors hover:bg-accent/25"
                                    aria-label="Set Ollama URL"
                                  >
                                    <Globe size={8} />
                                    Set URL
                                  </button>
                                )}
                              </div>
                            </div>

                            <AnimatePresence>
                              {isEditing && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.15, ease: "easeOut" }}
                                  className="overflow-hidden"
                                >
                                  <div className="px-1 pb-1.5">
                                    <div className="rounded-lg border border-border bg-secondary-bg/50 p-2">
                                      {item.providerId === "ollama" ? (
                                        <>
                                          <div className="flex items-center gap-1.5">
                                            <input
                                              ref={apiKeyInputRef}
                                              type="text"
                                              value={ollamaUrlInput}
                                              onChange={(e) => {
                                                setOllamaUrlInput(e.target.value);
                                                setOllamaUrlStatus("idle");
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  handleSaveOllamaUrl(ollamaUrlInput);
                                                }
                                                if (e.key === "Escape") {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  cancelEditing();
                                                }
                                              }}
                                              placeholder="http://localhost:11434"
                                              spellCheck={false}
                                              className={cn(
                                                "w-full flex-1 rounded border bg-secondary-bg px-2 py-1 text-text text-xs",
                                                "focus:border-accent focus:outline-none",
                                                ollamaUrlStatus === "error"
                                                  ? "border-red-500"
                                                  : "border-border",
                                              )}
                                              disabled={ollamaUrlStatus === "checking"}
                                            />
                                            <button
                                              onClick={() => handleSaveOllamaUrl(ollamaUrlInput)}
                                              disabled={ollamaUrlStatus === "checking"}
                                              className="rounded bg-accent px-2 py-1 text-[10px] text-white transition-colors hover:opacity-90 disabled:opacity-50"
                                            >
                                              {ollamaUrlStatus === "checking" ? "..." : "Save"}
                                            </button>
                                            <button
                                              onClick={cancelEditing}
                                              className="rounded p-1 text-text-lighter hover:bg-hover hover:text-text"
                                              aria-label="Cancel editing"
                                            >
                                              <X size={10} />
                                            </button>
                                          </div>
                                          {ollamaUrlStatus === "ok" && (
                                            <motion.div
                                              initial={{ opacity: 0 }}
                                              animate={{ opacity: 1 }}
                                              className="mt-1.5 flex items-center gap-1 text-[10px] text-green-500"
                                            >
                                              <CheckCircle size={9} />
                                              <span>Connected</span>
                                            </motion.div>
                                          )}
                                          {ollamaUrlStatus === "error" && (
                                            <motion.div
                                              initial={{ opacity: 0 }}
                                              animate={{ opacity: 1 }}
                                              className="mt-1.5 flex items-center gap-1 text-[10px] text-red-400"
                                            >
                                              <AlertCircle size={9} />
                                              <span>Could not connect to Ollama at this URL</span>
                                            </motion.div>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          <div className="flex items-center gap-1.5">
                                            <div className="relative flex-1">
                                              <input
                                                ref={apiKeyInputRef}
                                                type={showKey ? "text" : "password"}
                                                value={apiKeyInput}
                                                onChange={(e) => setApiKeyInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter" && apiKeyInput.trim()) {
                                                    e.preventDefault();
                                                    handleSaveKey(item.providerId);
                                                  }
                                                  if (e.key === "Escape") {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    cancelEditing();
                                                  }
                                                }}
                                                placeholder={`${item.name} API key...`}
                                                className={cn(
                                                  "w-full rounded border bg-secondary-bg px-2 py-1 pr-6 text-text text-xs",
                                                  "focus:border-accent focus:outline-none",
                                                  showingValidation &&
                                                    validationStatus.status === "invalid"
                                                    ? "border-red-500"
                                                    : "border-border",
                                                )}
                                                disabled={isValidating}
                                              />
                                              <button
                                                type="button"
                                                onClick={() => setShowKey(!showKey)}
                                                className="-translate-y-1/2 absolute top-1/2 right-1.5 text-text-lighter hover:text-text"
                                                aria-label={showKey ? "Hide key" : "Show key"}
                                              >
                                                {showKey ? <EyeOff size={10} /> : <Eye size={10} />}
                                              </button>
                                            </div>
                                            <button
                                              onClick={() => handleSaveKey(item.providerId)}
                                              disabled={!apiKeyInput.trim() || isValidating}
                                              className="rounded bg-accent px-2 py-1 text-[10px] text-white transition-colors hover:opacity-90 disabled:opacity-50"
                                            >
                                              {isValidating ? "..." : "Save"}
                                            </button>
                                            <button
                                              onClick={cancelEditing}
                                              className="rounded p-1 text-text-lighter hover:bg-hover hover:text-text"
                                              aria-label="Cancel editing"
                                            >
                                              <X size={10} />
                                            </button>
                                          </div>
                                          {showingValidation && (
                                            <motion.div
                                              initial={{ opacity: 0 }}
                                              animate={{ opacity: 1 }}
                                              className={cn(
                                                "mt-1.5 flex items-center gap-1 text-[10px]",
                                                validationStatus.status === "valid"
                                                  ? "text-green-500"
                                                  : "text-red-400",
                                              )}
                                            >
                                              {validationStatus.status === "valid" ? (
                                                <CheckCircle size={9} />
                                              ) : (
                                                <AlertCircle size={9} />
                                              )}
                                              <span>{validationStatus.message}</span>
                                            </motion.div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      }

                      selectableIndex++;
                      const itemIndex = selectableIndex;
                      const isHighlighted = itemIndex === selectedIndex;

                      return (
                        <button
                          key={`${item.providerId}-${item.id}`}
                          onClick={() => handleModelSelect(item.providerId, item.id)}
                          onMouseEnter={() => setSelectedIndex(itemIndex)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                            isHighlighted ? "bg-hover" : "bg-transparent",
                            item.isCurrent && "bg-accent/10",
                          )}
                        >
                          <span className="flex-1 truncate text-text">{item.name}</span>
                          {item.isCurrent && <Check size={12} className="shrink-0 text-accent" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
