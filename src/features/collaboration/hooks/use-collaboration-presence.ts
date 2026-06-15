import { useEffect, useMemo, useRef } from "react";
import { useCollaborationRuntimeStore } from "@/features/collaboration/stores/collaboration-runtime.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import {
  appendCollaborationDocumentUpdate,
  getCollaborationClientId,
  getNextCollaborationClientSeq,
  registerCollaborationDocument,
  streamCollaborationDocumentUpdates,
  updateCollaborationPresence,
} from "@/features/window/services/auth-api";
import { useAuthStore } from "@/features/window/stores/auth.store";

const PRESENCE_HEARTBEAT_MS = 60_000;
const DOCUMENT_STREAM_RECONNECT_MS = 2_000;
const CURSOR_UPDATE_THROTTLE_MS = 1_500;
const VIEWPORT_UPDATE_THROTTLE_MS = 2_000;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function useCollaborationPresence() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const collaboration = useAuthStore((state) => state.subscription?.collaboration);
  const setCollaborationSnapshot = useAuthStore((state) => state.setCollaborationSnapshot);
  const collaborationEnabled = Boolean(collaboration?.enabled);
  const presenceEnabled = collaboration?.settings?.sharedSettings.presenceEnabled !== false;
  const realtimeDocumentsEnabled = Boolean(collaboration?.capabilities.realtimeDocuments);
  const presenceTarget = useCollaborationRuntimeStore((state) => state.presenceTarget);
  const activeDocumentStream = useCollaborationRuntimeStore((state) => state.activeDocumentStream);
  const mediaState = useCollaborationRuntimeStore((state) => state.mediaState);
  const collaborationRuntimeActions = useCollaborationRuntimeStore((state) => state.actions);
  const activeBufferId = useBufferStore.use.activeBufferId();
  const buffers = useBufferStore.use.buffers();
  const cursorPosition = useEditorStateStore.use.cursorPosition();
  const selection = useEditorStateStore.use.selection?.();
  const scrollTop = useEditorStateStore.use.scrollTop();
  const scrollLeft = useEditorStateStore.use.scrollLeft();
  const viewportHeight = useEditorStateStore.use.viewportHeight();
  const lastPublishedCursorKey = useRef<string | null>(null);
  const lastPublishedViewportKey = useRef<string | null>(null);

  const activeFilePath = useMemo(() => {
    const buffer = buffers.find((entry) => entry.id === activeBufferId);
    if (!buffer || !("path" in buffer)) return null;
    if (buffer.path.startsWith("untitled:") || buffer.path.includes("://")) return null;
    return buffer.path;
  }, [activeBufferId, buffers]);

  useEffect(() => {
    if (!isAuthenticated || !collaborationEnabled || !presenceEnabled) return;

    let cancelled = false;
    const sendPresence = (status: "online" | "offline") => {
      const activeMedia = [
        mediaState.microphone ? "mic" : null,
        mediaState.screen ? "screen" : null,
      ].filter(Boolean);

      void updateCollaborationPresence({
        status,
        activeFilePath,
        channelId: status === "offline" ? null : presenceTarget.channelId,
        followingUserId: status === "offline" ? null : presenceTarget.followingUserId,
        cursorLabel:
          status === "offline" || activeMedia.length === 0 ? null : activeMedia.join(","),
      }).catch(() => {
        if (!cancelled && import.meta.env.DEV) {
          console.debug("Collaboration presence update failed");
        }
      });
    };

    sendPresence("online");
    const timer = window.setInterval(() => sendPresence("online"), PRESENCE_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      sendPresence("offline");
    };
  }, [
    activeFilePath,
    collaborationEnabled,
    isAuthenticated,
    mediaState.microphone,
    mediaState.screen,
    presenceEnabled,
    presenceTarget.channelId,
    presenceTarget.followingUserId,
  ]);

  useEffect(() => {
    if (!isAuthenticated || !collaborationEnabled || !realtimeDocumentsEnabled || !activeFilePath) {
      collaborationRuntimeActions.resetStream();
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let afterVersion = 0;

    const run = async () => {
      collaborationRuntimeActions.setStreamConnecting(activeFilePath);

      try {
        const nextCollaboration = await registerCollaborationDocument({
          path: activeFilePath,
          baseVersion: 0,
          stateVector: { source: "desktop-active-buffer" },
        });
        if (cancelled) return;

        if (!nextCollaboration) {
          collaborationRuntimeActions.setStreamError(
            activeFilePath,
            "Collaboration document registration did not return a workspace snapshot.",
          );
          return;
        }

        setCollaborationSnapshot(nextCollaboration);
        const document = nextCollaboration.documents.find((entry) => entry.path === activeFilePath);
        if (!document) {
          collaborationRuntimeActions.setStreamError(
            activeFilePath,
            "Registered collaboration document was not returned by the account service.",
          );
          return;
        }

        afterVersion = document.baseVersion;
        while (!cancelled) {
          await streamCollaborationDocumentUpdates({
            documentId: document.id,
            afterVersion,
            signal: controller.signal,
            onEvent: (event) => {
              if (cancelled) return;

              if (event.type === "ready") {
                afterVersion = Math.max(afterVersion, event.document.baseVersion);
                collaborationRuntimeActions.setStreamReady(event.document, activeFilePath);
                return;
              }

              if (event.type === "heartbeat") {
                afterVersion = Math.max(afterVersion, event.afterServerVersion);
                collaborationRuntimeActions.recordStreamHeartbeat(
                  event.document,
                  event.afterServerVersion,
                );
                return;
              }

              if (event.type === "update") {
                afterVersion = Math.max(afterVersion, event.update.serverVersion);
                collaborationRuntimeActions.recordStreamUpdate(
                  event.document,
                  event.update,
                  getCollaborationClientId(),
                );
                return;
              }

              collaborationRuntimeActions.setStreamError(activeFilePath, event.error);
            },
          });

          if (!cancelled) {
            collaborationRuntimeActions.setStreamReconnecting();
            await delay(DOCUMENT_STREAM_RECONNECT_MS, controller.signal);
          }
        }
      } catch {
        if (!cancelled) {
          collaborationRuntimeActions.setStreamError(
            activeFilePath,
            "Collaboration document stream failed.",
          );
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
      collaborationRuntimeActions.resetStream();
    };
  }, [
    activeFilePath,
    collaborationEnabled,
    collaborationRuntimeActions,
    isAuthenticated,
    realtimeDocumentsEnabled,
    setCollaborationSnapshot,
  ]);

  useEffect(() => {
    const documentId = activeDocumentStream.documentId;
    if (
      !isAuthenticated ||
      !collaborationEnabled ||
      !realtimeDocumentsEnabled ||
      !activeFilePath ||
      !documentId ||
      activeDocumentStream.status !== "live"
    ) {
      return;
    }

    const cursorKey = JSON.stringify({
      path: activeFilePath,
      documentId,
      cursorPosition,
      selection,
    });
    if (lastPublishedCursorKey.current === cursorKey) return;

    const timer = window.setTimeout(() => {
      if (lastPublishedCursorKey.current === cursorKey) return;
      lastPublishedCursorKey.current = cursorKey;

      void appendCollaborationDocumentUpdate({
        documentId,
        clientId: getCollaborationClientId(),
        clientSeq: getNextCollaborationClientSeq(),
        updateType: "cursor",
        operation: {
          source: "desktop-cursor",
          path: activeFilePath,
          cursor: cursorPosition,
          selection: selection ?? null,
          activeChannelId: presenceTarget.channelId,
          followingUserId: presenceTarget.followingUserId,
        },
      })
        .then((nextCollaboration) => {
          if (nextCollaboration) setCollaborationSnapshot(nextCollaboration);
          collaborationRuntimeActions.recordCursorUpdateSent(documentId);
        })
        .catch(() => {
          if (import.meta.env.DEV) {
            console.debug("Collaboration cursor update append failed");
          }
        });
    }, CURSOR_UPDATE_THROTTLE_MS);

    return () => window.clearTimeout(timer);
  }, [
    activeDocumentStream.documentId,
    activeDocumentStream.status,
    activeFilePath,
    collaborationEnabled,
    collaborationRuntimeActions,
    cursorPosition,
    isAuthenticated,
    presenceTarget.channelId,
    presenceTarget.followingUserId,
    realtimeDocumentsEnabled,
    selection,
    setCollaborationSnapshot,
  ]);

  useEffect(() => {
    const documentId = activeDocumentStream.documentId;
    if (
      !isAuthenticated ||
      !collaborationEnabled ||
      !realtimeDocumentsEnabled ||
      !activeFilePath ||
      !documentId ||
      activeDocumentStream.status !== "live"
    ) {
      return;
    }

    const viewportKey = JSON.stringify({
      path: activeFilePath,
      documentId,
      scrollTop,
      scrollLeft,
      viewportHeight,
    });
    if (lastPublishedViewportKey.current === viewportKey) return;

    const timer = window.setTimeout(() => {
      if (lastPublishedViewportKey.current === viewportKey) return;
      lastPublishedViewportKey.current = viewportKey;

      void appendCollaborationDocumentUpdate({
        documentId,
        clientId: getCollaborationClientId(),
        clientSeq: getNextCollaborationClientSeq(),
        updateType: "metadata",
        operation: {
          source: "desktop-viewport",
          path: activeFilePath,
          viewport: {
            scrollTop,
            scrollLeft,
            viewportHeight,
          },
          activeChannelId: presenceTarget.channelId,
          followingUserId: presenceTarget.followingUserId,
        },
      })
        .then((nextCollaboration) => {
          if (nextCollaboration) setCollaborationSnapshot(nextCollaboration);
          collaborationRuntimeActions.recordViewportUpdateSent(documentId);
        })
        .catch(() => {
          if (import.meta.env.DEV) {
            console.debug("Collaboration viewport update append failed");
          }
        });
    }, VIEWPORT_UPDATE_THROTTLE_MS);

    return () => window.clearTimeout(timer);
  }, [
    activeDocumentStream.documentId,
    activeDocumentStream.status,
    activeFilePath,
    collaborationEnabled,
    collaborationRuntimeActions,
    isAuthenticated,
    presenceTarget.channelId,
    presenceTarget.followingUserId,
    realtimeDocumentsEnabled,
    scrollLeft,
    scrollTop,
    setCollaborationSnapshot,
    viewportHeight,
  ]);
}
