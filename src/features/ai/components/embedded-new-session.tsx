import { useEffect, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import AIChat from "./chat/ai-chat";

/**
 * What an empty workbench shows: a new session in place, with no tab of its own. It keeps an
 * empty draft session (reusing one that is waiting) for the open project, and once its first
 * message is sent the session opens as a tab like any other.
 */
export function EmbeddedNewSession() {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath ?? null);
  const [draft, setDraft] = useState<{ chatId: string; workspacePath: string | null } | null>(null);
  const chatId = draft?.workspacePath === rootFolderPath ? draft.chatId : null;
  const started = useAIChatStore((state) =>
    chatId
      ? (state.messagesByChat[chatId]?.length ?? 0) > 0 || Boolean(state.agentRuns[chatId])
      : false,
  );

  useEffect(() => {
    if (chatId) return;
    const { actions } = useAIChatStore.getState();
    setDraft({
      chatId: actions.createNewChat(actions.getCurrentAgentId(), {
        activate: false,
        reuseEmpty: true,
      }),
      workspacePath: rootFolderPath,
    });
  }, [chatId, rootFolderPath]);

  useEffect(() => {
    if (chatId && started) useBufferStore.getState().actions.openAgentBuffer(chatId);
  }, [chatId, started]);

  if (!chatId) return null;
  return (
    <div className="size-full overflow-hidden" data-slot="embedded-new-session">
      <AIChat
        mode="chat"
        surfaceId={`agent-session:${chatId}`}
        chatId={chatId}
        activeBuffer={null}
        buffers={[]}
        isActiveSurface
        headerInTabBar
      />
    </div>
  );
}
