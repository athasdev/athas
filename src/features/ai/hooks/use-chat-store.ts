import { useAIChatStore } from "../store/store";

export function useChatState() {
  return {
    selectedBufferIds: useAIChatStore((state) => state.selectedBufferIds),
    selectedFilesPaths: useAIChatStore((state) => state.selectedFilesPaths),
    chats: useAIChatStore((state) => state.chats),
    currentChatId: useAIChatStore((state) => state.currentChatId),
    hasApiKey: useAIChatStore((state) => state.hasApiKey),
    isChatHistoryVisible: useAIChatStore((state) => state.isChatHistoryVisible),
    apiKeyModalState: useAIChatStore((state) => state.apiKeyModalState),
    isTyping: useAIChatStore((state) => state.isTyping),
    streamingMessageId: useAIChatStore((state) => state.streamingMessageId),
    mode: useAIChatStore((state) => state.mode),
    outputStyle: useAIChatStore((state) => state.outputStyle),
  };
}

export function useChatActions() {
  return {
    autoSelectBuffer: useAIChatStore((state) => state.autoSelectBuffer),
    checkApiKey: useAIChatStore((state) => state.checkApiKey),
    checkAllProviderApiKeys: useAIChatStore((state) => state.checkAllProviderApiKeys),
    setInput: useAIChatStore((state) => state.setInput),
    setIsTyping: useAIChatStore((state) => state.setIsTyping),
    setStreamingMessageId: useAIChatStore((state) => state.setStreamingMessageId),
    createNewChat: useAIChatStore((state) => state.createNewChat),
    deleteChat: useAIChatStore((state) => state.deleteChat),
    updateChatTitle: useAIChatStore((state) => state.updateChatTitle),
    addMessage: useAIChatStore((state) => state.addMessage),
    updateMessage: useAIChatStore((state) => state.updateMessage),
    setIsChatHistoryVisible: useAIChatStore((state) => state.setIsChatHistoryVisible),
    setApiKeyModalState: useAIChatStore((state) => state.setApiKeyModalState),
    saveApiKey: useAIChatStore((state) => state.saveApiKey),
    removeApiKey: useAIChatStore((state) => state.removeApiKey),
    hasProviderApiKey: useAIChatStore((state) => state.hasProviderApiKey),
    getCurrentChat: useAIChatStore((state) => state.getCurrentChat),
    getCurrentMessages: useAIChatStore((state) => state.getCurrentMessages),
    getCurrentAgentId: useAIChatStore((state) => state.getCurrentAgentId),
    switchToChat: useAIChatStore((state) => state.switchToChat),
    addMessageToQueue: useAIChatStore((state) => state.addMessageToQueue),
    processNextMessage: useAIChatStore((state) => state.processNextMessage),
    regenerateResponse: useAIChatStore((state) => state.regenerateResponse),
  };
}
