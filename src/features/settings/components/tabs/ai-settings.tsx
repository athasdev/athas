import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { McpServerSettings } from "@/features/ai/components/mcp/mcp-server-settings";
import { AgentAllowedActionsSettings } from "@/features/ai/components/permissions/agent-allowed-actions-settings";
import { CodexSettings } from "@/features/ai/integrations/codex/codex-settings";
import {
  MAX_INTELLIGENCE_AGENT_STEPS,
  MIN_INTELLIGENCE_AGENT_STEPS,
} from "@/features/ai/intelligence/lib/intelligence-agent-steps";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { TypedConfirmAction } from "@/features/settings/components/typed-confirm-action";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import NumberInput from "@/ui/number-input";
import Switch from "@/ui/switch";
import { AgentsSection } from "../ai/agents-section";
import { AthasPlanSection } from "../ai/athas-plan-section";
import { CustomEndpointSection } from "../ai/custom-endpoint-section";
import { DefaultModelSection } from "../ai/default-model-section";
import { FeatureModelsSection } from "../ai/feature-models-section";
import { OllamaSection } from "../ai/ollama-section";
import { ProviderKeysSection } from "../ai/provider-keys-section";
import { TabCompletionSection } from "../ai/tab-completion-section";
import Section, { SettingsView, SettingRow } from "../settings-section";

/** Settings > AI: the Athas plan and the model everything uses unless told otherwise. */
export function AIOverviewSettings() {
  return (
    <SettingsView>
      <AthasPlanSection />
      <DefaultModelSection />
      <FeatureModelsSection />
    </SettingsView>
  );
}

/** Settings > AI > Models & keys: where models come from besides Athas. */
export function AIModelsSettings() {
  return (
    <SettingsView>
      <ProviderKeysSection />
      <OllamaSection />
      <CustomEndpointSection />
    </SettingsView>
  );
}

export function TabCompletionSettings() {
  return (
    <SettingsView>
      <TabCompletionSection />
    </SettingsView>
  );
}

function AgentBehaviorSection() {
  const settings = useSettingsStore(
    useShallow((state) => ({
      aiFollowAgent: state.settings.aiFollowAgent,
      aiAgentMaxSteps: state.settings.aiAgentMaxSteps,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);

  return (
    <Section title="Agent behavior">
      <SettingRow
        label="Follow Agent"
        description="Start new agent chats with the editor following the files the agent works in"
        onReset={() => updateSetting("aiFollowAgent", getDefaultSetting("aiFollowAgent"))}
        canReset={settings.aiFollowAgent !== getDefaultSetting("aiFollowAgent")}
      >
        <Switch
          checked={settings.aiFollowAgent}
          onChange={(checked) => updateSetting("aiFollowAgent", checked)}
        />
      </SettingRow>
      <SettingRow
        label="Steps before pausing"
        description="How many model requests the Athas agent makes in one turn before it pauses and asks to continue"
        onReset={() => updateSetting("aiAgentMaxSteps", getDefaultSetting("aiAgentMaxSteps"))}
        canReset={settings.aiAgentMaxSteps !== getDefaultSetting("aiAgentMaxSteps")}
      >
        <NumberInput
          min={String(MIN_INTELLIGENCE_AGENT_STEPS)}
          max={String(MAX_INTELLIGENCE_AGENT_STEPS)}
          step="1"
          value={settings.aiAgentMaxSteps}
          onChange={(value) => updateSetting("aiAgentMaxSteps", value)}
        />
      </SettingRow>
    </Section>
  );
}

function ChatHistorySection() {
  const { showToast } = useToast();
  const [isClearing, setIsClearing] = useState(false);

  return (
    <Section title="Chat history">
      <SettingRow label="Clear chat history" description="Permanently delete every agent chat">
        <TypedConfirmAction
          actionLabel="Clear All"
          busyLabel="Clearing..."
          isBusy={isClearing}
          onConfirm={async () => {
            setIsClearing(true);
            try {
              await useAIChatStore.getState().actions.clearAllChats();
              showToast({ message: "Chat history cleared", type: "success" });
            } finally {
              setIsClearing(false);
            }
          }}
        />
      </SettingRow>
    </Section>
  );
}

/** Settings > AI > Agents: other coding agents, what agents may do alone, and past chats. */
export function AIAgentsSettings() {
  return (
    <SettingsView>
      <AgentsSection />
      <CodexSettings />
      <AgentBehaviorSection />
      <AgentAllowedActionsSettings />
      <ChatHistorySection />
    </SettingsView>
  );
}

export function McpSettings() {
  return (
    <SettingsView>
      <McpServerSettings />
    </SettingsView>
  );
}
