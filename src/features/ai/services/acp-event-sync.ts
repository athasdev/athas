import { listen } from "@tauri-apps/api/event";
import { getChatTitleFromSessionInfo } from "@/features/ai/lib/acp-session-info";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { sendAgentNativeNotification } from "@/features/ai/services/agent-native-notifications";
import { useAcpAuthStore } from "@/features/ai/stores/acp-auth.store";
import { useAcpQuestionsStore } from "@/features/ai/stores/acp-questions.store";
import { useAgentPermissionsStore } from "@/features/ai/stores/agent-permissions.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AcpEvent } from "@/features/ai/types/acp.types";

/**
 * Applies the ACP events that are not tied to one running prompt: session state, sign-in
 * requests, questions, and requests the agent stopped waiting on. It runs for the whole window,
 * so chats whose view is not mounted (a background tab) still get them.
 */
export function applyAcpEvent(payload: AcpEvent): void {
  const store = useAIChatStore.getState();
  const { actions } = store;

  switch (payload.type) {
    case "slash_commands_update":
      actions.setSessionSlashCommands(payload.sessionId, payload.commands);
      break;
    case "session_mode_update":
      actions.setSessionModeState(
        payload.sessionId,
        payload.modeState.currentModeId,
        payload.modeState.availableModes,
      );
      actions.restoreChatSessionSettings(payload.sessionId);
      break;
    case "current_mode_update":
      actions.setSessionCurrentMode(payload.sessionId, payload.currentModeId);
      break;
    case "config_options_update":
      actions.setSessionConfigOptions(payload.sessionId, payload.configOptions);
      actions.restoreChatSessionSettings(payload.sessionId);
      break;
    case "usage_update":
      actions.setSessionUsage(payload.sessionId, payload.usage);
      break;
    case "session_info_update": {
      const chat = store.chats.find((item) => item.acpSessionId === payload.sessionId);
      const nextTitle = chat ? getChatTitleFromSessionInfo(chat.title, payload.title) : null;
      if (chat && nextTitle) actions.updateChatTitle(chat.id, nextTitle);
      break;
    }
    case "auth_required": {
      const sessionChatId = payload.sessionId
        ? store.chats.find((item) => item.acpSessionId === payload.sessionId)?.id
        : undefined;
      const routedChatId =
        sessionChatId ?? AcpStreamHandler.chatForUnscopedRequest(payload.agentId);
      useAcpAuthStore.getState().actions.require({
        agentId: payload.agentId,
        sessionId: payload.sessionId,
        chatId: routedChatId,
        methods: payload.methods,
      });
      const authChatId = routedChatId ?? store.currentChatId;
      if (authChatId) {
        void sendAgentNativeNotification({
          kind: "auth",
          dedupeId: `${payload.agentId}:${payload.sessionId ?? "startup"}`,
          chatId: authChatId,
        });
      }
      break;
    }
    case "elicitation_request":
      useAcpQuestionsStore.getState().actions.add({
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        chatId: payload.sessionId ? undefined : AcpStreamHandler.chatForUnscopedRequest(),
        request: payload.request,
      });
      break;
    case "elicitation_complete":
      useAcpQuestionsStore.getState().actions.complete(payload.elicitationId);
      break;
    case "request_closed":
      useAcpQuestionsStore.getState().actions.remove(payload.requestId);
      useAgentPermissionsStore.getState().actions.remove(payload.requestId);
      break;
    case "status_changed":
      actions.setAcpAgentStatus(payload.status);
      break;
    default:
      break;
  }
}

/** Starts applying ACP events for this window. Resolves to the function that stops it. */
export function startAcpEventSync(): Promise<() => void> {
  return listen<AcpEvent>("acp-event", ({ payload }) => applyAcpEvent(payload));
}
