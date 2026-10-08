import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { OpenContentSpec } from "@/features/panes/types/pane-content.types";
import { initializeSettingsStore } from "@/features/settings/stores/settings.store";
import { initializeThemeSystem } from "@/extensions/themes/theme-initializer";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { initializeFrontendTerminalSession } from "@/features/terminal/utils/frontend-terminal-session";
import { frontendTrace } from "@/utils/frontend-trace";
import { applyPlatformClass } from "@/utils/platform";
import { onAppEvent } from "@/utils/app-events";
import { listenToMenuActions } from "../lib/menu-actions";
import {
  type DetachedWindowBaseMessage,
  type DetachedWindowKind,
  getDetachedWindowChannelName,
  parseDetachedWindowUrl,
} from "./detached-window-protocol";
import { readBufferText } from "@/features/editor/services/buffer-text";

export interface DetachedWindowConnection<Message> {
  post: (message: Message) => void;
  /**
   * Opens content in this window instead of forwarding it to the owner.
   * Everything else that asks for workbench content lands in the owner window.
   */
  openLocally: (content: OpenContentSpec) => string;
}

interface UseDetachedWindowOptions<Message> {
  kind: DetachedWindowKind;
  /** Messages the base protocol does not handle itself. */
  onMessage: (message: Message, connection: DetachedWindowConnection<Message>) => void;
  /** Runs for every close gesture: the close button, Cmd+W, the app menu and quit. */
  onCloseRequest: () => void;
}

/**
 * Window side of a detached window. Connects to the owner over the channel
 * named in the URL, boots the stores a bare window needs, routes workbench and
 * settings requests back to the owner, and funnels every close gesture into a
 * single callback so each kind decides what closing means.
 */
export function useDetachedWindow<Message extends { type: string }>({
  kind,
  onMessage,
  onCloseRequest,
}: UseDetachedWindowOptions<Message>) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = useMemo(() => parseDetachedWindowUrl(new URL(window.location.href)), []);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const handleMessage = useEffectEvent(onMessage);
  const handleCloseRequest = useEffectEvent(onCloseRequest);
  const openLocallyRef = useRef<DetachedWindowConnection<Message>["openLocally"]>((content) =>
    useBufferStore.getState().actions.openContent(content),
  );

  const post = useCallback((message: Message) => {
    channelRef.current?.postMessage(message);
  }, []);
  const openLocally = useCallback(
    (content: OpenContentSpec) => openLocallyRef.current(content),
    [],
  );

  useEffect(() => {
    applyPlatformClass();
    if (!target || target.kind !== kind) {
      setError("This window has no source window.");
      return;
    }

    let disposed = false;
    const channel = new BroadcastChannel(getDetachedWindowChannelName(target.channel));
    channelRef.current = channel;
    const connection: DetachedWindowConnection<Message> = { post, openLocally };

    channel.onmessage = ({ data }: MessageEvent<Message>) => {
      if (disposed) return;
      if ((data as DetachedWindowBaseMessage).type === "focus") {
        void getCurrentWindow().setFocus().catch(console.error);
        return;
      }
      handleMessage(data, connection);
    };

    const bufferActions = useBufferStore.getState().actions;
    openLocallyRef.current = bufferActions.openContent;
    const openInOwner: typeof bufferActions.openContent = (content) => {
      channel.postMessage({ type: "workbench", content });
      return "detached-workbench-request";
    };
    if (kind !== "standalone")
      useBufferStore.setState({
        actions: {
          ...bufferActions,
          openContent: openInOwner,
          setActiveBuffer: (id) => {
            const item = useBufferStore.getState().buffers.find((candidate) => candidate.id === id);
            if (item?.type === "editor") {
              openInOwner({
                type: "editor",
                path: item.path,
                name: item.name,
                content: readBufferText(item),
              });
            }
          },
        },
      });

    // A detached workbench has no Settings dialog of its own, so it opens the owner's. A
    // standalone window shows Settings as its content instead.
    useUIState.setState({
      openSettings:
        kind === "standalone"
          ? (tab, section) => {
              useUIState.setState((state) => ({
                settingsInitialTab: tab ?? null,
                settingsInitialSection: section ?? null,
                settingsNavigationRequestId: state.settingsNavigationRequestId + 1,
              }));
              bufferActions.openContent({ type: "settings" });
            }
          : (tab, section) => channel.postMessage({ type: "settings", tab, section }),
    });

    if (kind === "standalone") {
      useBufferStore.setState({
        actions: {
          ...bufferActions,
          openContent: (content) => {
            if (
              [
                "terminal",
                "settings",
                "extensions",
                "extension",
                "pullRequest",
                "githubIssue",
                "githubAction",
                "githubDelivery",
                "githubForm",
              ].includes(content.type)
            ) {
              return bufferActions.openContent(content);
            }
            void createAppWindow({ workbenchContent: content }).catch(console.error);
            return "standalone-workbench-request";
          },
        },
      });
    }

    const requestClose = () => {
      if (!disposed) handleCloseRequest();
    };
    const unlisteners = new Set<() => void>();
    let listenersFailed = false;
    const stopListeners = () => {
      for (const unlisten of unlisteners) unlisten();
      unlisteners.clear();
    };
    const listeners = Promise.all(
      [
        getCurrentWindow().onCloseRequested((event) => {
          if (disposed) return;
          event.preventDefault();
          requestClose();
        }),
        listenToMenuActions(({ action }) => {
          if (action === "close_window" || action === "quit_app") requestClose();
        }),
      ].map((listener) =>
        listener.then((unlisten) => {
          if (disposed || listenersFailed) unlisten();
          else unlisteners.add(unlisten);
        }),
      ),
    ).catch((cause) => {
      listenersFailed = true;
      stopListeners();
      throw cause;
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        requestClose();
      }
    };
    const unsubscribeCloseRequest = onAppEvent("athas:request-window-close", requestClose);
    window.addEventListener("keydown", onKeyDown);

    void useAuthStore.getState().actions.initialize().catch(console.error);
    const startedAt = performance.now();
    void Promise.all([
      initializeSettingsStore(),
      initializeThemeSystem(),
      listeners,
      kind === "standalone" ? initializeFrontendTerminalSession() : Promise.resolve(),
    ])
      .then(() => {
        if (!disposed) {
          frontendTrace("info", "bench:detached-window", "ready", {
            kind,
            durationMs: Math.round(performance.now() - startedAt),
          });
          setReady(true);
          channel.postMessage({ type: "ready" });
        }
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });

    return () => {
      disposed = true;
      channelRef.current = null;
      useBufferStore.setState({ actions: bufferActions });
      stopListeners();
      unsubscribeCloseRequest();
      window.removeEventListener("keydown", onKeyDown);
      channel.close();
    };
  }, [kind, openLocally, post, target]);

  return { error, ready, post, openLocally, payload: target?.payload ?? null };
}
