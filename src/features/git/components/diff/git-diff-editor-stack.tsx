import {
  ColumnsIcon as Columns2,
  DotsThreeIcon as MoreHorizontal,
  ListBulletsIcon as ListBullets,
  RowsIcon as Rows3,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import CodeEditor from "@/features/editor/components/code-editor";
import Breadcrumb, {
  BreadcrumbActionButton,
} from "@/features/editor/components/toolbar/breadcrumb";
import { MultibufferFileHeader } from "@/features/editor/components/multibuffer/multibuffer-file-header";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import {
  FileNavigatorSidebar,
  type FileNavigatorItem,
  type FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { calculateLineHeight, splitLines } from "@/features/editor/utils/lines";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { formatRelativeDate } from "@/utils/date";
import { cn } from "@/utils/cn";
import { joinPath } from "@/utils/path-helpers";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import Tooltip from "@/ui/tooltip";
import { getRemotes } from "../../api/git-remotes-api";
import { getGitStatus } from "../../api/git-status-api";
import { useDiffEditorBuffer } from "../../hooks/use-diff-editor-buffer";
import type { MultiFileDiff } from "../../types/git-diff.types";
import type { GitDiff } from "../../types/git.types";
import { gitDiffCache } from "../../utils/git-diff-cache";
import { getFileStatus } from "../../utils/git-diff-helpers";
import {
  DIFF_INLINE_RENDER_LINE_THRESHOLD,
  getInitialExpandedDiffFileKeys,
  shouldUseScrollableDiffEditor,
} from "../../utils/diff-viewer-scale";
import { buildWorkingTreeMultiDiff } from "../../utils/working-tree-multi-diff";
import {
  serializeGitDiffForEditor,
  serializeGitDiffSourceForEditor,
  serializeGitDiffSourceForSplitEditor,
} from "../../utils/diff-editor-content";
import DiffLineBackgroundLayer from "./diff-line-background-layer";
import ImageDiffViewer from "./git-diff-image";
import TextDiffViewer from "./git-diff-text";

function countStats(diff: GitDiff) {
  if (typeof diff.additions === "number" || typeof diff.deletions === "number") {
    return {
      additions: diff.additions ?? 0,
      deletions: diff.deletions ?? 0,
    };
  }

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

function getDiffSectionKey(multiDiff: MultiFileDiff, diff: GitDiff, index: number): string {
  return multiDiff.fileKeys?.[index] ?? `${diff.file_path}:${index}`;
}

function parseGitHubRemoteSlug(remoteUrl: string): { owner: string; repo: string } | null {
  const normalized = remoteUrl.trim();
  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    const [, owner, repo] = httpsMatch;
    return { owner, repo };
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    const [, owner, repo] = sshMatch;
    return { owner, repo };
  }

  return null;
}

function buildGitHubReferenceUrl(remoteUrl: string, gitRef: string): string | null {
  const slug = parseGitHubRemoteSlug(remoteUrl);
  if (!slug) return null;

  const comparisonMatch = gitRef.match(/^(.+?)(?:\.{2,3})(.+)$/);
  if (comparisonMatch) {
    const [, baseRef, targetRef] = comparisonMatch;
    return `https://github.com/${slug.owner}/${slug.repo}/compare/${encodeURIComponent(
      baseRef,
    )}...${encodeURIComponent(targetRef)}`;
  }

  return `https://github.com/${slug.owner}/${slug.repo}/commit/${encodeURIComponent(gitRef)}`;
}

function LargeDiffSectionEditor({ diff, cacheKey }: { diff: GitDiff; cacheKey: string }) {
  const sourcePath = diff.new_path || diff.old_path || diff.file_path;
  const editorContent = useMemo(() => serializeGitDiffForEditor(diff), [diff]);
  const bufferId = useDiffEditorBuffer({
    cacheKey: `${cacheKey}_large`,
    content: editorContent,
    sourcePath,
    name: `${sourcePath.split("/").pop() || "Diff"}.diff`,
  });

  return (
    <div
      className="relative overflow-hidden bg-primary-bg"
      style={{ height: "min(72vh, 760px)", minHeight: "420px" }}
    >
      <CodeEditor
        bufferId={bufferId}
        isActiveSurface={false}
        showToolbar={false}
        readOnly={true}
        scrollable={true}
      />
    </div>
  );
}

function EmbeddedDiffSectionEditor({
  diff,
  cacheKey,
  viewMode,
}: {
  diff: GitDiff;
  cacheKey: string;
  viewMode: "unified" | "split";
}) {
  const fontSize = useEditorSettingsStore.use.fontSize();
  const editorLineHeight = useEditorSettingsStore.use.lineHeight();
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
    const lineHeight = calculateLineHeight(fontSize * zoomLevel, editorLineHeight);

    return Math.max(
      lineCount * lineHeight +
        EDITOR_CONSTANTS.EDITOR_PADDING_TOP +
        EDITOR_CONSTANTS.EDITOR_PADDING_BOTTOM,
      160,
    );
  }, [
    fontSize,
    editorLineHeight,
    splitContent.left.content,
    splitContent.right.content,
    unifiedContent.content,
    viewMode,
    zoomLevel,
  ]);
  const lineHeight = useMemo(
    () => calculateLineHeight(fontSize * zoomLevel, editorLineHeight),
    [fontSize, editorLineHeight, zoomLevel],
  );
  const resolveAbsolutePath = useCallback(() => {
    const isAbsoluteProviderPath =
      sourcePath.startsWith("/") ||
      sourcePath.startsWith("remote://") ||
      sourcePath.startsWith("wsl://");
    if (isAbsoluteProviderPath) {
      return sourcePath;
    }
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
      <div className="grid grid-cols-2 bg-primary-bg" style={{ height: `${height}px` }}>
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
    <div className="relative overflow-hidden bg-primary-bg" style={{ height: `${height}px` }}>
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

function DiffSectionEditor({
  diff,
  cacheKey,
  viewMode,
}: {
  diff: GitDiff;
  cacheKey: string;
  viewMode: "unified" | "split";
}) {
  if (shouldUseScrollableDiffEditor(diff)) {
    return <LargeDiffSectionEditor diff={diff} cacheKey={cacheKey} />;
  }

  return <EmbeddedDiffSectionEditor diff={diff} cacheKey={cacheKey} viewMode={viewMode} />;
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
    <div ref={bodyRef} style={{ contentVisibility: "auto", containIntrinsicSize: "960px" }}>
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
  onOpenFile,
}: {
  diff: GitDiff;
  sectionKey: string;
  expanded: boolean;
  onToggle: (sectionKey: string) => void;
  onOpenFile: (filePath: string) => void | Promise<void>;
  viewMode: "unified" | "split";
  showWhitespace: boolean;
}) {
  const filePath = diff.new_path || diff.old_path || diff.file_path;
  const fileName = filePath.split("/").pop() || filePath;
  const directoryPath = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/") + 1)
    : "";
  const { additions, deletions } = countStats(diff);
  const handleToggle = useCallback(() => {
    onToggle(sectionKey);
  }, [onToggle, sectionKey]);
  const handleOpenFile = useCallback(() => {
    void onOpenFile(filePath);
  }, [filePath, onOpenFile]);
  const shouldUseInlineTextDiff =
    !shouldUseScrollableDiffEditor(diff) && diff.lines.length <= DIFF_INLINE_RENDER_LINE_THRESHOLD;

  return (
    <section
      className={cn(
        "relative isolate min-w-0 max-w-full bg-primary-bg",
        expanded && "border-border/60 border-b",
      )}
    >
      <MultibufferFileHeader
        filePath={filePath}
        fileName={fileName}
        directoryPath={directoryPath}
        expanded={expanded}
        onToggle={handleToggle}
        onOpen={handleOpenFile}
        surface="section"
        showFileIcon={false}
        trailing={
          <>
            {additions > 0 ? <span className="text-git-added">+{additions}</span> : null}
            {deletions > 0 ? <span className="text-git-deleted">-{deletions}</span> : null}
          </>
        }
      />

      {expanded ? (
        diff.is_image ? (
          <div className="min-w-0 max-w-full overflow-hidden">
            <LazyDiffSectionBody expanded={expanded}>
              <ImageDiffViewer diff={diff} fileName={fileName} onClose={() => {}} />
            </LazyDiffSectionBody>
          </div>
        ) : (
          <div className="min-w-0 max-w-full overflow-hidden">
            <LazyDiffSectionBody expanded={expanded}>
              {shouldUseInlineTextDiff ? (
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
          </div>
        )
      ) : null}
    </section>
  );
});

function getInitialExpandedFiles(multiDiff: MultiFileDiff): Set<string> {
  return new Set(getInitialExpandedDiffFileKeys(multiDiff));
}

const GitDiffEditorStack = memo(function GitDiffEditorStack({
  multiDiff,
}: {
  multiDiff: MultiFileDiff;
}) {
  const activeBuffer = useBufferStore((state) => {
    return getBufferById(state.buffers, state.activeBufferId);
  });
  const updateBufferContent = useBufferStore.use.actions().updateBufferContent;
  const closeBuffer = useBufferStore.use.actions().closeBuffer;
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [isFileTreeVisible, setIsFileTreeVisible] = useState(true);
  const [fileNavigatorViewMode, setFileNavigatorViewMode] = useState<FileNavigatorViewMode>("flat");
  const isWorkingTree = multiDiff.commitHash === "working-tree";
  const isWorkingTreeBuffer = activeBuffer?.path === "diff://working-tree/all-files";
  const isRefreshingRef = useRef(false);
  const sectionElementsRef = useRef(new Map<string, HTMLDivElement>());
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(
    () =>
      multiDiff.initiallyExpandedFileKey ??
      (multiDiff.files[0] ? getDiffSectionKey(multiDiff, multiDiff.files[0], 0) : null),
  );
  const handleOpenFile = useCallback(
    async (filePath: string) => {
      const repoPath = multiDiff.repoPath ?? rootFolderPath;
      const isAbsoluteProviderPath =
        filePath.startsWith("/") ||
        filePath.startsWith("remote://") ||
        filePath.startsWith("wsl://");
      const targetPath = isAbsoluteProviderPath
        ? filePath
        : repoPath
          ? joinPath(repoPath, filePath)
          : filePath;

      await useFileSystemStore
        .getState()
        .handleFileSelect(targetPath, false, undefined, undefined, undefined, false);
    },
    [multiDiff.repoPath, rootFolderPath],
  );
  const [githubCommitUrl, setGitHubCommitUrl] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() =>
    getInitialExpandedFiles(multiDiff),
  );
  const indexingProgress = multiDiff.indexingProgress;
  const isIndexingDiffs = Boolean(multiDiff.isLoading);
  const indexingLabel = indexingProgress
    ? `${indexingProgress.label ?? "Indexing"} ${indexingProgress.processed.toLocaleString()}/${indexingProgress.total.toLocaleString()}`
    : "Indexing changes";
  const indexedFileLabel = indexingProgress
    ? `${multiDiff.files.length.toLocaleString()} of ${indexingProgress.total.toLocaleString()} changed files`
    : `${multiDiff.totalFiles.toLocaleString()} changed file${multiDiff.totalFiles !== 1 ? "s" : ""}`;
  const diffFileItems = useMemo<FileNavigatorItem[]>(
    () =>
      multiDiff.files.map((diff, index) => {
        const filePath = diff.new_path || diff.old_path || diff.file_path;
        const { additions, deletions } = countStats(diff);
        const status = getFileStatus(diff);

        return {
          key: getDiffSectionKey(multiDiff, diff, index),
          path: filePath,
          iconClassName: statusTextClass[status],
          metadata: [
            ...(additions > 0 ? [{ label: `+${additions}`, className: "text-git-added" }] : []),
            ...(deletions > 0 ? [{ label: `-${deletions}`, className: "text-git-deleted" }] : []),
          ],
        };
      }),
    [multiDiff],
  );
  const handleToggleSection = useCallback((sectionKey: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }, []);
  const registerSectionElement = useCallback((sectionKey: string, node: HTMLDivElement | null) => {
    if (node) {
      sectionElementsRef.current.set(sectionKey, node);
      return;
    }

    sectionElementsRef.current.delete(sectionKey);
  }, []);
  const handleSelectFileFromTree = useCallback((sectionKey: string) => {
    setSelectedFileKey(sectionKey);
    setExpandedFiles((prev) => {
      if (prev.has(sectionKey)) return prev;
      const next = new Set(prev);
      next.add(sectionKey);
      return next;
    });

    window.requestAnimationFrame(() => {
      sectionElementsRef.current.get(sectionKey)?.scrollIntoView({
        block: "start",
      });
    });
  }, []);
  useEffect(() => {
    const nextKeys = new Set(
      multiDiff.files.map((diff, index) => getDiffSectionKey(multiDiff, diff, index)),
    );

    setExpandedFiles((previous) => {
      const nextExpanded = new Set(Array.from(previous).filter((key) => nextKeys.has(key)));

      if (nextExpanded.size === 0) {
        return getInitialExpandedFiles(multiDiff);
      }

      if (multiDiff.initiallyExpandedFileKey && nextKeys.has(multiDiff.initiallyExpandedFileKey)) {
        nextExpanded.add(multiDiff.initiallyExpandedFileKey);
      }

      return nextExpanded;
    });

    setSelectedFileKey((previous) => {
      if (previous && nextKeys.has(previous)) return previous;
      return (
        multiDiff.initiallyExpandedFileKey ??
        (multiDiff.files[0] ? getDiffSectionKey(multiDiff, multiDiff.files[0], 0) : null)
      );
    });
  }, [multiDiff.fileKeys, multiDiff.files, multiDiff.initiallyExpandedFileKey]);

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

  useEffect(() => {
    if (isWorkingTree || multiDiff.commitHash.startsWith("stash@{")) {
      setGitHubCommitUrl(null);
      return;
    }

    const repoPath = multiDiff.repoPath ?? rootFolderPath;
    if (!repoPath) {
      setGitHubCommitUrl(null);
      return;
    }

    let isCancelled = false;

    const loadGitHubCommitUrl = async () => {
      const remotes = await getRemotes(repoPath);
      const candidate =
        remotes.find((remote) => remote.name === "origin")?.url ?? remotes[0]?.url ?? null;
      const nextUrl = candidate ? buildGitHubReferenceUrl(candidate, multiDiff.commitHash) : null;
      if (!isCancelled) {
        setGitHubCommitUrl(nextUrl);
      }
    };

    void loadGitHubCommitUrl();

    return () => {
      isCancelled = true;
    };
  }, [isWorkingTree, multiDiff.commitHash, multiDiff.repoPath, rootFolderPath]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg">
      <Breadcrumb
        filePathOverride={multiDiff.title || "Uncommitted Changes"}
        interactive={false}
        showPath={false}
        showDefaultActions={true}
        extraLeftContent={
          <div className="ui-text-sm flex items-center gap-2 text-text-lighter">
            <span>{indexedFileLabel}</span>
            <span className="text-git-added">+{multiDiff.totalAdditions}</span>
            <span className="text-git-deleted">-{multiDiff.totalDeletions}</span>
            {isIndexingDiffs ? <span>{indexingLabel}</span> : null}
          </div>
        }
        rightContent={
          <div className="flex items-center gap-1">
            <BreadcrumbActionButton
              type="button"
              active={isFileTreeVisible}
              onClick={() => setIsFileTreeVisible((current) => !current)}
              className="gap-1"
              tooltip={isFileTreeVisible ? "Hide changed files" : "Show changed files"}
              tooltipSide="bottom"
              aria-label={isFileTreeVisible ? "Hide changed files" : "Show changed files"}
            >
              <ListBullets weight="duotone" />
            </BreadcrumbActionButton>
            <div className="flex items-center gap-0.5">
              <BreadcrumbActionButton
                type="button"
                active={viewMode === "unified"}
                onClick={() => setViewMode("unified")}
                tooltip="Unified view"
                tooltipSide="bottom"
                aria-label="Unified view"
              >
                <Rows3 weight="duotone" />
              </BreadcrumbActionButton>
              <BreadcrumbActionButton
                type="button"
                active={viewMode === "split"}
                onClick={() => setViewMode("split")}
                tooltip="Split view"
                tooltipSide="bottom"
                aria-label="Split view"
              >
                <Columns2 weight="duotone" />
              </BreadcrumbActionButton>
            </div>
            <DropdownMenu>
              <Tooltip content="Diff actions" side="bottom">
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Diff actions"
                    />
                  }
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent>
                {githubCommitUrl ? (
                  <DropdownMenuItem onClick={() => void openUrl(githubCommitUrl)}>
                    View on GitHub
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => setShowWhitespace((current) => !current)}>
                  {showWhitespace ? "Hide whitespace" : "Show whitespace"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {!isWorkingTree &&
      (multiDiff.commitMessage || multiDiff.commitAuthor || multiDiff.commitDate) ? (
        <div className="border-border/60 border-b bg-primary-bg px-4 py-3">
          <div className="max-w-4xl">
            {multiDiff.commitMessage ? (
              <div className="ui-text-base font-medium leading-snug text-text">
                {multiDiff.commitMessage}
              </div>
            ) : null}
            {multiDiff.commitDescription ? (
              <div className="ui-text-sm mt-1 whitespace-pre-wrap leading-relaxed text-text-lighter">
                {multiDiff.commitDescription}
              </div>
            ) : null}
            <div className="ui-text-sm mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-text-lighter">
              {multiDiff.commitAuthor ? (
                <span className="inline-flex items-center gap-1.5 text-text-light">
                  <Avatar name={multiDiff.commitAuthor} className="size-5" />
                  {multiDiff.commitAuthor}
                </span>
              ) : null}
              {multiDiff.commitDate ? (
                <span>{formatRelativeDate(multiDiff.commitDate)}</span>
              ) : null}
              <code className="font-mono text-text-lighter" title={multiDiff.commitHash}>
                {multiDiff.commitHash.slice(0, 7)}
              </code>
            </div>
          </div>
        </div>
      ) : null}

      {isIndexingDiffs && multiDiff.files.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-primary-bg">
          <div className="ui-text-sm text-text-lighter">{indexingLabel}</div>
        </div>
      ) : null}

      {isIndexingDiffs && multiDiff.files.length === 0 ? null : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {isFileTreeVisible ? (
            <FileNavigatorSidebar
              items={diffFileItems}
              selectedKey={selectedFileKey}
              onSelect={handleSelectFileFromTree}
              ariaLabel="Changed files"
              viewMode={fileNavigatorViewMode}
              onViewModeChange={setFileNavigatorViewMode}
              surface="review"
              className="h-auto self-stretch"
              searchMode="fuzzy"
              compactRows
            />
          ) : null}

          <div
            className="min-h-0 flex-1 overflow-auto"
            style={{ overflowAnchor: "none" }}
            data-diff-stack-scroll-container
          >
            <div className="flex min-w-0 max-w-full flex-col">
              {multiDiff.files.map((diff, index) => {
                const sectionKey = getDiffSectionKey(multiDiff, diff, index);

                return (
                  <div key={sectionKey} ref={(node) => registerSectionElement(sectionKey, node)}>
                    <DiffFileSection
                      diff={diff}
                      sectionKey={sectionKey}
                      expanded={expandedFiles.has(sectionKey)}
                      viewMode={viewMode}
                      showWhitespace={showWhitespace}
                      onToggle={handleToggleSection}
                      onOpenFile={handleOpenFile}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default GitDiffEditorStack;
