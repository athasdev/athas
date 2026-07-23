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
    checkApiKey: useAIChatStore((state) => state.checkApiKey),
    checkAllProviderApiKeys: useAIChatStore((state) => state.checkAllProviderApiKeys),
    setPendingAgentLaunchRequest: useAIChatStore((state) => state.setPendingAgentLaunchRequest),
    createNewChat: useAIChatStore((state) => state.createNewChat),
    ensureChatSession: useAIChatStore((state) => state.ensureChatSession),
    ensureChatForAgent: useAIChatStore((state) => state.ensureChatForAgent),
    deleteChat: useAIChatStore((state) => state.deleteChat),
    updateChatTitle: useAIChatStore((state) => state.updateChatTitle),
    addMessage: useAIChatStore((state) => state.addMessage),
    updateMessage: useAIChatStore((state) => state.updateMessage),
    replaceUserMessage: useAIChatStore((state) => state.replaceUserMessage),
    getMessagesForChat: useAIChatStore((state) => state.getMessagesForChat),
    saveApiKey: useAIChatStore((state) => state.saveApiKey),
    removeApiKey: useAIChatStore((state) => state.removeApiKey),
    hasProviderApiKey: useAIChatStore((state) => state.hasProviderApiKey),
    switchToChat: useAIChatStore((state) => state.switchToChat),
  };
}
