import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { enableMapSet } from "immer";
import { toast } from "sonner";
import { AgentTab } from "@/features/ai/components/agent-tab";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import { ActivityAgentRow } from "@/features/layout/components/sidebar/activity-agent-history";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import {
  initializeSettingsStore,
  useSettingsStore,
} from "@/features/settings/stores/settings.store";
import { initializeThemeSystem } from "@/extensions/themes/theme-initializer";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import TitleBar from "@/features/window/components/title-bar/title-bar";
import { WindowResizeBorder } from "@/features/window/components/window-resize-border";
import { useFontLoading } from "@/features/window/hooks/use-font-loading";
import { useSystemAccessibility } from "@/features/settings/hooks/use-system-accessibility";
import { REQUEST_WINDOW_CLOSE_EVENT } from "@/features/window/utils/request-window-close";
import { applyPlatformClass } from "@/utils/platform";
import { Button } from "@/ui/button";
import { ChromeBar, ChromeGroup, ChromeLabel } from "@/ui/chrome";
import { DialogServiceProvider } from "@/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/ui/empty";
import { PlusIcon, ArrowLeftIcon } from "@/ui/icons";
import { Toaster } from "@/ui/sonner";
import { TooltipProvider } from "@/ui/tooltip";
import {
  captureAgentWindowSnapshot,
  restoreAgentWindowSnapshot,
  setAgentWindowSessionOpener,
  type AgentWindowMessage,
} from "./agent-window-service";
import { getAgentWindowTransferBlocker, parseAgentWindowChannel } from "./agent-window-state";
import { useAgentWindowStore } from "./agent-window.store";

enableMapSet();

function selectSession(chatId: string) {
  const store = useBufferStore.getState();
  const existing = store.buffers.find(
    (buffer) => buffer.type === "agent" && buffer.sessionId === chatId,
  );
  const id = existing?.id ?? `detached-agent-${chatId}`;
  useBufferStore.setState({
    activeBufferId: id,
    buffers: existing
      ? store.buffers
      : [
          ...store.buffers,
          {
            id,
            type: "agent",
            sessionId: chatId,
            path: `agent://${chatId}`,
            name: "New Session",
            isActive: true,
            isPinned: false,
            isPreview: false,
          },
        ],
  });
  useAIChatStore.getState().actions.switchToChat(chatId);
  return id;
}

function newSession() {
  const store = useAIChatStore.getState();
  const agentId = isTerminalAgent(store.selectedAgentId) ? "custom" : store.selectedAgentId;
  selectSession(store.actions.createNewChat(agentId));
}

export default function DetachedAgentsApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const connection = useRef<BroadcastChannel | null>(null);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialized = useRef(false);
  const returningRef = useRef(false);
  const chats = useAIChatStore((state) => state.chats);
  const actions = useAIChatStore.use.actions();
  const buffers = useBufferStore((state) => state.buffers);
  const activeId = useBufferStore((state) => state.activeBufferId);
  const workspacePath = useProjectStore((state) => state.rootFolderPath);
  const settings = useSettingsStore.use.settings();
  useFontLoading();
  useSystemAccessibility();

  const returnToOwner = useCallback(() => {
    if (returningRef.current) return;
    if (!initialized.current) {
      void getCurrentWindow().destroy();
      return;
    }
    const blocker = getAgentWindowTransferBlocker(useAIChatStore.getState());
    if (blocker) {
      toast.info(blocker);
      return;
    }
    const snapshot = captureAgentWindowSnapshot();
    returningRef.current = true;
    setReturning(true);
    useAgentWindowStore.getState().actions.setStatus("opening");
    connection.current?.postMessage({ type: "return", snapshot });
    returnTimer.current = setTimeout(() => {
      returningRef.current = false;
      setReturning(false);
      useAgentWindowStore.getState().actions.setStatus("attached");
      toast.error("The original window did not respond. Your sessions remain here.");
    }, 10_000);
  }, []);

  useEffect(() => {
    applyPlatformClass();
    let disposed = false;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const id = parseAgentWindowChannel(new URL(window.location.href));
    if (!id) {
      setError("This Agents window has no source window.");
      return;
    }
    const channel = new BroadcastChannel(`athas-agents-${id}`);
    connection.current = channel;
    const publish = () => {
      if (!initialized.current || returningRef.current) return;
      clearTimeout(publishTimer);
      publishTimer = setTimeout(() => {
        channel.postMessage({ type: "snapshot", snapshot: captureAgentWindowSnapshot() });
      }, 150);
    };
    channel.onmessage = ({ data }: MessageEvent<AgentWindowMessage>) => {
      if (data.type === "initialize" && !initialized.current) {
        restoreAgentWindowSnapshot(data.snapshot);
        useProjectStore.getState().actions.setRootFolderPath(data.snapshot.workspacePath);
        useFileSystemStore.setState({ rootFolderPath: data.snapshot.workspacePath });
        useBufferStore.setState({
          buffers: data.snapshot.buffers,
          activeBufferId: data.snapshot.activeBufferId,
        });
        initialized.current = true;
        setReady(true);
        const active = data.snapshot.buffers.find(
          (buffer) => buffer.id === data.snapshot.activeBufferId && buffer.type === "agent",
        );
        const fallback = data.snapshot.buffers.find((buffer) => buffer.type === "agent");
        const selected = active ?? fallback;
        if (selected?.type === "agent") selectSession(selected.sessionId);
        publish();
      } else if (data.type === "returned" && returningRef.current) {
        clearTimeout(returnTimer.current);
        void getCurrentWindow()
          .destroy()
          .catch((cause) => {
            returningRef.current = false;
            setReturning(false);
            useAgentWindowStore.getState().actions.setStatus("attached");
            toast.error(`Could not close the Agents window. Try returning again: ${String(cause)}`);
          });
      } else if ((data.type === "focus" || data.type === "open") && initialized.current) {
        if (data.type === "open" && !returningRef.current) {
          if (data.chatId) selectSession(data.chatId);
          else newSession();
        }
        void getCurrentWindow().setFocus().catch(console.error);
      }
    };
    setAgentWindowSessionOpener(selectSession);
    const bufferActions = useBufferStore.getState().actions;
    const openInWorkbench: typeof bufferActions.openContent = (content) => {
      if (content.type === "agent") {
        if (content.sessionId) return selectSession(content.sessionId);
        newSession();
        return useBufferStore.getState().activeBufferId ?? "";
      }
      channel.postMessage({ type: "workbench", content });
      return "detached-workbench-request";
    };
    useBufferStore.setState({
      actions: {
        ...bufferActions,
        openContent: openInWorkbench,
        setActiveBuffer: (id) => {
          const buffer = useBufferStore.getState().buffers.find((item) => item.id === id);
          if (buffer?.type === "agent") selectSession(buffer.sessionId);
          else if (buffer?.type === "editor")
            openInWorkbench({
              type: "editor",
              path: buffer.path,
              name: buffer.name,
              content: buffer.content,
            });
        },
      },
    });
    const unsubscribeChat = useAIChatStore.subscribe(publish);
    const unsubscribeBuffers = useBufferStore.subscribe(publish);
    const listeners = Promise.all([
      getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        returnToOwner();
      }),
      getCurrentWindow().listen("menu_close_window", returnToOwner),
      getCurrentWindow().listen("menu_quit_app", returnToOwner),
    ]);
    window.addEventListener(REQUEST_WINDOW_CLOSE_EVENT, returnToOwner);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        returnToOwner();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    void Promise.all([
      initializeSettingsStore(),
      initializeThemeSystem(),
      useAuthStore.getState().actions.initialize(),
      listeners,
    ])
      .then(() => {
        if (!disposed) channel.postMessage({ type: "ready" });
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });
    return () => {
      disposed = true;
      clearTimeout(publishTimer);
      clearTimeout(returnTimer.current);
      unsubscribeChat();
      unsubscribeBuffers();
      setAgentWindowSessionOpener(null);
      useBufferStore.setState({ actions: bufferActions });
      void listeners.then((unlisteners) => unlisteners.forEach((unlisten) => unlisten()));
      channel.close();
      window.removeEventListener(REQUEST_WINDOW_CLOSE_EVENT, returnToOwner);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [returnToOwner]);

  const visibleChats = filterChatsByWorkspace(chats, workspacePath)
    .filter((chat) => !chat.archivedAt)
    .sort(
      (a, b) =>
        Number(b.isPinned) - Number(a.isPinned) ||
        b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
    );
  const agentBuffers = buffers
    .filter((buffer) => buffer.type === "agent")
    .filter((buffer) => chats.some((chat) => chat.id === buffer.sessionId));
  const active = agentBuffers.find((buffer) => buffer.id === activeId);

  return (
    <DialogServiceProvider>
      <TooltipProvider>
        <FontStyleInjector />
        <WindowResizeBorder />
        <div className="athas-layout-shell flex h-dvh flex-col overflow-hidden bg-background">
          <TitleBar showMinimal />
          <ChromeBar region="sidebar">
            <ChromeGroup grow>
              <ChromeLabel tone="strong">Agents</ChromeLabel>
            </ChromeGroup>
            <Button variant="ghost" onClick={returnToOwner} disabled={returning}>
              <ArrowLeftIcon /> Return to Main Window
            </Button>
          </ChromeBar>
          {error ? (
            <Empty tone="error">
              <EmptyHeader>
                <EmptyTitle>Agents window error</EmptyTitle>
                <EmptyDescription>{error}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : !ready || returning ? (
            <Empty>
              <EmptyTitle>{returning ? "Returning Agents…" : "Loading Agents…"}</EmptyTitle>
            </Empty>
          ) : (
            <div className="flex min-h-0 flex-1">
              <aside
                aria-label="Agent sessions"
                className="flex w-56 shrink-0 flex-col overflow-y-auto p-2 max-[600px]:w-40"
              >
                <Button variant="ghost" onClick={newSession}>
                  <PlusIcon /> New Agent
                </Button>
                {visibleChats.map((chat) => (
                  <ActivityAgentRow
                    key={chat.id}
                    chat={chat}
                    active={active?.sessionId === chat.id}
                    aiProviderId={settings.aiProviderId}
                    aiModelId={settings.aiModelId}
                    currentBranch={null}
                    workspacePath={workspacePath ?? null}
                    onOpen={selectSession}
                    onUpdateTitle={actions.updateChatTitle}
                    onPinChange={actions.setChatPinned}
                    onArchive={(id) => actions.setChatArchived(id, true)}
                    onDelete={(chatId) => {
                      if (useAIChatStore.getState().agentRuns[chatId]) {
                        toast.info("Stop this agent before deleting its session.");
                        return;
                      }
                      actions.deleteChat(chatId);
                    }}
                  />
                ))}
              </aside>
              <main className="min-h-0 min-w-0 flex-1">
                {agentBuffers.map((buffer) => (
                  <div key={buffer.id} className={buffer.id === activeId ? "h-full" : "hidden"}>
                    <AgentTab buffer={buffer} isActive={buffer.id === activeId} />
                  </div>
                ))}
                {!active && (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>Your agents, in their own window</EmptyTitle>
                      <EmptyDescription>Select a session or start a new agent.</EmptyDescription>
                    </EmptyHeader>
                    <Button onClick={newSession}>New Agent</Button>
                  </Empty>
                )}
              </main>
            </div>
          )}
        </div>
        <Toaster />
      </TooltipProvider>
    </DialogServiceProvider>
  );
}
