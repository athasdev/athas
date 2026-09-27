import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { agentIsDetached } from "@/features/ai/detached/agent-window.store";
import { getSessionToCloseWithTab } from "@/features/ai/lib/agent-tab-session-release";
import { useAcpQuestionsStore } from "@/features/ai/stores/acp-questions.store";
import { useAgentPermissionsStore } from "@/features/ai/stores/agent-permissions.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";

function openAgentChatIds(): Set<string> {
  const ids = new Set<string>();
  for (const buffer of useBufferStore.getState().buffers) {
    if (buffer.type === "agent" && buffer.sessionId) ids.add(buffer.sessionId);
  }
  return ids;
}

/** Closes a chat's ACP session when its last tab closes, where the agent can bring it back. */
function releaseChatSession(chatId: string) {
  const store = useAIChatStore.getState();
  const chat = store.chats.find((item) => item.id === chatId);
  const sessionId = chat?.acpSessionId ?? null;
  const isBusy =
    Boolean(store.agentRuns[chatId]) ||
    store.pendingAgentLaunchRequest?.chatId === chatId ||
    agentIsDetached(chatId) ||
    useAgentPermissionsStore.getState().permissions.some((item) => item.chatId === chatId) ||
    useAcpQuestionsStore.getState().questions.some((item) => item.sessionId === sessionId);
  const toClose = getSessionToCloseWithTab({
    chat,
    agents: Object.values(store.acpAgents),
    isBusy,
  });
  if (!toClose) return;
  store.actions.clearAcpSession(toClose);
  void invoke("close_acp_session", { sessionId: toClose }).catch((error) =>
    console.error("Failed to close the agent session of a closed tab:", error),
  );
}

/** Frees the agent sessions of chats whose tabs were closed (see `getSessionToCloseWithTab`). */
export function useAgentTabSessionRelease() {
  useEffect(() => {
    let open = openAgentChatIds();
    return useBufferStore.subscribe((state, previous) => {
      if (state.buffers === previous.buffers) return;
      const next = openAgentChatIds();
      for (const chatId of open) {
        if (!next.has(chatId)) releaseChatSession(chatId);
      }
      open = next;
    });
  }, []);
}
