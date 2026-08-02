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

async function buildProviderApiKeyMap(
  subscription: ReturnType<typeof useAuthStore.getState>["subscription"],
) {
  const entries = await Promise.all(
    getAvailableProviders().map(async (provider) => {
      try {
        if (!provider.requiresApiKey) {
          return [provider.id, true] as const;
        }

        const token = await getProviderApiToken(provider.id);
        return [
          provider.id,
          canUseProviderWithoutApiKey({
            providerId: provider.id,
            subscription,
            hasStoredKey: Boolean(token),
            requiresApiKey: provider.requiresApiKey,
          }),
        ] as const;
      } catch {
        return [provider.id, false] as const;
      }
    }),
  );

  return new Map(entries);
}

function getProviderAccessFromMap(providerId: string, providerApiKeys: Map<string, boolean>) {
  const provider = getProviderById(providerId);
  if (!provider) return false;
  if (!provider.requiresApiKey) return true;
  return providerApiKeys.get(providerId) ?? false;
}

export function createProviderActions(set: SetAIChatStore, get: GetAIChatStore): ProviderActions {
  const refreshProviderAccess = async () => {
    const subscription = useAuthStore.getState().subscription;
    const providerApiKeys = await buildProviderApiKeyMap(subscription);
    const currentProviderId = useSettingsStore.getState().settings.aiProviderId;

    set((state) => {
      state.providerApiKeys = providerApiKeys;
      state.hasApiKey = getProviderAccessFromMap(currentProviderId, providerApiKeys);
    });
  };

  return {
    checkApiKey: async (providerId) => {
      try {
        const provider = getProviderById(providerId);
        const subscription = useAuthStore.getState().subscription;

        if (provider && !provider.requiresApiKey) {
          set((state) => {
            state.hasApiKey = true;
          });
          return;
        }

        const token = await getProviderApiToken(providerId);
        set((state) => {
          state.hasApiKey = canUseProviderWithoutApiKey({
            providerId,
            subscription,
            hasStoredKey: Boolean(token),
            requiresApiKey: provider?.requiresApiKey ?? true,
          });
        });
      } catch (error) {
        console.error("Error checking API key:", error);
        set((state) => {
          state.hasApiKey = false;
        });
      }
    },
    checkAllProviderApiKeys: refreshProviderAccess,
    saveApiKey: async (providerId, apiKey) => {
      try {
        if (!(await validateProviderApiKey(providerId, apiKey))) {
          return false;
        }

        await storeProviderApiToken(providerId, apiKey);
        await refreshProviderAccess();
        return true;
      } catch (error) {
        console.error("Error saving API key:", error);
        return false;
      }
    },
    removeApiKey: async (providerId) => {
      try {
        await removeProviderApiToken(providerId);
        await refreshProviderAccess();
      } catch (error) {
        console.error("Error removing API key:", error);
        throw error;
      }
    },
    hasProviderApiKey: (providerId) => get().providerApiKeys.get(providerId) ?? false,
    setDynamicModels: (providerId, models) =>
      set((state) => {
        state.dynamicModels[providerId] = models;
      }),
  };
}
