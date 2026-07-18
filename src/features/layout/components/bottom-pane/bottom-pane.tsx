import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DebuggerView from "@/features/debugger/components/debugger-view";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { activateBufferInPaneAndSync } from "@/features/panes/utils/pane-activation";
import { getAllPaneGroups } from "@/features/panes/utils/pane-tree";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  clearInternalTabDragData,
  getInternalTabDragData,
  getInternalTabDragHover,
} from "@/features/tabs/utils/internal-tab-drag";
import TerminalContainer from "@/features/terminal/components/terminal-container";
import { cn } from "@/utils/cn";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { WorkbenchFullscreenSurface } from "@/features/window/components/workbench-fullscreen-surface";
import { BottomBufferPane } from "./bottom-buffer-pane";

const BottomPane = () => {
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const terminalEnabled = useSettingsStore((state) => state.settings.coreFeatures.terminal);
  const debuggerEnabled = useSettingsStore((state) => state.settings.coreFeatures.debugger);
  const bottomRoot = usePaneStore.use.bottomRoot();
  const bottomPaneBufferIds = useMemo(() => {
    const bufferIds: string[] = [];
    for (const pane of getAllPaneGroups(bottomRoot)) {
      for (const bufferId of pane.bufferIds) {
        bufferIds.push(bufferId);
      }
    }
    return bufferIds;
  }, [bottomRoot]);
  const { moveBufferToPane } = usePaneStore.use.actions();
  const { openTerminalBuffer } = useBufferStore.use.actions();
  const [height, setHeight] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isInternalHoverTarget, setIsInternalHoverTarget] = useState(false);
  const paneFrameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncHover = () => {
      setIsInternalHoverTarget(getInternalTabDragHover().paneId === BOTTOM_PANE_ID);
    };

    window.addEventListener("athas-internal-tab-drag-hover", syncHover);
    return () => window.removeEventListener("athas-internal-tab-drag-hover", syncHover);
  }, []);

  useEffect(() => {
    if (
      isBottomPaneVisible &&
      (bottomPaneActiveTab === "diagnostics" || bottomPaneActiveTab === "references")
    ) {
      useUIState.getState().setIsBottomPaneVisible(false);
    }
  }, [bottomPaneActiveTab, isBottomPaneVisible]);

  useEffect(() => {
    if (isBottomPaneVisible && bottomPaneActiveTab === "debugger" && !debuggerEnabled) {
      useUIState.getState().setIsBottomPaneVisible(false);
    }
  }, [bottomPaneActiveTab, isBottomPaneVisible, debuggerEnabled]);

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
      const frameEl = paneFrameRef.current;
      let currentHeight = startHeight;
      let rafId: number | null = null;

      const handleMouseMove = (e: MouseEvent) => {
        const deltaY = startY - e.clientY;
        currentHeight = Math.min(Math.max(startHeight + deltaY, 200), window.innerHeight * 0.8);

        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (frameEl) {
            frameEl.style.height = `calc(${currentHeight}px + var(--athas-workbench-gap))`;
          }
        });
      };

      const handleMouseUp = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (frameEl) {
          frameEl.style.height = `calc(${currentHeight}px + var(--athas-workbench-gap))`;
        }
        setHeight(currentHeight);
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
          const bufferId = openTerminalBuffer({
            sessionId: tabData.terminalId,
            name: tabData.name,
            command: tabData.initialCommand,
            workingDirectory: tabData.currentDirectory,
            remoteConnectionId: tabData.remoteConnectionId,
          });
          activateBufferInPaneAndSync(BOTTOM_PANE_ID, bufferId);
          window.dispatchEvent(
            new CustomEvent("terminal-detach-to-buffer", {
              detail: { terminalId: tabData.terminalId },
            }),
          );
        } else if (tabData.bufferId && tabData.paneId && tabData.paneId !== BOTTOM_PANE_ID) {
          moveBufferToPane(tabData.bufferId, tabData.paneId, BOTTOM_PANE_ID);
          activateBufferInPaneAndSync(BOTTOM_PANE_ID, tabData.bufferId);
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
    [moveBufferToPane, openTerminalBuffer],
  );

  const resizeGutter = !isFullScreen ? (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        "group relative flex h-[var(--athas-workbench-gap)] w-full shrink-0 cursor-ns-resize items-center justify-center",
        "transition-colors duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] hover:bg-accent/8",
        isResizing && "bg-accent/8",
      )}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize bottom pane"
    >
      <div
        className={cn(
          "h-px w-full bg-transparent transition-colors duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] group-hover:bg-accent",
          isResizing && "bg-accent",
        )}
      />
    </div>
  ) : null;

  const paneContent = (
    <div
      data-bottom-pane-drop-target
      className={cn(
        "athas-glass-island relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-primary-bg",
        isInternalHoverTarget && "ring-2 ring-accent ring-inset",
        isFullScreen && "size-full rounded-none border-0 shadow-none ring-0",
        !isFullScreen && "flex-1",
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="h-full overflow-hidden">
        {/* Terminal Container - Always mounted to preserve terminal sessions */}
        {terminalEnabled && (
          <TerminalContainer
            currentDirectory={rootFolderPath}
            className={cn("h-full", bottomPaneActiveTab === "terminal" ? "block" : "hidden")}
            onFullScreen={() => setIsFullScreen(!isFullScreen)}
            isFullScreen={isFullScreen}
          />
        )}

        {debuggerEnabled && bottomPaneActiveTab === "debugger" && (
          <div className="h-full">
            <DebuggerView />
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

  const pane = isFullScreen ? (
    <WorkbenchFullscreenSurface>{paneContent}</WorkbenchFullscreenSurface>
  ) : (
    paneContent
  );

  if (isFullScreen) {
    return isBottomPaneVisible ? pane : null;
  }

  return (
    <div
      ref={paneFrameRef}
      className={cn("flex shrink-0 flex-col", !isBottomPaneVisible && "hidden")}
      style={{
        height: `calc(${height}px + var(--athas-workbench-gap))`,
      }}
    >
      {resizeGutter}
      {pane}
      {isResizing ? <div className="fixed inset-0 z-40 cursor-ns-resize" /> : null}
    </div>
  );
};

export default BottomPane;
