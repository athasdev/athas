import { useModelName } from "@/features/ai/components/selectors/model-connection-menu";
import { useProviderById } from "@/features/ai/hooks/use-available-providers";
import { resolveAutocompleteConnection } from "@/features/ai/intelligence/lib/resolve-intelligence-connection";
import type { IntelligenceConnection } from "@/features/ai/intelligence/types/intelligence.types";
import { useAIModelSettings } from "@/features/settings/hooks/use-ai-model-settings";
import { withTaskConnection } from "@/features/settings/lib/ai-model-preferences";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/auth/stores/auth.store";

export const ATHAS_TAB_MODEL_NAME = "Athas Tab";

/**
 * The model Tab completion runs on, for every place that shows or changes it: the explicit
 * choice (null on Automatic), what that resolves to right now, and how to describe it.
 */
export function useTabCompletionModel() {
  const state = useAIModelSettings();
  const enabled = useSettingsStore((store) => store.settings.aiCompletion);
  const policy = useAuthStore((store) => store.subscription?.enterprise?.policy);
  const allowed = policy?.managedMode ? policy.aiCompletionEnabled : true;

  const stored = state.preferences.tasks.autocomplete;
  const choice = stored && stored.providerId !== "auto" ? stored : null;
  const resolved = resolveAutocompleteConnection({
    ...state.context,
    isLocalProvider: state.isLocalProvider,
  });
  const provider = useProviderById(resolved?.providerId ?? "");
  const modelName = useModelName(resolved?.providerId ?? "", resolved?.modelId ?? "");
  const defaultIsLocal = state.isLocalProvider(state.defaultConnection.providerId);
  const resolvedIsLocal = resolved ? state.isLocalProvider(resolved.providerId) : false;

  /** Short name for compact places, such as the editor toolbar menu. */
  const shortName = !resolved
    ? "Choose a model"
    : resolved.providerId === "athas"
      ? ATHAS_TAB_MODEL_NAME
      : (modelName ?? resolved.modelId);
  const providerName = resolved ? (provider?.name ?? resolved.providerId) : "";

  const describe = () => {
    if (!resolved) {
      if (defaultIsLocal) return "Choose a local model; Automatic never uses Athas here";
      return state.isAuthenticated
        ? "Athas Tab needs Pro, or choose your own model"
        : "Sign in for Athas Tab, or choose your own model";
    }
    const prefix = choice ? "" : "Automatic: ";
    if (resolved.providerId === "athas") return `${prefix}Athas Tab, included in Pro`;
    if (resolvedIsLocal) return `${prefix}${shortName}, runs locally`;
    return `${prefix}${shortName} on your ${providerName} key${
      defaultIsLocal ? ", sends code off your network" : ""
    }`;
  };

  return {
    allowed,
    enabled,
    choice,
    resolved,
    shortName,
    providerName,
    isAutomatic: !choice,
    isLocal: resolvedIsLocal,
    locked: state.locked,
    description: describe(),
    change: (connection: IntelligenceConnection | null) =>
      state.actions.change(withTaskConnection(state.preferences, "autocomplete", connection)),
  };
}
