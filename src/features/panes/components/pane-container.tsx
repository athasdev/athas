import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { fileOpenBenchmark } from "@/features/editor/services/file-open-benchmark";
import { useShallow } from "zustand/react/shallow";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { Buffer } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/stores/buffer-index";
import { isEditorKeyboardTarget } from "@/features/keymaps/services/editor-keyboard-target";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { formatDiffBufferLabel } from "@/features/git/services/diff-buffer-label";
import { openSidebarResourceBuffer } from "@/features/sidebar/services/open-sidebar-resource";
import {
  hasSidebarResourceDragData,
  readSidebarResourceDragData,
  type SidebarDragResource,
} from "@/features/sidebar/services/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  useActiveWorkspaceId,
  useWorkspaceStoreScopeId,
} from "@/features/workspace/stores/create-workspace-scoped-store";
import TabBar from "@/features/tabs/components/tab-bar";
import { extractDroppedFilePaths } from "@/features/file-system/services/file-system-dropped-paths";
import {
  clearInternalTabDragData,
  getInternalTabDragData,
  getInternalTabDragHover,
  resolveDropTarget,
} from "@/features/tabs/services/internal-tab-drag";
import { cn } from "@/utils/cn";
import {
  activateBufferInPaneAndSync,
  activatePaneAndSyncBuffer,
} from "../services/pane-activation";
import { BOTTOM_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane.store";
import type { PaneGroup } from "../types/pane.types";
import type { EditorContent, TerminalContent } from "../types/pane-content.types";
import { getPaneView, prefetchPaneViews, renderPaneView } from "../services/pane-view-registry";
import {
  getOrCreatePaneDropTarget,
  moveBufferToPaneDropTarget,
} from "../services/pane-drop-actions";
import { PaneSurfaceLayer } from "./pane-surface-layer";
import { type DropZone, SplitDropOverlay } from "./split-drop-overlay";
import { emitAppEvent, onAppEvent } from "@/utils/app-events";

const CodeEditor = lazy(() => import("@/features/editor/components/code-editor"));

interface PaneContainerProps {
  pane: PaneGroup;
}

const DEFAULT_CAROUSEL_CARD_WIDTH = 640;
/**
 * Editors kept mounted but hidden after their tab loses focus, most recent first. Switching back
 * to one of them shows it immediately instead of creating a new editor, re-tokenizing and jumping
 * to the saved scroll position; the cap keeps memory close to one editor per pane.
 */
const MAX_WARM_EDITOR_BUFFERS = 3;

let hasPrefetchedPaneSurfaces = false;

/**
 * Loads the code for the surfaces users open most once the app is idle, so the first editor,
 * terminal, diff or search tab after startup doesn't wait on a network-style chunk fetch.
 */
function prefetchPaneSurfaces() {
  if (hasPrefetchedPaneSurfaces || typeof window === "undefined") return;
  hasPrefetchedPaneSurfaces = true;
  const load = () => {
    void import("@/features/editor/components/code-editor");
    prefetchPaneViews();
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(load, { timeout: 3000 });
  } else {
    setTimeout(load, 1500);
  }
}
const MIN_CAROUSEL_CARD_WIDTH = 320;
const CAROUSEL_OUTER_GAP_PX = 160;
type EditorBufferShell = Pick<EditorContent, "id" | "path" | "name" | "type" | "readOnly">;
type PaneRenderBuffer = Exclude<Buffer, EditorContent> | EditorBufferShell;

const editorBufferShellCache = new Map<string, EditorBufferShell>();

function getEditorBufferShell(buffer: EditorContent): EditorBufferShell {
  const cached = editorBufferShellCache.get(buffer.id);
  if (
    cached &&
    cached.path === buffer.path &&
    cached.name === buffer.name &&
    cached.readOnly === buffer.readOnly
  ) {
    return cached;
  }

  const shell = {
    id: buffer.id,
    path: buffer.path,
    name: buffer.name,
    type: buffer.type,
    readOnly: buffer.readOnly,
  } satisfies EditorBufferShell;
  editorBufferShellCache.set(buffer.id, shell);
  return shell;
}

function toPaneRenderBuffer(buffer: Buffer | undefined): PaneRenderBuffer | undefined {
  if (!buffer) return undefined;
  if (buffer.type === "editor") return getEditorBufferShell(buffer);
  return buffer;
}

const EMPTY_PANE_BUFFERS: PaneRenderBuffer[] = [];

function BufferPreviewCard({ buffer }: { buffer: PaneRenderBuffer }) {
  const previewText =
    "content" in buffer && typeof buffer.content === "string"
      ? buffer.content.split("\n").slice(0, 14).join("\n").trim()
      : "";

  const summary =
    buffer.type === "terminal"
      ? "Terminal session"
      : buffer.type === "browser"
        ? buffer.url
        : buffer.type === "pullRequest"
          ? `Pull request #${buffer.prNumber}`
          : buffer.type === "githubIssue"
            ? `Issue #${buffer.issueNumber}`
            : buffer.type === "githubAction"
              ? `Workflow run #${buffer.runId}`
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
                          : buffer.type === "globalSearch"
                            ? "Search results"
                            : buffer.type === "diagnostics"
                              ? "Diagnostics"
                              : buffer.type === "references"
                                ? "References"
                                : previewText || "No preview available";

  const previewLines = summary.split("\n").slice(0, 12);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="pointer-events-none flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-12 shrink-0 flex-col items-end gap-1 border-r border-border bg-surface px-2 py-4 ui-text-sm leading-5 text-subtle-foreground">
          {previewLines.map((_, index) => (
            <span key={`${buffer.id}-line-${index + 1}`}>{index + 1}</span>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          <pre className="h-full overflow-hidden whitespace-pre-wrap wrap-break-word ui-text-sm leading-5 text-subtle-foreground">
            {summary}
          </pre>
        </div>
      </div>

      <div className="border-t border-border bg-surface px-4 py-2">
        <div className="truncate ui-text-sm font-medium text-foreground">
          {buffer.type === "diff" ? formatDiffBufferLabel(buffer.name, buffer.path) : buffer.name}
        </div>
        <div className="truncate ui-text-sm text-subtle-foreground">{buffer.path}</div>
      </div>
    </div>
  );
}

function CarouselCardContent({
  buffer,
  isActiveBuffer,
  renderActiveBuffer,
}: {
  buffer: Exclude<PaneRenderBuffer, EditorBufferShell>;
  isActiveBuffer: boolean;
  renderActiveBuffer: (buffer: PaneRenderBuffer) => ReactNode;
}) {
  const CarouselCard = getPaneView(buffer.type)?.carouselCard;
  if (CarouselCard) return <CarouselCard buffer={buffer} />;
  return isActiveBuffer ? renderActiveBuffer(buffer) : <BufferPreviewCard buffer={buffer} />;
}

function isStandardEditorBuffer(buffer: PaneRenderBuffer): buffer is EditorBufferShell {
  return buffer.type === "editor";
}

export function PaneContainer({ pane }: PaneContainerProps) {
  const activePaneId = usePaneStore.use.activePaneId();
  const { reorderPaneBuffers } = usePaneStore.use.actions();
  const { openTerminalBuffer } = useBufferStore.use.actions();
  const handleFileOpen = useFileSystemStore((state) => state.handleFileOpen);
  const horizontalBufferCarousel = useSettingsStore((state) => state.settings.horizontalTabScroll);

  useEffect(prefetchPaneSurfaces, []);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isTabDragOver, setIsTabDragOver] = useState(false);
  const [internalHoverZone, setInternalHoverZone] = useState<DropZone>(null);
  const [carouselCardWidth, setCarouselCardWidth] = useState(DEFAULT_CAROUSEL_CARD_WIDTH);
  const [isCarouselResizing, setIsCarouselResizing] = useState(false);
  const [draggedCarouselBufferId, setDraggedCarouselBufferId] = useState<string | null>(null);
  const [carouselDropBufferId, setCarouselDropBufferId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const carouselViewportRef = useRef<HTMLDivElement>(null);
  const lastCarouselBufferIdRef = useRef<string | null>(null);
  const suppressAutoCenterRef = useRef(false);
  const workspaceScopeId = useWorkspaceStoreScopeId();
  const activeWorkspaceId = useActiveWorkspaceId();
  const isWorkspaceSurfaceActive = !workspaceScopeId || workspaceScopeId === activeWorkspaceId;
  const isActivePane = pane.id === activePaneId && isWorkspaceSurfaceActive;

  const paneBuffers = useBufferStore(
    useShallow((state) => {
      if (pane.bufferIds.length === 0) {
        return EMPTY_PANE_BUFFERS;
      }

      const nextPaneBuffers: PaneRenderBuffer[] = [];
      for (const bufferId of pane.bufferIds) {
        const buffer = toPaneRenderBuffer(getBufferById(state.buffers, bufferId) ?? undefined);
        if (buffer) nextPaneBuffers.push(buffer);
      }
      return nextPaneBuffers;
    }),
  );
  const activeBuffer = paneBuffers.find((buffer) => buffer.id === pane.activeBufferId) ?? null;
  const activeBufferPath = activeBuffer?.path;

  useLayoutEffect(() => {
    if (activeBufferPath) fileOpenBenchmark.markOnce(activeBufferPath, "pane-rendered");
  }, [activeBufferPath]);

  const handlePaneClick = useCallback(() => {
    if (!isActivePane) {
      activatePaneAndSyncBuffer(pane.id);
    }
  }, [isActivePane, pane.id]);

  const handlePaneMouseDownCapture = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const isEditorTarget = isEditorKeyboardTarget(target);
      const isTerminalTextarea = target.classList.contains("xterm-helper-textarea");
      if (
        !isEditorTarget &&
        !isTerminalTextarea &&
        target.closest("button, input, textarea, [role='button'], [role='menu']")
      ) {
        return;
      }

      if (!isActivePane) {
        activatePaneAndSyncBuffer(pane.id);
      }
    },
    [isActivePane, pane.id],
  );

  const handleTabClick = useCallback(
    (bufferId: string) => {
      activateBufferInPaneAndSync(pane.id, bufferId);
    },
    [pane.id],
  );

  const openFileTreeDropInPane = useCallback(
    async (
      fileDragData: { path: string; name: string; isDir: boolean },
      point: { x: number; y: number },
    ) => {
      if (!isWorkspaceSurfaceActive) return;
      if (fileDragData.isDir) return;
      if (!handleFileOpen) return;

      const target = resolveDropTarget(point);
      if (target.paneId !== pane.id) return;

      const targetPaneId = getOrCreatePaneDropTarget({ paneId: pane.id, zone: target.zone });
      if (!targetPaneId) return;

      activatePaneAndSyncBuffer(targetPaneId);

      try {
        await handleFileOpen(fileDragData.path, false, { paneId: targetPaneId });
      } catch (error) {
        console.error("Failed to open file from file tree drop:", error);
      } finally {
        delete window.__fileDragData;
      }
    },
    [handleFileOpen, isWorkspaceSurfaceActive, pane.id],
  );

  const openSidebarResourceInPane = useCallback(
    async (resource: SidebarDragResource, point: { x: number; y: number }) => {
      if (!isWorkspaceSurfaceActive) return;
      const opensBuffer =
        !(resource.type === "file" && resource.isDir) && resource.type !== "git-worktree";
      const target = resolveDropTarget(point);
      if (target.paneId !== pane.id) return;

      const targetPaneId = opensBuffer
        ? getOrCreatePaneDropTarget({ paneId: pane.id, zone: target.zone })
        : pane.id;
      if (!targetPaneId) return;

      activatePaneAndSyncBuffer(targetPaneId);

      try {
        await openSidebarResourceBuffer(resource, { paneId: targetPaneId });
      } catch (error) {
        console.error("Failed to open sidebar resource from drop:", error);
      }
    },
    [isWorkspaceSurfaceActive, pane.id],
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

  // Listen for file tree drops on this pane
  useEffect(() => {
    if (!isWorkspaceSurfaceActive) {
      return;
    }

    const syncHover = () => {
      const hover = getInternalTabDragHover();
      setInternalHoverZone(hover.paneId === pane.id ? hover.zone : null);
    };

    return onAppEvent("tabs:internal-drag-hover", syncHover);
  }, [isWorkspaceSurfaceActive, pane.id]);

  useEffect(() => {
    if (!isWorkspaceSurfaceActive) {
      return;
    }

    return onAppEvent("file-tree:drop-on-pane", (drop) => {
      const fileDragData = window.__fileDragData;
      if (!fileDragData) return;

      void openFileTreeDropInPane(fileDragData, { x: drop.x, y: drop.y });
    });
  }, [isWorkspaceSurfaceActive, openFileTreeDropInPane]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const hasTabData =
      e.dataTransfer.types.includes("application/tab-data") || !!getInternalTabDragData();
    const hasFilePath = e.dataTransfer.types.includes("text/plain");
    const hasSidebarResource = hasSidebarResourceDragData(e.dataTransfer);
    const hasFileDragData = !!window.__fileDragData;

    if (
      hasTabData ||
      hasSidebarResource ||
      hasFilePath ||
      hasFileDragData ||
      e.dataTransfer.types.includes("Files")
    ) {
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
      const fallbackTabData = getInternalTabDragData();
      if (!tabDataString && !fallbackTabData) return;

      let bufferId: string | undefined;
      let sourcePaneId: string | undefined;
      let source: string | undefined;
      let terminalId: string | undefined;
      let terminalName: string | undefined;
      let shell: string | undefined;
      let initialCommand: string | undefined;
      let currentDirectory: string | undefined;
      let remoteConnectionId: string | undefined;
      try {
        const tabData = tabDataString ? JSON.parse(tabDataString) : fallbackTabData;
        bufferId = tabData.bufferId;
        sourcePaneId = tabData.paneId;
        source = tabData.source;
        terminalId = tabData.terminalId;
        terminalName = tabData.name;
        shell = tabData.shell;
        initialCommand = tabData.initialCommand;
        currentDirectory = tabData.currentDirectory;
        remoteConnectionId = tabData.remoteConnectionId;
      } catch {
        return;
      } finally {
        clearInternalTabDragData();
      }

      if (zone === "center") {
        if (source === "terminal-panel" && terminalId) {
          openTerminalBuffer(
            {
              sessionId: terminalId,
              name: terminalName,
              shell,
              command: initialCommand,
              workingDirectory: currentDirectory,
              remoteConnectionId,
            },
            { paneId: pane.id },
          );
          emitAppEvent("terminal:detach-to-buffer", { terminalId });
        } else if (sourcePaneId && sourcePaneId !== pane.id && bufferId) {
          moveBufferToPaneDropTarget(bufferId, sourcePaneId, { paneId: pane.id, zone: "center" });
          activateBufferInPaneAndSync(pane.id, bufferId);
        } else if (!sourcePaneId && bufferId) {
          activateBufferInPaneAndSync(pane.id, bufferId);
        }
        return;
      }

      const newPaneId = getOrCreatePaneDropTarget({ paneId: pane.id, zone });
      if (!newPaneId) return;

      // Move the dragged buffer into the newly created pane.
      if (source === "terminal-panel" && terminalId) {
        openTerminalBuffer(
          {
            sessionId: terminalId,
            name: terminalName,
            shell,
            command: initialCommand,
            workingDirectory: currentDirectory,
            remoteConnectionId,
          },
          { paneId: newPaneId },
        );
        emitAppEvent("terminal:detach-to-buffer", { terminalId });
      } else if (sourcePaneId && sourcePaneId !== pane.id && bufferId) {
        moveBufferToPaneDropTarget(bufferId, sourcePaneId, { paneId: newPaneId, zone: "center" });
        activateBufferInPaneAndSync(newPaneId, bufferId);
      } else if (bufferId) {
        moveBufferToPaneDropTarget(bufferId, pane.id, { paneId: newPaneId, zone: "center" });
        activateBufferInPaneAndSync(newPaneId, bufferId);
      }
    },
    [pane.id, openTerminalBuffer],
  );

  // Handle mouse up for file tree drag (which uses mouse events, not HTML5 drag API)
  const handleMouseUp = useCallback(
    async (event: React.MouseEvent) => {
      const fileDragData = window.__fileDragData;
      if (!fileDragData || fileDragData.isDir) {
        return; // Only handle file drops, not directory drops
      }

      await openFileTreeDropInPane(fileDragData, { x: event.clientX, y: event.clientY });
    },
    [openFileTreeDropInPane],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      setIsTabDragOver(false);
      activatePaneAndSyncBuffer(pane.id);

      // Tab drops are handled by SplitDropOverlay — skip here
      if (e.dataTransfer.types.includes("application/tab-data") || getInternalTabDragData()) {
        return;
      }

      const sidebarResource = readSidebarResourceDragData(e.dataTransfer);
      if (sidebarResource) {
        await openSidebarResourceInPane(sidebarResource, { x: e.clientX, y: e.clientY });
        return;
      }

      const droppedPaths = extractDroppedFilePaths(e.dataTransfer);
      if (droppedPaths.length > 0 && handleFileOpen) {
        for (const droppedPath of droppedPaths) {
          await handleFileOpen(droppedPath, false, { paneId: pane.id });
        }
        return;
      }
    },
    [pane.id, handleFileOpen, openSidebarResourceInPane],
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

  const shouldRenderCarousel =
    isWorkspaceSurfaceActive && horizontalBufferCarousel && paneBuffers.length > 1;
  const activeEditorBufferId =
    activeBuffer && isStandardEditorBuffer(activeBuffer) ? activeBuffer.id : null;
  const [warmEditorBufferIds, setWarmEditorBufferIds] = useState<string[]>([]);
  const nextWarmEditorBufferIds = [
    ...(activeEditorBufferId ? [activeEditorBufferId] : []),
    ...warmEditorBufferIds.filter(
      (bufferId) =>
        bufferId !== activeEditorBufferId &&
        paneBuffers.some((buffer) => buffer.id === bufferId && isStandardEditorBuffer(buffer)),
    ),
  ].slice(0, MAX_WARM_EDITOR_BUFFERS);
  if (
    nextWarmEditorBufferIds.length !== warmEditorBufferIds.length ||
    nextWarmEditorBufferIds.some((bufferId, index) => bufferId !== warmEditorBufferIds[index])
  ) {
    setWarmEditorBufferIds(nextWarmEditorBufferIds);
  }
  const mountedEditorBuffers = paneBuffers.filter(
    (buffer): buffer is EditorBufferShell =>
      isWorkspaceSurfaceActive &&
      isStandardEditorBuffer(buffer) &&
      nextWarmEditorBufferIds.includes(buffer.id),
  );

  const renderActiveBuffer = useCallback(
    (buffer: PaneRenderBuffer) => {
      const view = isStandardEditorBuffer(buffer)
        ? null
        : renderPaneView(buffer, { paneId: pane.id, isActive: isActivePane });
      return (
        view ?? (
          <CodeEditor
            paneId={pane.id}
            bufferId={buffer.id}
            isActiveSurface={isActivePane}
            readOnly={buffer.type === "editor" ? buffer.readOnly : undefined}
          />
        )
      );
    },
    [isActivePane, pane.id],
  );

  return (
    <div
      ref={containerRef}
      data-pane-container
      data-pane-id={pane.id}
      className={cn(
        "relative flex size-full flex-col overflow-hidden bg-background",
        isActivePane && "ring-1 ring-focus",
        (isDragOver || internalHoverZone) && "ring-2 ring-primary",
      )}
      onMouseDownCapture={handlePaneMouseDownCapture}
      onClick={handlePaneClick}
      onMouseUp={handleMouseUp}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {(isDragOver || internalHoverZone) && !isTabDragOver && !internalHoverZone && (
        <div className="pointer-events-none absolute inset-0 z-40 bg-primary-soft" />
      )}
      <SplitDropOverlay
        visible={isTabDragOver || !!internalHoverZone}
        onDrop={handleSplitDrop}
        activeZoneOverride={internalHoverZone}
      />
      <TabBar
        paneId={pane.id}
        onTabClick={handleTabClick}
        disablePaneActions={pane.id === BOTTOM_PANE_ID}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={null}>
          {paneBuffers.length === 0 ? null : shouldRenderCarousel ? (
            <div
              ref={carouselViewportRef}
              className="scrollbar-none flex h-full items-stretch gap-4 overflow-x-auto overflow-y-hidden px-4 py-4 overscroll-x-none"
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
                      "relative h-full shrink-0 overflow-hidden rounded-2xl border text-left transition-[transform,opacity,border-color,box-shadow] duration-normal ease-smooth",
                      isActiveBuffer
                        ? "border-primary bg-background ring-1 ring-focus"
                        : "border-border bg-background hover:border-border-strong",
                      isDropTarget && "border-primary ring-2 ring-focus",
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
                    <div className="size-full">
                      {isStandardEditorBuffer(buffer) ? (
                        <CodeEditor
                          paneId={pane.id}
                          bufferId={buffer.id}
                          isActiveSurface={isActivePane && isActiveBuffer}
                          readOnly={buffer.readOnly}
                          showToolbar={false}
                          className={isActiveBuffer ? undefined : "pointer-events-none"}
                        />
                      ) : buffer.type === "terminal" ? (
                        <div
                          className={isActiveBuffer ? "size-full" : "pointer-events-none size-full"}
                        >
                          {renderPaneView(buffer, {
                            paneId: pane.id,
                            isActive: isActivePane && isActiveBuffer,
                            isVisible: true,
                          })}
                        </div>
                      ) : (
                        <CarouselCardContent
                          buffer={buffer}
                          isActiveBuffer={isActiveBuffer}
                          renderActiveBuffer={renderActiveBuffer}
                        />
                      )}
                    </div>
                    <div
                      className="absolute top-0 right-0 z-20 h-full w-2 cursor-col-resize transition-colors hover:bg-primary-soft"
                      onMouseDown={handleCarouselResizeStart}
                      role="separator"
                      tabIndex={0}
                      aria-orientation="vertical"
                      aria-label="Resize buffer carousel cards"
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {paneBuffers
                .filter(
                  (b): b is TerminalContent =>
                    isWorkspaceSurfaceActive && b.id === activeBuffer?.id && b.type === "terminal",
                )
                .map((b) => {
                  return (
                    <PaneSurfaceLayer key={b.id} active>
                      <Suspense fallback={null}>
                        {renderPaneView(b, {
                          paneId: pane.id,
                          isActive: isActivePane,
                          isVisible: isWorkspaceSurfaceActive,
                        })}
                      </Suspense>
                    </PaneSurfaceLayer>
                  );
                })}
              {mountedEditorBuffers.map((buffer) => {
                const isActive = buffer.id === activeBuffer?.id;
                return (
                  <PaneSurfaceLayer key={buffer.id} active={isActive}>
                    <Suspense fallback={null}>
                      <CodeEditor
                        paneId={pane.id}
                        bufferId={buffer.id}
                        isActiveSurface={isActive && isActivePane}
                        readOnly={buffer.readOnly}
                        outline={isActive}
                      />
                    </Suspense>
                  </PaneSurfaceLayer>
                );
              })}
              {isWorkspaceSurfaceActive &&
                activeBuffer &&
                activeBuffer.type !== "terminal" &&
                !isStandardEditorBuffer(activeBuffer) && (
                  <PaneSurfaceLayer key={activeBuffer.id} active>
                    <Suspense fallback={null}>{renderActiveBuffer(activeBuffer)}</Suspense>
                  </PaneSurfaceLayer>
                )}
            </>
          )}
        </Suspense>
      </div>
    </div>
  );
}
