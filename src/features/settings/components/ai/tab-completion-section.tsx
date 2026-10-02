import { ModelConnectionPicker } from "@/features/ai/components/selectors/model-connection-picker";
import { useModelName } from "@/features/ai/components/selectors/model-connection-menu";
import { useProviderById } from "@/features/ai/hooks/use-available-providers";
import { resolveAutocompleteConnection } from "@/features/ai/intelligence/lib/resolve-intelligence-connection";
import type { IntelligenceConnection } from "@/features/ai/intelligence/types/intelligence.types";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { useAIModelSettings } from "@/features/settings/hooks/use-ai-model-settings";
import { withTaskConnection } from "@/features/settings/lib/ai-model-preferences";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import Badge from "@/ui/badge";
import Switch from "@/ui/switch";
import Section, { SettingRow } from "../settings-section";

const AUTOMATIC = "Automatic";

function useConnectionName(connection: IntelligenceConnection | null) {
  const provider = useProviderById(connection?.providerId ?? "");
  const modelName = useModelName(connection?.providerId ?? "", connection?.modelId ?? "");
  if (!connection) return { model: "", provider: "" };
  return {
    model: modelName ?? connection.modelId,
    provider: provider?.name ?? connection.providerId,
  };
}

/**
 * Tab completion has its own model. On Automatic it uses Athas's Tab model, or the default model
 * when it runs locally or when Athas is not available, so a local setup never sends code to Athas
 * without the user choosing it.
 */
export function TabCompletionSection() {
  const state = useAIModelSettings();
  const enabled = useSettingsStore((store) => store.settings.aiCompletion);
  const updateSetting = useSettingsStore((store) => store.actions.updateSetting);
  const policy = useAuthStore((store) => store.subscription?.enterprise?.policy);
  const allowed = policy?.managedMode ? policy.aiCompletionEnabled : true;

  const stored = state.preferences.tasks.autocomplete;
  const choice = stored && stored.providerId !== "auto" ? stored : null;
  const resolved = resolveAutocompleteConnection({
    ...state.context,
    isLocalProvider: state.isLocalProvider,
  });
  const resolvedName = useConnectionName(resolved);
  const defaultIsLocal = state.isLocalProvider(state.defaultConnection.providerId);
  const resolvedIsLocal = resolved ? state.isLocalProvider(resolved.providerId) : false;

  const describeModel = () => {
    if (!resolved) {
      if (defaultIsLocal) return "Choose a local model; Automatic never uses Athas here";
      return state.isAuthenticated
        ? "Athas Tab needs Pro, or choose your own model"
        : "Sign in for Athas Tab, or choose your own model";
    }
    const prefix = choice ? "" : "Automatic: ";
    if (resolved.providerId === "athas") return `${prefix}Athas Tab, included in Pro`;
    if (resolvedIsLocal) return `${prefix}${resolvedName.model}, runs locally`;
    return `${prefix}${resolvedName.model} on your ${resolvedName.provider} key${
      defaultIsLocal ? ", sends code off your network" : ""
    }`;
  };

  return (
    <Section title="Suggestions">
      <SettingRow
        label="Tab completion"
        description={allowed ? undefined : "Turned off by your organization"}
        onReset={() => updateSetting("aiCompletion", getDefaultSetting("aiCompletion"))}
        canReset={enabled !== getDefaultSetting("aiCompletion")}
      >
        <Switch
          checked={allowed ? enabled : false}
          onChange={(checked) => updateSetting("aiCompletion", checked)}
          disabled={!allowed}
        />
      </SettingRow>
      <SettingRow
        label="Model"
        labelAccessory={
          allowed && enabled && !resolved ? <Badge tone="warning">Off until chosen</Badge> : null
        }
        description={describeModel()}
      >
        <ModelConnectionPicker
          aria-label="Tab completion model"
          purpose="completion"
          value={choice}
          inheritLabel={AUTOMATIC}
          onChange={(connection) =>
            state.actions.change(withTaskConnection(state.preferences, "autocomplete", connection))
          }
          disabled={state.locked || !allowed || !enabled}
        />
      </SettingRow>
    </Section>
  );
}
