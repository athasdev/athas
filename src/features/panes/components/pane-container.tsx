import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DatabaseType } from "@/features/database/models/provider.types";
import { PROVIDER_REGISTRY } from "@/features/database/providers/provider-registry";
import CodeEditor from "@/features/editor/components/code-editor";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import type { Buffer } from "@/features/editor/stores/buffer-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { stageHunk, unstageHunk } from "@/features/git/api/git-status-api";
import type { GitHunk } from "@/features/git/types/git-types";
import { useGitHubStore } from "@/features/github/stores/github-store";
import { useSettingsStore } from "@/features/settings/store";
import TabBar from "@/features/tabs/components/tab-bar";
import { extractDroppedFilePaths } from "@/features/file-system/utils/file-system-dropped-paths";
import { cn } from "@/utils/cn";
import { EmptyEditorState } from "../../layout/components/empty-editor-state";
import { usePaneStore } from "../stores/pane-store";
import type { PaneGroup } from "../types/pane";
import { hasTextContent } from "../types/pane-content";
import type { EditorContent, PullRequestContent } from "../types/pane-content";
import { type DropZone, SplitDropOverlay } from "./split-drop-overlay";

const AgentTab = lazy(() =>
  import("@/features/ai/components/agent-tab").then((m) => ({ default: m.AgentTab })),
);

const databaseViewerCache = new Map<
  DatabaseType,
  React.LazyExoticComponent<React.ComponentType<any>>
>();
function getDatabaseViewer(dbType: DatabaseType) {
  if (!databaseViewerCache.has(dbType)) {
    databaseViewerCache.set(dbType, lazy(PROVIDER_REGISTRY[dbType].viewerComponent));
  }
  return databaseViewerCache.get(dbType)!;
}
const ExternalEditorTerminal = lazy(() =>
  import("@/features/editor/components/external-editor-terminal").then((m) => ({
    default: m.ExternalEditorTerminal,
  })),
);
const DiffViewer = lazy(() => import("@/features/git/components/diff/git-diff-viewer"));
const PRViewer = lazy(() => import("@/features/github/components/pr-viewer"));
const ImageViewer = lazy(() =>
  import("@/features/image-viewer/components/image-viewer").then((m) => ({
    default: m.ImageViewer,
  })),
);
const PdfViewer = lazy(() =>
  import("@/features/pdf-viewer/components/pdf-viewer").then((m) => ({ default: m.PdfViewer })),
);
const BinaryFileViewer = lazy(() =>
  import("@/features/binary-viewer/components/binary-file-viewer").then((m) => ({
    default: m.BinaryFileViewer,
  })),
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

const DEFAULT_CAROUSEL_CARD_WIDTH = 640;
const MIN_CAROUSEL_CARD_WIDTH = 320;
const CAROUSEL_OUTER_GAP_PX = 160;

function BufferPreviewCard({ buffer }: { buffer: Buffer }) {
  const previewText = hasTextContent(buffer)
    ? buffer.content.split("\n").slice(0, 14).join("\n").trim()
    : "";

  const summary =
    buffer.type === "terminal"
      ? "Terminal session"
      : buffer.type === "webViewer"
        ? buffer.url || "Web view"
        : buffer.type === "pullRequest"
          ? `Pull request #${buffer.prNumber}`
          : buffer.type === "diff"
            ? "Diff preview"
            : buffer.type === "image"
              ? "Image preview"
              : buffer.type === "pdf"
                ? "PDF preview"
                : buffer.type === "binary"
                  ? "Binary file preview"
                  : buffer.type === "database"
                    ? `${buffer.databaseType} viewer`
                    : buffer.type === "externalEditor"
                      ? "External editor session"
                      : previewText || "No preview available";

  const previewLines = summary.split("\n").slice(0, 12);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-primary-bg">
      <div className="pointer-events-none flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-12 shrink-0 flex-col items-end gap-1 border-r border-border/60 bg-secondary-bg/80 px-2 py-4 text-[11px] leading-5 text-text-lighter">
          {previewLines.map((_, index) => (
            <span key={`${buffer.id}-line-${index + 1}`}>{index + 1}</span>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          <pre className="h-full overflow-hidden whitespace-pre-wrap break-words text-xs leading-5 text-text-lighter">
            {summary}
          </pre>
        </div>
      </div>

      <div className="border-t border-border/60 bg-secondary-bg/80 px-4 py-2">
        <div className="truncate text-xs font-medium text-text">{buffer.name}</div>
        <div className="truncate text-[11px] text-text-lighter">{buffer.path}</div>
      </div>
    </div>
  );
}

function PullRequestPreviewCard({ buffer }: { buffer: PullRequestContent }) {
  const selectedPRDetails = useGitHubStore((state) => state.selectedPRDetails);
  const selectedPRComments = useGitHubStore((state) => state.selectedPRComments);
  const details = selectedPRDetails?.number === buffer.prNumber ? selectedPRDetails : null;
  const fileCount = details ? details.changedFiles : null;
  const commentCount = details ? selectedPRComments.length : null;
  const commitCount = details ? details.commits.length : null;
  const authorLogin = details ? details.author.login : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-primary-bg">
      <div className="shrink-0 bg-secondary-bg/60 px-3 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5 h-4 w-4 shrink-0 rounded-[4px] bg-green-500/80" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-border bg-primary-bg/70 px-1.5 py-0.5 font-mono text-[11px] text-text-lighter">
                #{buffer.prNumber ?? "--"}
              </span>
              <div className="min-w-0 truncate font-medium text-sm text-text">{buffer.name}</div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-lighter">
              <span className="font-medium text-text-light">
                {authorLogin ? `@${authorLogin}` : "Pull request"}
              </span>
              <span>{fileCount ?? "--"} files</span>
              <span>{commitCount ?? "--"} commits</span>
              <span>{commentCount ?? "--"} comments</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="rounded-md border border-border bg-primary-bg/70 px-2 py-1 text-text-lighter">
                Description
              </span>
              <span className="rounded-md border border-border bg-primary-bg/70 px-2 py-1 text-text-lighter">
                Files
              </span>
              <span className="rounded-md border border-border bg-primary-bg/70 px-2 py-1 text-text-lighter">
                Comments
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-primary-bg/40 px-3 py-3">
        <div className="rounded-lg bg-secondary-bg/35 px-3 py-2">
          <div className="line-clamp-5 text-sm leading-6 text-text-lighter">
            {details?.body?.trim()
              ? details.body
              : "Activate this card to inspect the full pull request description, changed files, comments, review state, and checkout actions."}
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-secondary-bg/35 px-3 py-2 text-xs text-text-lighter">
          {buffer.path}
        </div>
      </div>
    </div>
  );
}

function isStandardEditorBuffer(buffer: Buffer): buffer is EditorContent {
  return buffer.type === "editor";
}

export function PaneContainer({ pane }: PaneContainerProps) {
  const buffers = useBufferStore.use.buffers();
  const activePaneId = usePaneStore.use.activePaneId();
  const {
    setActivePane,
    setActivePaneBuffer,
    addBufferToPane,
    moveBufferToPane,
    reorderPaneBuffers,
    splitPane,
  } = usePaneStore.use.actions();
  const { closeBufferForce, openBuffer } = useBufferStore.use.actions();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const handleFileOpen = useFileSystemStore.use.handleFileOpen?.();
  const horizontalBufferCarousel = useSettingsStore((state) => state.settings.horizontalTabScroll);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isTabDragOver, setIsTabDragOver] = useState(false);
  const [carouselCardWidth, setCarouselCardWidth] = useState(DEFAULT_CAROUSEL_CARD_WIDTH);
  const [isCarouselResizing, setIsCarouselResizing] = useState(false);
  const [draggedCarouselBufferId, setDraggedCarouselBufferId] = useState<string | null>(null);
  const [carouselDropBufferId, setCarouselDropBufferId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const carouselViewportRef = useRef<HTMLDivElement>(null);
  const lastCarouselBufferIdRef = useRef<string | null>(null);
  const suppressAutoCenterRef = useRef(false);
  const isActivePane = pane.id === activePaneId;

  const paneBuffers = useMemo(
    () =>
      pane.bufferIds
        .map((bufferId) => buffers.find((buffer) => buffer.id === bufferId))
        .filter((buffer): buffer is Buffer => buffer !== undefined),
    [buffers, pane.bufferIds],
  );

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

  const getCarouselWidthBounds = useCallback(() => {
    const viewportWidth = carouselViewportRef.current?.clientWidth ?? window.innerWidth;
    return {
      min: MIN_CAROUSEL_CARD_WIDTH,
      max: Math.max(MIN_CAROUSEL_CARD_WIDTH, viewportWidth - CAROUSEL_OUTER_GAP_PX),
    };
  }, []);

  useEffect(() => {
    if (!horizontalBufferCarousel) return;

    const clampWidth = () => {
      const { min, max } = getCarouselWidthBounds();
      setCarouselCardWidth((current) => Math.max(min, Math.min(current, max)));
    };

    clampWidth();
    window.addEventListener("resize", clampWidth);
    return () => window.removeEventListener("resize", clampWidth);
  }, [getCarouselWidthBounds, horizontalBufferCarousel]);

  const handleCarouselResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = carouselCardWidth;
      setIsCarouselResizing(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const { min, max } = getCarouselWidthBounds();
        setCarouselCardWidth(Math.max(min, Math.min(startWidth + delta, max)));
      };

      const handleMouseUp = () => {
        setIsCarouselResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [carouselCardWidth, getCarouselWidthBounds],
  );

  const scrollBufferCardIntoView = useCallback(
    (bufferId: string, behavior: ScrollBehavior = "smooth") => {
      const viewport = carouselViewportRef.current;
      if (!viewport) return;

      const card = viewport.querySelector<HTMLElement>(`[data-buffer-card-id="${bufferId}"]`);
      if (!card) return;

      const viewportRect = viewport.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const targetLeft = card.offsetLeft - (viewportRect.width - cardRect.width) / 2;

      viewport.scrollTo({
        left: Math.max(0, targetLeft),
        behavior,
      });
    },
    [],
  );

  useEffect(() => {
    if (!horizontalBufferCarousel || !pane.activeBufferId || paneBuffers.length <= 1) return;
    if (suppressAutoCenterRef.current) {
      suppressAutoCenterRef.current = false;
      return;
    }
    scrollBufferCardIntoView(pane.activeBufferId, "smooth");
  }, [horizontalBufferCarousel, pane.activeBufferId, paneBuffers.length, scrollBufferCardIntoView]);

  useEffect(() => {
    if (pane.activeBufferId !== lastCarouselBufferIdRef.current) {
      lastCarouselBufferIdRef.current = pane.activeBufferId;
    }
  }, [pane.activeBufferId]);

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
    if (activeBuffer?.type === "externalEditor") {
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
          const bufferId = openBuffer(path, name, content, false, undefined, false, false);
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

    const hasTabData = e.dataTransfer.types.includes("application/tab-data");
    const hasFilePath = e.dataTransfer.types.includes("text/plain");
    const hasFileDragData = !!window.__fileDragData;

    if (hasTabData || hasFilePath || hasFileDragData || e.dataTransfer.types.includes("Files")) {
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
      if (hasTabData) {
        setIsTabDragOver(true);
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setIsDragOver(false);
      setIsTabDragOver(false);
    }
  }, []);

  const handleSplitDrop = useCallback(
    (zone: DropZone, e: React.DragEvent) => {
      setIsDragOver(false);
      setIsTabDragOver(false);

      if (!zone) return;

      const tabDataString = e.dataTransfer.getData("application/tab-data");
      if (!tabDataString) return;

      let bufferId: string;
      let sourcePaneId: string;
      try {
        const tabData = JSON.parse(tabDataString);
        bufferId = tabData.bufferId;
        sourcePaneId = tabData.paneId;
      } catch {
        return;
      }

      if (zone === "center") {
        if (sourcePaneId && sourcePaneId !== pane.id) {
          moveBufferToPane(bufferId, sourcePaneId, pane.id);
        } else if (!sourcePaneId) {
          addBufferToPane(pane.id, bufferId, true);
        }
        return;
      }

      // Create a split — new pane is always child[1]
      const direction = zone === "left" || zone === "right" ? "horizontal" : "vertical";
      const newPaneId = splitPane(pane.id, direction);
      if (!newPaneId) return;

      // Move the dragged buffer into the new pane (child[1] = right/bottom)
      if (sourcePaneId && sourcePaneId !== pane.id) {
        moveBufferToPane(bufferId, sourcePaneId, newPaneId);
      } else {
        moveBufferToPane(bufferId, pane.id, newPaneId);
      }
    },
    [pane.id, splitPane, moveBufferToPane, addBufferToPane],
  );

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
          undefined,
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
      setIsTabDragOver(false);
      setActivePane(pane.id);

      // Tab drops are handled by SplitDropOverlay — skip here
      if (e.dataTransfer.types.includes("application/tab-data")) {
        return;
      }

      const droppedPaths = extractDroppedFilePaths(e.dataTransfer);
      if (droppedPaths.length > 0 && handleFileOpen) {
        for (const droppedPath of droppedPaths) {
          await handleFileOpen(droppedPath, false);
        }
        return;
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

  const handleCarouselWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!horizontalBufferCarousel) return;

      const viewport = carouselViewportRef.current;
      if (!viewport) return;

      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-buffer-card-id]")) {
        return;
      }

      if (e.ctrlKey || e.metaKey) return;

      const delta =
        Math.abs(e.deltaX) > 0
          ? e.deltaX
          : e.shiftKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)
            ? e.deltaY
            : 0;
      if (delta === 0) return;

      const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
      if (maxScrollLeft <= 0) return;

      const nextScrollLeft = Math.max(0, Math.min(viewport.scrollLeft + delta, maxScrollLeft));
      if (nextScrollLeft === viewport.scrollLeft) return;

      e.preventDefault();
      viewport.scrollTo({ left: nextScrollLeft, behavior: "auto" });
    },
    [horizontalBufferCarousel],
  );

  const handleCarouselCardActivate = useCallback(
    (bufferId: string) => {
      if (draggedCarouselBufferId || isCarouselResizing) return;
      if (bufferId === pane.activeBufferId) return;
      suppressAutoCenterRef.current = true;
      handleTabClick(bufferId);
    },
    [draggedCarouselBufferId, handleTabClick, isCarouselResizing, pane.activeBufferId],
  );

  const handleCarouselCardDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, bufferId: string) => {
      setDraggedCarouselBufferId(bufferId);
      setCarouselDropBufferId(bufferId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-athas-carousel-buffer", bufferId);
    },
    [],
  );

  const handleCarouselCardDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, bufferId: string) => {
      if (!draggedCarouselBufferId || draggedCarouselBufferId === bufferId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setCarouselDropBufferId(bufferId);
    },
    [draggedCarouselBufferId],
  );

  const handleCarouselCardDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetBufferId: string) => {
      e.preventDefault();

      const sourceBufferId =
        draggedCarouselBufferId || e.dataTransfer.getData("application/x-athas-carousel-buffer");
      if (!sourceBufferId || sourceBufferId === targetBufferId) {
        setDraggedCarouselBufferId(null);
        setCarouselDropBufferId(null);
        return;
      }

      const sourceIndex = pane.bufferIds.indexOf(sourceBufferId);
      const targetIndex = pane.bufferIds.indexOf(targetBufferId);
      if (sourceIndex !== -1 && targetIndex !== -1 && sourceIndex !== targetIndex) {
        reorderPaneBuffers(pane.id, sourceIndex, targetIndex);
      }

      setDraggedCarouselBufferId(null);
      setCarouselDropBufferId(null);
    },
    [draggedCarouselBufferId, pane.bufferIds, pane.id, reorderPaneBuffers],
  );

  const handleCarouselCardDragEnd = useCallback(() => {
    setDraggedCarouselBufferId(null);
    setCarouselDropBufferId(null);
  }, []);

  const shouldShowNewTabCard = horizontalBufferCarousel && !activeBuffer;
  const shouldRenderCarousel =
    horizontalBufferCarousel && (paneBuffers.length > 1 || shouldShowNewTabCard);

  const renderActiveBuffer = useCallback(
    (buffer: Buffer) => {
      switch (buffer.type) {
        case "newTab":
          return null;

        case "terminal":
          return (
            <TerminalTab
              sessionId={buffer.sessionId}
              bufferId={buffer.id}
              initialCommand={buffer.initialCommand}
              workingDirectory={buffer.workingDirectory}
              remoteConnectionId={buffer.remoteConnectionId}
              isActive={isActivePane}
            />
          );

        case "webViewer":
          return <WebViewer url={buffer.url} bufferId={buffer.id} isActive={isActivePane} />;

        case "agent":
          return <AgentTab />;

        case "diff":
          return <DiffViewer onStageHunk={handleStageHunk} onUnstageHunk={handleUnstageHunk} />;

        case "pullRequest":
          return <PRViewer prNumber={buffer.prNumber} />;

        case "image":
          return <ImageViewer filePath={buffer.path} fileName={buffer.name} bufferId={buffer.id} />;

        case "pdf":
          return <PdfViewer filePath={buffer.path} fileName={buffer.name} bufferId={buffer.id} />;

        case "database": {
          const config = PROVIDER_REGISTRY[buffer.databaseType];
          const DatabaseViewer = getDatabaseViewer(buffer.databaseType);
          const viewerProps = config.isFileBased
            ? { databasePath: buffer.path }
            : { connectionId: buffer.connectionId };
          return <DatabaseViewer {...viewerProps} />;
        }

        case "binary":
          return (
            <BinaryFileViewer
              filePath={buffer.path}
              fileName={buffer.name}
              rootFolderPath={rootFolderPath}
            />
          );

        case "externalEditor":
          return (
            <ExternalEditorTerminal
              filePath={buffer.path}
              fileName={buffer.name}
              terminalConnectionId={buffer.terminalConnectionId}
              onEditorExit={handleExternalEditorExit}
            />
          );

        default:
          return <CodeEditor paneId={pane.id} bufferId={buffer.id} />;
      }
    },
    [
      handleExternalEditorExit,
      handleStageHunk,
      handleUnstageHunk,
      isActivePane,
      pane.id,
      rootFolderPath,
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
      {isDragOver && !isTabDragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 bg-accent/10" />
      )}
      <SplitDropOverlay visible={isTabDragOver} onDrop={handleSplitDrop} />
      {paneBuffers.length > 0 && <TabBar paneId={pane.id} onTabClick={handleTabClick} />}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {(!activeBuffer || activeBuffer.type === "newTab") && !shouldRenderCarousel && (
          <EmptyEditorState />
        )}

        <Suspense fallback={null}>
          {shouldRenderCarousel ? (
            <div
              ref={carouselViewportRef}
              className="scrollbar-hidden flex h-full items-stretch gap-4 overflow-x-auto overflow-y-hidden px-4 py-4 [overscroll-behavior-x:contain]"
              onWheelCapture={handleCarouselWheel}
            >
              {paneBuffers.map((buffer) => {
                const isActiveBuffer = buffer.id === pane.activeBufferId;
                const isDropTarget =
                  draggedCarouselBufferId !== null &&
                  carouselDropBufferId === buffer.id &&
                  draggedCarouselBufferId !== buffer.id;

                return (
                  <div
                    key={buffer.id}
                    data-buffer-card-id={buffer.id}
                    className={cn(
                      "relative h-full shrink-0 overflow-hidden rounded-2xl border text-left transition-[transform,opacity,border-color,box-shadow] duration-200",
                      isActiveBuffer
                        ? "border-accent/50 bg-primary-bg shadow-[0_0_0_1px_rgba(99,102,241,0.15)]"
                        : "border-border/70 bg-primary-bg hover:border-border/90",
                      isDropTarget && "border-accent shadow-[0_0_0_1px_rgba(99,102,241,0.25)]",
                      draggedCarouselBufferId === buffer.id && "opacity-70",
                      isCarouselResizing && "transition-none",
                    )}
                    style={{
                      width: `${carouselCardWidth}px`,
                    }}
                    draggable={!isCarouselResizing}
                    onDragStart={(e) => handleCarouselCardDragStart(e, buffer.id)}
                    onDragOver={(e) => handleCarouselCardDragOver(e, buffer.id)}
                    onDrop={(e) => handleCarouselCardDrop(e, buffer.id)}
                    onDragEnd={handleCarouselCardDragEnd}
                    onMouseEnter={() => handleCarouselCardActivate(buffer.id)}
                    onClick={
                      isActiveBuffer
                        ? undefined
                        : () => {
                            suppressAutoCenterRef.current = false;
                            handleTabClick(buffer.id);
                            scrollBufferCardIntoView(buffer.id, "smooth");
                          }
                    }
                    role={isActiveBuffer ? undefined : "button"}
                    tabIndex={isActiveBuffer ? undefined : 0}
                    onKeyDown={
                      isActiveBuffer
                        ? undefined
                        : (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              suppressAutoCenterRef.current = false;
                              handleTabClick(buffer.id);
                              scrollBufferCardIntoView(buffer.id, "smooth");
                            }
                          }
                    }
                  >
                    <div className="h-full w-full">
                      {buffer.type === "newTab" ? (
                        <EmptyEditorState />
                      ) : isStandardEditorBuffer(buffer) ? (
                        <CodeEditor
                          paneId={pane.id}
                          bufferId={buffer.id}
                          isActiveSurface={isActiveBuffer}
                          showToolbar={false}
                          className={isActiveBuffer ? undefined : "pointer-events-none"}
                        />
                      ) : buffer.type === "terminal" ? (
                        <div
                          className={
                            isActiveBuffer ? "h-full w-full" : "pointer-events-none h-full w-full"
                          }
                        >
                          <TerminalTab
                            sessionId={buffer.sessionId}
                            bufferId={buffer.id}
                            initialCommand={buffer.initialCommand}
                            workingDirectory={buffer.workingDirectory}
                            isActive={isActivePane && isActiveBuffer}
                            isVisible={true}
                          />
                        </div>
                      ) : buffer.type === "webViewer" ? (
                        <div
                          className={
                            isActiveBuffer ? "h-full w-full" : "pointer-events-none h-full w-full"
                          }
                        >
                          <WebViewer
                            url={buffer.url}
                            bufferId={buffer.id}
                            isActive={isActivePane && isActiveBuffer}
                            isVisible={true}
                          />
                        </div>
                      ) : buffer.type === "pullRequest" ? (
                        <PullRequestPreviewCard buffer={buffer} />
                      ) : isActiveBuffer ? (
                        renderActiveBuffer(buffer)
                      ) : (
                        <BufferPreviewCard buffer={buffer} />
                      )}
                    </div>
                    <div
                      className="absolute top-0 right-0 z-20 h-full w-2 cursor-col-resize transition-colors hover:bg-accent/20"
                      onMouseDown={handleCarouselResizeStart}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize buffer carousel cards"
                    />
                  </div>
                );
              })}
              {shouldShowNewTabCard && (
                <div
                  key="new-tab-card"
                  data-buffer-card-id="new-tab-card"
                  className={cn(
                    "relative h-full shrink-0 overflow-hidden rounded-2xl border border-dashed border-border/70 bg-primary-bg",
                    isCarouselResizing && "transition-none",
                  )}
                  style={{
                    width: `${carouselCardWidth}px`,
                  }}
                >
                  <div className="h-full w-full">
                    <EmptyEditorState />
                  </div>
                  <div
                    className="absolute top-0 right-0 z-20 h-full w-2 cursor-col-resize transition-colors hover:bg-accent/20"
                    onMouseDown={handleCarouselResizeStart}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize buffer carousel cards"
                  />
                </div>
              )}
            </div>
          ) : (
            activeBuffer && renderActiveBuffer(activeBuffer)
          )}
        </Suspense>
      </div>
    </div>
  );
}
