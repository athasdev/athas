import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import { resolveIntelligenceConnection } from "../lib/resolve-intelligence-connection";
import { useIntelligenceSettingsStore } from "../stores/intelligence-settings.store";
import type { IntelligenceTask } from "../types/intelligence.types";

export async function getIntelligenceConnection(task: IntelligenceTask) {
  const auth = useAuthStore.getState();
  await useIntelligenceSettingsStore.getState().actions.setUser(auth.user?.id ?? null);
  if (useAuthStore.getState().user?.id !== auth.user?.id)
    throw new Error("The active account changed. Try again.");
  if (useIntelligenceSettingsStore.getState().loading) {
    await new Promise<void>((resolve) => {
      const unsubscribe = useIntelligenceSettingsStore.subscribe((state) => {
        if (!state.loading) {
          unsubscribe();
          resolve();
        }
      });
    });
  }
  if (useAuthStore.getState().user?.id !== auth.user?.id)
    throw new Error("The active account changed. Try again.");
  const preferenceState = useIntelligenceSettingsStore.getState();
  if (preferenceState.scope !== "personal" && (preferenceState.loading || preferenceState.error)) {
    throw new Error("Team settings are unavailable. Select personal settings or reconnect.");
  }
  const settings = useSettingsStore.getState().settings;
  const connection = resolveIntelligenceConnection({
    task,
    preferences: useIntelligenceSettingsStore.getState().preferences,
    hasIntelligence: hasProductCapability(auth.subscription, "intelligence"),
    personalConnection: { providerId: settings.aiProviderId, modelId: settings.aiModelId },
  });
  assertIntelligenceConnectionAllowed(connection.providerId, task);
  return { ...connection, scope: preferenceState.scope, userId: auth.user?.id ?? null };
}

export function assertIntelligenceConnectionAllowed(providerId: string, task: IntelligenceTask) {
  const policy = useAuthStore.getState().subscription?.enterprise?.policy;
  if (policy?.managedMode) {
    if (
      !(task === "agent" ? policy.aiChatEnabled : policy.aiCompletionEnabled) ||
      (providerId !== "athas" && !policy.allowByok)
    ) {
      throw new Error("This AI connection is disabled by your organization.");
    }
  }
}
