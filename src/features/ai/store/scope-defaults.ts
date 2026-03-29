import { isHarnessChatScopeId, PANEL_CHAT_SCOPE_ID } from "@/features/ai/lib/chat-scope";
import type { AgentType, ChatScopeId } from "@/features/ai/types/ai-chat";
import type { ChatMode, ChatScopeState } from "./types";

const DEFAULT_CHAT_MODE: ChatMode = "chat";

export const getDefaultAgentIdForScope = (
  scopeId: ChatScopeId = PANEL_CHAT_SCOPE_ID,
): AgentType => {
  return isHarnessChatScopeId(scopeId) ? "pi" : "custom";
};

export const createDefaultChatScopeState = (
  scopeId: ChatScopeId = PANEL_CHAT_SCOPE_ID,
): ChatScopeState => ({
  currentChatId: null,
  selectedAgentId: getDefaultAgentIdForScope(scopeId),
  input: "",
  pastedImages: [],
  isTyping: false,
  streamingMessageId: null,
  selectedBufferIds: new Set<string>(),
  selectedFilesPaths: new Set<string>(),
  isContextDropdownOpen: false,
  isSendAnimating: false,
  messageQueue: [],
  isProcessingQueue: false,
  mode: DEFAULT_CHAT_MODE,
  isChatHistoryVisible: false,
  availableSlashCommands: [],
  sessionModeState: {
    currentModeId: null,
    availableModes: [],
  },
});
