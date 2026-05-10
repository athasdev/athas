import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import { activateBufferInPaneAndSync } from "@/features/panes/utils/pane-activation";
import {
  clearInternalTabDragData,
  getInternalTabDragData,
} from "@/features/tabs/utils/internal-tab-drag";
import { useUIState } from "@/features/window/stores/ui-state-store";
import {
  handleExternalFileDropPayload,
  isExternalFileDragTypeList,
} from "../utils/file-system-drop-controller";

function resolveClientPoint(position: { x: number; y: number }) {
  const rawPoint = { x: position.x, y: position.y };
  const scaledPoint = {
    x: position.x / window.devicePixelRatio,
    y: position.y / window.devicePixelRatio,
  };

  const rawElement = document.elementFromPoint(rawPoint.x, rawPoint.y);
  if (rawElement) {
    return { point: rawPoint, element: rawElement };
  }

  const scaledElement = document.elementFromPoint(scaledPoint.x, scaledPoint.y);
  return { point: scaledPoint, element: scaledElement };
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
    window.dispatchEvent(
      new CustomEvent("terminal-detach-to-buffer", {
        detail: { terminalId: tabData.terminalId },
      }),
    );
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

/**
 * Hook to handle drag-and-drop from OS into the application
 * @param onDrop - Callback when files/folders are dropped (array of paths)
 * @returns isDraggingOver - Boolean indicating if a drag is over the window
 */
export const useFileSystemFolderDrop = (onDrop: (paths: string[]) => void | Promise<void>) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let unlistenWindow: (() => void) | null = null;
    let unlistenWebview: (() => void) | null = null;
    let domTeardown: (() => void) | null = null;

    const handleExternalPayload = async (payload: { type: string; paths?: string[] }) => {
      await handleExternalFileDropPayload(payload, {
        onDrop,
        setDraggingOver: setIsDraggingOver,
        onError: (error) => {
          console.error("Error handling dropped items:", error);
        },
      });
    };

    const setupListener = async () => {
      unlistenWindow = await currentWindow.onDragDropEvent(async (event) => {
        if (getInternalTabDragData()) {
          if (
            event.payload.type === "drop" &&
            "position" in event.payload &&
            routeInternalTabDrop(event.payload.position)
          ) {
            setIsDraggingOver(false);
            return;
          }
          if (event.payload.type === "leave" || event.payload.type === "drop") {
            setIsDraggingOver(false);
          }
          return;
        }
        await handleExternalPayload(event.payload);
      });

      const currentWebview = getCurrentWebview();
      unlistenWebview = await currentWebview.onDragDropEvent(async (event) => {
        if (getInternalTabDragData()) {
          if (
            event.payload.type === "drop" &&
            "position" in event.payload &&
            routeInternalTabDrop(event.payload.position)
          ) {
            setIsDraggingOver(false);
            return;
          }
          if (event.payload.type === "leave" || event.payload.type === "drop") {
            setIsDraggingOver(false);
          }
          return;
        }
        await handleExternalPayload(event.payload);
      });

      const onDomDragOver = (event: DragEvent) => {
        if (getInternalTabDragData()) return;
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
      };
      const onDomDrop = (event: DragEvent) => {
        if (getInternalTabDragData()) {
          setIsDraggingOver(false);
          return;
        }
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        setIsDraggingOver(false);
      };
      const onDomEnter = (event: DragEvent) => {
        if (getInternalTabDragData()) return;
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        setIsDraggingOver(true);
      };
      const onDomLeave = (event: DragEvent) => {
        if (getInternalTabDragData()) {
          setIsDraggingOver(false);
          return;
        }
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        setIsDraggingOver(false);
      };

      window.addEventListener("dragover", onDomDragOver);
      window.addEventListener("drop", onDomDrop);
      window.addEventListener("dragenter", onDomEnter);
      window.addEventListener("dragleave", onDomLeave);

      domTeardown = () => {
        window.removeEventListener("dragover", onDomDragOver);
        window.removeEventListener("drop", onDomDrop);
        window.removeEventListener("dragenter", onDomEnter);
        window.removeEventListener("dragleave", onDomLeave);
      };
    };

    setupListener();

    return () => {
      if (unlistenWindow) unlistenWindow();
      if (unlistenWebview) unlistenWebview();
      if (domTeardown) domTeardown();
    };
  }, [onDrop]);

  return { isDraggingOver };
};
