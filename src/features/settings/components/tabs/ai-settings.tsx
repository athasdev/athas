import { invoke } from "@tauri-apps/api/core";
import {
  WarningCircle as AlertCircle,
  CheckCircle,
  Cloud,
  ArrowSquareOut as ExternalLink,
  GlobeHemisphereWest as Globe,
  Key,
  Laptop,
  ArrowClockwise as RefreshCw,
  ArrowCounterClockwise as RotateCcw,
  Trash as Trash2,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProviderApiKeyCommand } from "@/features/ai/components/provider-api-key-command";
import { ModelSelector } from "@/features/ai/components/selectors/model-selector";
import { ProviderSelector } from "@/features/ai/components/selectors/provider-selector";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AgentConfig, SessionConfigOption } from "@/features/ai/types/acp";
import { getAvailableProviders, updateAgentStatus } from "@/features/ai/types/providers";
import { useToast } from "@/features/layout/contexts/toast-context";
import { TypedConfirmAction } from "@/features/settings/components/typed-confirm-action";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { SegmentedControl } from "@/ui/segmented-control";
import Section, { SETTINGS_CONTROL_WIDTHS, SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { fetchAutocompleteModels } from "@/features/editor/services/editor-autocomplete-service";
import { cn } from "@/utils/cn";
import {
  setOllamaApiKey,
  setOllamaBaseUrl,
} from "@/features/ai/services/providers/ai-provider-registry";
import {
  DEFAULT_OLLAMA_BASE_URL,
  OLLAMA_CLOUD_BASE_URL,
  checkOllamaConnection,
  isOllamaCloudUrl,
} from "@/features/ai/services/providers/ollama-provider";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
} from "@/features/ai/services/ai-token-service";
const DEFAULT_AUTOCOMPLETE_MODEL_ID = "mistralai/devstral-small";
const DEFAULT_AUTOCOMPLETE_MODELS = [
  { id: "mistralai/devstral-small", name: "Devstral Small 1.1" },
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5" },
  { id: "openai/gpt-5-nano", name: "GPT-5 Nano" },
  { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
];

function resolveAutocompleteDefaultModelId(models: Array<{ id: string; name: string }>): string {
  if (models.some((model) => model.id === DEFAULT_AUTOCOMPLETE_MODEL_ID)) {
    return DEFAULT_AUTOCOMPLETE_MODEL_ID;
  }
  return models[0]?.id || DEFAULT_AUTOCOMPLETE_MODEL_ID;
}

export const AISettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const subscription = useAuthStore((state) => state.subscription);
  const { showToast } = useToast();
  const enterprisePolicy = subscription?.enterprise?.policy;
  const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
  const aiCompletionAllowedByPolicy = managedPolicy ? managedPolicy.aiCompletionEnabled : true;
  const byokAllowedByPolicy = managedPolicy ? managedPolicy.allowByok : true;

  const [sessionConfigOptions, setSessionConfigOptions] = useState<SessionConfigOption[]>([]);
  const [isClearingChats, setIsClearingChats] = useState(false);
  const [autocompleteModels, setAutocompleteModels] = useState(DEFAULT_AUTOCOMPLETE_MODELS);
  const [isLoadingAutocompleteModels, setIsLoadingAutocompleteModels] = useState(false);
  const [autocompleteModelError, setAutocompleteModelError] = useState<string | null>(null);
  const [isApiKeyManagerOpen, setIsApiKeyManagerOpen] = useState(false);

  // Ollama URL state
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL);
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const ollamaDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Ollama API key state (used for Ollama Cloud; optional for local)
  const [ollamaApiKeyInput, setOllamaApiKeyInput] = useState("");
  const [hasStoredOllamaKey, setHasStoredOllamaKey] = useState(false);
  const [isSavingOllamaKey, setIsSavingOllamaKey] = useState(false);

  const isOllamaCloud = isOllamaCloudUrl(ollamaUrl);
  const needsApiKey = isOllamaCloud;

  useEffect(() => {
    const detectAgents = async () => {
      try {
        const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
        updateAgentStatus(availableAgents.map((a) => ({ id: a.id, installed: a.installed })));
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

  // Sync Ollama base URL + API key on mount
  useEffect(() => {
    const url = settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL;
    setOllamaBaseUrl(url);
    void (async () => {
      const token = await getProviderApiToken("ollama");
      setHasStoredOllamaKey(!!token);
      setOllamaApiKey(token);
    })();
  }, []);

  const validateOllamaConnection = useCallback(
    async (url: string, apiKey?: string | null) => {
      setOllamaStatus("checking");
      const keyToUse =
        apiKey !== undefined
          ? apiKey
          : hasStoredOllamaKey
            ? await getProviderApiToken("ollama")
            : null;
      const ok = await checkOllamaConnection(url, keyToUse);
      setOllamaStatus(ok ? "ok" : "error");
    },
    [hasStoredOllamaKey],
  );

  const handleOllamaUrlChange = (value: string) => {
    setOllamaUrl(value);
    setOllamaStatus("idle");

    if (ollamaDebounceRef.current) clearTimeout(ollamaDebounceRef.current);
    ollamaDebounceRef.current = setTimeout(() => {
      const trimmed = value.replace(/\/+$/, "") || DEFAULT_OLLAMA_BASE_URL;
      updateSetting("ollamaBaseUrl", trimmed);
      setOllamaBaseUrl(trimmed);
      void validateOllamaConnection(trimmed);
    }, 600);
  };

  const handleResetOllamaUrl = () => {
    setOllamaUrl(DEFAULT_OLLAMA_BASE_URL);
    updateSetting("ollamaBaseUrl", DEFAULT_OLLAMA_BASE_URL);
    setOllamaBaseUrl(DEFAULT_OLLAMA_BASE_URL);
    void validateOllamaConnection(DEFAULT_OLLAMA_BASE_URL);
  };

  const handleUseOllamaCloud = () => {
    setOllamaUrl(OLLAMA_CLOUD_BASE_URL);
    updateSetting("ollamaBaseUrl", OLLAMA_CLOUD_BASE_URL);
    setOllamaBaseUrl(OLLAMA_CLOUD_BASE_URL);
    void validateOllamaConnection(OLLAMA_CLOUD_BASE_URL);
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

  const providers = getAvailableProviders();

  const handleProviderChange = (newProviderId: string) => {
    const provider = providers.find((p) => p.id === newProviderId);
    updateSetting("aiProviderId", newProviderId);
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
        if (!models.some((model) => model.id === settings.aiAutocompleteModelId)) {
          updateSetting("aiAutocompleteModelId", resolveAutocompleteDefaultModelId(models));
        }
      } else {
        setAutocompleteModels(DEFAULT_AUTOCOMPLETE_MODELS);
      }
    } catch {
      setAutocompleteModels(DEFAULT_AUTOCOMPLETE_MODELS);
      setAutocompleteModelError("Could not load model list. Showing defaults.");
    } finally {
      setIsLoadingAutocompleteModels(false);
    }
  };

  useEffect(() => {
    void loadAutocompleteModels();
  }, []);

  const providersNeedingAuth = getAvailableProviders().filter(
    (p) => p.requiresAuth && !p.requiresApiKey,
  );

  const isOllamaSelected = settings.aiProviderId === "ollama";

  return (
    <div className="space-y-4">
      <Section title="Athas Agent">
        <SettingRow
          label="Provider"
          description="Choose the provider used by Athas Agent"
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
          description="Choose the model used by Athas Agent"
          onReset={() => updateSetting("aiModelId", getDefaultSetting("aiModelId"))}
          canReset={settings.aiModelId !== getDefaultSetting("aiModelId")}
        >
          <ModelSelector
            providerId={settings.aiProviderId}
            modelId={settings.aiModelId}
            onChange={(id) => updateSetting("aiModelId", id)}
          />
        </SettingRow>

        <SettingRow label="API Keys" description="Manage provider API keys separately">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setIsApiKeyManagerOpen(true)}
            className="w-fit"
          >
            <Key />
            <span>Manage keys</span>
          </Button>
        </SettingRow>
      </Section>

      {(isOllamaSelected || settings.ollamaBaseUrl !== DEFAULT_OLLAMA_BASE_URL) && (
        <Section title="Ollama">
          <SettingRow label="Mode" description="Run Ollama locally or use Ollama Cloud">
            <SegmentedControl
              value={isOllamaCloud ? "cloud" : "local"}
              onChange={(nextValue) => {
                if (nextValue === "local") {
                  handleResetOllamaUrl();
                  return;
                }
                handleUseOllamaCloud();
              }}
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
            <div className="flex items-center gap-1.5">
              <Input
                type="text"
                value={ollamaUrl}
                onChange={(e) => handleOllamaUrlChange(e.target.value)}
                placeholder={DEFAULT_OLLAMA_BASE_URL}
                spellCheck={false}
                leftIcon={Globe}
                className={cn("w-56", ollamaStatus === "error" && "border-error/60")}
              />
              {ollamaStatus === "checking" && (
                <RefreshCw className="animate-spin text-text-lighter" />
              )}
              {ollamaStatus === "ok" && <CheckCircle className="text-success" />}
              {ollamaStatus === "error" && <AlertCircle className="text-error" />}
              {ollamaUrl !== DEFAULT_OLLAMA_BASE_URL && (
                <Button
                  type="button"
                  variant="default"
                  size="icon-xs"
                  onClick={handleResetOllamaUrl}
                  title="Reset to default"
                  aria-label="Reset Ollama URL to default"
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
            <div className="flex items-center gap-1.5">
              <Input
                type="password"
                value={ollamaApiKeyInput}
                onChange={(e) => setOllamaApiKeyInput(e.target.value)}
                placeholder={hasStoredOllamaKey ? "••••••••  (saved)" : "ollama-…"}
                spellCheck={false}
                leftIcon={Key}
                className={cn("w-56", needsApiKey && !hasStoredOllamaKey && "border-warning/60")}
                autoComplete="off"
                disabled={isSavingOllamaKey}
              />
              <Button
                type="button"
                variant="default"
                size="xs"
                onClick={handleSaveOllamaApiKey}
                disabled={!ollamaApiKeyInput.trim() || isSavingOllamaKey}
              >
                {isSavingOllamaKey ? "Saving…" : "Save"}
              </Button>
              {hasStoredOllamaKey && (
                <Button
                  type="button"
                  variant="default"
                  size="xs"
                  onClick={handleRemoveOllamaApiKey}
                  title="Remove saved API key"
                  aria-label="Remove Ollama API key"
                  className="text-error hover:bg-error/10"
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
                  className="inline-flex items-center gap-1 text-link hover:underline"
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
              <Badge variant="default" size="default">
                Error
              </Badge>
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
              <Badge variant="default" size="default">
                Coming Soon
              </Badge>
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
                  value={option.kind.currentValue}
                  options={option.kind.options.map((value) => ({
                    value: value.id,
                    label: value.name,
                  }))}
                  onChange={(value) =>
                    useAIChatStore.getState().changeSessionConfigOption(option.id, value)
                  }
                  size="xs"
                  variant="secondary"
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
              label="Autocomplete Model"
              description="Choose any OpenRouter model for autocomplete"
              onReset={() =>
                updateSetting("aiAutocompleteModelId", getDefaultSetting("aiAutocompleteModelId"))
              }
              canReset={
                settings.aiAutocompleteModelId !== getDefaultSetting("aiAutocompleteModelId")
              }
            >
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="xs"
                  onClick={loadAutocompleteModels}
                  disabled={isLoadingAutocompleteModels || !aiCompletionAllowedByPolicy}
                  title="Refresh model list"
                >
                  <RefreshCw className={cn(isLoadingAutocompleteModels && "animate-spin")} />
                </Button>
                <Select
                  value={settings.aiAutocompleteModelId}
                  options={autocompleteModels.map((model) => ({
                    value: model.id,
                    label: model.name,
                  }))}
                  onChange={(value) => updateSetting("aiAutocompleteModelId", value)}
                  size="xs"
                  variant="default"
                  searchable
                  searchableTrigger="input"
                  className={SETTINGS_CONTROL_WIDTHS.xwide}
                  disabled={!aiCompletionAllowedByPolicy}
                />
              </div>
            </SettingRow>
            {autocompleteModelError && (
              <SettingRow label="Model List" description={autocompleteModelError}>
                <Badge variant="default" size="default">
                  Error
                </Badge>
              </SettingRow>
            )}
          </>
        )}
        {managedPolicy ? (
          <SettingRow
            label="Enterprise Policy"
            description={`${aiCompletionAllowedByPolicy ? "AI completion enabled." : "AI completion disabled."} ${byokAllowedByPolicy ? "BYOK allowed." : "BYOK blocked."}`}
          >
            <Badge variant="default" size="default">
              Managed
            </Badge>
          </SettingRow>
        ) : null}
      </Section>

      <Section title="Chat History">
        <SettingRow label="Clear All Chats" description="Permanently delete all chat history">
          <TypedConfirmAction
            actionLabel="Clear All"
            busyLabel="Clearing..."
            isBusy={isClearingChats}
            onConfirm={async () => {
              setIsClearingChats(true);
              try {
                await useAIChatStore.getState().clearAllChats();
                showToast({ message: "All chats cleared", type: "success" });
              } finally {
                setIsClearingChats(false);
              }
            }}
          />
        </SettingRow>
      </Section>
    </div>
  );
};
