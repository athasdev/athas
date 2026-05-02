import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import { getAllPaneGroups } from "@/features/panes/utils/pane-tree";
import { useSettingsStore } from "@/features/settings/store";
import {
  clearInternalTabDragData,
  getInternalTabDragData,
  getInternalTabDragHover,
} from "@/features/tabs/utils/internal-tab-drag";
import TerminalContainer from "@/features/terminal/components/terminal-container";
import { cn } from "@/utils/cn";
import { IS_MAC } from "@/utils/platform";
import { useProjectStore } from "@/features/window/stores/project-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import ReferencesPane from "../../../references/components/references-pane";
import { BottomBufferPane } from "./bottom-buffer-pane";

const BottomPane = () => {
  const { isBottomPaneVisible, bottomPaneActiveTab } = useUIState();
  const { rootFolderPath } = useProjectStore();
  const { settings } = useSettingsStore();
  const bottomRoot = usePaneStore.use.bottomRoot();
  const bottomPaneBufferIds = getAllPaneGroups(bottomRoot).flatMap((pane) => pane.bufferIds);
  const { moveBufferToPane, setActivePane } = usePaneStore.use.actions();
  const { openTerminalBuffer } = useBufferStore.use.actions();
  const [height, setHeight] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isInternalHoverTarget, setIsInternalHoverTarget] = useState(false);

  useEffect(() => {
    const syncHover = () => {
      setIsInternalHoverTarget(getInternalTabDragHover().paneId === BOTTOM_PANE_ID);
    };

    window.addEventListener("athas-internal-tab-drag-hover", syncHover);
    return () => window.removeEventListener("athas-internal-tab-drag-hover", syncHover);
  }, []);

  useEffect(() => {
    if (isBottomPaneVisible && bottomPaneActiveTab === "diagnostics") {
      useUIState.getState().setIsBottomPaneVisible(false);
    }
  }, [bottomPaneActiveTab, isBottomPaneVisible]);

  useEffect(() => {
    if (
      isBottomPaneVisible &&
      bottomPaneActiveTab === "buffers" &&
      bottomPaneBufferIds.length === 0
    ) {
      useUIState.getState().setIsBottomPaneVisible(false);
    }
  }, [bottomPaneActiveTab, bottomPaneBufferIds.length, isBottomPaneVisible]);

  // Resize logic
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startY = e.clientY;
      const startHeight = height;

      const handleMouseMove = (e: MouseEvent) => {
        const deltaY = startY - e.clientY; // Reverse direction since we're resizing from top
        const newHeight = Math.min(Math.max(startHeight + deltaY, 200), window.innerHeight * 0.8); // Min 200px, max 80% of screen
        setHeight(newHeight);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  const titleBarHeight = IS_MAC ? 44 : 28; // h-11 for macOS, h-7 for Windows/Linux
  const footerHeight = 32; // Footer height matches min-h-[32px] from editor-footer
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("application/tab-data") && !getInternalTabDragData()) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const tabDataString = e.dataTransfer.getData("application/tab-data");
      const fallbackTabData = getInternalTabDragData();
      if (!tabDataString && !fallbackTabData) return;

      e.preventDefault();

      try {
        const tabData = (tabDataString ? JSON.parse(tabDataString) : fallbackTabData) as
          | {
              bufferId?: string;
              paneId?: string;
              source?: "pane" | "terminal-panel";
              terminalId?: string;
              name?: string;
              initialCommand?: string;
              currentDirectory?: string;
              remoteConnectionId?: string;
            }
          | undefined;

        if (!tabData) return;

        if (tabData.source === "terminal-panel" && tabData.terminalId) {
          setActivePane(BOTTOM_PANE_ID);
          openTerminalBuffer({
            sessionId: tabData.terminalId,
            name: tabData.name,
            command: tabData.initialCommand,
            workingDirectory: tabData.currentDirectory,
            remoteConnectionId: tabData.remoteConnectionId,
          });
          window.dispatchEvent(
            new CustomEvent("terminal-detach-to-buffer", {
              detail: { terminalId: tabData.terminalId },
            }),
          );
        } else if (tabData.bufferId && tabData.paneId && tabData.paneId !== BOTTOM_PANE_ID) {
          moveBufferToPane(tabData.bufferId, tabData.paneId, BOTTOM_PANE_ID);
        } else {
          return;
        }

        useUIState.getState().setBottomPaneActiveTab("buffers");
        useUIState.getState().setIsBottomPaneVisible(true);
      } catch {
        // Ignore malformed drag payloads.
      } finally {
        clearInternalTabDragData();
      }
    },
    [moveBufferToPane, openTerminalBuffer, setActivePane],
  );

  return (
    <div
      data-bottom-pane-drop-target
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border border-border/70 bg-primary-bg",
        isInternalHoverTarget && "ring-2 ring-accent ring-inset",
        isFullScreen && "fixed inset-x-2 z-[10040] rounded-xl shadow-2xl",
        !isBottomPaneVisible && "hidden",
      )}
      style={
        isFullScreen
          ? {
              top: `${titleBarHeight + 8}px`,
              bottom: `${footerHeight + 8}px`,
            }
          : {
              height: `${height}px`,
              flexShrink: 0,
            }
      }
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "group absolute top-0 right-0 left-0 z-10 h-1",
          "cursor-ns-resize transition-colors duration-150 hover:bg-blue-500/30",
          isResizing && "bg-blue-500/50",
        )}
      >
        <div
          className={cn(
            "-translate-y-[1px] absolute top-0 right-0 left-0 h-[3px]",
            "bg-blue-500 opacity-0 transition-opacity duration-150 group-hover:opacity-100",
          )}
        />
      </div>

      {/* Content Area */}
      <div className="h-full overflow-hidden">
        {/* Terminal Container - Always mounted to preserve terminal sessions */}
        {settings.coreFeatures.terminal && (
          <TerminalContainer
            currentDirectory={rootFolderPath}
            className={cn("h-full", bottomPaneActiveTab === "terminal" ? "block" : "hidden")}
            onFullScreen={() => setIsFullScreen(!isFullScreen)}
            isFullScreen={isFullScreen}
          />
        )}

        {/* References Pane */}
        {bottomPaneActiveTab === "references" && (
          <div className="h-full">
            <ReferencesPane
              onFullScreen={() => setIsFullScreen(!isFullScreen)}
              isFullScreen={isFullScreen}
            />
          </div>
        )}

        {bottomPaneActiveTab === "buffers" && (
          <div className="h-full">
            {bottomPaneBufferIds.length > 0 ? <BottomBufferPane /> : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default BottomPane;
