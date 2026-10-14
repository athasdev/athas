import { commands } from "@/bindings/commands";
import { useEffect } from "react";
import { agentIsDetached } from "@/features/ai/detached/stores/agent-window.store";
import { getSessionToCloseWithTab } from "@/features/ai/lib/agent-tab-session-release";
import { useAcpQuestionsStore } from "@/features/ai/stores/acp-questions.store";
import { useAgentPermissionsStore } from "@/features/ai/stores/agent-permissions.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";

/**
 * Chats with a tab in any open project. Switching projects swaps the active buffer store, so
 * reading only that one would treat every tab of the project left behind as closed.
 */
function getBufferLists() {
  return useBufferStore.getAllStores().map((store) => store.getState().buffers);
}

function openAgentChatIds(bufferLists: ReturnType<typeof getBufferLists>): Set<string> {
  const ids = new Set<string>();
  for (const buffers of bufferLists) {
    for (const buffer of buffers) {
      if (buffer.type === "agent" && buffer.sessionId) ids.add(buffer.sessionId);
    }
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
  void commands
    .closeAcpSession(toClose)
    .catch((error) => console.error("Failed to close the agent session of a closed tab:", error));
}

/** Frees the agent sessions of chats whose tabs were closed (see `getSessionToCloseWithTab`). */
export function useAgentTabSessionRelease() {
  useEffect(() => {
    let seen = getBufferLists();
    let open = openAgentChatIds(seen);
    return useBufferStore.subscribeAll(() => {
      const lists = getBufferLists();
      if (lists.length === seen.length && lists.every((buffers, index) => buffers === seen[index]))
        return;
      seen = lists;
      const next = openAgentChatIds(lists);
      for (const chatId of open) {
        if (!next.has(chatId)) releaseChatSession(chatId);
      }
      open = next;
    });
  }, []);
}
