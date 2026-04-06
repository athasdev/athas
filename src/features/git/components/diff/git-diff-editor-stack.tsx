import { Check, ChevronDown, ChevronRight, Columns2, Rows3, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeEditor from "@/features/editor/components/code-editor";
import Breadcrumb from "@/features/editor/components/toolbar/breadcrumb";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { calculateLineHeight, splitLines } from "@/features/editor/utils/lines";
import { useZoomStore } from "@/features/window/stores/zoom-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { getGitStatus } from "../../api/git-status-api";
import { useDiffEditorBuffer } from "../../hooks/use-diff-editor-buffer";
import type { MultiFileDiff } from "../../types/git-diff-types";
import type { GitDiff } from "../../types/git-types";
import { gitDiffCache } from "../../utils/git-diff-cache";
import { getFileStatus } from "../../utils/git-diff-helpers";
import { buildWorkingTreeMultiDiff } from "../../utils/working-tree-multi-diff";
import {
  serializeGitDiffSourceForEditor,
  serializeGitDiffSourceForSplitEditor,
} from "../../utils/diff-editor-content";
import DiffLineBackgroundLayer from "./diff-line-background-layer";
import ImageDiffViewer from "./git-diff-image";
import TextDiffViewer from "./git-diff-text";

function countStats(diff: GitDiff) {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.lines) {
    if (line.line_type === "added") additions++;
    if (line.line_type === "removed") deletions++;
  }

  return { additions, deletions };
}

const statusTextClass: Record<string, string> = {
  added: "text-git-added",
  deleted: "text-git-deleted",
  modified: "text-git-modified",
  renamed: "text-git-renamed",
};

const statusBadgeClass: Record<string, string> = {
  added: "bg-git-added/12 text-git-added",
  deleted: "bg-git-deleted/12 text-git-deleted",
  modified: "bg-git-modified/12 text-git-modified",
  renamed: "bg-git-renamed/12 text-git-renamed",
};

function DiffSectionEditor({
  diff,
  cacheKey,
  viewMode,
}: {
  diff: GitDiff;
  cacheKey: string;
  viewMode: "unified" | "split";
}) {
  const fontSize = useEditorSettingsStore.use.fontSize();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const sourcePath = diff.new_path || diff.old_path || diff.file_path;
  const unifiedContent = useMemo(() => serializeGitDiffSourceForEditor(diff), [diff]);
  const splitContent = useMemo(() => serializeGitDiffSourceForSplitEditor(diff), [diff]);
  const unifiedBufferId = useDiffEditorBuffer({
    cacheKey,
    content: unifiedContent.content,
    sourcePath,
    name: sourcePath.split("/").pop() || "Diff",
    pathOverride: sourcePath,
  });
  const leftSplitBufferId = useDiffEditorBuffer({
    cacheKey: `${cacheKey}_left`,
    content: splitContent.left.content,
    sourcePath,
    name: `${sourcePath.split("/").pop() || "Diff"} (left)`,
    pathOverride: sourcePath,
  });
  const rightSplitBufferId = useDiffEditorBuffer({
    cacheKey: `${cacheKey}_right`,
    content: splitContent.right.content,
    sourcePath,
    name: `${sourcePath.split("/").pop() || "Diff"} (right)`,
    pathOverride: sourcePath,
  });
  const height = useMemo(() => {
    const lineCount =
      viewMode === "split"
        ? Math.max(
            splitLines(splitContent.left.content).length,
            splitLines(splitContent.right.content).length,
          )
        : splitLines(unifiedContent.content).length;
    const lineHeight = calculateLineHeight(fontSize * zoomLevel);

    return Math.max(
      lineCount * lineHeight +
        EDITOR_CONSTANTS.EDITOR_PADDING_TOP +
        EDITOR_CONSTANTS.EDITOR_PADDING_BOTTOM,
      160,
    );
  }, [
    fontSize,
    splitContent.left.content,
    splitContent.right.content,
    unifiedContent.content,
    viewMode,
    zoomLevel,
  ]);
  const lineHeight = useMemo(
    () => calculateLineHeight(fontSize * zoomLevel),
    [fontSize, zoomLevel],
  );
  const resolveAbsolutePath = useCallback(() => {
    if (sourcePath.startsWith("/") || sourcePath.startsWith("remote://")) return sourcePath;
    if (!rootFolderPath) return sourcePath;
    return `${rootFolderPath.replace(/\/$/, "")}/${sourcePath.replace(/^\//, "")}`;
  }, [rootFolderPath, sourcePath]);
  const findNearestActualLine = useCallback((actualLines: Array<number | null>, line: number) => {
    if (actualLines[line] != null) return actualLines[line];
    for (let delta = 1; delta < actualLines.length; delta++) {
      const before = line - delta;
      if (before >= 0 && actualLines[before] != null) return actualLines[before];
      const after = line + delta;
      if (after < actualLines.length && actualLines[after] != null) return actualLines[after];
    }
    return 1;
  }, []);
  const openSourceLocation = useCallback(
    async (line: number, column: number, actualLines: Array<number | null>) => {
      const targetPath = resolveAbsolutePath();
      const targetLine = findNearestActualLine(actualLines, line) ?? 1;
      await useFileSystemStore
        .getState()
        .handleFileSelect(targetPath, false, targetLine, column + 1, undefined, false);
    },
    [findNearestActualLine, resolveAbsolutePath],
  );

  if (viewMode === "split") {
    return (
      <div
        className="grid grid-cols-2 border-border border-t bg-primary-bg"
        style={{ height: `${height}px` }}
      >
        <div className="relative overflow-hidden border-border border-r bg-primary-bg">
          <DiffLineBackgroundLayer
            lineKinds={splitContent.left.lineKinds}
            lineHeight={lineHeight}
          />
          <CodeEditor
            bufferId={leftSplitBufferId}
            isActiveSurface={false}
            showToolbar={false}
            readOnly={true}
            scrollable={false}
            onReadonlySurfaceClick={({ line, column }) =>
              void openSourceLocation(line, column, splitContent.left.actualLines)
            }
          />
        </div>
        <div className="relative overflow-hidden bg-primary-bg">
          <DiffLineBackgroundLayer
            lineKinds={splitContent.right.lineKinds}
            lineHeight={lineHeight}
          />
          <CodeEditor
            bufferId={rightSplitBufferId}
            isActiveSurface={false}
            showToolbar={false}
            readOnly={true}
            scrollable={false}
            onReadonlySurfaceClick={({ line, column }) =>
              void openSourceLocation(line, column, splitContent.right.actualLines)
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden border-border border-t bg-primary-bg"
      style={{ height: `${height}px` }}
    >
      <DiffLineBackgroundLayer lineKinds={unifiedContent.lineKinds} lineHeight={lineHeight} />
      <CodeEditor
        bufferId={unifiedBufferId}
        isActiveSurface={false}
        showToolbar={false}
        readOnly={true}
        scrollable={false}
        onReadonlySurfaceClick={({ line, column }) =>
          void openSourceLocation(line, column, unifiedContent.actualLines)
        }
      />
    </div>
  );
}

const LazyDiffSectionBody = memo(function LazyDiffSectionBody({
  expanded,
  children,
}: {
  expanded: boolean;
  children: React.ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [shouldMount, setShouldMount] = useState(expanded);

  useEffect(() => {
    if (!expanded) {
      setShouldMount(false);
      return;
    }

    const element = bodyRef.current;
    if (!element) {
      setShouldMount(true);
      return;
    }

    const scrollContainer = element.closest("[data-diff-stack-scroll-container]");
    if (!(scrollContainer instanceof HTMLDivElement)) {
      setShouldMount(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setShouldMount(true);
          observer.disconnect();
        }
      },
      {
        root: scrollContainer,
        rootMargin: "1200px 0px",
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded]);

  return (
    <div
      ref={bodyRef}
      className="border-border border-t"
      style={{ contentVisibility: "auto", containIntrinsicSize: "960px" }}
    >
      {shouldMount ? children : <div className="h-[320px] bg-primary-bg" />}
    </div>
  );
});

const DiffFileSection = memo(function DiffFileSection({
  diff,
  sectionKey,
  expanded,
  onToggle,
  viewMode,
  showWhitespace,
  enableHunkActions,
}: {
  diff: GitDiff;
  sectionKey: string;
  expanded: boolean;
  onToggle: (sectionKey: string) => void;
  viewMode: "unified" | "split";
  showWhitespace: boolean;
  enableHunkActions: boolean;
}) {
  const filePath = diff.new_path || diff.old_path || diff.file_path;
  const fileName = filePath.split("/").pop() || filePath;
  const directoryPath = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/") + 1)
    : "";
  const status = getFileStatus(diff) as "added" | "deleted" | "modified" | "renamed";
  const { additions, deletions } = countStats(diff);
  const handleToggle = useCallback(() => {
    onToggle(sectionKey);
  }, [onToggle, sectionKey]);

  return (
    <section className="relative isolate rounded-md border border-border/70 bg-primary-bg">
      <div className="sticky top-0 z-50 border-border/70 border-b bg-primary-bg shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <button
          type="button"
          onClick={handleToggle}
          className="relative z-50 flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover/30"
        >
          <span className="shrink-0 text-text-lighter">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <FileExplorerIcon
            fileName={fileName}
            isDir={false}
            size={16}
            className="shrink-0 text-text-lighter"
          />
          <span className={`shrink-0 text-sm font-medium ${statusTextClass[status]}`}>
            {fileName}
          </span>
          <span className="min-w-0 truncate text-sm text-text-lighter">{directoryPath}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
            {additions > 0 ? <span className="text-git-added">+{additions}</span> : null}
            {deletions > 0 ? <span className="text-git-deleted">-{deletions}</span> : null}
            <span className={`rounded px-1.5 py-0.5 capitalize ${statusBadgeClass[status]}`}>
              {status}
            </span>
          </span>
        </button>
      </div>

      {expanded ? (
        diff.is_image ? (
          <LazyDiffSectionBody expanded={expanded}>
            <ImageDiffViewer diff={diff} fileName={fileName} onClose={() => {}} />
          </LazyDiffSectionBody>
        ) : (
          <LazyDiffSectionBody expanded={expanded}>
            {enableHunkActions && viewMode === "unified" ? (
              <TextDiffViewer
                diff={diff}
                isStaged={sectionKey.startsWith("staged:")}
                viewMode={viewMode}
                showWhitespace={showWhitespace}
                isEmbeddedInScrollView={true}
              />
            ) : (
              <DiffSectionEditor diff={diff} cacheKey={sectionKey} viewMode={viewMode} />
            )}
          </LazyDiffSectionBody>
        )
      ) : null}
    </section>
  );
});

const GitDiffEditorStack = memo(function GitDiffEditorStack({
  multiDiff,
}: {
  multiDiff: MultiFileDiff;
}) {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const updateBufferContent = useBufferStore.use.actions().updateBufferContent;
  const closeBuffer = useBufferStore.use.actions().closeBuffer;
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [showWhitespace, setShowWhitespace] = useState(false);
  const isWorkingTree = multiDiff.commitHash === "working-tree";
  const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId) || null;
  const isWorkingTreeBuffer = activeBuffer?.path === "diff://working-tree/all-files";
  const isRefreshingRef = useRef(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () =>
      new Set(
        multiDiff.files.map(
          (diff, index) => multiDiff.fileKeys?.[index] ?? `${diff.file_path}:${index}`,
        ),
      ),
  );
  const handleToggleSection = useCallback((sectionKey: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }, []);

  useEffect(() => {
    setExpandedFiles(
      new Set(
        multiDiff.files.map(
          (diff, index) => multiDiff.fileKeys?.[index] ?? `${diff.file_path}:${index}`,
        ),
      ),
    );
  }, [multiDiff]);

  const refreshWorkingTreeBuffer = useCallback(async () => {
    if (!isWorkingTree || !isWorkingTreeBuffer || !rootFolderPath || !activeBuffer) return;
    if (isRefreshingRef.current) return;

    isRefreshingRef.current = true;

    try {
      gitDiffCache.invalidate(rootFolderPath);
      const gitStatus = await getGitStatus(rootFolderPath);
      const nextMultiDiff = await buildWorkingTreeMultiDiff({
        repoPath: rootFolderPath,
        status: gitStatus,
        previousFileKeys: multiDiff.fileKeys,
      });

      if (nextMultiDiff.files.length === 0) {
        closeBuffer(activeBuffer.id);
        return;
      }

      updateBufferContent(activeBuffer.id, "", false, nextMultiDiff);
    } finally {
      isRefreshingRef.current = false;
    }
  }, [
    activeBuffer,
    closeBuffer,
    isWorkingTree,
    isWorkingTreeBuffer,
    multiDiff.fileKeys,
    rootFolderPath,
    updateBufferContent,
  ]);

  useEffect(() => {
    if (!isWorkingTree) return;

    const handleGitStatusChanged = () => {
      window.setTimeout(() => {
        void refreshWorkingTreeBuffer();
      }, 50);
    };

    window.addEventListener("git-status-changed", handleGitStatusChanged);
    return () => {
      window.removeEventListener("git-status-changed", handleGitStatusChanged);
    };
  }, [isWorkingTree, refreshWorkingTreeBuffer]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg">
      <Breadcrumb
        filePathOverride={multiDiff.title || "Uncommitted Changes"}
        interactive={false}
        showDefaultActions={true}
        extraLeftContent={
          <span className="text-text-lighter">
            {multiDiff.totalFiles} file{multiDiff.totalFiles !== 1 ? "s" : ""}
          </span>
        }
        rightContent={
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              active={showWhitespace}
              onClick={() => setShowWhitespace((prev) => !prev)}
              className={cn("h-5 gap-1 px-1.5 text-text-lighter", showWhitespace && "text-text")}
              title={showWhitespace ? "Hide whitespace" : "Show whitespace"}
            >
              <Trash2 />
              {showWhitespace ? <Check /> : null}
            </Button>
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                active={viewMode === "unified"}
                onClick={() => setViewMode("unified")}
                className="text-text-lighter"
                title="Unified view"
              >
                <Rows3 />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                active={viewMode === "split"}
                onClick={() => setViewMode("split")}
                className="text-text-lighter"
                title="Split view"
              >
                <Columns2 />
              </Button>
            </div>
          </div>
        }
      />

      <div
        className="min-h-0 flex-1 overflow-auto px-2 pb-2"
        style={{ overflowAnchor: "none" }}
        data-diff-stack-scroll-container
      >
        <div className="flex flex-col gap-2">
          {multiDiff.files.map((diff, index) => {
            const sectionKey = multiDiff.fileKeys?.[index] ?? `${diff.file_path}:${index}`;

            return (
              <DiffFileSection
                key={sectionKey}
                diff={diff}
                sectionKey={sectionKey}
                expanded={expandedFiles.has(sectionKey)}
                viewMode={viewMode}
                showWhitespace={showWhitespace}
                enableHunkActions={isWorkingTree}
                onToggle={handleToggleSection}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default GitDiffEditorStack;
