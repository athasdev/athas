import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, CheckCircle, Globe, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProviderModelSelector } from "@/features/ai/components/selectors/provider-model-selector";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AgentConfig, SessionConfigOption, SessionMode } from "@/features/ai/types/acp";
import { getAvailableProviders, updateAgentStatus } from "@/features/ai/types/providers";
import { useToast } from "@/features/layout/contexts/toast-context";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Section, { SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { fetchAutocompleteModels } from "@/features/editor/services/editor-autocomplete-service";
import { cn } from "@/utils/cn";
import { setOllamaBaseUrl } from "@/features/ai/services/providers/ai-provider-registry";
import { checkOllamaConnection } from "@/features/ai/services/providers/ollama-provider";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_AUTOCOMPLETE_MODEL_ID = "mistralai/devstral-small";
const NO_DEFAULT_SESSION_MODE = "__none__";

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
  const isPro = subscription?.status === "pro";

  const [availableModes, setAvailableModes] = useState<SessionMode[]>([]);
  const [sessionConfigOptions, setSessionConfigOptions] = useState<SessionConfigOption[]>([]);
  const [isClearingChats, setIsClearingChats] = useState(false);
  const [autocompleteModels, setAutocompleteModels] = useState(DEFAULT_AUTOCOMPLETE_MODELS);
  const [isLoadingAutocompleteModels, setIsLoadingAutocompleteModels] = useState(false);
  const [autocompleteModelError, setAutocompleteModelError] = useState<string | null>(null);

  // Ollama URL state
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL);
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const ollamaDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
      setAvailableModes(state.sessionModeState.availableModes);
      setSessionConfigOptions(state.sessionConfigOptions);
    });
    setAvailableModes(useAIChatStore.getState().sessionModeState.availableModes);
    setSessionConfigOptions(useAIChatStore.getState().sessionConfigOptions);
    return unsubscribe;
  }, []);

  // Sync Ollama base URL on mount
  useEffect(() => {
    const url = settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL;
    setOllamaBaseUrl(url);
  }, []);

  const validateOllamaConnection = useCallback(async (url: string) => {
    setOllamaStatus("checking");
    const ok = await checkOllamaConnection(url);
    setOllamaStatus(ok ? "ok" : "error");
  }, []);

  const handleOllamaUrlChange = (value: string) => {
    setOllamaUrl(value);
    setOllamaStatus("idle");

    if (ollamaDebounceRef.current) clearTimeout(ollamaDebounceRef.current);
    ollamaDebounceRef.current = setTimeout(() => {
      const trimmed = value.replace(/\/+$/, "") || DEFAULT_OLLAMA_BASE_URL;
      updateSetting("ollamaBaseUrl", trimmed);
      setOllamaBaseUrl(trimmed);
      validateOllamaConnection(trimmed);
    }, 600);
  };

  const handleResetOllamaUrl = () => {
    setOllamaUrl(DEFAULT_OLLAMA_BASE_URL);
    updateSetting("ollamaBaseUrl", DEFAULT_OLLAMA_BASE_URL);
    setOllamaBaseUrl(DEFAULT_OLLAMA_BASE_URL);
    validateOllamaConnection(DEFAULT_OLLAMA_BASE_URL);
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
        <div className="ui-font ui-text-sm px-1 pb-1 text-text-lighter">
          When `Athas Agent` is selected in chat, it uses the provider and model configured here.
        </div>
        {isPro ? (
          <div className="ui-font ui-text-sm rounded-xl border border-border bg-secondary-bg/60 px-3 py-2 text-text-lighter">
            <span className="text-text">Athas Pro detected.</span> Chat provider routing is
            currently configured through the model selection below; autocomplete already uses
            Athas-hosted credit on Pro.
          </div>
        ) : null}
        <SettingRow
          label="Provider & Model"
          description="Choose the provider and model used by Athas Agent"
          onReset={() => {
            updateSetting("aiProviderId", getDefaultSetting("aiProviderId"));
            updateSetting("aiModelId", getDefaultSetting("aiModelId"));
          }}
          canReset={
            settings.aiProviderId !== getDefaultSetting("aiProviderId") ||
            settings.aiModelId !== getDefaultSetting("aiModelId")
          }
        >
          <ProviderModelSelector
            providerId={settings.aiProviderId}
            modelId={settings.aiModelId}
            onProviderChange={(id) => handleProviderChange(id)}
            onModelChange={(id) => updateSetting("aiModelId", id)}
          />
        </SettingRow>
      </Section>

      {(isOllamaSelected || settings.ollamaBaseUrl !== DEFAULT_OLLAMA_BASE_URL) && (
        <Section title="Ollama">
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
                  variant="secondary"
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
          {ollamaStatus === "error" && (
            <div className="ui-font ui-text-sm flex items-center gap-1.5 px-1 text-error">
              <AlertCircle className="shrink-0" />
              <span>Could not connect. Check that Ollama is running at this address.</span>
            </div>
          )}
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
              <Badge variant="default" size="default">
                Coming Soon
              </Badge>
            </SettingRow>
          ))}
        </Section>
      )}

      {availableModes.length > 0 && (
        <Section title="Agent Defaults">
          <SettingRow
            label="Default Session Mode"
            description="Default mode for ACP agent sessions"
            onReset={() =>
              updateSetting("aiDefaultSessionMode", getDefaultSetting("aiDefaultSessionMode"))
            }
            canReset={settings.aiDefaultSessionMode !== getDefaultSetting("aiDefaultSessionMode")}
          >
            <Select
              value={settings.aiDefaultSessionMode || NO_DEFAULT_SESSION_MODE}
              options={[
                { value: NO_DEFAULT_SESSION_MODE, label: "None" },
                ...availableModes.map((mode) => ({
                  value: mode.id,
                  label: mode.name,
                })),
              ]}
              onChange={(value) =>
                updateSetting(
                  "aiDefaultSessionMode",
                  value === NO_DEFAULT_SESSION_MODE ? "" : value,
                )
              }
              size="xs"
              variant="secondary"
            />
          </SettingRow>
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
                />
              </SettingRow>
            );
          })}
        </Section>
      )}

      <Section title="Autocomplete">
        <SettingRow
          label="AI Completion"
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
        <SettingRow
          label="Autocomplete Model"
          description="Choose any OpenRouter model for autocomplete"
          onReset={() =>
            updateSetting("aiAutocompleteModelId", getDefaultSetting("aiAutocompleteModelId"))
          }
          canReset={settings.aiAutocompleteModelId !== getDefaultSetting("aiAutocompleteModelId")}
        >
          <div className="flex items-center gap-2">
            <Select
              value={settings.aiAutocompleteModelId}
              options={autocompleteModels.map((model) => ({
                value: model.id,
                label: model.name,
              }))}
              onChange={(value) => updateSetting("aiAutocompleteModelId", value)}
              size="xs"
              variant="secondary"
              searchable
              className="w-56"
              disabled={!aiCompletionAllowedByPolicy}
            />
            <Button
              variant="secondary"
              size="xs"
              onClick={loadAutocompleteModels}
              disabled={isLoadingAutocompleteModels || !aiCompletionAllowedByPolicy}
              title="Refresh model list"
            >
              <RefreshCw className={cn(isLoadingAutocompleteModels && "animate-spin")} />
            </Button>
          </div>
        </SettingRow>
        {autocompleteModelError && (
          <div className="ui-font ui-text-sm mt-1 flex items-center gap-1.5 px-1 text-error">
            <AlertCircle />
            <span>{autocompleteModelError}</span>
          </div>
        )}
        <div className="ui-font ui-text-sm px-1 text-text-lighter">
          Pro uses Athas-hosted autocomplete credit. Free can use BYOK by setting an OpenRouter API
          key in the API Keys section.
        </div>
        {managedPolicy ? (
          <div className="ui-font ui-text-sm px-1 text-text-lighter">
            Enterprise policy:{" "}
            {aiCompletionAllowedByPolicy ? "AI completion enabled." : "AI completion disabled."}{" "}
            {byokAllowedByPolicy ? "BYOK allowed." : "BYOK blocked."}
          </div>
        ) : null}
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
            className="gap-1.5 text-error hover:bg-error/10"
          >
            <Trash2 />
            {isClearingChats ? "Clearing..." : "Clear All"}
          </Button>
        </SettingRow>
      </Section>
    </div>
  );
};
