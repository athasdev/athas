import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import type { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import UnsavedChangesDialog from "@/features/tabs/components/unsaved-changes-dialog";
import { WindowCloseSession, type PendingWindowClose } from "../services/window-close-session";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { agentsAreDetached } from "@/features/ai/detached/agent-window.store";
import { toast } from "sonner";
import { onAppEvent } from "@/utils/app-events";
import { listenToMenuActions } from "../services/menu-actions";

type CloseRequestedHandler = Parameters<ReturnType<typeof getCurrentWindow>["onCloseRequested"]>[0];

async function listenForCloseGuard(
  handleCloseRequested: CloseRequestedHandler,
  continueCloseOrPrompt: () => Promise<void>,
) {
  const currentWindow = getCurrentWindow();
  const results = await Promise.allSettled([
    currentWindow.onCloseRequested(handleCloseRequested),
    listenToMenuActions(({ action }) => {
      if (action === "quit_app" || action === "close_window") void continueCloseOrPrompt();
    }),
  ]);
  const unlisteners = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    unlisteners.forEach((unlisten) => unlisten());
    throw failure.reason;
  }
  return () => unlisteners.forEach((unlisten) => unlisten());
}

export function WindowCloseGuard() {
  const [session] = useState(() => new WindowCloseSession());
  const [pendingClose, setPendingClose] = useState<PendingWindowClose | null>(null);
  const pendingCloseRef = useRef<PendingWindowClose | null>(null);
  const closeInProgressRef = useRef(false);
  const setDecision = useCallback((request: PendingWindowClose | null) => {
    pendingCloseRef.current = request;
    setPendingClose(request);
  }, []);
  const persistSessionSnapshot = useCallback(() => {
    for (const store of workspaceRuntimeRegistry.getExistingStores<
      ReturnType<typeof useFileSystemStore.getState>
    >("file-system")) {
      store.getState().persistActiveProjectSession({ immediate: true });
    }
  }, []);

  const continueCloseOrPrompt = useCallback(async () => {
    if (agentsAreDetached()) {
      toast.info("Close the agent windows before closing this window.");
      return;
    }
    if (closeInProgressRef.current || pendingCloseRef.current) return;
    const request = session.findBlockingDraft();
    if (request) {
      setDecision(request);
      return;
    }
    try {
      persistSessionSnapshot();
      closeInProgressRef.current = true;
      await getCurrentWindow().close();
    } catch (error) {
      closeInProgressRef.current = false;
      session.reset();
      toast.error(`Could not close this window: ${String(error)}`);
    }
  }, [persistSessionSnapshot, session, setDecision]);

  const handleCloseRequested = useCallback<CloseRequestedHandler>(
    (event) => {
      if (agentsAreDetached()) {
        event.preventDefault();
        toast.info("Close the agent windows before closing this window.");
        return;
      }
      const request = session.findBlockingDraft();
      if (request) {
        event.preventDefault();
        closeInProgressRef.current = false;
        if (!pendingCloseRef.current) setDecision(request);
        return;
      }
      try {
        persistSessionSnapshot();
      } catch (error) {
        event.preventDefault();
        closeInProgressRef.current = false;
        session.reset();
        toast.error(`Could not save the window session: ${String(error)}`);
      }
    },
    [persistSessionSnapshot, session, setDecision],
  );

  useEffect(() => {
    let disposed = false;
    let unlistenCloseGuard: (() => void) | undefined;
    void listenForCloseGuard(handleCloseRequested, continueCloseOrPrompt)
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenCloseGuard = unlisten;
      })
      .catch((error) => {
        if (!disposed)
          toast.error(`Could not protect unsaved changes while closing: ${String(error)}`);
      });
    window.addEventListener("beforeunload", persistSessionSnapshot);
    const unsubscribeCloseRequest = onAppEvent("window:request-close", continueCloseOrPrompt);
    return () => {
      disposed = true;
      session.reset();
      pendingCloseRef.current = null;
      unlistenCloseGuard?.();
      window.removeEventListener("beforeunload", persistSessionSnapshot);
      unsubscribeCloseRequest();
    };
  }, [continueCloseOrPrompt, handleCloseRequested, persistSessionSnapshot, session]);

  const handleSaveAndContinue = useCallback(async () => {
    const request = pendingCloseRef.current;
    if (!request) return;
    const saved = await session.save(request);
    if (pendingCloseRef.current !== request) return;
    if (!saved && session.isDraftPresent(request)) return;
    setDecision(null);
    await continueCloseOrPrompt();
  }, [continueCloseOrPrompt, session, setDecision]);

  const handleDiscardAndContinue = useCallback(async () => {
    const request = pendingCloseRef.current;
    if (!request) return;
    session.discard(request);
    setDecision(null);
    await continueCloseOrPrompt();
  }, [continueCloseOrPrompt, session, setDecision]);

  const handleCancel = useCallback(() => {
    session.reset();
    closeInProgressRef.current = false;
    setDecision(null);
  }, [session, setDecision]);

  if (!pendingClose) return null;
  const workspaceName =
    workspaceRuntimeRegistry.getWorkspace(pendingClose.owner.workspaceId)?.descriptor.name ??
    pendingClose.owner.workspaceId;
  return (
    <UnsavedChangesDialog
      decisionKey={pendingClose}
      fileName={`${pendingClose.buffer.name} (${workspaceName})`}
      onSave={handleSaveAndContinue}
      onDiscard={() => void handleDiscardAndContinue()}
      onCancel={handleCancel}
    />
  );
}
