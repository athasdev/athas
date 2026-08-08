import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
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
  type ExternalFileDropPayload,
} from "../utils/file-system-drop-controller";

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
      const handleNativeDragDrop = async (payload: ExternalFileDropPayload) => {
        if (getInternalTabDragData()) {
          if (
            payload.type === "drop" &&
            payload.position &&
            routeInternalTabDrop(payload.position)
          ) {
            setIsDraggingOver(false);
            return;
          }
          if (payload.type === "leave" || payload.type === "drop") {
            setIsDraggingOver(false);
          }
          return;
        }

        const position = payload.position;
        const target = position ? resolveClientPoint(position).element : null;
        const route = getExternalFileDropRoute(target, treatPaneDropAsGlobal);

        if (route === "terminal") {
          if (payload.type === "drop" && payload.paths) {
            dispatchDroppedPathsToTerminal(target, payload.paths);
          }
          setIsDraggingOver(false);
          return;
        }

        if (route !== "global") {
          setIsDraggingOver(false);
          return;
        }

        await handleExternalPayload(payload);
      };

      unlistenWindow = await currentWindow.onDragDropEvent((event) =>
        handleNativeDragDrop(event.payload),
      );

      const currentWebview = getCurrentWebview();
      unlistenWebview = await currentWebview.onDragDropEvent((event) =>
        handleNativeDragDrop(event.payload),
      );

      const onDomDragOver = (event: DragEvent) => {
        if (getInternalTabDragData()) return;
        if (!isExternalFileDrag(event)) return;
        if (!isGlobalExternalFileDropEventTarget(event, treatPaneDropAsGlobal)) {
          setIsDraggingOver(false);
          return;
        }
        event.preventDefault();
      };
      const onDomDrop = (event: DragEvent) => {
        if (getInternalTabDragData()) {
          setIsDraggingOver(false);
          return;
        }
        if (!isExternalFileDrag(event)) return;
        if (!isGlobalExternalFileDropEventTarget(event, treatPaneDropAsGlobal)) {
          setIsDraggingOver(false);
          return;
        }
        event.preventDefault();
        setIsDraggingOver(false);
      };
      const onDomEnter = (event: DragEvent) => {
        if (getInternalTabDragData()) return;
        if (!isExternalFileDrag(event)) return;
        if (!isGlobalExternalFileDropEventTarget(event, treatPaneDropAsGlobal)) {
          setIsDraggingOver(false);
          return;
        }
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
  }, [onDrop, treatPaneDropAsGlobal]);

  return { isDraggingOver };
};
