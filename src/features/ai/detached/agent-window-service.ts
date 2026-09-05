import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { captureAgentDrafts, restoreAgentDrafts } from "./agent-window-drafts";
import { getAgentWindowTransferBlocker, type AgentWindowSnapshot } from "./agent-window-state";
import { useAgentWindowStore } from "./agent-window.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useGitHubStore } from "@/features/github/stores/github.store";
import { getAccountIdentity } from "@/features/window/lib/account-identity";
import { useUIState, type SettingsTab } from "@/features/window/stores/ui-state.store";
import type { AgentAccountIdentity } from "./agent-window-state";

export type AgentWindowMessage =
  | { type: "identity"; identity: AgentAccountIdentity }
  | { type: "settings"; tab?: SettingsTab; section?: string }
  | { type: "ready" }
  | { type: "initialize" | "snapshot" | "return"; snapshot: AgentWindowSnapshot }
  | { type: "returned" | "focus" }
  | {
      type: "workbench";
      content: Parameters<ReturnType<typeof useBufferStore.getState>["actions"]["openContent"]>[0];
    };

const channels = new Map<string, BroadcastChannel>();
let localSessionOpener: ((chatId: string) => string) | null = null;

export function setAgentWindowSessionOpener(opener: ((chatId: string) => string) | null) {
  localSessionOpener = opener;
}

export function openAgentWindowSession(chatId: string) {
  return localSessionOpener?.(chatId) ?? null;
}

export function isAgentWindow() {
  return localSessionOpener !== null;
}

function captureAccountIdentity() {
  const user = useAuthStore.getState().user;
  const github = useGitHubStore.getState();
  return getAccountIdentity(
    user,
    github.githubAccountStatus === "connected" ? github.currentUser || user?.github_username : null,
  );
}

export function captureAgentWindowSnapshot(chatId?: string): AgentWindowSnapshot {
  const state = useAIChatStore.getState();
  const buffers = useBufferStore.getState();
  return {
    accountIdentity: useAgentWindowStore.getState().accountIdentity ?? captureAccountIdentity(),
    chat: {
      chats: chatId ? state.chats.filter((chat) => chat.id === chatId) : state.chats,
      currentChatId: chatId ?? state.currentChatId,
      selectedAgentId: state.selectedAgentId,
      chatMessageLoadStates: chatId
        ? Object.fromEntries(
            Object.entries(state.chatMessageLoadStates).filter(([id]) => id === chatId),
          )
        : state.chatMessageLoadStates,
    },
    workspacePath:
      (chatId && state.chats.find((chat) => chat.id === chatId)?.workspacePath) ||
      useProjectStore.getState().rootFolderPath,
    buffers: buffers.buffers.filter(
      (buffer) =>
        (buffer.type === "agent" && (!chatId || buffer.sessionId === chatId)) ||
        buffer.type === "editor",
    ),
    activeBufferId: buffers.activeBufferId,
    drafts: chatId
      ? Object.fromEntries(
          Object.entries(captureAgentDrafts()).filter(([id]) => id === `agent-session:${chatId}`),
        )
      : captureAgentDrafts(),
  };
}

export function restoreAgentWindowSnapshot(snapshot: AgentWindowSnapshot, chatId?: string) {
  restoreAgentDrafts(snapshot.drafts, Boolean(chatId));
  if (!chatId) {
    useAgentWindowStore.getState().actions.setAccountIdentity(snapshot.accountIdentity ?? null);
    useAIChatStore.setState(snapshot.chat);
    return;
  }
  const state = useAIChatStore.getState();
  useAIChatStore.setState({
    chats: [
      ...state.chats.filter((chat) => chat.id !== chatId),
      ...snapshot.chat.chats.filter((chat) => chat.id === chatId),
    ],
    chatMessageLoadStates: {
      ...state.chatMessageLoadStates,
      ...snapshot.chat.chatMessageLoadStates,
    },
  });
}

export function focusAgentWindow(chatId: string) {
  channels.get(chatId)?.postMessage({ type: "focus" });
}

export async function openAgentInNewWindow(chatId: string) {
  if (isAgentWindow()) {
    void getCurrentWindow().setFocus().catch(console.error);
    return;
  }
  if (channels.has(chatId)) {
    focusAgentWindow(chatId);
    return;
  }
  const blocker = getAgentWindowTransferBlocker(useAIChatStore.getState(), chatId);
  if (blocker) {
    toast.info(blocker);
    return;
  }
  if (!useAIChatStore.getState().chats.some((chat) => chat.id === chatId)) return;
  const initial = captureAgentWindowSnapshot(chatId);
  initial.activeBufferId =
    initial.buffers.find((buffer) => buffer.type === "agent" && buffer.sessionId === chatId)?.id ??
    null;
  const id = crypto.randomUUID();
  const connection = new BroadcastChannel(`athas-agents-${id}`);
  channels.set(chatId, connection);
  let latest = initial;
  let initialized = false;
  let returned = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detachedWindow: Window | undefined;
  let cleaned = false;
  const publishIdentity = () =>
    connection.postMessage({ type: "identity", identity: captureAccountIdentity() });
  const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
    if (state.user !== previous.user) publishIdentity();
  });
  const unsubscribeGithub = useGitHubStore.subscribe((state, previous) => {
    if (
      state.currentUser !== previous.currentUser ||
      state.githubAccountStatus !== previous.githubAccountStatus
    )
      publishIdentity();
  });
  const setStatus = (status: "attached" | "opening" | "detached") =>
    useAgentWindowStore.getState().actions.setStatus(chatId, status);
  setStatus("opening");

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    unlisten?.();
    unsubscribeAuth();
    unsubscribeGithub();
    connection.close();
    if (channels.get(chatId) === connection) channels.delete(chatId);
    setStatus("attached");
  };
  connection.onmessage = ({ data }: MessageEvent<AgentWindowMessage>) => {
    if (cleaned) return;
    if (returned) {
      if (data.type === "return") connection.postMessage({ type: "returned" });
      return;
    }
    if (data.type === "ready") {
      connection.postMessage({
        type: "initialize",
        snapshot: { ...initial, accountIdentity: captureAccountIdentity() },
      });
    } else if (data.type === "settings") {
      useUIState.getState().openSettingsDialog(data.tab, data.section);
      void getCurrentWindow().setFocus().catch(console.error);
    } else if (data.type === "workbench") {
      useBufferStore.getState().actions.openContent(data.content);
      void getCurrentWindow().setFocus().catch(console.error);
    } else if (data.type === "snapshot" || data.type === "return") {
      initialized = true;
      clearTimeout(timer);
      latest = data.snapshot;
      restoreAgentWindowSnapshot(latest, chatId);
      setStatus("detached");
      if (data.type === "return") {
        returned = true;
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
        restoreAgentWindowSnapshot(latest, chatId);
      }
      cleanup();
    });
    if (!initialized) {
      timer = setTimeout(() => {
        if (initialized) return;
        void detachedWindow!
          .destroy()
          .then(() => {
            restoreAgentWindowSnapshot(initial, chatId);
            cleanup();
            toast.error("The agent window did not finish opening. Your session stayed here.");
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
    restoreAgentWindowSnapshot(initial, chatId);
    cleanup();
    toast.error(`Could not open the Agents window: ${String(error)}`);
  }
}
