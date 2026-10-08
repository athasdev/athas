import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { McpServerSettings } from "@/features/ai/components/mcp/mcp-server-settings";
import { AgentAllowedActionsSettings } from "@/features/ai/components/permissions/agent-allowed-actions-settings";
import { CodexSettings } from "@/features/ai/integrations/codex/codex-settings";
import {
  MAX_INTELLIGENCE_AGENT_STEPS,
  MIN_INTELLIGENCE_AGENT_STEPS,
} from "@/features/settings/services/ai-agent-steps";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useToast } from "@/utils/toast";
import { TypedConfirmAction } from "@/features/settings/components/typed-confirm-action";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import NumberInput from "@/ui/number-input";
import Switch from "@/ui/switch";
import Textarea from "@/ui/textarea";
import { AgentsSection } from "../ai/agents-section";
import { AthasPlanSection } from "../ai/athas-plan-section";
import { CustomEndpointSection } from "../ai/custom-endpoint-section";
import { DefaultModelSection } from "../ai/default-model-section";
import { FeatureModelsSection } from "../ai/feature-models-section";
import { OllamaSection } from "../ai/ollama-section";
import { ProviderKeysSection } from "../ai/provider-keys-section";
import { TabCompletionSection } from "../ai/tab-completion-section";
import Section, { SettingsView, SettingRow, SettingBlock } from "../settings-section";

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
        description="The editor follows the files an agent opens"
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
        control="number"
        description="Model requests per turn before asking to continue"
        onReset={() => updateSetting("aiAgentMaxSteps", getDefaultSetting("aiAgentMaxSteps"))}
        canReset={settings.aiAgentMaxSteps !== getDefaultSetting("aiAgentMaxSteps")}
      >
        <NumberInput
          width="full"
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

function AgentInstructionsSection() {
  const userRules = useSettingsStore((state) => state.settings.aiUserRules);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  return (
    <Section title="Agent instructions">
      <SettingRow
        label="User rules"
        control="field"
        description="Instructions for Athas's built-in agent across projects. External agents use their own configuration."
        onReset={() => updateSetting("aiUserRules", "")}
        canReset={Boolean(userRules)}
      >
        <Textarea
          aria-label="User rules"
          value={userRules}
          rows={4}
          font="mono"
          placeholder="Prefer small changes and run the relevant tests."
          onChange={(event) => updateSetting("aiUserRules", event.target.value)}
        />
      </SettingRow>
      <SettingBlock>
        <p className="ui-text-sm text-muted-foreground">
          Project instructions load from AGENTS.md, CLAUDE.md, .athas/rules and .cursor/rules. Root
          .athasignore, .aiignore and .cursorignore files exclude paths from automatic context, Tab
          completion and built-in workspace tools. External agents, terminal commands and MCP tools
          follow their own access rules.
        </p>
      </SettingBlock>
    </Section>
  );
}

function ChatHistorySection() {
  const { showToast } = useToast();
  const [isClearing, setIsClearing] = useState(false);

  return (
    <Section title="Chat history">
      <SettingRow label="Clear chat history">
        <TypedConfirmAction
          actionLabel="Clear All"
          variant="danger"
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
      <AgentInstructionsSection />
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
