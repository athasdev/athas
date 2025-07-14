import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PersistentSettings {
  // AI Chat Settings
  aiProviderId: string;
  aiModelId: string;
  aiChatWidth: number;
  isAIChatVisible: boolean;

  // Actions
  setAIProvider: (providerId: string) => void;
  setAIModel: (modelId: string) => void;
  setAIProviderAndModel: (providerId: string, modelId: string) => void;
  setAIChatWidth: (width: number) => void;
  setIsAIChatVisible: (visible: boolean) => void;
}

export const usePersistentSettingsStore = create<PersistentSettings>()(
  persist(
    set => ({
      // Default values
      aiProviderId: "openai",
      aiModelId: "gpt-4o-mini",
      aiChatWidth: 400,
      isAIChatVisible: false,

      // Actions
      setAIProvider: providerId => set({ aiProviderId: providerId }),
      setAIModel: modelId => set({ aiModelId: modelId }),
      setAIProviderAndModel: (providerId, modelId) =>
        set({ aiProviderId: providerId, aiModelId: modelId }),
      setAIChatWidth: width => set({ aiChatWidth: width }),
      setIsAIChatVisible: visible => set({ isAIChatVisible: visible }),
    }),
    {
      name: "athas-persistent-settings",
      version: 1,
    },
  ),
);
