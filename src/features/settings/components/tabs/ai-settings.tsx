import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  Check,
  CheckCircle,
  Eye,
  EyeOff,
  Key,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AgentConfig, SessionMode } from "@/features/ai/types/acp";
import { getAvailableProviders, updateAgentStatus } from "@/features/ai/types/providers";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/store";
import Button from "@/ui/button";
import Dropdown from "@/ui/dropdown";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";
import { fetchAutocompleteModels } from "@/utils/autocomplete";
import { cn } from "@/utils/cn";
import { getProvider } from "@/utils/providers";

const DEFAULT_AUTOCOMPLETE_MODEL_ID = "openai/gpt-5-nano";

const DEFAULT_AUTOCOMPLETE_MODELS = [
  { id: "openai/gpt-5-nano", name: "GPT-5 Nano" },
  { id: "openai/gpt-5-mini", name: "GPT-5 Mini" },
  { id: "openai/gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
  { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
];

function resolveAutocompleteDefaultModelId(models: Array<{ id: string; name: string }>): string {
  if (models.some((model) => model.id === DEFAULT_AUTOCOMPLETE_MODEL_ID)) {
    return DEFAULT_AUTOCOMPLETE_MODEL_ID;
  }
  return models[0]?.id || DEFAULT_AUTOCOMPLETE_MODEL_ID;
}

export const AISettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const { showToast } = useToast();

  // State for available session modes
  const [availableModes, setAvailableModes] = useState<SessionMode[]>([]);
  const [isClearingChats, setIsClearingChats] = useState(false);
  const [autocompleteModels, setAutocompleteModels] = useState(DEFAULT_AUTOCOMPLETE_MODELS);
  const [isLoadingAutocompleteModels, setIsLoadingAutocompleteModels] = useState(false);
  const [autocompleteModelError, setAutocompleteModelError] = useState<string | null>(null);

  // Detect installed agents on mount
  useEffect(() => {
    const detectAgents = async () => {
      try {
        const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
        updateAgentStatus(availableAgents.map((a) => ({ id: a.id, installed: a.installed })));
      } catch {
        // Failed to detect agents, leave as not installed
      }
    };
    detectAgents();
  }, []);

  // Get available session modes from AI chat store
  useEffect(() => {
    const unsubscribe = useAIChatStore.subscribe((state) => {
      setAvailableModes(state.sessionModeState.availableModes);
    });
    // Initialize with current value
    setAvailableModes(useAIChatStore.getState().sessionModeState.availableModes);
    return unsubscribe;
  }, []);

  // State for inline API key editing
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<{
    providerId: string | null;
    status: "valid" | "invalid" | null;
    message?: string;
  }>({ providerId: null, status: null });

  // Dynamic models state
  const { dynamicModels, setDynamicModels } = useAIChatStore();
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  // API Key functions from AI chat store
  const saveApiKey = useAIChatStore((state) => state.saveApiKey);
  const removeApiKey = useAIChatStore((state) => state.removeApiKey);
  const hasProviderApiKey = useAIChatStore((state) => state.hasProviderApiKey);
  const checkAllProviderApiKeys = useAIChatStore((state) => state.checkAllProviderApiKeys);

  // Check all provider API keys on mount
  useEffect(() => {
    checkAllProviderApiKeys();
  }, [checkAllProviderApiKeys]);

  const providers = getAvailableProviders();
  const currentProvider = providers.find((p) => p.id === settings.aiProviderId);

  // Fetch dynamic models if provider supports it
  const fetchDynamicModels = async () => {
    const providerInstance = getProvider(settings.aiProviderId);
    const providerConfig = providers.find((p) => p.id === settings.aiProviderId);

    // Always clear error when fetching/switching
    setModelFetchError(null);

    // Only fetch dynamic models if provider supports it AND does not require an API key (unless explicitly allowed)
    // This enforces static lists for cloud providers like OpenAI as requested
    if (providerInstance?.getModels && !providerConfig?.requiresApiKey) {
      setIsLoadingModels(true);
      try {
        const models = await providerInstance.getModels();
        if (models.length > 0) {
          setDynamicModels(settings.aiProviderId, models);
          // If current model is not in the list, select the first one
          if (!models.find((m) => m.id === settings.aiModelId)) {
            updateSetting("aiModelId", models[0].id);
          }
        } else {
          setDynamicModels(settings.aiProviderId, []);
          const errorMessage =
            settings.aiProviderId === "ollama"
              ? "No models detected. Please install a model in Ollama."
              : "No models found.";
          setModelFetchError(errorMessage);
        }
      } catch (error) {
        console.error("Failed to fetch models:", error);
        setModelFetchError("Failed to fetch models");
      } finally {
        setIsLoadingModels(false);
      }
    }
  };

  useEffect(() => {
    fetchDynamicModels();
  }, [settings.aiProviderId, updateSetting, setDynamicModels]);

  const loadAutocompleteModels = async () => {
    setIsLoadingAutocompleteModels(true);
    setAutocompleteModelError(null);
    try {
      const models = await fetchAutocompleteModels();
      if (models.length > 0) {
        setAutocompleteModels(models);
        if (!models.some((model) => model.id === settings.aiAutocompleteModelId)) {
          updateSetting("aiAutocompleteModelId", resolveAutocompleteDefaultModelId(models));
        }
      } else {
        setAutocompleteModels(DEFAULT_AUTOCOMPLETE_MODELS);
      }
    } catch (error) {
      console.error("Failed to fetch autocomplete models:", error);
      setAutocompleteModels(DEFAULT_AUTOCOMPLETE_MODELS);
      setAutocompleteModelError("Could not load model list. Showing defaults.");
    } finally {
      setIsLoadingAutocompleteModels(false);
    }
  };

  useEffect(() => {
    void loadAutocompleteModels();
  }, []);

  const providerOptions = getAvailableProviders().map((provider) => ({
    value: provider.id,
    label: provider.name,
  }));

  const handleProviderChange = (providerId: string) => {
    const provider = getAvailableProviders().find((p) => p.id === providerId);
    if (provider) {
      updateSetting("aiProviderId", providerId);
      // Reset model ID, it will be updated by fetchDynamicModels or default logic
      if (provider.models.length > 0) {
        updateSetting("aiModelId", provider.models[0].id);
      }
    }
  };
  const startEditing = (providerId: string) => {
    setEditingProvider(providerId);
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

  const handleSaveKey = async (providerId: string) => {
    if (!apiKeyInput.trim()) {
      setValidationStatus({
        providerId,
        status: "invalid",
        message: "Please enter an API key",
      });
      return;
    }

    setIsValidating(true);
    setValidationStatus({ providerId: null, status: null });

    try {
      const isValid = await saveApiKey(providerId, apiKeyInput);

      if (isValid) {
        setValidationStatus({
          providerId,
          status: "valid",
          message: "API key saved successfully",
        });
        setTimeout(() => {
          cancelEditing();
        }, 1500);
      } else {
        setValidationStatus({
          providerId,
          status: "invalid",
          message: "Invalid API key. Please check and try again.",
        });
      }
    } catch {
      setValidationStatus({
        providerId,
        status: "invalid",
        message: "Failed to validate API key",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveKey = async (providerId: string) => {
    try {
      await removeApiKey(providerId);
      setValidationStatus({
        providerId,
        status: "valid",
        message: "API key removed",
      });
      setTimeout(() => {
        setValidationStatus({ providerId: null, status: null });
      }, 2000);
    } catch {
      setValidationStatus({
        providerId,
        status: "invalid",
        message: "Failed to remove API key",
      });
    }
  };

  const renderApiKeyInput = (providerId: string, providerName: string) => {
    const isEditing = editingProvider === providerId;
    const hasKey = hasProviderApiKey(providerId);
    const showingValidation = validationStatus.providerId === providerId && validationStatus.status;

    if (!isEditing && !hasKey && !showingValidation) {
      return (
        <Button
          variant="outline"
          size="xs"
          onClick={() => startEditing(providerId)}
          className="gap-1.5"
        >
          <Key size={12} />
          Set API Key
        </Button>
      );
    }

    if (!isEditing && hasKey) {
      return (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-green-500 text-xs">
            <Check size={12} />
            <span>Configured</span>
          </div>
          <Button variant="ghost" size="xs" onClick={() => startEditing(providerId)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => handleRemoveKey(providerId)}
            className="text-red-500 hover:bg-red-500/10"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      );
    }

    return (
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={`Enter ${providerName} API key...`}
              className={cn(
                "ui-font w-full rounded border bg-secondary-bg px-2 py-1.5 pr-8 text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
                showingValidation && validationStatus.status === "invalid"
                  ? "border-red-500"
                  : "border-border",
              )}
              disabled={isValidating}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="-translate-y-1/2 absolute top-1/2 right-2 text-text-lighter transition-colors hover:text-text"
            >
              {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <Button
            variant="default"
            size="xs"
            onClick={() => handleSaveKey(providerId)}
            disabled={!apiKeyInput.trim() || isValidating}
          >
            {isValidating ? "Saving..." : "Save"}
          </Button>
          <Button variant="ghost" size="xs" onClick={cancelEditing}>
            <X size={12} />
          </Button>
        </div>

        {showingValidation && (
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              validationStatus.status === "valid" ? "text-green-500" : "text-red-500",
            )}
          >
            {validationStatus.status === "valid" ? (
              <CheckCircle size={12} />
            ) : (
              <AlertCircle size={12} />
            )}
            <span>{validationStatus.message}</span>
          </div>
        )}
      </div>
    );
  };

  // Get all providers that require API keys
  const providersNeedingKeys = getAvailableProviders().filter((p) => p.requiresApiKey);

  // Get all providers that require authentication (but not API keys)
  const providersNeedingAuth = getAvailableProviders().filter(
    (p) => p.requiresAuth && !p.requiresApiKey,
  );

  const providerInstance = getProvider(settings.aiProviderId);
  const supportsDynamicModels = !!providerInstance?.getModels;

  return (
    <div className="space-y-4">
      <Section title="Provider & Model">
        <SettingRow label="Provider" description="Choose your AI service provider">
          <Dropdown
            value={settings.aiProviderId}
            options={providerOptions}
            onChange={handleProviderChange}
            size="xs"
            searchable={true}
          />
        </SettingRow>

        <SettingRow label="Model" description="Select the AI model to use">
          <div className="flex items-center gap-2">
            <Dropdown
              value={settings.aiModelId}
              options={(dynamicModels[settings.aiProviderId] || currentProvider?.models || []).map(
                (model: { id: string; name: string }) => ({
                  value: model.id,
                  label: model.name,
                }),
              )}
              onChange={(value) => updateSetting("aiModelId", value)}
              size="xs"
              searchable={true}
              className="w-56"
            />
            {supportsDynamicModels && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => fetchDynamicModels()}
                disabled={isLoadingModels}
                title="Refresh models"
              >
                <RefreshCw size={14} className={cn(isLoadingModels && "animate-spin")} />
              </Button>
            )}
          </div>
          {modelFetchError && (
            <div className="mt-1 flex items-center gap-1.5 text-red-500 text-xs">
              <AlertCircle size={12} />
              <span>{modelFetchError}</span>
            </div>
          )}
        </SettingRow>
      </Section>

      {providersNeedingKeys.length > 0 && (
        <Section title="API Keys">
          {providersNeedingKeys.map((provider) => (
            <SettingRow key={provider.id} label={provider.name}>
              {renderApiKeyInput(provider.id, provider.name)}
            </SettingRow>
          ))}
        </Section>
      )}

      {providersNeedingAuth.length > 0 && (
        <Section title="Authentication">
          {providersNeedingAuth.map((provider) => (
            <SettingRow
              key={provider.id}
              label={provider.name}
              description="Requires OAuth authentication"
            >
              <div className="flex items-center gap-2 rounded border border-border bg-secondary-bg px-3 py-1.5">
                <span className="text-text-lighter text-xs">Coming Soon</span>
              </div>
            </SettingRow>
          ))}
        </Section>
      )}

      {availableModes.length > 0 && (
        <Section title="Agent Defaults">
          <SettingRow
            label="Default Session Mode"
            description="Default mode for ACP agent sessions"
          >
            <Dropdown
              value={settings.aiDefaultSessionMode || ""}
              options={[
                { value: "", label: "None" },
                ...availableModes.map((mode) => ({
                  value: mode.id,
                  label: mode.name,
                })),
              ]}
              onChange={(value) => updateSetting("aiDefaultSessionMode", value)}
              size="xs"
            />
          </SettingRow>
        </Section>
      )}

      <Section title="Autocomplete">
        <SettingRow label="AI Completion" description="Enable AI autocomplete while typing">
          <Switch
            checked={settings.aiCompletion}
            onChange={(checked) => updateSetting("aiCompletion", checked)}
            size="sm"
          />
        </SettingRow>
        <SettingRow
          label="Autocomplete Model"
          description="Choose any OpenRouter model for autocomplete"
        >
          <div className="flex items-center gap-2">
            <Dropdown
              value={settings.aiAutocompleteModelId}
              options={autocompleteModels.map((model) => ({
                value: model.id,
                label: model.name,
              }))}
              onChange={(value) => updateSetting("aiAutocompleteModelId", value)}
              size="xs"
              searchable={true}
              className="w-56"
            />
            <Button
              variant="ghost"
              size="xs"
              onClick={loadAutocompleteModels}
              disabled={isLoadingAutocompleteModels}
              title="Refresh model list"
            >
              <RefreshCw size={14} className={cn(isLoadingAutocompleteModels && "animate-spin")} />
            </Button>
          </div>
        </SettingRow>
        {autocompleteModelError && (
          <div className="mt-1 flex items-center gap-1.5 px-1 text-red-500 text-xs">
            <AlertCircle size={12} />
            <span>{autocompleteModelError}</span>
          </div>
        )}
        <div className="px-1 text-text-lighter text-xs">
          Pro uses Athas-hosted autocomplete credit. Free can use BYOK by setting an OpenRouter API
          key in the API Keys section.
        </div>
      </Section>

      <Section title="Chat History">
        <SettingRow label="Clear All Chats" description="Permanently delete all chat history">
          <Button
            variant="outline"
            size="xs"
            onClick={async () => {
              if (
                window.confirm(
                  "Are you sure you want to delete all chat history? This action cannot be undone.",
                )
              ) {
                setIsClearingChats(true);
                try {
                  await useAIChatStore.getState().clearAllChats();
                  showToast({ message: "All chats cleared", type: "success" });
                } finally {
                  setIsClearingChats(false);
                }
              }
            }}
            disabled={isClearingChats}
            className="gap-1.5 text-red-500 hover:bg-red-500/10"
          >
            <Trash2 size={12} />
            {isClearingChats ? "Clearing..." : "Clear All"}
          </Button>
        </SettingRow>
      </Section>
    </div>
  );
};
