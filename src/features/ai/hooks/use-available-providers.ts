import { useSyncExternalStore } from "react";
import {
  getAvailableProviders,
  subscribeToAvailableProviders,
  type ModelProvider,
} from "@/features/ai/types/providers.types";

export function useAvailableProviders(): ModelProvider[] {
  return useSyncExternalStore(
    subscribeToAvailableProviders,
    getAvailableProviders,
    getAvailableProviders,
  );
}

export function useProviderById(providerId: string): ModelProvider | undefined {
  return useAvailableProviders().find((provider) => provider.id === providerId);
}
