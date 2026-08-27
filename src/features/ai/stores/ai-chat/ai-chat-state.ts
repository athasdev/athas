import type { AIChatState } from "./ai-chat-store.types";

export function createInitialAIChatState(): AIChatState {
  return {
    chats: [],
    currentChatId: null,
    selectedAgentId: "custom",
    pendingAgentLaunchRequest: null,
    agentRuns: {},
    agentMessageQueues: {},
    chatMessageLoadStates: {},
    mode: "chat",
    outputStyle: "default",
    hasApiKey: false,
    providerApiKeys: new Map(),
    dynamicModels: {},
    availableSlashCommands: [],
    sessionModeState: {
      currentModeId: null,
      availableModes: [],
    },
    acpStatus: null,
    sessionConfigOptions: [],
  };
}
