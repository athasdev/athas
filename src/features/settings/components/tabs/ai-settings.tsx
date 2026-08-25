import { invoke } from "@tauri-apps/api/core";
import {
  WarningCircleIcon as AlertCircle,
  CheckCircleIcon as CheckCircle,
  CloudIcon as Cloud,
  ArrowSquareOutIcon as ExternalLink,
  GlobeHemisphereWestIcon as Globe,
  KeyIcon as Key,
  LaptopIcon as Laptop,
  PaletteIcon as Palette,
  SparkleIcon as Sparkles,
  ArrowClockwiseIcon as RefreshCw,
  ArrowCounterClockwiseIcon as RotateCcw,
  TrashIcon as Trash2,
} from "@/ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ProviderApiKeyCommand } from "@/features/ai/components/provider-api-key-command";
import { ModelSelector } from "@/features/ai/components/selectors/model-selector";
import { ProviderSelector } from "@/features/ai/components/selectors/provider-selector";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import { useAIProviderSettingsActions } from "@/features/ai/services/providers/ai-provider-settings-registry";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentConfig, SessionConfigOption } from "@/features/ai/types/acp.types";
import { useToast } from "@/features/layout/contexts/toast-context";
import { TypedConfirmAction } from "@/features/settings/components/typed-confirm-action";
import { Spinner } from "@/ui/spinner";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Section, { SETTINGS_CONTROL_WIDTHS, SettingsView, SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { ToggleGroup } from "@/ui/toggle-group";
import { fetchAutocompleteModels } from "@/features/editor/services/editor-autocomplete-service";
import {
  CUSTOM_AUTOCOMPLETE_PROVIDER_ID,
  CUSTOM_CHAT_PROVIDER_ID,
} from "@/features/ai/lib/custom-provider-config";
import { cn } from "@/utils/cn";
import {
  setCustomProviderBaseUrl,
  setOllamaApiKey,
  setOllamaBaseUrl,
} from "@/features/ai/services/providers/ai-provider-registry";
import {
  DEFAULT_OLLAMA_BASE_URL,
  OLLAMA_CLOUD_BASE_URL,
  checkOllamaConnection,
  isOllamaCloudUrl,
} from "@/features/ai/services/providers/ollama-provider";
import { resolveOllamaBaseUrl } from "@/features/ai/lib/ollama-endpoint";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
} from "@/features/ai/services/ai-token-service";
import { CodexSettings } from "@/features/ai/integrations/codex/codex-settings";
import { requestAgentNativeNotificationPermission } from "@/features/ai/services/agent-native-notifications";
const DEFAULT_AUTOCOMPLETE_MODEL_ID = "mistralai/devstral-small";

function resolveAutocompleteDefaultModelId(models: Array<{ id: string; name: string }>): string {
  if (models.some((model) => model.id === DEFAULT_AUTOCOMPLETE_MODEL_ID)) {
    return DEFAULT_AUTOCOMPLETE_MODEL_ID;
  }
  return models[0]?.id || DEFAULT_AUTOCOMPLETE_MODEL_ID;
}

export const AISettings = () => {
  const settings = useSettingsStore(
    useShallow((state) => ({
      aiAutocompleteCustomBaseUrl: state.settings.aiAutocompleteCustomBaseUrl,
      aiAutocompleteCustomModelId: state.settings.aiAutocompleteCustomModelId,
      aiAutocompleteModelId: state.settings.aiAutocompleteModelId,
      aiAutocompleteProvider: state.settings.aiAutocompleteProvider,
      aiCompletion: state.settings.aiCompletion,
      aiCustomBaseUrl: state.settings.aiCustomBaseUrl,
      aiCustomModelId: state.settings.aiCustomModelId,
      aiAgentNotifications: state.settings.aiAgentNotifications,
      aiModelId: state.settings.aiModelId,
      aiProviderId: state.settings.aiProviderId,
      ollamaBaseUrl: state.settings.ollamaBaseUrl,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const openCommandPaletteView = useUIState((state) => state.openCommandPaletteView);
  const subscription = useAuthStore((state) => state.subscription);
  const { showToast } = useToast();
  const enterprisePolicy = subscription?.enterprise?.policy;
  const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
  const aiCompletionAllowedByPolicy = managedPolicy ? managedPolicy.aiCompletionEnabled : true;
  const byokAllowedByPolicy = managedPolicy ? managedPolicy.allowByok : true;

  const [sessionConfigOptions, setSessionConfigOptions] = useState<SessionConfigOption[]>([]);
  const [isClearingChats, setIsClearingChats] = useState(false);
  const [autocompleteModels, setAutocompleteModels] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [isLoadingAutocompleteModels, setIsLoadingAutocompleteModels] = useState(false);
  const [autocompleteModelError, setAutocompleteModelError] = useState<string | null>(null);
  const [customAutocompleteModelInput, setCustomAutocompleteModelInput] = useState(
    settings.aiAutocompleteCustomModelId,
  );
  const [customAutocompleteBaseUrlInput, setCustomAutocompleteBaseUrlInput] = useState(
    settings.aiAutocompleteCustomBaseUrl,
  );
  const [customAutocompleteApiKeyInput, setCustomAutocompleteApiKeyInput] = useState("");
  const [hasCustomAutocompleteApiKey, setHasCustomAutocompleteApiKey] = useState(false);
  const [isSavingCustomAutocompleteApiKey, setIsSavingCustomAutocompleteApiKey] = useState(false);
  const [customChatBaseUrlInput, setCustomChatBaseUrlInput] = useState(settings.aiCustomBaseUrl);
  const [customChatApiKeyInput, setCustomChatApiKeyInput] = useState("");
  const [hasCustomChatApiKey, setHasCustomChatApiKey] = useState(false);
  const [isSavingCustomChatApiKey, setIsSavingCustomChatApiKey] = useState(false);
  const [isApiKeyManagerOpen, setIsApiKeyManagerOpen] = useState(false);
  const [isUpdatingAgentNotifications, setIsUpdatingAgentNotifications] = useState(false);

  // Ollama URL state
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL);
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const ollamaDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ollamaDraftDirtyRef = useRef(false);
  const ollamaValidationIdRef = useRef(0);
  const lastSelfHostedOllamaUrlRef = useRef(
    isOllamaCloudUrl(settings.ollamaBaseUrl)
      ? DEFAULT_OLLAMA_BASE_URL
      : resolveOllamaBaseUrl(settings.ollamaBaseUrl) || DEFAULT_OLLAMA_BASE_URL,
  );

  // Ollama API key state (used for Ollama Cloud; optional for local)
  const [ollamaApiKeyInput, setOllamaApiKeyInput] = useState("");
  const [hasStoredOllamaKey, setHasStoredOllamaKey] = useState(false);
  const [isSavingOllamaKey, setIsSavingOllamaKey] = useState(false);

  const isOllamaCloud = isOllamaCloudUrl(ollamaUrl);
  const needsApiKey = isOllamaCloud;
  const providers = useAvailableProviders();
  const providerSettingsActions = useAIProviderSettingsActions(settings.aiProviderId);

  useEffect(() => {
    const detectAgents = async () => {
      try {
        await invoke<AgentConfig[]>("get_available_agents");
      } catch {
        // Failed to detect agents
      }
    };
    detectAgents();
  }, []);

  useEffect(() => {
    const unsubscribe = useAIChatStore.subscribe((state) => {
      setSessionConfigOptions(state.sessionConfigOptions);
    });
    setSessionConfigOptions(useAIChatStore.getState().sessionConfigOptions);
    return unsubscribe;
  }, []);

  // Keep the draft aligned with settings loaded after the dialog mounted.
  useEffect(() => {
    const url = resolveOllamaBaseUrl(settings.ollamaBaseUrl) || DEFAULT_OLLAMA_BASE_URL;
    setOllamaBaseUrl(url);

    if (!isOllamaCloudUrl(url)) {
      lastSelfHostedOllamaUrlRef.current = url;
    }

    if (!ollamaDraftDirtyRef.current) {
      if (ollamaDebounceRef.current) clearTimeout(ollamaDebounceRef.current);
      setOllamaUrl(url);
    }
  }, [settings.ollamaBaseUrl]);

  useEffect(() => {
    void (async () => {
      const token = await getProviderApiToken("ollama");
      setHasStoredOllamaKey(!!token);
      setOllamaApiKey(token);
    })();
  }, []);

  useEffect(
    () => () => {
      if (ollamaDebounceRef.current) clearTimeout(ollamaDebounceRef.current);
      ollamaValidationIdRef.current += 1;
    },
    [],
  );

  const validateOllamaConnection = useCallback(
    async (url: string, apiKey?: string | null) => {
      const normalizedUrl = resolveOllamaBaseUrl(url);
      const validationId = ++ollamaValidationIdRef.current;
      if (!normalizedUrl) {
        setOllamaStatus("error");
        return;
      }

      setOllamaStatus("checking");
      const keyToUse =
        apiKey !== undefined
          ? apiKey
          : hasStoredOllamaKey
            ? await getProviderApiToken("ollama")
            : null;
      const ok = await checkOllamaConnection(normalizedUrl, keyToUse);
      if (validationId === ollamaValidationIdRef.current) {
        setOllamaStatus(ok ? "ok" : "error");
      }
    },
    [hasStoredOllamaKey],
  );

  const commitOllamaUrl = useCallback(
    (value: string) => {
      if (ollamaDebounceRef.current) {
        clearTimeout(ollamaDebounceRef.current);
        ollamaDebounceRef.current = undefined;
      }

      const normalizedUrl = resolveOllamaBaseUrl(value);
      if (!normalizedUrl) {
        setOllamaStatus("error");
        return;
      }

      ollamaDraftDirtyRef.current = false;
      setOllamaUrl(normalizedUrl);
      void updateSetting("ollamaBaseUrl", normalizedUrl);
      setOllamaBaseUrl(normalizedUrl);
      if (!isOllamaCloudUrl(normalizedUrl)) {
        lastSelfHostedOllamaUrlRef.current = normalizedUrl;
      }
      void validateOllamaConnection(normalizedUrl);
    },
    [updateSetting, validateOllamaConnection],
  );

  const handleOllamaUrlChange = (value: string) => {
    ollamaDraftDirtyRef.current = true;
    setOllamaUrl(value);
    setOllamaStatus("idle");

    if (ollamaDebounceRef.current) clearTimeout(ollamaDebounceRef.current);
    ollamaDebounceRef.current = setTimeout(() => {
      ollamaDebounceRef.current = undefined;
      void commitOllamaUrl(value);
    }, 600);
  };

  const handleResetOllamaUrl = () => {
    lastSelfHostedOllamaUrlRef.current = DEFAULT_OLLAMA_BASE_URL;
    commitOllamaUrl(DEFAULT_OLLAMA_BASE_URL);
  };

  const handleUseSelfHostedOllama = () => {
    commitOllamaUrl(lastSelfHostedOllamaUrlRef.current);
  };

  const handleUseOllamaCloud = () => {
    const currentUrl = resolveOllamaBaseUrl(ollamaUrl);
    if (currentUrl && !isOllamaCloudUrl(currentUrl)) {
      lastSelfHostedOllamaUrlRef.current = currentUrl;
    }
    commitOllamaUrl(OLLAMA_CLOUD_BASE_URL);
  };

  const handleSaveOllamaApiKey = async () => {
    const trimmed = ollamaApiKeyInput.trim();
    if (!trimmed) return;
    setIsSavingOllamaKey(true);
    try {
      await storeProviderApiToken("ollama", trimmed);
      setOllamaApiKey(trimmed);
      setHasStoredOllamaKey(true);
      setOllamaApiKeyInput("");
      showToast({ message: "Ollama API key saved", type: "success" });
      void validateOllamaConnection(ollamaUrl, trimmed);
    } catch {
      showToast({ message: "Failed to save Ollama API key", type: "error" });
    } finally {
      setIsSavingOllamaKey(false);
    }
  };

  const handleRemoveOllamaApiKey = async () => {
    try {
      await removeProviderApiToken("ollama");
      setOllamaApiKey(null);
      setHasStoredOllamaKey(false);
      setOllamaApiKeyInput("");
      showToast({ message: "Ollama API key removed", type: "success" });
      void validateOllamaConnection(ollamaUrl, null);
    } catch {
      showToast({ message: "Failed to remove Ollama API key", type: "error" });
    }
  };

  const handleProviderChange = (newProviderId: string) => {
    const provider = providers.find((p) => p.id === newProviderId);
    updateSetting("aiProviderId", newProviderId);
    if (newProviderId === CUSTOM_CHAT_PROVIDER_ID) {
      updateSetting("aiModelId", settings.aiCustomModelId || settings.aiAutocompleteCustomModelId);
      return;
    }
    if (provider && provider.models.length > 0) {
      updateSetting("aiModelId", provider.models[0].id);
    }
  };

  const loadAutocompleteModels = async () => {
    setIsLoadingAutocompleteModels(true);
    setAutocompleteModelError(null);
    try {
      const models = await fetchAutocompleteModels();
      if (models.length > 0) {
        setAutocompleteModels(models);
        setAutocompleteModelError(null);
        if (!models.some((model) => model.id === settings.aiAutocompleteModelId)) {
          updateSetting("aiAutocompleteModelId", resolveAutocompleteDefaultModelId(models));
        }
      } else {
        setAutocompleteModels([]);
        setAutocompleteModelError("Model list is empty. Refresh to try again.");
      }
    } catch {
      setAutocompleteModels([]);
      setAutocompleteModelError("Could not load model list. Refresh to try again.");
    } finally {
      setIsLoadingAutocompleteModels(false);
    }
  };

  useEffect(() => {
    void loadAutocompleteModels();
  }, []);

  useEffect(() => {
    setCustomAutocompleteModelInput(settings.aiAutocompleteCustomModelId);
  }, [settings.aiAutocompleteCustomModelId]);

  useEffect(() => {
    setCustomAutocompleteBaseUrlInput(settings.aiAutocompleteCustomBaseUrl);
  }, [settings.aiAutocompleteCustomBaseUrl]);

  useEffect(() => {
    setCustomChatBaseUrlInput(settings.aiCustomBaseUrl);
  }, [settings.aiCustomBaseUrl]);

  useEffect(() => {
    void (async () => {
      const token = await getProviderApiToken(CUSTOM_AUTOCOMPLETE_PROVIDER_ID);
      setHasCustomAutocompleteApiKey(Boolean(token));
      const customChatToken = await getProviderApiToken(CUSTOM_CHAT_PROVIDER_ID);
      setHasCustomChatApiKey(Boolean(customChatToken));
    })();
  }, []);

  const handleSaveCustomAutocompleteApiKey = async () => {
    const token = customAutocompleteApiKeyInput.trim();
    if (!token) return;

    setIsSavingCustomAutocompleteApiKey(true);
    try {
      await storeProviderApiToken(CUSTOM_AUTOCOMPLETE_PROVIDER_ID, token);
      setHasCustomAutocompleteApiKey(true);
      setCustomAutocompleteApiKeyInput("");
      showToast({ message: "Custom autocomplete API key saved", type: "success" });
    } catch {
      showToast({ message: "Failed to save custom autocomplete API key", type: "error" });
    } finally {
      setIsSavingCustomAutocompleteApiKey(false);
    }
  };

  const handleRemoveCustomAutocompleteApiKey = async () => {
    setIsSavingCustomAutocompleteApiKey(true);
    try {
      await removeProviderApiToken(CUSTOM_AUTOCOMPLETE_PROVIDER_ID);
      setHasCustomAutocompleteApiKey(false);
      setCustomAutocompleteApiKeyInput("");
      showToast({ message: "Custom autocomplete API key removed", type: "success" });
    } catch {
      showToast({ message: "Failed to remove custom autocomplete API key", type: "error" });
    } finally {
      setIsSavingCustomAutocompleteApiKey(false);
    }
  };

  const handleSaveCustomChatApiKey = async () => {
    const token = customChatApiKeyInput.trim();
    if (!token) return;

    setIsSavingCustomChatApiKey(true);
    try {
      await storeProviderApiToken(CUSTOM_CHAT_PROVIDER_ID, token);
      setHasCustomChatApiKey(true);
      setCustomChatApiKeyInput("");
      showToast({ message: "Custom provider API key saved", type: "success" });
    } catch {
      showToast({ message: "Failed to save custom provider API key", type: "error" });
    } finally {
      setIsSavingCustomChatApiKey(false);
    }
  };

  const handleRemoveCustomChatApiKey = async () => {
    setIsSavingCustomChatApiKey(true);
    try {
      await removeProviderApiToken(CUSTOM_CHAT_PROVIDER_ID);
      setHasCustomChatApiKey(false);
      setCustomChatApiKeyInput("");
      showToast({ message: "Custom provider API key removed", type: "success" });
    } catch {
      showToast({ message: "Failed to remove custom provider API key", type: "error" });
    } finally {
      setIsSavingCustomChatApiKey(false);
    }
  };

  const commitCustomChatBaseUrl = () => {
    updateSetting("aiCustomBaseUrl", customChatBaseUrlInput);
    setCustomProviderBaseUrl(customChatBaseUrlInput);
  };

  const commitCustomAutocompleteModel = () => {
    updateSetting("aiAutocompleteCustomModelId", customAutocompleteModelInput);
  };

  const commitCustomAutocompleteBaseUrl = () => {
    updateSetting("aiAutocompleteCustomBaseUrl", customAutocompleteBaseUrlInput);
  };

  const handleAgentNotificationsChange = async (checked: boolean) => {
    if (!checked) {
      await updateSetting("aiAgentNotifications", false);
      return;
    }

    setIsUpdatingAgentNotifications(true);
    try {
      const permission = await requestAgentNativeNotificationPermission();
      if (permission === "granted") {
        await updateSetting("aiAgentNotifications", true);
        showToast({ message: "Agent notifications enabled", type: "success" });
        return;
      }

      await updateSetting("aiAgentNotifications", false);
      showToast({
        message:
          permission === "denied"
            ? "Native notification permission was not granted"
            : "Native notifications are unavailable",
        type: permission === "denied" ? "warning" : "error",
      });
    } finally {
      setIsUpdatingAgentNotifications(false);
    }
  };

  const providersNeedingAuth = providers.filter((p) => p.requiresAuth && !p.requiresApiKey);

  const isOllamaSelected = settings.aiProviderId === "ollama";
  const isCustomProviderSelected = settings.aiProviderId === CUSTOM_CHAT_PROVIDER_ID;
  const showCustomProviderSettings =
    isCustomProviderSelected || Boolean(settings.aiCustomBaseUrl || settings.aiCustomModelId);
  const hasAutocompleteModels = autocompleteModels.length > 0;

  return (
    <SettingsView>
      <CodexSettings />
      <Section title="Notifications">
        <SettingRow
          label="Agent Notifications"
          description="Show native notifications when background agent work finishes, fails, or needs approval"
          onReset={() =>
            updateSetting("aiAgentNotifications", getDefaultSetting("aiAgentNotifications"))
          }
          canReset={settings.aiAgentNotifications !== getDefaultSetting("aiAgentNotifications")}
        >
          <Switch
            checked={settings.aiAgentNotifications}
            onChange={(checked) => void handleAgentNotificationsChange(checked)}
            disabled={isUpdatingAgentNotifications}
            size="sm"
          />
        </SettingRow>
      </Section>
      <Section title="AI Chat">
        <SettingRow
          label="Provider"
          description="Choose the provider used by direct AI chat"
          onReset={() => {
            updateSetting("aiProviderId", getDefaultSetting("aiProviderId"));
            updateSetting("aiModelId", getDefaultSetting("aiModelId"));
          }}
          canReset={
            settings.aiProviderId !== getDefaultSetting("aiProviderId") ||
            settings.aiModelId !== getDefaultSetting("aiModelId")
          }
        >
          <ProviderSelector
            providerId={settings.aiProviderId}
            onChange={(id) => handleProviderChange(id)}
          />
        </SettingRow>

        <SettingRow
          label="Model"
          description={
            isCustomProviderSelected
              ? "Model name sent to the custom endpoint"
              : "Choose the model used by direct AI chat"
          }
          onReset={() => {
            if (isCustomProviderSelected) {
              updateSetting("aiCustomModelId", getDefaultSetting("aiCustomModelId"));
              updateSetting("aiModelId", getDefaultSetting("aiCustomModelId"));
              return;
            }
            updateSetting("aiModelId", getDefaultSetting("aiModelId"));
          }}
          canReset={
            isCustomProviderSelected
              ? settings.aiCustomModelId !== getDefaultSetting("aiCustomModelId")
              : settings.aiModelId !== getDefaultSetting("aiModelId")
          }
        >
          {isCustomProviderSelected ? (
            <ModelSelector
              providerId={settings.aiProviderId}
              modelId={settings.aiModelId || settings.aiCustomModelId}
              onChange={(id) => {
                updateSetting("aiCustomModelId", id);
                updateSetting("aiModelId", id);
              }}
            />
          ) : (
            <ModelSelector
              providerId={settings.aiProviderId}
              modelId={settings.aiModelId}
              onChange={(id) => updateSetting("aiModelId", id)}
            />
          )}
        </SettingRow>

        <SettingRow label="API Keys" description="Manage provider API keys separately">
          <Button
            shape="pill"
            type="button"
            variant="default"
            onClick={() => setIsApiKeyManagerOpen(true)}
            className="w-fit"
            size="sm"
          >
            <Key />
            <span>Manage keys</span>
          </Button>
        </SettingRow>

        {providerSettingsActions.map((action) => {
          const Icon = action.icon === "sparkles" ? Sparkles : Palette;

          return (
            <SettingRow
              key={action.id}
              label={action.label}
              description={action.getDescription?.() || "Configure provider extension"}
            >
              <Button
                shape="pill"
                type="button"
                variant="default"
                onClick={() => openCommandPaletteView(action.commandPaletteViewId)}
                className="w-fit"
                size="sm"
              >
                <Icon />
                <span>{action.buttonLabel}</span>
              </Button>
            </SettingRow>
          );
        })}
      </Section>

      {showCustomProviderSettings && (
        <Section title="Custom Provider">
          <SettingRow
            label="Base URL"
            description="OpenAI-compatible endpoint base URL for direct AI chat"
            onReset={() => {
              updateSetting("aiCustomBaseUrl", getDefaultSetting("aiCustomBaseUrl"));
              setCustomProviderBaseUrl(getDefaultSetting("aiCustomBaseUrl"));
            }}
            canReset={settings.aiCustomBaseUrl !== getDefaultSetting("aiCustomBaseUrl")}
          >
            <Input
              value={customChatBaseUrlInput}
              onChange={(event) => setCustomChatBaseUrlInput(event.currentTarget.value)}
              onBlur={commitCustomChatBaseUrl}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              placeholder="http://localhost:11434/v1"
              size="md"
              className={SETTINGS_CONTROL_WIDTHS.xwide}
              spellCheck={false}
              leftIcon={Globe}
            />
          </SettingRow>
          <SettingRow
            label="API Key"
            description={
              hasCustomChatApiKey
                ? "Stored securely. Leave blank to keep the existing key."
                : "Optional bearer token for the custom endpoint"
            }
          >
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={customChatApiKeyInput}
                onChange={(event) => setCustomChatApiKeyInput(event.currentTarget.value)}
                placeholder={hasCustomChatApiKey ? "Saved" : "API key"}
                size="md"
                className={SETTINGS_CONTROL_WIDTHS.wide}
                spellCheck={false}
                autoComplete="off"
                disabled={isSavingCustomChatApiKey}
              />
              <Button
                shape="pill"
                type="button"
                variant="default"
                onClick={handleSaveCustomChatApiKey}
                disabled={!customChatApiKeyInput.trim() || isSavingCustomChatApiKey}
                size="sm"
              >
                Save
              </Button>
              {hasCustomChatApiKey && (
                <Button
                  shape="pill"
                  type="button"
                  variant="default"
                  onClick={handleRemoveCustomChatApiKey}
                  disabled={isSavingCustomChatApiKey}
                  size="sm"
                >
                  Remove
                </Button>
              )}
            </div>
          </SettingRow>
        </Section>
      )}

      {(isOllamaSelected || settings.ollamaBaseUrl !== DEFAULT_OLLAMA_BASE_URL) && (
        <Section title="Ollama">
          <SettingRow label="Mode" description="Run Ollama locally or use Ollama Cloud">
            <ToggleGroup
              value={isOllamaCloud ? "cloud" : "local"}
              onValueChange={(nextValue) => {
                if (nextValue === "local") {
                  handleUseSelfHostedOllama();
                  return;
                }
                handleUseOllamaCloud();
              }}
              ariaLabel="Ollama mode"
              options={[
                { value: "local", label: "Local", icon: <Laptop /> },
                { value: "cloud", label: "Cloud", icon: <Cloud /> },
              ]}
            />
          </SettingRow>
          <SettingRow
            label="Endpoint"
            description="Base URL for Ollama API (local, LAN, or cloud)"
            onReset={handleResetOllamaUrl}
            canReset={settings.ollamaBaseUrl !== getDefaultSetting("ollamaBaseUrl")}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Input
                type="text"
                value={ollamaUrl}
                onChange={(e) => handleOllamaUrlChange(e.target.value)}
                onBlur={(e) => {
                  void commitOllamaUrl(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  e.currentTarget.blur();
                }}
                placeholder={DEFAULT_OLLAMA_BASE_URL}
                spellCheck={false}
                leftIcon={Globe}
                className={cn(
                  "w-56 max-w-full",
                  ollamaStatus === "error" && "border-destructive/60",
                )}
              />
              {ollamaStatus === "checking" && <Spinner label="Checking" compact />}
              {ollamaStatus === "ok" && <CheckCircle className="text-success" />}
              {ollamaStatus === "error" && <AlertCircle className="text-destructive" />}
              {ollamaUrl !== DEFAULT_OLLAMA_BASE_URL && (
                <Button
                  shape="pill"
                  type="button"
                  variant="default"
                  onClick={handleResetOllamaUrl}
                  title="Reset to default"
                  aria-label="Reset Ollama URL to default"
                  size="icon-xs"
                >
                  <RotateCcw />
                </Button>
              )}
            </div>
          </SettingRow>
          <SettingRow
            label="API Key"
            description="Used for authenticated Ollama endpoints and Ollama Cloud."
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Input
                type="password"
                value={ollamaApiKeyInput}
                onChange={(e) => setOllamaApiKeyInput(e.target.value)}
                placeholder={hasStoredOllamaKey ? "••••••••  (saved)" : "ollama-…"}
                spellCheck={false}
                leftIcon={Key}
                className={cn(
                  "w-56 max-w-full",
                  needsApiKey && !hasStoredOllamaKey && "border-warning/60",
                )}
                autoComplete="off"
                disabled={isSavingOllamaKey}
              />
              <Button
                shape="pill"
                type="button"
                variant="default"
                onClick={handleSaveOllamaApiKey}
                disabled={!ollamaApiKeyInput.trim() || isSavingOllamaKey}
                size="sm"
              >
                {isSavingOllamaKey ? "Saving…" : "Save"}
              </Button>
              {hasStoredOllamaKey && (
                <Button
                  shape="pill"
                  type="button"
                  variant="default"
                  onClick={handleRemoveOllamaApiKey}
                  title="Remove saved API key"
                  aria-label="Remove Ollama API key"
                  className="text-destructive hover:bg-destructive/10"
                  size="icon-xs"
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </SettingRow>
          {needsApiKey && !hasStoredOllamaKey && (
            <SettingRow label="Ollama Cloud Key" description="Ollama Cloud requires an API key.">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="shrink-0 text-warning" />
                <a
                  href="https://ollama.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Get key <ExternalLink className="size-3" />
                </a>
              </div>
            </SettingRow>
          )}
          {ollamaStatus === "error" && (
            <SettingRow
              label="Connection Status"
              description={
                isOllamaCloud
                  ? "Could not reach Ollama Cloud. Verify your API key and internet connection."
                  : "Could not connect. Check that Ollama is running at this address."
              }
            >
              <Badge variant="default">Error</Badge>
            </SettingRow>
          )}
        </Section>
      )}

      <ProviderApiKeyCommand
        isOpen={isApiKeyManagerOpen}
        onClose={() => setIsApiKeyManagerOpen(false)}
        initialProviderId={settings.aiProviderId}
      />

      {providersNeedingAuth.length > 0 && (
        <Section title="Authentication">
          {providersNeedingAuth.map((provider) => (
            <SettingRow
              key={provider.id}
              label={provider.name}
              description="Requires OAuth authentication"
            >
              <Badge variant="default">Coming Soon</Badge>
            </SettingRow>
          ))}
        </Section>
      )}

      {sessionConfigOptions.length > 0 && (
        <Section title="ACP Session">
          {sessionConfigOptions.map((option) => {
            if (option.kind.type !== "select") {
              return null;
            }

            return (
              <SettingRow
                key={option.id}
                label={option.name}
                description={option.description || "Session option exposed by the active ACP agent"}
              >
                <Select
                  shape="pill"
                  value={option.kind.currentValue}
                  options={option.kind.options.map((value) => ({
                    value: value.id,
                    label: value.name,
                  }))}
                  onChange={(value) =>
                    useAIChatStore.getState().actions.changeSessionConfigOption(option.id, value)
                  }
                  size="md"
                  variant="default"
                  searchable
                  searchableTrigger="input"
                />
              </SettingRow>
            );
          })}
        </Section>
      )}

      <Section title="Autocomplete">
        <SettingRow
          label="AI Autocomplete"
          description="Enable AI autocomplete while typing"
          onReset={() => updateSetting("aiCompletion", getDefaultSetting("aiCompletion"))}
          canReset={settings.aiCompletion !== getDefaultSetting("aiCompletion")}
        >
          <Switch
            checked={aiCompletionAllowedByPolicy ? settings.aiCompletion : false}
            onChange={(checked) => updateSetting("aiCompletion", checked)}
            disabled={!aiCompletionAllowedByPolicy}
            size="sm"
          />
        </SettingRow>
        {settings.aiCompletion && (
          <>
            <SettingRow
              label="Autocomplete Provider"
              description="Use Athas/OpenRouter or an OpenAI-compatible endpoint"
              onReset={() =>
                updateSetting("aiAutocompleteProvider", getDefaultSetting("aiAutocompleteProvider"))
              }
              canReset={
                settings.aiAutocompleteProvider !== getDefaultSetting("aiAutocompleteProvider")
              }
            >
              <ToggleGroup
                value={settings.aiAutocompleteProvider}
                options={[
                  { value: "openrouter", label: "OpenRouter" },
                  { value: "custom", label: "Custom" },
                ]}
                onValueChange={(value) =>
                  updateSetting(
                    "aiAutocompleteProvider",
                    value === "custom" ? "custom" : "openrouter",
                  )
                }
                ariaLabel="Autocomplete provider"
                size="xs"
                wrap={false}
              />
            </SettingRow>
            <SettingRow
              label={
                settings.aiAutocompleteProvider === "custom" ? "Custom Model" : "Autocomplete Model"
              }
              description={
                settings.aiAutocompleteProvider === "custom"
                  ? "Model name sent to the custom endpoint"
                  : "Choose any OpenRouter model for autocomplete"
              }
              onReset={() =>
                settings.aiAutocompleteProvider === "custom"
                  ? updateSetting(
                      "aiAutocompleteCustomModelId",
                      getDefaultSetting("aiAutocompleteCustomModelId"),
                    )
                  : updateSetting(
                      "aiAutocompleteModelId",
                      getDefaultSetting("aiAutocompleteModelId"),
                    )
              }
              canReset={
                settings.aiAutocompleteProvider === "custom"
                  ? settings.aiAutocompleteCustomModelId !==
                    getDefaultSetting("aiAutocompleteCustomModelId")
                  : settings.aiAutocompleteModelId !== getDefaultSetting("aiAutocompleteModelId")
              }
            >
              {settings.aiAutocompleteProvider === "custom" ? (
                <Input
                  value={customAutocompleteModelInput}
                  onChange={(event) => setCustomAutocompleteModelInput(event.currentTarget.value)}
                  onBlur={commitCustomAutocompleteModel}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="qwen2.5-coder:7b"
                  size="md"
                  className={SETTINGS_CONTROL_WIDTHS.xwide}
                  disabled={!aiCompletionAllowedByPolicy}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    shape="pill"
                    variant="default"
                    onClick={loadAutocompleteModels}
                    disabled={isLoadingAutocompleteModels || !aiCompletionAllowedByPolicy}
                    title="Refresh model list"
                    size="icon-xs"
                  >
                    {isLoadingAutocompleteModels ? (
                      <Spinner label="Loading models" compact />
                    ) : (
                      <RefreshCw />
                    )}
                  </Button>
                  <Select
                    shape="pill"
                    value={hasAutocompleteModels ? settings.aiAutocompleteModelId : ""}
                    options={autocompleteModels.map((model) => ({
                      value: model.id,
                      label: model.name,
                    }))}
                    onChange={(value) => updateSetting("aiAutocompleteModelId", value)}
                    size="md"
                    variant="default"
                    searchable
                    searchableTrigger="input"
                    disabled={
                      !aiCompletionAllowedByPolicy ||
                      isLoadingAutocompleteModels ||
                      !hasAutocompleteModels
                    }
                    placeholder={
                      isLoadingAutocompleteModels ? "Loading models..." : "No models loaded"
                    }
                  />
                </div>
              )}
            </SettingRow>
            {settings.aiAutocompleteProvider === "custom" && (
              <>
                <SettingRow
                  label="Custom Base URL"
                  description="OpenAI-compatible endpoint base URL"
                  onReset={() =>
                    updateSetting(
                      "aiAutocompleteCustomBaseUrl",
                      getDefaultSetting("aiAutocompleteCustomBaseUrl"),
                    )
                  }
                  canReset={
                    settings.aiAutocompleteCustomBaseUrl !==
                    getDefaultSetting("aiAutocompleteCustomBaseUrl")
                  }
                >
                  <Input
                    value={customAutocompleteBaseUrlInput}
                    onChange={(event) =>
                      setCustomAutocompleteBaseUrlInput(event.currentTarget.value)
                    }
                    onBlur={commitCustomAutocompleteBaseUrl}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="http://localhost:11434/v1"
                    size="md"
                    className={SETTINGS_CONTROL_WIDTHS.xwide}
                    disabled={!aiCompletionAllowedByPolicy}
                  />
                </SettingRow>
                <SettingRow
                  label="Custom API Key"
                  description={
                    hasCustomAutocompleteApiKey
                      ? "Stored securely. Leave blank to keep the existing key."
                      : "Optional bearer token for the custom endpoint"
                  }
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      value={customAutocompleteApiKeyInput}
                      onChange={(event) =>
                        setCustomAutocompleteApiKeyInput(event.currentTarget.value)
                      }
                      placeholder={hasCustomAutocompleteApiKey ? "Saved" : "API key"}
                      size="md"
                      className={SETTINGS_CONTROL_WIDTHS.wide}
                      disabled={!aiCompletionAllowedByPolicy || isSavingCustomAutocompleteApiKey}
                    />
                    <Button
                      shape="pill"
                      variant="default"
                      onClick={handleSaveCustomAutocompleteApiKey}
                      disabled={
                        !customAutocompleteApiKeyInput.trim() ||
                        !aiCompletionAllowedByPolicy ||
                        isSavingCustomAutocompleteApiKey
                      }
                      size="sm"
                    >
                      Save
                    </Button>
                    {hasCustomAutocompleteApiKey && (
                      <Button
                        shape="pill"
                        variant="default"
                        onClick={handleRemoveCustomAutocompleteApiKey}
                        disabled={!aiCompletionAllowedByPolicy || isSavingCustomAutocompleteApiKey}
                        size="sm"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </SettingRow>
              </>
            )}
            {autocompleteModelError && (
              <SettingRow label="Model List" description={autocompleteModelError}>
                <Badge variant="default">Error</Badge>
              </SettingRow>
            )}
          </>
        )}
        {managedPolicy ? (
          <SettingRow
            label="Enterprise Policy"
            description={`${aiCompletionAllowedByPolicy ? "AI completion enabled." : "AI completion disabled."} ${byokAllowedByPolicy ? "BYOK allowed." : "BYOK blocked."}`}
          >
            <Badge variant="default">Managed</Badge>
          </SettingRow>
        ) : null}
      </Section>

      <Section title="Agent History">
        <SettingRow label="Clear Agent History" description="Permanently delete all agent history">
          <TypedConfirmAction
            actionLabel="Clear All"
            busyLabel="Clearing..."
            isBusy={isClearingChats}
            onConfirm={async () => {
              setIsClearingChats(true);
              try {
                await useAIChatStore.getState().actions.clearAllChats();
                showToast({ message: "Agent history cleared", type: "success" });
              } finally {
                setIsClearingChats(false);
              }
            }}
          />
        </SettingRow>
      </Section>
    </SettingsView>
  );
};
