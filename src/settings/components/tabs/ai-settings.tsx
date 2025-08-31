import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import ApiKeyModal from "@/components/api-key-modal";
import Button from "@/components/ui/button";
import Dropdown from "@/components/ui/dropdown";
import Section, { SettingRow } from "@/components/ui/section";
import Switch from "@/components/ui/switch";
import { useSettingsStore } from "@/settings/store";
import { useAIChatStore } from "@/stores/ai-chat/store";
import {
  getAvailableProviders,
  getModelById,
  setClaudeCodeAvailability,
} from "@/types/ai-provider";
import type { ClaudeStatus } from "@/types/claude";

export const AISettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const [apiKeysVisible, setApiKeysVisible] = useState(false);

  // Check Claude Code availability on mount
  useEffect(() => {
    const checkClaudeCodeStatus = async () => {
      try {
        const status = await invoke<ClaudeStatus>("get_claude_status");
        setClaudeCodeAvailability(status.interceptor_running);
      } catch {
        // If we can't check status, assume it's not available
        setClaudeCodeAvailability(false);
      }
    };
    checkClaudeCodeStatus();
  }, []);

  // Local state for immediate modal response
  const [localModalState, setLocalModalState] = useState<{
    isOpen: boolean;
    providerId: string | null;
  }>({
    isOpen: false,
    providerId: null,
  });

  // API Key functions from AI chat store
  const saveApiKey = useAIChatStore((state) => state.saveApiKey);
  const removeApiKey = useAIChatStore((state) => state.removeApiKey);
  const hasProviderApiKey = useAIChatStore((state) => state.hasProviderApiKey);

  const currentProvider = getAvailableProviders().find((p) => p.id === settings.aiProviderId);
  const currentModel = getModelById(settings.aiProviderId, settings.aiModelId);

  const providerOptions = getAvailableProviders().map((provider) => ({
    value: provider.id,
    label: provider.name,
  }));

  const modelOptions =
    currentProvider?.models.map((model) => ({
      value: model.id,
      label: model.name,
    })) || [];

  const handleProviderChange = (providerId: string) => {
    const provider = getAvailableProviders().find((p) => p.id === providerId);
    if (provider && provider.models.length > 0) {
      updateSetting("aiProviderId", providerId);
      updateSetting("aiModelId", provider.models[0].id);
    }
  };

  const handleModelChange = (modelId: string) => {
    updateSetting("aiModelId", modelId);
  };

  const handleApiKeyRequest = (providerId: string) => {
    setLocalModalState({ isOpen: true, providerId });
  };

  return (
    <div className="space-y-4">
      <Section title="AI Provider">
        <SettingRow label="Provider" description="Choose your AI service provider">
          <Dropdown
            value={settings.aiProviderId}
            options={providerOptions}
            onChange={handleProviderChange}
            className="w-40"
            size="xs"
          />
        </SettingRow>

        <SettingRow label="Model" description="Select the AI model to use">
          <Dropdown
            value={settings.aiModelId}
            options={modelOptions}
            onChange={handleModelChange}
            className="w-40"
            size="xs"
          />
        </SettingRow>

        {currentModel && (
          <SettingRow
            label="Model Info"
            description={`${currentModel.maxTokens.toLocaleString()} tokens • ${
              currentModel.costPer1kTokens ? `$${currentModel.costPer1kTokens}/1k tokens` : "Free"
            }`}
          >
            <span className="text-text-lighter text-xs">
              {currentProvider?.requiresApiKey ? "API Key Required" : "Ready"}
            </span>
          </SettingRow>
        )}
      </Section>

      <Section title="AI Features">
        <SettingRow label="AI Chat" description="Enable AI-powered chat assistant">
          <Switch
            checked={settings.coreFeatures.aiChat}
            onChange={(checked) =>
              updateSetting("coreFeatures", { ...settings.coreFeatures, aiChat: checked })
            }
            size="sm"
          />
        </SettingRow>

        <SettingRow label="AI Completion" description="Enable AI code completion in editor">
          <Switch
            checked={settings.aiCompletion}
            onChange={(checked) => updateSetting("aiCompletion", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="API Keys">
        <SettingRow label="Manage API Keys">
          <Button variant="outline" size="xs" onClick={() => setApiKeysVisible(!apiKeysVisible)}>
            {apiKeysVisible ? "Hide" : "Show"}
          </Button>
        </SettingRow>

        {apiKeysVisible &&
          getAvailableProviders()
            .filter((provider) => provider.requiresApiKey)
            .map((provider) => (
              <SettingRow key={provider.id} label={provider.name}>
                <Button variant="ghost" size="xs" onClick={() => handleApiKeyRequest(provider.id)}>
                  {hasProviderApiKey(provider.id) ? "Update" : "Configure"}
                </Button>
              </SettingRow>
            ))}
      </Section>

      <Section title="Chat Behavior">
        <SettingRow
          label="Auto-scroll to Bottom"
          description="Automatically scroll to new messages"
        >
          <Switch checked={true} onChange={() => {}} size="sm" />
        </SettingRow>

        <SettingRow
          label="Remember Context"
          description="Include recent file context in conversations"
        >
          <Switch checked={true} onChange={() => {}} size="sm" />
        </SettingRow>

        <SettingRow label="Syntax Highlighting" description="Enable code highlighting in chat">
          <Switch checked={true} onChange={() => {}} size="sm" />
        </SettingRow>
      </Section>

      <Section title="Performance">
        <SettingRow label="Stream Responses" description="Show AI responses as they generate">
          <Switch checked={true} onChange={() => {}} size="sm" />
        </SettingRow>

        <SettingRow
          label="Max Context Length"
          description="Maximum tokens for conversation context"
        >
          <Dropdown
            value="8000"
            options={[
              { value: "4000", label: "4K tokens" },
              { value: "8000", label: "8K tokens" },
              { value: "16000", label: "16K tokens" },
              { value: "32000", label: "32K tokens" },
            ]}
            onChange={() => {}}
            className="w-24"
            size="xs"
          />
        </SettingRow>
      </Section>

      {/* API Key Modal */}
      <ApiKeyModal
        isOpen={localModalState.isOpen}
        onClose={() => setLocalModalState({ isOpen: false, providerId: null })}
        providerId={localModalState.providerId || ""}
        onSave={saveApiKey}
        onRemove={removeApiKey}
        hasExistingKey={
          localModalState.providerId ? hasProviderApiKey(localModalState.providerId) : false
        }
      />
    </div>
  );
};
