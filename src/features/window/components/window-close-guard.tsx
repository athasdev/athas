import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { isEditorContent } from "@/features/panes/types/pane-content.types";
import UnsavedChangesDialog from "@/features/window/components/unsaved-changes-dialog";
import { consumeCloseRequestSuppression } from "@/features/window/utils/close-request-suppression";
import { REQUEST_WINDOW_CLOSE_EVENT } from "@/features/window/utils/request-window-close";
import { IS_LINUX } from "@/utils/platform";

interface PendingWindowClose {
  bufferId: string;
  fileName: string;
}

type CloseRequestedHandler = Parameters<ReturnType<typeof getCurrentWindow>["onCloseRequested"]>[0];

async function listenForCloseGuard(
  handleCloseRequested: CloseRequestedHandler,
  continueCloseOrPrompt: () => Promise<void>,
) {
  const currentWindow = getCurrentWindow();
  const currentWebviewWindow = getCurrentWebviewWindow();
  const [unlistenClose, unlistenQuit, unlistenMenuCloseWindow] = await Promise.all([
    currentWindow.onCloseRequested(handleCloseRequested),
    currentWebviewWindow.listen("menu_quit_app", () => void continueCloseOrPrompt()),
    currentWebviewWindow.listen("menu_close_window", () => void continueCloseOrPrompt()),
  ]);

  return () => {
    unlistenClose();
    unlistenQuit();
    unlistenMenuCloseWindow();
  };
}

function getBlockingDirtyBuffer(discardedBufferIds: Set<string>) {
  return useBufferStore
    .getState()
    .buffers.find(
      (buffer) => isEditorContent(buffer) && buffer.isDirty && !discardedBufferIds.has(buffer.id),
    );
}

export function WindowCloseGuard() {
  const [pendingClose, setPendingClose] = useState<PendingWindowClose | null>(null);
  const closeInProgressRef = useRef(false);
  const discardedBufferIdsRef = useRef(new Set<string>());
  const persistActiveProjectSession = useFileSystemStore(
    (state) => state.persistActiveProjectSession,
  );
  const { setActiveBuffer } = useBufferStore.use.actions();
  const { handleSave } = useEditorAppStore.use.actions();

  const persistSessionSnapshot = useCallback(() => {
    useFileSystemStore.getState().persistActiveProjectSession();
  }, []);

  const continueCloseOrPrompt = useCallback(async () => {
    const dirtyBuffer = getBlockingDirtyBuffer(discardedBufferIdsRef.current);

    if (dirtyBuffer) {
      setPendingClose({
        bufferId: dirtyBuffer.id,
        fileName: dirtyBuffer.name,
      });
      return;
    }

    persistSessionSnapshot();
    closeInProgressRef.current = true;
    await getCurrentWindow().close();
  }, [persistSessionSnapshot]);

  const handleCloseRequested = useCallback<CloseRequestedHandler>(
    (event) => {
      if (IS_LINUX && consumeCloseRequestSuppression()) {
        event.preventDefault();
        return;
      }

      if (closeInProgressRef.current) {
        persistSessionSnapshot();
        return;
      }

      const dirtyBuffer = getBlockingDirtyBuffer(discardedBufferIdsRef.current);
      if (!dirtyBuffer) {
        persistSessionSnapshot();
        return;
      }

      event.preventDefault();
      setPendingClose({
        bufferId: dirtyBuffer.id,
        fileName: dirtyBuffer.name,
      });
    },
    [persistSessionSnapshot],
  );

  useEffect(() => {
    let disposed = false;
    let unlistenCloseGuard: (() => void) | undefined;

    void listenForCloseGuard(handleCloseRequested, continueCloseOrPrompt).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenCloseGuard = unlisten;
    });
    window.addEventListener("beforeunload", persistActiveProjectSession);
    window.addEventListener(REQUEST_WINDOW_CLOSE_EVENT, continueCloseOrPrompt);

    return () => {
      disposed = true;
      unlistenCloseGuard?.();
      window.removeEventListener("beforeunload", persistActiveProjectSession);
      window.removeEventListener(REQUEST_WINDOW_CLOSE_EVENT, continueCloseOrPrompt);
    };
  }, [continueCloseOrPrompt, handleCloseRequested, persistActiveProjectSession]);

  const handleSaveAndContinue = useCallback(async () => {
    if (!pendingClose) return;

    setActiveBuffer(pendingClose.bufferId);
    await handleSave();

    const pendingBuffer = getBufferById(useBufferStore.getState().buffers, pendingClose.bufferId);

    if (pendingBuffer && isEditorContent(pendingBuffer) && pendingBuffer.isDirty) {
      return;
    }

    setPendingClose(null);
    await continueCloseOrPrompt();
  }, [continueCloseOrPrompt, handleSave, pendingClose, setActiveBuffer]);

  const handleDiscardAndContinue = useCallback(async () => {
    if (!pendingClose) return;

    discardedBufferIdsRef.current.add(pendingClose.bufferId);
    setPendingClose(null);
    await continueCloseOrPrompt();
  }, [continueCloseOrPrompt, pendingClose]);

  const handleCancel = useCallback(() => {
    discardedBufferIdsRef.current.clear();
    closeInProgressRef.current = false;
    setPendingClose(null);
  }, []);

  if (!pendingClose) {
    return null;
  }

  return (
    <UnsavedChangesDialog
      fileName={pendingClose.fileName}
      onSave={() => void handleSaveAndContinue()}
      onDiscard={() => void handleDiscardAndContinue()}
      onCancel={handleCancel}
    />
  );
}
