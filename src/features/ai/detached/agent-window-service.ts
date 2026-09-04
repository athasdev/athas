import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { captureAgentDrafts, restoreAgentDrafts } from "./agent-window-drafts";
import { getAgentWindowTransferBlocker, type AgentWindowSnapshot } from "./agent-window-state";
import { useAgentWindowStore } from "./agent-window.store";

export type AgentWindowMessage =
  | { type: "ready" }
  | { type: "initialize" | "snapshot" | "return"; snapshot: AgentWindowSnapshot }
  | { type: "returned" | "focus" }
  | { type: "open"; chatId?: string }
  | {
      type: "workbench";
      content: Parameters<ReturnType<typeof useBufferStore.getState>["actions"]["openContent"]>[0];
    };

let channel: BroadcastChannel | null = null;
let localSessionOpener: ((chatId: string) => string) | null = null;

export function setAgentWindowSessionOpener(opener: ((chatId: string) => string) | null) {
  localSessionOpener = opener;
}

export function openAgentWindowSession(chatId: string) {
  return localSessionOpener?.(chatId) ?? null;
}

export function captureAgentWindowSnapshot(): AgentWindowSnapshot {
  const state = useAIChatStore.getState();
  const buffers = useBufferStore.getState();
  return {
    chat: {
      chats: state.chats,
      currentChatId: state.currentChatId,
      selectedAgentId: state.selectedAgentId,
      chatMessageLoadStates: state.chatMessageLoadStates,
    },
    workspacePath: useProjectStore.getState().rootFolderPath,
    buffers: buffers.buffers.filter(
      (buffer) => buffer.type === "agent" || buffer.type === "editor",
    ),
    activeBufferId: buffers.activeBufferId,
    drafts: captureAgentDrafts(),
  };
}

export function restoreAgentWindowSnapshot(snapshot: AgentWindowSnapshot) {
  restoreAgentDrafts(snapshot.drafts);
  useAIChatStore.setState(snapshot.chat);
}

export function focusAgentWindow(chatId?: string) {
  channel?.postMessage(chatId ? { type: "open", chatId } : { type: "focus" });
}

export function newAgentInDetachedWindow() {
  channel?.postMessage({ type: "open" });
}

export async function detachAgentView() {
  if (channel) {
    focusAgentWindow();
    return;
  }
  const blocker = getAgentWindowTransferBlocker(useAIChatStore.getState());
  if (blocker) {
    toast.info(blocker);
    return;
  }
  const initial = captureAgentWindowSnapshot();
  const id = crypto.randomUUID();
  const connection = new BroadcastChannel(`athas-agents-${id}`);
  channel = connection;
  let latest = initial;
  let initialized = false;
  let returned = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detachedWindow: Window | undefined;
  let cleaned = false;
  const setStatus = useAgentWindowStore.getState().actions.setStatus;
  setStatus("opening");

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    unlisten?.();
    connection.close();
    if (channel === connection) channel = null;
    setStatus("attached");
  };
  connection.onmessage = ({ data }: MessageEvent<AgentWindowMessage>) => {
    if (cleaned) return;
    if (returned) {
      if (data.type === "return") connection.postMessage({ type: "returned" });
      return;
    }
    if (data.type === "ready") {
      connection.postMessage({ type: "initialize", snapshot: initial });
    } else if (data.type === "workbench") {
      useBufferStore.getState().actions.openContent(data.content);
      void getCurrentWindow().setFocus().catch(console.error);
    } else if (data.type === "snapshot" || data.type === "return") {
      initialized = true;
      clearTimeout(timer);
      latest = data.snapshot;
      setStatus("detached");
      if (data.type === "return") {
        returned = true;
        restoreAgentWindowSnapshot(latest);
        const active = latest.buffers.find((buffer) => buffer.id === latest.activeBufferId);
        if (
          active?.type === "agent" &&
          latest.workspacePath === useProjectStore.getState().rootFolderPath
        ) {
          useBufferStore.getState().actions.openAgentBuffer(active.sessionId);
        }
        connection.postMessage({ type: "returned" });
        void getCurrentWindow().setFocus().catch(console.error);
      }
    }
  };
  try {
    const label = await createAppWindow({ agentWindow: id });
    detachedWindow = new Window(label);
    unlisten = await detachedWindow.once("tauri://destroyed", () => {
      if (!returned) {
        restoreAgentWindowSnapshot(latest);
        if (initialized) toast.info("Agents returned to this window.");
      }
      cleanup();
    });
    if (!initialized) {
      timer = setTimeout(() => {
        if (initialized) return;
        void detachedWindow!
          .destroy()
          .then(() => {
            restoreAgentWindowSnapshot(initial);
            cleanup();
            toast.error("The Agents window did not finish opening. Your sessions stayed here.");
          })
          .catch((error) => {
            toast.error(`Could not close the unresponsive Agents window: ${String(error)}`);
          });
      }, 30_000);
    }
  } catch (error) {
    if (detachedWindow) {
      try {
        await detachedWindow.destroy();
      } catch (closeError) {
        toast.error(`Could not recover the Agents window: ${String(closeError)}`);
        return;
      }
    }
    restoreAgentWindowSnapshot(initial);
    cleanup();
    toast.error(`Could not open the Agents window: ${String(error)}`);
  }
}
