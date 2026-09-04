import { useAIChatStore } from "../stores/ai-chat.store";

export function useChatState() {
  return {
    chats: useAIChatStore((state) => state.chats),
    currentChatId: useAIChatStore((state) => state.currentChatId),
    hasApiKey: useAIChatStore((state) => state.hasApiKey),
    pendingAgentLaunchRequest: useAIChatStore((state) => state.pendingAgentLaunchRequest),
    agentRuns: useAIChatStore((state) => state.agentRuns),
    agentMessageQueues: useAIChatStore((state) => state.agentMessageQueues),
    chatMessageLoadStates: useAIChatStore((state) => state.chatMessageLoadStates),
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
    startAgentRun: useAIChatStore((state) => state.actions.startAgentRun),
    updateAgentRun: useAIChatStore((state) => state.actions.updateAgentRun),
    finishAgentRun: useAIChatStore((state) => state.actions.finishAgentRun),
    enqueueAgentMessage: useAIChatStore((state) => state.actions.enqueueAgentMessage),
    prependAgentMessage: useAIChatStore((state) => state.actions.prependAgentMessage),
    dequeueAgentMessage: useAIChatStore((state) => state.actions.dequeueAgentMessage),
    moveQueuedAgentMessage: useAIChatStore((state) => state.actions.moveQueuedAgentMessage),
    removeQueuedAgentMessage: useAIChatStore((state) => state.actions.removeQueuedAgentMessage),
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
