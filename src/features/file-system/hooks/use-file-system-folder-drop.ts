import { useEffect, useEffectEvent, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { activateBufferInPaneAndSync } from "@/features/panes/utils/pane-activation";
import {
  clearInternalTabDragData,
  getInternalTabDragData,
} from "@/features/tabs/utils/internal-tab-drag";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  dispatchDroppedPathsToTerminal,
  handleExternalFileDropPayload,
  getExternalFileDropRoute,
  isExternalFileDragTypeList,
  resolveDropClientPoint,
} from "../utils/file-system-drop-controller";
import { listenToNativeDragDrop, type NativeDragDropPayload } from "@/utils/tauri-drag-drop";
import { emitAppEvent } from "@/utils/app-events";

function resolveClientPoint(position: { x: number; y: number }) {
  return resolveDropClientPoint(position, window.devicePixelRatio, (x, y) =>
    document.elementFromPoint(x, y),
  );
}

function routeInternalTabDrop(position: { x: number; y: number }) {
  const tabData = getInternalTabDragData();
  if (!tabData) return false;

  const { element } = resolveClientPoint(position);
  if (!element) return false;

  const paneActions = usePaneStore.getState().actions;
  const bufferActions = useBufferStore.getState().actions;
  const uiState = useUIState.getState();

  const tabBar = element.closest<HTMLElement>("[data-tab-bar-pane-id]");
  const paneContainer = element.closest<HTMLElement>("[data-pane-id]");
  const bottomPaneTarget = element.closest<HTMLElement>("[data-bottom-pane-drop-target]");

  const targetPaneId =
    tabBar?.dataset.tabBarPaneId ||
    paneContainer?.dataset.paneId ||
    (bottomPaneTarget ? BOTTOM_PANE_ID : null);

  if (!targetPaneId) return false;

  if (tabData.source === "terminal-panel" && tabData.terminalId) {
    const bufferId = bufferActions.openTerminalBuffer({
      sessionId: tabData.terminalId,
      name: tabData.name,
      command: tabData.initialCommand,
      workingDirectory: tabData.currentDirectory,
      remoteConnectionId: tabData.remoteConnectionId,
    });
    activateBufferInPaneAndSync(targetPaneId, bufferId);
    emitAppEvent("terminal-detach-to-buffer", { terminalId: tabData.terminalId });
  } else if (tabData.bufferId && tabData.paneId && tabData.paneId !== targetPaneId) {
    paneActions.moveBufferToPane(tabData.bufferId, tabData.paneId, targetPaneId);
    activateBufferInPaneAndSync(targetPaneId, tabData.bufferId);
  } else {
    return false;
  }

  if (targetPaneId === BOTTOM_PANE_ID) {
    uiState.setBottomPaneActiveTab("buffers");
    uiState.setIsBottomPaneVisible(true);
  }

  clearInternalTabDragData();

  return true;
}

function isExternalFileDrag(event: DragEvent): boolean {
  return isExternalFileDragTypeList(event.dataTransfer?.types);
}

function isGlobalExternalFileDropEventTarget(
  event: DragEvent,
  treatPaneDropAsGlobal: boolean,
): boolean {
  return (
    getExternalFileDropRoute(
      event.target instanceof Element ? event.target : null,
      treatPaneDropAsGlobal,
    ) === "global"
  );
}

function listenForExternalFileDropDomEvents(
  treatPaneDropAsGlobal: boolean,
  setDraggingOver: (isDraggingOver: boolean) => void,
) {
  const onDomDragOver = (event: DragEvent) => {
    if (getInternalTabDragData()) return;
    if (!isExternalFileDrag(event)) return;
    if (!isGlobalExternalFileDropEventTarget(event, treatPaneDropAsGlobal)) {
      setDraggingOver(false);
      return;
    }
    event.preventDefault();
  };
  const onDomDrop = (event: DragEvent) => {
    if (getInternalTabDragData()) {
      setDraggingOver(false);
      return;
    }
    if (!isExternalFileDrag(event)) return;
    if (!isGlobalExternalFileDropEventTarget(event, treatPaneDropAsGlobal)) {
      setDraggingOver(false);
      return;
    }
    event.preventDefault();
    setDraggingOver(false);
  };
  const onDomEnter = (event: DragEvent) => {
    if (getInternalTabDragData()) return;
    if (!isExternalFileDrag(event)) return;
    if (!isGlobalExternalFileDropEventTarget(event, treatPaneDropAsGlobal)) {
      setDraggingOver(false);
      return;
    }
    event.preventDefault();
    setDraggingOver(true);
  };
  const onDomLeave = (event: DragEvent) => {
    if (getInternalTabDragData()) {
      setDraggingOver(false);
      return;
    }
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    setDraggingOver(false);
  };

  window.addEventListener("dragover", onDomDragOver);
  window.addEventListener("drop", onDomDrop);
  window.addEventListener("dragenter", onDomEnter);
  window.addEventListener("dragleave", onDomLeave);

  return () => {
    window.removeEventListener("dragover", onDomDragOver);
    window.removeEventListener("drop", onDomDrop);
    window.removeEventListener("dragenter", onDomEnter);
    window.removeEventListener("dragleave", onDomLeave);
  };
}

/**
 * Hook to handle drag-and-drop from OS into the application
 * @param onDrop - Callback when files/folders are dropped (array of paths)
 * @param treatPaneDropAsGlobal - Whether editor pane surfaces should fall through to onDrop
 * @returns isDraggingOver - Boolean indicating if a drag is over the window
 */
export const useFileSystemFolderDrop = (
  onDrop: (paths: string[]) => void | Promise<void>,
  treatPaneDropAsGlobal = false,
) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const handleDrop = useEffectEvent((paths: string[]) => onDrop(paths));
  const handleNativeDragDrop = useEffectEvent(async (payload: NativeDragDropPayload) => {
    if (getInternalTabDragData()) {
      if (payload.type === "drop" && routeInternalTabDrop(payload.position)) {
        setIsDraggingOver(false);
        return;
      }
      if (payload.type === "leave" || payload.type === "drop") {
        setIsDraggingOver(false);
      }
      return;
    }

    const target = "position" in payload ? resolveClientPoint(payload.position).element : null;
    const route = getExternalFileDropRoute(target, treatPaneDropAsGlobal);

    if (route === "terminal") {
      if (payload.type === "drop") {
        dispatchDroppedPathsToTerminal(target, payload.paths);
      }
      setIsDraggingOver(false);
      return;
    }

    if (route !== "global") {
      setIsDraggingOver(false);
      return;
    }

    await handleExternalFileDropPayload(payload, {
      onDrop: handleDrop,
      setDraggingOver: setIsDraggingOver,
      onError: (error) => {
        console.error("Error handling dropped items:", error);
      },
    });
  });

  useEffect(() => {
    let disposed = false;
    let unlistenNative: (() => void) | null = null;

    void listenToNativeDragDrop((payload) => {
      if (!disposed) void handleNativeDragDrop(payload);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenNative = unlisten;
      })
      .catch((error) => {
        console.error("Failed to listen for native file drops:", error);
      });

    return () => {
      disposed = true;
      unlistenNative?.();
    };
  }, []);

  useEffect(
    () => listenForExternalFileDropDomEvents(treatPaneDropAsGlobal, setIsDraggingOver),
    [treatPaneDropAsGlobal],
  );

  return { isDraggingOver };
};
