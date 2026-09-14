import { canUseProviderWithoutApiKey } from "@/features/ai/lib/provider-access";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
  validateProviderApiKey,
} from "@/features/ai/services/ai-token-service";
import { getAvailableProviders, getProviderById } from "@/features/ai/types/providers.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import type { AIChatActions } from "./ai-chat-store.types";
import type { GetAIChatStore, SetAIChatStore } from "./ai-chat-store-context";

type ProviderActions = Pick<
  AIChatActions,
  | "checkApiKey"
  | "checkAllProviderApiKeys"
  | "saveApiKey"
  | "removeApiKey"
  | "hasProviderApiKey"
  | "setDynamicModels"
>;

export function getProviderAccessFromMap(
  providerId: string,
  providerApiKeys: Map<string, boolean>,
) {
  const provider = getProviderById(providerId);
  if (!provider) return false;
  if (!provider.requiresApiKey && providerId !== "athas") return true;
  return providerApiKeys.get(providerId) ?? false;
}

export function createProviderActions(set: SetAIChatStore, get: GetAIChatStore): ProviderActions {
  const inFlight = new Map<string, Promise<void>>();
  const revisions = new Map<string, number>();
  const checkApiKey = (providerId: string): Promise<void> => {
    const pending = inFlight.get(providerId);
    if (pending) return pending;
    const revision = revisions.get(providerId) ?? 0;
    const request = (async () => {
      const provider = getProviderById(providerId);
      let hasStoredKey = false;
      try {
        hasStoredKey = provider?.requiresApiKey
          ? Boolean(await getProviderApiToken(providerId))
          : false;
      } catch (error) {
        console.error("Error checking API key:", error);
      }
      if ((revisions.get(providerId) ?? 0) !== revision) return;
      const allowed =
        Boolean(provider) &&
        canUseProviderWithoutApiKey({
          providerId,
          subscription: useAuthStore.getState().subscription,
          hasStoredKey,
          requiresApiKey: provider?.requiresApiKey ?? true,
        });
      set((state) => {
        state.providerApiKeys.set(providerId, allowed);
        const defaultProviderId = useSettingsStore.getState().settings.aiProviderId;
        state.hasApiKey = getProviderAccessFromMap(defaultProviderId, state.providerApiKeys);
      });
    })();
    inFlight.set(providerId, request);
    void request.finally(() => {
      if (inFlight.get(providerId) === request) inFlight.delete(providerId);
    });
    return request;
  };
  const refreshProviderAccess = async () => {
    await Promise.all(getAvailableProviders().map((provider) => checkApiKey(provider.id)));
  };
  const invalidate = (providerId: string) => {
    revisions.set(providerId, (revisions.get(providerId) ?? 0) + 1);
    inFlight.delete(providerId);
    set((state) => {
      delete state.dynamicModels[providerId];
    });
  };

  return {
    checkApiKey,
    checkAllProviderApiKeys: refreshProviderAccess,
    saveApiKey: async (providerId, apiKey) => {
      try {
        if (!(await validateProviderApiKey(providerId, apiKey))) {
          return false;
        }

        await storeProviderApiToken(providerId, apiKey);
        invalidate(providerId);
        await checkApiKey(providerId);
        return true;
      } catch (error) {
        console.error("Error saving API key:", error);
        return false;
      }
    },
    removeApiKey: async (providerId) => {
      try {
        await removeProviderApiToken(providerId);
        invalidate(providerId);
        await checkApiKey(providerId);
      } catch (error) {
        console.error("Error removing API key:", error);
        throw error;
      }
    },
    hasProviderApiKey: (providerId) => getProviderAccessFromMap(providerId, get().providerApiKeys),
    setDynamicModels: (providerId, models) =>
      set((state) => {
        state.dynamicModels[providerId] = models;
      }),
  };
}
