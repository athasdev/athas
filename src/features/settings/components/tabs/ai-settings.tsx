import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AIModelSelector } from "@/features/ai/components/selectors/ai-model-selector";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AgentConfig, SessionMode } from "@/features/ai/types/acp";
import { getAvailableProviders, updateAgentStatus } from "@/features/ai/types/providers";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/stores/auth-store";
import Button from "@/ui/button";
import Dropdown from "@/ui/dropdown";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";
import { fetchAutocompleteModels } from "@/utils/autocomplete";
import { cn } from "@/utils/cn";

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
  const subscription = useAuthStore((state) => state.subscription);
  const { showToast } = useToast();
  const enterprisePolicy = subscription?.enterprise?.policy;
  const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
  const aiCompletionAllowedByPolicy = managedPolicy ? managedPolicy.aiCompletionEnabled : true;
  const byokAllowedByPolicy = managedPolicy ? managedPolicy.allowByok : true;

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

  // Get all providers that require authentication (but not API keys)
  const providersNeedingAuth = getAvailableProviders().filter(
    (p) => p.requiresAuth && !p.requiresApiKey,
  );

  return (
    <div className="space-y-4">
      <Section title="Provider & Model">
        <SettingRow label="Model" description="Choose your AI provider and model">
          <AIModelSelector
            providerId={settings.aiProviderId}
            modelId={settings.aiModelId}
            onProviderChange={(id) => handleProviderChange(id)}
            onModelChange={(id) => updateSetting("aiModelId", id)}
          />
        </SettingRow>
      </Section>

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
            checked={aiCompletionAllowedByPolicy ? settings.aiCompletion : false}
            onChange={(checked) => updateSetting("aiCompletion", checked)}
            disabled={!aiCompletionAllowedByPolicy}
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
              disabled={!aiCompletionAllowedByPolicy}
            />
            <Button
              variant="ghost"
              size="xs"
              onClick={loadAutocompleteModels}
              disabled={isLoadingAutocompleteModels || !aiCompletionAllowedByPolicy}
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
        {managedPolicy ? (
          <div className="px-1 text-text-lighter text-xs">
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
