import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeEditor from "@/features/editor/components/code-editor";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { stageHunk, unstageHunk } from "@/features/git/api/status";
import type { GitHunk } from "@/features/git/types/git";
import TabBar from "@/features/tabs/components/tab-bar";
import { EmptyEditorState } from "../../layout/components/empty-editor-state";
import { usePaneStore } from "../stores/pane-store";
import type { PaneGroup } from "../types/pane";

const AgentTab = lazy(() =>
  import("@/features/ai/components/agent-tab").then((m) => ({ default: m.AgentTab })),
);
const SQLiteViewer = lazy(() => import("@/features/database/providers/sqlite/sqlite-viewer"));
const ExternalEditorTerminal = lazy(() =>
  import("@/features/editor/components/external-editor-terminal").then((m) => ({
    default: m.ExternalEditorTerminal,
  })),
);
const DiffViewer = lazy(() => import("@/features/git/components/diff/viewer"));
const PRViewer = lazy(() => import("@/features/github/components/pr-viewer"));
const ImageViewer = lazy(() =>
  import("@/features/image-viewer/components/image-viewer").then((m) => ({
    default: m.ImageViewer,
  })),
);
const PdfViewer = lazy(() =>
  import("@/features/pdf-viewer/components/pdf-viewer").then((m) => ({ default: m.PdfViewer })),
);
const TerminalTab = lazy(() =>
  import("@/features/terminal/components/terminal-tab").then((m) => ({ default: m.TerminalTab })),
);
const WebViewer = lazy(() =>
  import("@/features/web-viewer/components/web-viewer").then((m) => ({ default: m.WebViewer })),
);

interface PaneContainerProps {
  pane: PaneGroup;
}

export function PaneContainer({ pane }: PaneContainerProps) {
  const buffers = useBufferStore.use.buffers();
  const activePaneId = usePaneStore.use.activePaneId();
  const { setActivePane, setActivePaneBuffer, addBufferToPane, moveBufferToPane } =
    usePaneStore.use.actions();
  const { closeBufferForce, openBuffer } = useBufferStore.use.actions();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const handleFileOpen = useFileSystemStore.use.handleFileOpen?.();

  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isActivePane = pane.id === activePaneId;

  const paneBuffers = useMemo(() => {
    return buffers.filter((b) => pane.bufferIds.includes(b.id));
  }, [buffers, pane.bufferIds]);

  const activeBuffer = useMemo(() => {
    if (!pane.activeBufferId) return null;
    return paneBuffers.find((b) => b.id === pane.activeBufferId) || null;
  }, [paneBuffers, pane.activeBufferId]);

  const handlePaneClick = useCallback(() => {
    if (!isActivePane) {
      setActivePane(pane.id);
      // Sync buffer store's activeBufferId with this pane's active buffer
      if (pane.activeBufferId) {
        useBufferStore.getState().actions.setActiveBuffer(pane.activeBufferId);
      }
    }
  }, [isActivePane, pane.id, pane.activeBufferId, setActivePane]);

  const handleTabClick = useCallback(
    (bufferId: string) => {
      setActivePane(pane.id);
      setActivePaneBuffer(pane.id, bufferId);
      // Sync buffer store's activeBufferId
      useBufferStore.getState().actions.setActiveBuffer(bufferId);
    },
    [pane.id, setActivePane, setActivePaneBuffer],
  );

  const handleStageHunk = useCallback(
    async (hunk: GitHunk) => {
      if (!rootFolderPath) return;
      try {
        const success = await stageHunk(rootFolderPath, hunk);
        if (success) {
          window.dispatchEvent(new CustomEvent("git-status-changed"));
        }
      } catch (error) {
        console.error("Error staging hunk:", error);
      }
    },
    [rootFolderPath],
  );

  const handleUnstageHunk = useCallback(
    async (hunk: GitHunk) => {
      if (!rootFolderPath) return;
      try {
        const success = await unstageHunk(rootFolderPath, hunk);
        if (success) {
          window.dispatchEvent(new CustomEvent("git-status-changed"));
        }
      } catch (error) {
        console.error("Error unstaging hunk:", error);
      }
    },
    [rootFolderPath],
  );

  const handleExternalEditorExit = useCallback(() => {
    if (activeBuffer?.isExternalEditor) {
      closeBufferForce(activeBuffer.id);
    }
  }, [activeBuffer, closeBufferForce]);

  // Listen for file tree drops on this pane
  useEffect(() => {
    const handleFileTreeDrop = async (e: CustomEvent) => {
      const { path, name, x, y } = e.detail;
      const container = containerRef.current;

      if (!container) return;

      // Check if this drop is within this pane's bounds
      const rect = container.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        return;
      }

      // This pane receives the file drop
      setActivePane(pane.id);

      try {
        const content = await readFileContent(path);
        const existingBuffer = buffers.find((b) => b.path === path);

        if (existingBuffer) {
          if (!pane.bufferIds.includes(existingBuffer.id)) {
            addBufferToPane(pane.id, existingBuffer.id, true);
          } else {
            setActivePaneBuffer(pane.id, existingBuffer.id);
          }
        } else {
          const bufferId = openBuffer(path, name, content, false, false, false, false);
          if (!pane.bufferIds.includes(bufferId)) {
            addBufferToPane(pane.id, bufferId, true);
          }
        }
        // Sync buffer store
        const newActivePane = usePaneStore.getState().actions.getActivePane();
        if (newActivePane?.activeBufferId) {
          useBufferStore.getState().actions.setActiveBuffer(newActivePane.activeBufferId);
        }
      } catch (error) {
        console.error("Failed to open file from file tree drop:", error);
      }
    };

    window.addEventListener(
      "file-tree-drop-on-pane",
      handleFileTreeDrop as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        "file-tree-drop-on-pane",
        handleFileTreeDrop as unknown as EventListener,
      );
    };
  }, [
    pane.id,
    pane.bufferIds,
    buffers,
    setActivePane,
    addBufferToPane,
    setActivePaneBuffer,
    openBuffer,
  ]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if this is a tab being dragged or a file
    const hasTabData = e.dataTransfer.types.includes("application/tab-data");
    const hasFilePath = e.dataTransfer.types.includes("text/plain");
    const hasFileDragData = !!window.__fileDragData;

    if (hasTabData || hasFilePath || hasFileDragData || e.dataTransfer.types.includes("Files")) {
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if we're leaving the pane container itself
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setIsDragOver(false);
    }
  }, []);

  // Handle mouse up for file tree drag (which uses mouse events, not HTML5 drag API)
  const handleMouseUp = useCallback(async () => {
    const fileDragData = window.__fileDragData;
    if (!fileDragData || fileDragData.isDir) {
      return; // Only handle file drops, not directory drops
    }

    // File tree is dragging a file and user released on this pane
    setActivePane(pane.id);

    try {
      const content = await readFileContent(fileDragData.path);
      const existingBuffer = buffers.find((b) => b.path === fileDragData.path);

      if (existingBuffer) {
        // Buffer exists, add to this pane if not already there
        if (!pane.bufferIds.includes(existingBuffer.id)) {
          addBufferToPane(pane.id, existingBuffer.id, true);
        } else {
          setActivePaneBuffer(pane.id, existingBuffer.id);
        }
      } else {
        // Open the file as a new buffer
        const bufferId = openBuffer(
          fileDragData.path,
          fileDragData.name,
          content,
          false,
          false,
          false,
          false,
        );
        // Ensure it's in this pane
        if (!pane.bufferIds.includes(bufferId)) {
          addBufferToPane(pane.id, bufferId, true);
        }
      }
    } catch (error) {
      console.error("Failed to open file from file tree:", error);
    }

    // Clean up global drag data
    delete window.__fileDragData;
  }, [
    pane.id,
    pane.bufferIds,
    buffers,
    setActivePane,
    addBufferToPane,
    setActivePaneBuffer,
    openBuffer,
  ]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      setActivePane(pane.id);

      // Handle tab drag from another pane
      const tabDataString = e.dataTransfer.getData("application/tab-data");
      if (tabDataString) {
        try {
          const tabData = JSON.parse(tabDataString);
          const { bufferId, paneId: sourcePaneId } = tabData;

          if (sourcePaneId && sourcePaneId !== pane.id) {
            // Move buffer from source pane to this pane
            moveBufferToPane(bufferId, sourcePaneId, pane.id);
          } else if (!sourcePaneId) {
            // Tab from outside pane system, just add to this pane
            addBufferToPane(pane.id, bufferId, true);
          }
          return;
        } catch {
          // Invalid tab data, continue to other handlers
        }
      }

      // Handle file path drop from file tree
      const filePath = e.dataTransfer.getData("text/plain");
      if (filePath?.startsWith("/")) {
        try {
          const fileName = filePath.split("/").pop() || "Untitled";
          const content = await readFileContent(filePath);

          // Check if buffer already exists
          const existingBuffer = buffers.find((b) => b.path === filePath);
          if (existingBuffer) {
            // Buffer exists, add to this pane if not already there
            if (!pane.bufferIds.includes(existingBuffer.id)) {
              addBufferToPane(pane.id, existingBuffer.id, true);
            } else {
              setActivePaneBuffer(pane.id, existingBuffer.id);
            }
          } else {
            // Open the file as a new buffer
            const bufferId = openBuffer(filePath, fileName, content, false, false, false, false);
            // Ensure it's in this pane
            if (!pane.bufferIds.includes(bufferId)) {
              addBufferToPane(pane.id, bufferId, true);
            }
          }
          return;
        } catch (error) {
          console.error("Failed to open dropped file:", error);
        }
      }

      // Handle native file drop
      if (e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
          const path = (file as File & { path?: string }).path;
          if (path && handleFileOpen) {
            await handleFileOpen(path, false);
          }
        }
      }
    },
    [
      pane.id,
      pane.bufferIds,
      buffers,
      setActivePane,
      addBufferToPane,
      moveBufferToPane,
      setActivePaneBuffer,
      openBuffer,
      handleFileOpen,
    ],
  );

  return (
    <div
      ref={containerRef}
      data-pane-container
      className={`relative flex h-full w-full flex-col overflow-hidden bg-primary-bg ${
        isActivePane ? "ring-1 ring-accent/30" : ""
      } ${isDragOver ? "ring-2 ring-accent" : ""}`}
      onClick={handlePaneClick}
      onMouseUp={handleMouseUp}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && <div className="pointer-events-none absolute inset-0 z-40 bg-accent/10" />}
      {paneBuffers.length > 0 && <TabBar paneId={pane.id} onTabClick={handleTabClick} />}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!activeBuffer && <EmptyEditorState />}

        <Suspense fallback={null}>
          {paneBuffers
            .filter((b) => b.isTerminal && b.terminalSessionId)
            .map((buffer) => (
              <div
                key={buffer.id}
                className={buffer.id === pane.activeBufferId ? "h-full" : "hidden"}
              >
                <TerminalTab
                  sessionId={buffer.terminalSessionId!}
                  bufferId={buffer.id}
                  initialCommand={buffer.terminalInitialCommand}
                  workingDirectory={buffer.terminalWorkingDirectory}
                  isActive={buffer.id === pane.activeBufferId && isActivePane}
                />
              </div>
            ))}

          {paneBuffers
            .filter((b) => b.isWebViewer && b.webViewerUrl)
            .map((buffer) => (
              <div
                key={buffer.id}
                className={buffer.id === pane.activeBufferId ? "h-full" : "hidden"}
              >
                <WebViewer
                  url={buffer.webViewerUrl!}
                  bufferId={buffer.id}
                  isActive={buffer.id === pane.activeBufferId && isActivePane}
                />
              </div>
            ))}

          {paneBuffers
            .filter((b) => b.isAgent)
            .map((buffer) => (
              <div
                key={buffer.id}
                className={buffer.id === pane.activeBufferId ? "h-full" : "hidden"}
              >
                <AgentTab />
              </div>
            ))}

          {activeBuffer &&
            !activeBuffer.isTerminal &&
            !activeBuffer.isWebViewer &&
            !activeBuffer.isAgent &&
            (() => {
              if (activeBuffer.isDiff) {
                return (
                  <DiffViewer onStageHunk={handleStageHunk} onUnstageHunk={handleUnstageHunk} />
                );
              } else if (activeBuffer.isPullRequest && activeBuffer.prNumber) {
                return <PRViewer prNumber={activeBuffer.prNumber} />;
              } else if (activeBuffer.isImage) {
                return (
                  <ImageViewer
                    filePath={activeBuffer.path}
                    fileName={activeBuffer.name}
                    bufferId={activeBuffer.id}
                  />
                );
              } else if (activeBuffer.isPdf) {
                return (
                  <PdfViewer
                    filePath={activeBuffer.path}
                    fileName={activeBuffer.name}
                    bufferId={activeBuffer.id}
                  />
                );
              } else if (activeBuffer.isSQLite) {
                return <SQLiteViewer databasePath={activeBuffer.path} />;
              } else if (activeBuffer.isExternalEditor && activeBuffer.terminalConnectionId) {
                return (
                  <ExternalEditorTerminal
                    filePath={activeBuffer.path}
                    fileName={activeBuffer.name}
                    terminalConnectionId={activeBuffer.terminalConnectionId}
                    onEditorExit={handleExternalEditorExit}
                  />
                );
              } else {
                return <CodeEditor paneId={pane.id} bufferId={activeBuffer.id} />;
              }
            })()}
        </Suspense>
      </div>
    </div>
  );
}
