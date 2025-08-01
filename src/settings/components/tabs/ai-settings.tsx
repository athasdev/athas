import { useState } from "react";
import Button from "@/components/ui/button";
import Dropdown from "@/components/ui/dropdown";
import Section, { SettingRow } from "@/components/ui/section";
import Switch from "@/components/ui/switch";
import { usePersistentSettingsStore } from "@/settings/stores/persistent-settings-store";
import { useSettingsStore } from "@/settings/stores/settings-store";
import { getAvailableProviders, getModelById } from "@/types/ai-provider";

export const AISettings = () => {
  const {
    aiProviderId,
    aiModelId,
    aiSyntaxHighlighting,
    setAIProviderAndModel,
    setAISyntaxHighlighting,
    coreFeatures,
    setCoreFeatures,
  } = usePersistentSettingsStore();

  const { settings, updateSetting } = useSettingsStore();
  const [apiKeysVisible, setApiKeysVisible] = useState(false);

  const currentProvider = getAvailableProviders().find((p) => p.id === aiProviderId);
  const currentModel = getModelById(aiProviderId, aiModelId);

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
      setAIProviderAndModel(providerId, provider.models[0].id);
    }
  };

  const handleModelChange = (modelId: string) => {
    setAIProviderAndModel(aiProviderId, modelId);
  };

  return (
    <div className="space-y-4">
      <Section title="AI Provider">
        <SettingRow label="Provider" description="Choose your AI service provider">
          <Dropdown
            value={aiProviderId}
            options={providerOptions}
            onChange={handleProviderChange}
            className="w-40"
            size="xs"
          />
        </SettingRow>

        <SettingRow label="Model" description="Select the AI model to use">
          <Dropdown
            value={aiModelId}
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
            checked={coreFeatures.aiChat}
            onChange={(checked) => setCoreFeatures({ ...coreFeatures, aiChat: checked })}
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
        <SettingRow label="Manage API Keys" description="Configure authentication for AI providers">
          <Button variant="outline" size="xs" onClick={() => setApiKeysVisible(!apiKeysVisible)}>
            {apiKeysVisible ? "Hide" : "Show"}
          </Button>
        </SettingRow>

        {apiKeysVisible &&
          getAvailableProviders()
            .filter((provider) => provider.requiresApiKey)
            .map((provider) => (
              <SettingRow
                key={provider.id}
                label={`${provider.name} API Key`}
                description={`Authentication for ${provider.name} services`}
              >
                <Button variant="ghost" size="xs">
                  Configure
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
          <Switch
            checked={aiSyntaxHighlighting}
            onChange={(checked) => setAISyntaxHighlighting(checked)}
            size="sm"
          />
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
    </div>
  );
};
