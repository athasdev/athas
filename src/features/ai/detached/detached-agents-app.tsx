import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { enableMapSet } from "immer";
import { toast } from "sonner";
import { AgentTab } from "@/features/ai/components/agent-tab";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import { initializeSettingsStore } from "@/features/settings/stores/settings.store";
import { initializeThemeSystem } from "@/extensions/themes/theme-initializer";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import TitleBar from "@/features/window/components/title-bar/title-bar";
import { WindowResizeBorder } from "@/features/window/components/window-resize-border";
import { useFontLoading } from "@/features/window/hooks/use-font-loading";
import { useSystemAccessibility } from "@/features/settings/hooks/use-system-accessibility";
import { REQUEST_WINDOW_CLOSE_EVENT } from "@/features/window/utils/request-window-close";
import { applyPlatformClass } from "@/utils/platform";
import { DialogServiceProvider } from "@/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/ui/empty";
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
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useUIState } from "@/features/window/stores/ui-state.store";

enableMapSet();

export default function DetachedAgentsApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const connection = useRef<BroadcastChannel | null>(null);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sessionId = useRef<string | null>(null);
  const returningRef = useRef(false);
  const buffer = useBufferStore((state) => state.buffers.find((item) => item.type === "agent"));
  const chat = useAIChatStore((state) =>
    state.chats.find((item) => item.id === (buffer?.type === "agent" ? buffer.sessionId : null)),
  );
  useEffect(() => {
    if (chat?.title) void getCurrentWindow().setTitle(`${chat.title} — Athas`).catch(console.error);
  }, [chat?.title]);
  useFontLoading();
  useSystemAccessibility();

  const returnToOwner = useCallback(() => {
    if (returningRef.current) return;
    if (!sessionId.current) {
      void getCurrentWindow().destroy();
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
    connection.current?.postMessage({ type: "return", snapshot });
    returnTimer.current = setTimeout(() => {
      returningRef.current = false;
      setReturning(false);
      toast.error("The original window did not respond. Your session remains here.");
    }, 10_000);
  }, []);

  useEffect(() => {
    applyPlatformClass();
    let disposed = false;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const id = parseAgentWindowChannel(new URL(window.location.href));
    if (!id) {
      setError("This agent window has no source window.");
      return;
    }
    const channel = new BroadcastChannel(`athas-agents-${id}`);
    connection.current = channel;
    const publish = () => {
      if (!sessionId.current || returningRef.current) return;
      clearTimeout(publishTimer);
      publishTimer = setTimeout(() => {
        if (!sessionId.current) return;
        channel.postMessage({
          type: "snapshot",
          snapshot: captureAgentWindowSnapshot(sessionId.current),
        });
      }, 150);
    };
    channel.onmessage = ({ data }: MessageEvent<AgentWindowMessage>) => {
      if (data.type === "initialize" && !sessionId.current) {
        const chatId = data.snapshot.chat.currentChatId;
        if (!chatId) {
          setError("No agent session was provided.");
          return;
        }
        restoreAgentWindowSnapshot(data.snapshot);
        useProjectStore.getState().actions.setRootFolderPath(data.snapshot.workspacePath);
        useFileSystemStore.setState({ rootFolderPath: data.snapshot.workspacePath });
        const existing = data.snapshot.buffers.find(
          (item) => item.type === "agent" && item.sessionId === chatId,
        );
        const agentBuffer = existing ?? {
          id: `detached-agent-${chatId}`,
          type: "agent" as const,
          sessionId: chatId,
          path: `agent://${chatId}`,
          name: data.snapshot.chat.chats[0]?.title ?? "Agent",
          isActive: true,
          isPinned: false,
          isPreview: false,
        };
        useBufferStore.setState({
          buffers: [...data.snapshot.buffers.filter((item) => item.type === "editor"), agentBuffer],
          activeBufferId: agentBuffer.id,
        });
        sessionId.current = chatId;
        useAIChatStore.getState().actions.switchToChat(chatId);
        setReady(true);
        publish();
      } else if (data.type === "identity") {
        useAgentWindowStore.getState().actions.setAccountIdentity(data.identity);
      } else if (data.type === "returned" && returningRef.current) {
        clearTimeout(returnTimer.current);
        void getCurrentWindow()
          .destroy()
          .catch((cause) => {
            returningRef.current = false;
            setReturning(false);
            toast.error(`Could not close the agent window: ${String(cause)}`);
          });
      } else if (data.type === "focus" && sessionId.current) {
        void getCurrentWindow().setFocus().catch(console.error);
      }
    };
    const bufferActions = useBufferStore.getState().actions;
    const openInWorkbench: typeof bufferActions.openContent = (content) => {
      channel.postMessage({ type: "workbench", content });
      return "agent-workbench-request";
    };
    setAgentWindowSessionOpener((chatId) => {
      if (chatId === sessionId.current) return useBufferStore.getState().activeBufferId ?? "";
      return openInWorkbench({ type: "agent", sessionId: chatId });
    });
    useBufferStore.setState({
      actions: {
        ...bufferActions,
        openContent: openInWorkbench,
        openSettingsBuffer: () => {
          const state = useUIState.getState();
          channel.postMessage({
            type: "settings",
            tab: state.settingsInitialTab ?? undefined,
            section: state.settingsInitialSection ?? undefined,
          });
          return "agent-settings-request";
        },
        setActiveBuffer: (id) => {
          const item = useBufferStore.getState().buffers.find((candidate) => candidate.id === id);
          if (item?.type === "editor")
            openInWorkbench({
              type: "editor",
              path: item.path,
              name: item.name,
              content: item.content,
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
    void useAuthStore.getState().actions.initialize().catch(console.error);
    void Promise.all([initializeSettingsStore(), initializeThemeSystem(), listeners])
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
      useAgentWindowStore.getState().actions.setAccountIdentity(null);
      useBufferStore.setState({ actions: bufferActions });
      void listeners.then((unlisteners) => unlisteners.forEach((unlisten) => unlisten()));
      channel.close();
      window.removeEventListener(REQUEST_WINDOW_CLOSE_EVENT, returnToOwner);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [returnToOwner]);

  return (
    <DialogServiceProvider>
      <TooltipProvider>
        <FontStyleInjector />
        <WindowResizeBorder />
        <div className="athas-layout-shell flex h-dvh flex-col overflow-hidden bg-background">
          <TitleBar
            showMinimal
            title={chat?.title ?? "Agent"}
            titleIcon={
              <ProviderIcon
                providerId={
                  chat?.agentId === "custom"
                    ? (chat.providerId ?? "custom")
                    : (chat?.agentId ?? "custom")
                }
              />
            }
          />
          {error ? (
            <Empty tone="error">
              <EmptyHeader>
                <EmptyTitle>Agent window error</EmptyTitle>
                <EmptyDescription>{error}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : !ready || returning ? (
            <Empty>
              <EmptyTitle>{returning ? "Returning agent…" : "Loading agent…"}</EmptyTitle>
            </Empty>
          ) : buffer?.type === "agent" ? (
            <main className="min-h-0 min-w-0 flex-1">
              <AgentTab buffer={buffer} />
            </main>
          ) : null}
        </div>
        <Toaster />
      </TooltipProvider>
    </DialogServiceProvider>
  );
}
