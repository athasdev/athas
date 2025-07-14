import { create, type ExtractState } from "zustand";
import { combine, persist } from "zustand/middleware";

const initialState = {
  // AI Chat Settings
  aiProviderId: "openai",
  aiModelId: "gpt-4o-mini",
  aiChatWidth: 400,
  isAIChatVisible: false,
};

const storeCreator = combine(initialState, set => ({
  // Actions
  setAIProvider: (providerId: string) => set({ aiProviderId: providerId }),
  setAIModel: (modelId: string) => set({ aiModelId: modelId }),
  setAIProviderAndModel: (providerId: string, modelId: string) =>
    set({ aiProviderId: providerId, aiModelId: modelId }),
  setAIChatWidth: (width: number) => set({ aiChatWidth: width }),
  setIsAIChatVisible: (visible: boolean) => set({ isAIChatVisible: visible }),
}));

export const usePersistentSettingsStore = create<ReturnType<typeof storeCreator>>()(
  persist(storeCreator, {
    name: "athas-persistent-settings",
    version: 1,
  }),
);

export type PersistentSettings = ExtractState<typeof usePersistentSettingsStore>;
