import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { isLocalAiProvider } from "@/features/ai/lib/local-ai-connection";
import { useIntelligenceSettingsStore } from "@/features/ai/intelligence/stores/intelligence-settings.store";
import { getEffectiveDefaultConnection } from "@/features/settings/lib/ai-model-preferences";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";

/**
 * The model preferences the AI settings pages edit, saved as they change, together with what the
 * default model resolves to on this device.
 */
export function useAIModelSettings() {
  const store = useIntelligenceSettingsStore(
    useShallow((state) => ({
      userId: state.userId,
      scope: state.scope,
      scopes: state.scopes,
      preferences: state.preferences,
      dirty: state.dirty,
      loading: state.loading,
      error: state.error,
      actions: state.actions,
    })),
  );
  const { hasIntelligence, isAuthenticated } = useProFeature();
  const settings = useSettingsStore(
    useShallow((state) => ({
      aiProviderId: state.settings.aiProviderId,
      aiModelId: state.settings.aiModelId,
      ollamaBaseUrl: state.settings.ollamaBaseUrl,
      aiCustomBaseUrl: state.settings.aiCustomBaseUrl,
      aiAutocompleteCustomBaseUrl: state.settings.aiAutocompleteCustomBaseUrl,
    })),
  );
  const editable = store.scopes.find((scope) => scope.id === store.scope)?.canEdit ?? false;
  const { dirty, error, loading, actions } = store;

  useEffect(() => {
    if (dirty && !loading && !error && editable) void actions.save();
  }, [actions, dirty, editable, error, loading]);

  const isLocalProvider = (providerId: string) => isLocalAiProvider(providerId, settings);
  const context = {
    preferences: store.preferences,
    hasIntelligence,
    personalConnection: { providerId: settings.aiProviderId, modelId: settings.aiModelId },
    personalConnectionIsLocal: isLocalProvider(settings.aiProviderId),
  };

  return {
    ...store,
    editable,
    locked: loading || !editable,
    hasIntelligence,
    isAuthenticated,
    context,
    isLocalProvider,
    defaultConnection: getEffectiveDefaultConnection(context),
  };
}
