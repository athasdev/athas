import type { ChatAcpEventInput } from "../lib/acp-event-timeline";
import { PANEL_CHAT_SCOPE_ID } from "../lib/chat-scope";
import { getQueuedMessageCounts } from "../lib/message-queue";
import { createDefaultChatScopeState } from "../store/scope-defaults";
import { useAIChatStore } from "../store/store";
import type { ChatMode, PastedImage } from "../store/types";
import type { AcpPlanEntry, SessionMode, SlashCommand } from "../types/acp";
import type { AgentType, ChatScopeId } from "../types/ai-chat";
import type { ChatAcpPermissionRequest, ChatAcpToolEventData } from "../types/chat-ui";

export function useChatState(scopeId: ChatScopeId = PANEL_CHAT_SCOPE_ID) {
  const scopeState = useAIChatStore(
    (state) => state.chatScopes[scopeId] ?? createDefaultChatScopeState(scopeId),
  );
  const queueCounts = getQueuedMessageCounts(scopeState.messageQueue);

  return {
    chats: useAIChatStore((state) => state.chats),
    currentChatId: scopeState.currentChatId,
    selectedAgentId: scopeState.selectedAgentId,
    input: scopeState.input,
    pastedImages: scopeState.pastedImages,
    selectedBufferIds: scopeState.selectedBufferIds,
    selectedFilesPaths: scopeState.selectedFilesPaths,
    isContextDropdownOpen: scopeState.isContextDropdownOpen,
    isSendAnimating: scopeState.isSendAnimating,
    queueCount: queueCounts.total,
    steeringQueueCount: queueCounts.steering,
    followUpQueueCount: queueCounts.followUp,
    hasApiKey: useAIChatStore((state) => state.hasApiKey),
    isChatHistoryVisible: scopeState.isChatHistoryVisible,
    apiKeyModalState: useAIChatStore((state) => state.apiKeyModalState),
    isTyping: scopeState.isTyping,
    streamingMessageId: scopeState.streamingMessageId,
    mode: scopeState.mode,
    outputStyle: useAIChatStore((state) => state.outputStyle),
    availableSlashCommands: scopeState.availableSlashCommands,
    sessionModeState: scopeState.sessionModeState,
  };
}

export function useChatActions(scopeId: ChatScopeId = PANEL_CHAT_SCOPE_ID) {
  return {
    autoSelectBuffer: (bufferId: string) =>
      useAIChatStore.getState().autoSelectBuffer(bufferId, scopeId),
    checkApiKey: useAIChatStore((state) => state.checkApiKey),
    checkAllProviderApiKeys: useAIChatStore((state) => state.checkAllProviderApiKeys),
    setInput: (input: string) => useAIChatStore.getState().setInput(input, scopeId),
    setIsTyping: (isTyping: boolean) => useAIChatStore.getState().setIsTyping(isTyping, scopeId),
    setStreamingMessageId: (streamingMessageId: string | null) =>
      useAIChatStore.getState().setStreamingMessageId(streamingMessageId, scopeId),
    addPastedImage: (image: PastedImage) =>
      useAIChatStore.getState().addPastedImage(image, scopeId),
    removePastedImage: (imageId: string) =>
      useAIChatStore.getState().removePastedImage(imageId, scopeId),
    clearPastedImages: () => useAIChatStore.getState().clearPastedImages(scopeId),
    toggleBufferSelection: (bufferId: string) =>
      useAIChatStore.getState().toggleBufferSelection(bufferId, scopeId),
    toggleFileSelection: (filePath: string) =>
      useAIChatStore.getState().toggleFileSelection(filePath, scopeId),
    setIsContextDropdownOpen: (isOpen: boolean) =>
      useAIChatStore.getState().setIsContextDropdownOpen(isOpen, scopeId),
    setIsSendAnimating: (isAnimating: boolean) =>
      useAIChatStore.getState().setIsSendAnimating(isAnimating, scopeId),
    clearSelectedBuffers: () => useAIChatStore.getState().clearSelectedBuffers(scopeId),
    clearSelectedFiles: () => useAIChatStore.getState().clearSelectedFiles(scopeId),
    setSelectedAgentId: (agentId: AgentType) =>
      useAIChatStore.getState().setSelectedAgentId(agentId, scopeId),
    setMode: (mode: ChatMode) => useAIChatStore.getState().setMode(mode, scopeId),
    createNewChat: (agentId?: AgentType) =>
      useAIChatStore.getState().createNewChat(agentId, scopeId),
    changeCurrentChatAgent: (agentId: AgentType) =>
      useAIChatStore.getState().changeCurrentChatAgent(agentId, scopeId),
    ensureChatForAgent: (agentId: AgentType) =>
      useAIChatStore.getState().ensureChatForAgent(agentId, scopeId),
    deleteChat: (chatId: string) => useAIChatStore.getState().deleteChat(chatId, scopeId),
    updateChatTitle: useAIChatStore((state) => state.updateChatTitle),
    addMessage: useAIChatStore((state) => state.addMessage),
    updateMessage: useAIChatStore((state) => state.updateMessage),
    setIsChatHistoryVisible: (isVisible: boolean) =>
      useAIChatStore.getState().setIsChatHistoryVisible(isVisible, scopeId),
    setApiKeyModalState: useAIChatStore((state) => state.setApiKeyModalState),
    saveApiKey: useAIChatStore((state) => state.saveApiKey),
    removeApiKey: useAIChatStore((state) => state.removeApiKey),
    hasProviderApiKey: useAIChatStore((state) => state.hasProviderApiKey),
    getCurrentChat: () => useAIChatStore.getState().getCurrentChat(scopeId),
    getCurrentMessages: () => useAIChatStore.getState().getCurrentMessages(scopeId),
    getEffectiveMessages: () => useAIChatStore.getState().getEffectiveMessages(scopeId),
    getCurrentAgentId: () => useAIChatStore.getState().getCurrentAgentId(scopeId),
    switchToChat: (chatId: string) => useAIChatStore.getState().switchToChat(chatId, scopeId),
    continueChatInPlace: (chatId: string) =>
      useAIChatStore.getState().continueChatInPlace(chatId, scopeId),
    forkChatFromChat: (
      sourceChatId: string,
      targetScopeId?: ChatScopeId,
      branchPointMessageId?: string | null,
    ) =>
      useAIChatStore.getState().forkChatFromChat(sourceChatId, targetScopeId, branchPointMessageId),
    compactChat: (reason?: "manual" | "threshold" | "overflow") =>
      useAIChatStore.getState().compactChat(reason, scopeId),
    summarizeBranchTransition: (sourceChatId: string, targetChatId: string) =>
      useAIChatStore.getState().summarizeBranchTransition(sourceChatId, targetChatId),
    addMessageToQueue: (message: string) =>
      useAIChatStore.getState().addMessageToQueue(message, "steering", scopeId),
    addFollowUpMessageToQueue: (message: string) =>
      useAIChatStore.getState().addMessageToQueue(message, "follow-up", scopeId),
    processNextMessage: () => useAIChatStore.getState().processNextMessage(scopeId),
    regenerateResponse: () => useAIChatStore.getState().regenerateResponse(scopeId),
    setAvailableSlashCommands: (commands: SlashCommand[]) =>
      useAIChatStore.getState().setAvailableSlashCommands(commands, scopeId),
    getFilteredSlashCommands: () => useAIChatStore.getState().getFilteredSlashCommands(scopeId),
    changeSessionMode: (modeId: string) =>
      useAIChatStore.getState().changeSessionMode(modeId, scopeId),
    setSessionModeState: (currentModeId: string | null, availableModes: SessionMode[]) =>
      useAIChatStore.getState().setSessionModeState(currentModeId, availableModes, scopeId),
    setCurrentModeId: (modeId: string) =>
      useAIChatStore.getState().setCurrentModeId(modeId, scopeId),
    appendAcpActivityEvent: (event: ChatAcpEventInput) =>
      useAIChatStore.getState().appendAcpActivityEvent(event, scopeId),
    completeAcpToolEvent: (activityId: string, success: boolean, tool?: ChatAcpToolEventData) =>
      useAIChatStore.getState().completeAcpToolEvent(activityId, success, tool, scopeId),
    setAcpPlanEntries: (entries: AcpPlanEntry[]) =>
      useAIChatStore.getState().setAcpPlanEntries(entries, scopeId),
    addAcpPermissionRequest: (
      permission: Omit<ChatAcpPermissionRequest, "status" | "timestamp" | "resolvedAt">,
    ) => useAIChatStore.getState().addAcpPermissionRequest(permission, scopeId),
    resolveAcpPermissionRequest: (requestId: string, status: "approved" | "denied") =>
      useAIChatStore.getState().resolveAcpPermissionRequest(requestId, status, scopeId),
    markPendingAcpPermissionsStale: () =>
      useAIChatStore.getState().markPendingAcpPermissionsStale(scopeId),
  };
}
