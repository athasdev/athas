import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useGitHubStore } from "@/features/github/stores/github.store";
import {
  type DetachedWindowHandle,
  openDetachedWindow,
} from "@/features/window/detached/detached-window-owner";
import type { DetachedWindowBaseMessage } from "@/features/window/detached/detached-window-protocol";
import { getAccountIdentity } from "@/features/window/lib/account-identity";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { captureAgentDrafts, restoreAgentDrafts } from "./agent-window-drafts";
import {
  type AgentAccountIdentity,
  type AgentWindowSnapshot,
  getAgentWindowTransferBlocker,
} from "./agent-window-state";
import { useAgentWindowStore } from "./agent-window.store";

export type AgentWindowMessage =
  | DetachedWindowBaseMessage
  | { type: "identity"; identity: AgentAccountIdentity }
  | { type: "initialize" | "snapshot" | "return"; snapshot: AgentWindowSnapshot }
  | { type: "returned" | "recall" };

const windows = new Map<string, DetachedWindowHandle<AgentWindowMessage>>();
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
  windows.get(chatId)?.post({ type: "focus" });
}

/**
 * Ask the detached window to hand the session back. Without this the only way
 * home is a keyboard shortcut inside the other window.
 */
export function recallAgentWindow(chatId: string) {
  const handle = windows.get(chatId);
  if (!handle) return false;
  handle.post({ type: "recall" });
  return true;
}

export async function openAgentInNewWindow(chatId: string) {
  if (isAgentWindow()) {
    void getCurrentWindow().setFocus().catch(console.error);
    return;
  }
  if (windows.has(chatId)) {
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
  let latest = initial;
  let returned = false;
  const setStatus = (status: "attached" | "opening" | "detached") =>
    useAgentWindowStore.getState().actions.setStatus(chatId, status);
  const publishIdentity = () =>
    windows.get(chatId)?.post({ type: "identity", identity: captureAccountIdentity() });
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
  const finish = () => {
    unsubscribeAuth();
    unsubscribeGithub();
    if (windows.get(chatId) === handle) windows.delete(chatId);
    setStatus("attached");
  };

  setStatus("opening");
  const handle = openDetachedWindow<AgentWindowMessage>({
    kind: "agent",
    onMessage: (data, handle) => {
      if (returned) {
        if (data.type === "return") handle.post({ type: "returned" });
        return;
      }
      if (data.type === "ready") {
        handle.post({
          type: "initialize",
          snapshot: { ...initial, accountIdentity: captureAccountIdentity() },
        });
      } else if (data.type === "snapshot" || data.type === "return") {
        handle.markInitialized();
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
          handle.post({ type: "returned" });
          void getCurrentWindow().setFocus().catch(console.error);
        }
      }
    },
    onDestroyed: () => {
      if (!returned) restoreAgentWindowSnapshot(latest, chatId);
      finish();
    },
    onOpenTimeout: () => {
      restoreAgentWindowSnapshot(initial, chatId);
      finish();
      toast.error("The agent window did not finish opening. Your session stayed here.");
    },
    onError: (error) => {
      restoreAgentWindowSnapshot(initial, chatId);
      finish();
      toast.error(`Could not open the Agents window: ${String(error)}`);
    },
  });
  windows.set(chatId, handle);
  await handle.opened;
}
