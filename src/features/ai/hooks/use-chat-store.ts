import { useAIChatStore } from "../stores/ai-chat.store";

export function useChatState() {
  return {
    chats: useAIChatStore((state) => state.chats),
    currentChatId: useAIChatStore((state) => state.currentChatId),
    hasApiKey: useAIChatStore((state) => state.hasApiKey),
    pendingAgentLaunchRequest: useAIChatStore((state) => state.pendingAgentLaunchRequest),
    mode: useAIChatStore((state) => state.mode),
    outputStyle: useAIChatStore((state) => state.outputStyle),
  };
}

export function useChatActions() {
  return {
    checkApiKey: useAIChatStore((state) => state.actions.checkApiKey),
    checkAllProviderApiKeys: useAIChatStore((state) => state.actions.checkAllProviderApiKeys),
    setPendingAgentLaunchRequest: useAIChatStore(
      (state) => state.actions.setPendingAgentLaunchRequest,
    ),
    createNewChat: useAIChatStore((state) => state.actions.createNewChat),
    ensureChatSession: useAIChatStore((state) => state.actions.ensureChatSession),
    ensureChatForAgent: useAIChatStore((state) => state.actions.ensureChatForAgent),
    deleteChat: useAIChatStore((state) => state.actions.deleteChat),
    updateChatTitle: useAIChatStore((state) => state.actions.updateChatTitle),
    addMessage: useAIChatStore((state) => state.actions.addMessage),
    updateMessage: useAIChatStore((state) => state.actions.updateMessage),
    replaceUserMessage: useAIChatStore((state) => state.actions.replaceUserMessage),
    getMessagesForChat: useAIChatStore((state) => state.actions.getMessagesForChat),
    saveApiKey: useAIChatStore((state) => state.actions.saveApiKey),
    removeApiKey: useAIChatStore((state) => state.actions.removeApiKey),
    hasProviderApiKey: useAIChatStore((state) => state.actions.hasProviderApiKey),
    switchToChat: useAIChatStore((state) => state.actions.switchToChat),
  };
}
