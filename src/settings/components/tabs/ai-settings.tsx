import { useState } from "react";
import Button from "@/components/ui/button";
import Dropdown from "@/components/ui/dropdown";
import Section, { SettingRow } from "@/components/ui/section";
import Switch from "@/components/ui/switch";
import { useSettingsStore } from "@/settings/store";
import { getAvailableProviders, getModelById } from "@/types/ai-provider";

export const AISettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const [apiKeysVisible, setApiKeysVisible] = useState(false);

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
    </div>
  );
};
