import { create } from "zustand";
import { combine, persist } from "zustand/middleware";
import type { CoreFeaturesState } from "../models/feature.types";

const initialState = {
  // AI Chat Settings
  aiProviderId: "openai",
  aiModelId: "gpt-4o-mini",
  aiChatWidth: 400,
  isAIChatVisible: false,
  // Extensions Settings
  extensionsActiveTab: "all" as "all" | "core" | "language-server" | "theme",
  // Tab Settings
  maxOpenTabs: 10,
  // Core Features
  coreFeatures: {
    git: true,
    remote: true,
    terminal: true,
    search: true,
    diagnostics: true,
    aiChat: true,
    breadcrumbs: true,
  } as CoreFeaturesState,
};

const storeCreator = combine(initialState, (set) => ({
  // Actions
  setAIProvider: (providerId: string) => set({ aiProviderId: providerId }),
  setAIModel: (modelId: string) => set({ aiModelId: modelId }),
  setAIProviderAndModel: (providerId: string, modelId: string) =>
    set({ aiProviderId: providerId, aiModelId: modelId }),
  setAIChatWidth: (width: number) => set({ aiChatWidth: width }),
  setIsAIChatVisible: (visible: boolean) => set({ isAIChatVisible: visible }),
  setExtensionsActiveTab: (tab: "all" | "core" | "language-server" | "theme") =>
    set({ extensionsActiveTab: tab }),
  setCoreFeatures: (features: CoreFeaturesState) => set({ coreFeatures: features }),
}));

export const usePersistentSettingsStore = create<ReturnType<typeof storeCreator>>()(
  persist(storeCreator, {
    name: "athas-persistent-settings",
    version: 1,
  }),
);
