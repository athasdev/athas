import { getCurrentWindow } from "@tauri-apps/api/window";
import { enableMapSet } from "immer";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AgentTab } from "@/features/ai/components/agent-tab";
import { registerAiEditorFeatures } from "@/features/ai/services/ai-editor-features";
import { AgentSessionIcon } from "@/features/ai/components/icons/agent-session-icon";
import { useAcpEventSync } from "@/features/ai/hooks/use-acp-event-sync";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { ShareDialog } from "@/features/sharing/components/share-dialog";
import { SharingRuntime } from "@/features/sharing/components/sharing-runtime";
import { AppQueryProvider } from "@/components/app-query-provider";
import { DetachedWindowShell } from "@/features/window/detached/detached-window-shell";
import { useDetachedWindow } from "@/features/window/detached/hooks/use-detached-window";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { Button } from "@/ui/button";
import { ArrowCounterClockwiseIcon } from "@/ui/icons";
import {
  type AgentWindowMessage,
  captureAgentWindowSnapshot,
  restoreAgentWindowSnapshot,
  setAgentWindowSessionOpener,
} from "./services/agent-window-service";
import { getAgentWindowTransferBlocker } from "./agent-window-state";
import { getActiveBufferId } from "@/features/panes/stores/pane-selectors";
import { usePaneStore } from "@/features/panes/stores/pane.store";

enableMapSet();

registerAiEditorFeatures();

const RETURN_TIMEOUT_MS = 10_000;

/**
 * A bare window that owns one agent session. The session moves here with its
 * drafts and comes back to the main window when this window closes.
 */
export default function DetachedAgentWindow() {
  useAcpEventSync();
  const [ready, setReady] = useState(false);
  const [returning, setReturning] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const returningRef = useRef(false);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const buffer = useBufferStore((state) => state.buffers.find((item) => item.type === "agent"));
  const chat = useAIChatStore((state) =>
    state.chats.find((item) => item.id === (buffer?.type === "agent" ? buffer.sessionId : null)),
  );

  const { error, post } = useDetachedWindow<AgentWindowMessage>({
    kind: "agent",
    onMessage: (data) => {
      if (data.type === "initialize" && !sessionId.current) {
        const chatId = data.snapshot.chat.currentChatId;
        if (!chatId) {
          setSessionError("No agent session was provided.");
          return;
        }
        restoreAgentWindowSnapshot(data.snapshot);
        useProjectStore.getState().actions.setRootFolderPath(data.snapshot.workspacePath);
        const existing = data.snapshot.buffers.find(
          (item) => item.type === "agent" && item.sessionId === chatId,
        );
        const agentBuffer = existing ?? {
          id: `detached-agent-${chatId}`,
          type: "agent" as const,
          sessionId: chatId,
          path: `agent://${chatId}`,
          name: data.snapshot.chat.chats[0]?.title ?? "Agent",
        };
        useBufferStore.setState({
          buffers: [...data.snapshot.buffers.filter((item) => item.type === "editor"), agentBuffer],
        });
        usePaneStore.getState().actions.placeBuffer(agentBuffer.id);
        sessionId.current = chatId;
        useAIChatStore.getState().actions.switchToChat(chatId);
        setReady(true);
        post({ type: "snapshot", snapshot: captureAgentWindowSnapshot(chatId) });
      } else if (data.type === "returned" && returningRef.current) {
        clearTimeout(returnTimer.current);
        void getCurrentWindow()
          .destroy()
          .catch((cause) => {
            returningRef.current = false;
            setReturning(false);
            toast.error(`Could not close the agent window: ${String(cause)}`);
          });
      } else if (data.type === "recall") {
        returnToOwner();
      }
    },
    onCloseRequest: () => returnToOwner(),
  });

  const returnToOwner = useCallback(() => {
    if (returningRef.current) return;
    if (!sessionId.current) {
      void getCurrentWindow().destroy().catch(console.error);
      return;
    }
    const blocker = getAgentWindowTransferBlocker(useAIChatStore.getState(), sessionId.current);
    if (blocker) {
      toast.info(blocker);
      return;
    }
    const snapshot = captureAgentWindowSnapshot(sessionId.current);
    returningRef.current = true;
    setReturning(true);
    post({ type: "return", snapshot });
    returnTimer.current = setTimeout(() => {
      returningRef.current = false;
      setReturning(false);
      toast.error("The original window did not respond. Your session remains here.");
    }, RETURN_TIMEOUT_MS);
  }, [post]);

  useEffect(() => {
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      if (!sessionId.current || returningRef.current) return;
      clearTimeout(publishTimer);
      publishTimer = setTimeout(() => {
        if (!sessionId.current) return;
        post({ type: "snapshot", snapshot: captureAgentWindowSnapshot(sessionId.current) });
      }, 150);
    };
    setAgentWindowSessionOpener((chatId) => {
      if (chatId === sessionId.current) return getActiveBufferId() ?? "";
      return useBufferStore.getState().actions.openContent({ type: "agent", sessionId: chatId });
    });
    const unsubscribeChat = useAIChatStore.subscribe(publish);
    const unsubscribeBuffers = useBufferStore.subscribe(publish);
    return () => {
      clearTimeout(publishTimer);
      clearTimeout(returnTimer.current);
      unsubscribeChat();
      unsubscribeBuffers();
      setAgentWindowSessionOpener(null);
    };
  }, [post]);

  const pending = returning
    ? { title: "Returning session…", description: "Handing this session back to the main window." }
    : !ready
      ? { title: "Opening session…", description: "Connecting to the main window." }
      : null;

  return (
    <AppQueryProvider>
      <DetachedWindowShell
        title={chat?.title ?? "Agent"}
        icon={<AgentSessionIcon session={chat} />}
        actions={
          ready && !returning ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={returnToOwner}
              tooltip="Move this session back to the main window"
              shortcut="mod+w"
              aria-label="Return session to the main window"
            >
              <ArrowCounterClockwiseIcon />
              Return
            </Button>
          ) : null
        }
        error={error ?? sessionError}
        pending={pending}
        runtime={
          <>
            <ShareDialog />
            <SharingRuntime />
          </>
        }
      >
        {buffer?.type === "agent" ? (
          <main className="min-h-0 min-w-0 flex-1">
            <AgentTab buffer={buffer} />
          </main>
        ) : null}
      </DetachedWindowShell>
    </AppQueryProvider>
  );
}
