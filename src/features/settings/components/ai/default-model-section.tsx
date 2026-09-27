import { ModelConnectionPicker } from "@/features/ai/components/selectors/model-connection-picker";
import { useConnectedModelProviders } from "@/features/ai/components/selectors/model-connection-menu";
import { useProviderById } from "@/features/ai/hooks/use-available-providers";
import type { IntelligenceConnection } from "@/features/ai/intelligence/types/intelligence.types";
import { useAIModelSettings } from "@/features/settings/hooks/use-ai-model-settings";
import {
  isConnectionAvailable,
  withDefaultConnection,
} from "@/features/settings/lib/ai-model-preferences";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { SparkleIcon } from "@/ui/icons";
import Select from "@/ui/select";
import Section, { SettingRow } from "../settings-section";

function describeDefault(params: {
  connection: IntelligenceConnection;
  available: boolean;
  isLocal: boolean;
  isAuthenticated: boolean;
  providerName: string | undefined;
}) {
  const { connection, available, isLocal, isAuthenticated, providerName } = params;
  if (!available) {
    return isAuthenticated
      ? "Athas models need Pro. Choose one of your own models, or upgrade."
      : "Choose a model to start using AI in Athas.";
  }
  if (connection.providerId === "athas") {
    return connection.modelId === "auto"
      ? "Athas Automatic picks a suitable model for each request. Usage comes out of your included credit, then your balance."
      : "Hosted by Athas. Usage comes out of your included credit, then your balance.";
  }
  if (isLocal) return "Runs locally. Prompts and code never leave your network.";
  return `Runs on your ${providerName ?? connection.providerId} account, with your own key.`;
}

/**
 * The model new chats and every AI feature except Tab completion use. It saves as it changes and
 * is mirrored on this device, so the composer shows it before a chat exists.
 */
export function DefaultModelSection() {
  const state = useAIModelSettings();
  const { defaultConnection, hasIntelligence, isAuthenticated, locked, error, loading, actions } =
    state;
  const updateSetting = useSettingsStore((store) => store.actions.updateSetting);
  const provider = useProviderById(defaultConnection.providerId);
  const keyProviders = useConnectedModelProviders().filter((item) => item.requiresApiKey);
  const available = isConnectionAvailable(defaultConnection, hasIntelligence);
  const openModelsPage = (section: string) =>
    useUIState.getState().openSettings("ai-models", section);

  const changeDefault = (connection: IntelligenceConnection | null) => {
    if (!connection) return;
    actions.change(withDefaultConnection(state.preferences, connection));
    if (connection.providerId === "custom")
      void updateSetting("aiCustomModelId", connection.modelId);
    void updateSetting("aiProviderId", connection.providerId);
    void updateSetting("aiModelId", connection.modelId);
  };

  return (
    <Section
      title="Default model"
      description="New chats, inline edits, commit messages, and titles use it. Switch models for any chat from the composer."
    >
      {!available && keyProviders.length === 0 ? (
        <EmptyState
          variant="section"
          icon={<SparkleIcon />}
          title="Set up a model"
          message={
            isAuthenticated
              ? "Upgrade to Pro above for Athas models, add your own API key, or run models locally with Ollama."
              : "Sign in above to use Athas models, add your own API key, or run models locally with Ollama."
          }
          action={{ label: "Add an API key", onClick: () => openModelsPage("Your API keys") }}
          secondaryAction={{ label: "Use Ollama", onClick: () => openModelsPage("Ollama") }}
        />
      ) : null}
      {state.scopes.length > 1 ? (
        <SettingRow label="Settings for" description="Team settings apply to everyone on the team.">
          <Select
            aria-label="Model settings scope"
            value={state.scope}
            options={state.scopes.map((scope) => ({ value: scope.id, label: scope.name }))}
            disabled={loading}
            onChange={(scope) => void actions.setScope(scope)}
          />
        </SettingRow>
      ) : null}
      <SettingRow
        label="Default model"
        description={describeDefault({
          connection: defaultConnection,
          available,
          isLocal: state.isLocalProvider(defaultConnection.providerId),
          isAuthenticated,
          providerName: provider?.name,
        })}
      >
        <ModelConnectionPicker
          aria-label="Default model"
          value={available ? defaultConnection : null}
          onChange={changeDefault}
          disabled={locked}
        />
      </SettingRow>
      {error ? (
        <SettingRow label="Could not save" description={error}>
          <div className="flex gap-2">
            <Button disabled={loading || !state.editable} onClick={() => void actions.save()}>
              Try again
            </Button>
            {state.userId !== null ? (
              <Button disabled={loading} onClick={() => void actions.refresh(true)}>
                Use saved settings
              </Button>
            ) : null}
          </div>
        </SettingRow>
      ) : null}
    </Section>
  );
}
