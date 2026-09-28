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
import Select from "@/ui/select";
import Section, { SettingRow, SettingStatus } from "../settings-section";

function describeDefault(params: {
  connection: IntelligenceConnection;
  available: boolean;
  isLocal: boolean;
  isAuthenticated: boolean;
  providerName: string | undefined;
}) {
  const { connection, available, isLocal, isAuthenticated, providerName } = params;
  if (!available) return isAuthenticated ? "Athas models need Pro" : "Choose a model to start";
  if (connection.providerId === "athas")
    return connection.modelId === "auto" ? "Picks a model per request" : "Hosted by Athas";
  if (isLocal) return "Runs locally";
  return `Your ${providerName ?? connection.providerId} key`;
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
  const openModelsPage = (section?: string) =>
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
    <Section title="Default model">
      {!available && keyProviders.length === 0 ? (
        <SettingRow
          label="No model yet"
          description="Use Athas, your own API key, or Ollama"
          activateOnClick={false}
        >
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => openModelsPage("Ollama")}>
              Use Ollama
            </Button>
            <Button onClick={() => openModelsPage()}>Add API Key</Button>
          </div>
        </SettingRow>
      ) : null}
      {state.scopes.length > 1 ? (
        <SettingRow label="Settings for">
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
        <SettingRow
          label="Could not save"
          description={<SettingStatus tone="danger">{error}</SettingStatus>}
        >
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
