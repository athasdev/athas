import {
  Check,
  CaretDown as ChevronDown,
  CaretRight as ChevronRight,
  Columns as Columns2,
  ArrowSquareOut as ExternalLink,
  Rows as Rows3,
  Trash as Trash2,
} from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import { joinPath } from "@/utils/path-helpers";
import { getRemotes } from "../../api/git-remotes-api";
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
import Badge from "@/ui/badge";

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

const MAX_HUNK_ACTION_DIFF_LINES = 1200;

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
  onOpenFile,
}: {
  diff: GitDiff;
  sectionKey: string;
  expanded: boolean;
  onToggle: (sectionKey: string) => void;
  onOpenFile: (filePath: string) => void | Promise<void>;
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
  const handleOpenFile = useCallback(() => {
    void onOpenFile(filePath);
  }, [filePath, onOpenFile]);
  const shouldUseInlineTextDiff =
    enableHunkActions && viewMode === "unified" && diff.lines.length <= MAX_HUNK_ACTION_DIFF_LINES;

  return (
    <section className="relative isolate min-w-0 max-w-full rounded-md bg-primary-bg">
      <div className="sticky top-0 z-50 min-w-0 max-w-full bg-primary-bg">
        <div
          className={cn(
            "min-w-0 max-w-full overflow-hidden border border-border/70 bg-primary-bg shadow-[0_1px_0_rgba(0,0,0,0.04)]",
            expanded ? "rounded-t-md" : "rounded-md",
          )}
        >
          <div className="flex min-w-0 items-center">
            <button
              type="button"
              onClick={handleToggle}
              className="relative z-50 flex h-8 w-8 shrink-0 items-center justify-center text-text-lighter hover:bg-hover/30 hover:text-text"
              aria-label={expanded ? "Collapse file diff" : "Expand file diff"}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <button
              type="button"
              onClick={handleOpenFile}
              className="relative z-50 flex min-w-0 flex-1 items-center gap-2 overflow-hidden py-2 pr-3 text-left hover:bg-hover/30"
              aria-label={`Open ${filePath}`}
            >
              <FileExplorerIcon
                fileName={fileName}
                isDir={false}
                size={16}
                className="shrink-0 text-text-lighter"
              />
              <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
                <span
                  className={cn(
                    "min-w-0 max-w-[45%] truncate ui-text-sm font-medium",
                    statusTextClass[status],
                  )}
                >
                  {fileName}
                </span>
                <span className="min-w-0 flex-1 truncate ui-text-sm editor-font text-text-lighter">
                  {directoryPath}
                </span>
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
                {additions > 0 ? <span className="text-git-added">+{additions}</span> : null}
                {deletions > 0 ? <span className="text-git-deleted">-{deletions}</span> : null}
                <Badge
                  size="compact"
                  variant="muted"
                  className={`rounded px-1.5 py-0.5 capitalize ${statusBadgeClass[status]}`}
                >
                  {status}
                </Badge>
              </span>
            </button>
          </div>
        </div>
      </div>

      {expanded ? (
        diff.is_image ? (
          <div className="-mt-px min-w-0 max-w-full overflow-hidden rounded-b-md border-border/70 border-x border-b">
            <LazyDiffSectionBody expanded={expanded}>
              <ImageDiffViewer diff={diff} fileName={fileName} onClose={() => {}} />
            </LazyDiffSectionBody>
          </div>
        ) : (
          <div className="-mt-px min-w-0 max-w-full overflow-hidden rounded-b-md border-border/70 border-x border-b">
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
  if (multiDiff.initiallyExpandedFileKey) {
    return new Set([multiDiff.initiallyExpandedFileKey]);
  }

  return new Set(
    multiDiff.files.map(
      (diff, index) => multiDiff.fileKeys?.[index] ?? `${diff.file_path}:${index}`,
    ),
  );
}

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
  const handleOpenFile = useCallback(
    async (filePath: string) => {
      const repoPath = multiDiff.repoPath ?? rootFolderPath;
      const targetPath =
        filePath.startsWith("/") || filePath.startsWith("remote://")
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
  const handleToggleSection = useCallback((sectionKey: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }, []);

  useEffect(() => {
    const nextKeys = new Set(
      multiDiff.files.map(
        (diff, index) => multiDiff.fileKeys?.[index] ?? `${diff.file_path}:${index}`,
      ),
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
            <span>
              {multiDiff.totalFiles} changed file
              {multiDiff.totalFiles !== 1 ? "s" : ""}
            </span>
            <span className="text-git-added">+{multiDiff.totalAdditions}</span>
            <span className="text-git-deleted">-{multiDiff.totalDeletions}</span>
          </div>
        }
        rightContent={
          <div className="flex items-center gap-1">
            {githubCommitUrl ? (
              <Tooltip content="View on GitHub" side="bottom">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void openUrl(githubCommitUrl)}
                  className="h-5 gap-1 px-1.5 text-text-lighter ui-text-sm"
                  aria-label="View on GitHub"
                >
                  <ExternalLink />
                  View on GitHub
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip content={showWhitespace ? "Hide whitespace" : "Show whitespace"} side="bottom">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                active={showWhitespace}
                onClick={() => setShowWhitespace((prev) => !prev)}
                className={cn("h-5 gap-1 px-1.5 text-text-lighter", showWhitespace && "text-text")}
                aria-label={showWhitespace ? "Hide whitespace" : "Show whitespace"}
              >
                <Trash2 />
                {showWhitespace ? <Check /> : null}
              </Button>
            </Tooltip>
            <div className="flex items-center gap-0.5">
              <Tooltip content="Unified view" side="bottom">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  active={viewMode === "unified"}
                  onClick={() => setViewMode("unified")}
                  className="text-text-lighter"
                  aria-label="Unified view"
                >
                  <Rows3 />
                </Button>
              </Tooltip>
              <Tooltip content="Split view" side="bottom">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  active={viewMode === "split"}
                  onClick={() => setViewMode("split")}
                  className="text-text-lighter"
                  aria-label="Split view"
                >
                  <Columns2 />
                </Button>
              </Tooltip>
            </div>
          </div>
        }
      />

      {!isWorkingTree &&
      (multiDiff.commitMessage || multiDiff.commitAuthor || multiDiff.commitDate) ? (
        <div className="bg-primary-bg px-2 py-2">
          <div className="px-1 py-1.5">
            {multiDiff.commitMessage ? (
              <div className="ui-text-sm font-medium text-text">{multiDiff.commitMessage}</div>
            ) : null}
            {multiDiff.commitDescription ? (
              <div className="ui-text-sm mt-2 whitespace-pre-wrap text-text-lighter">
                {multiDiff.commitDescription}
              </div>
            ) : null}
            <div className="ui-text-sm mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-text-lighter">
              {multiDiff.commitAuthor ? <span>{multiDiff.commitAuthor}</span> : null}
              {multiDiff.commitDate ? (
                <span>{formatRelativeDate(multiDiff.commitDate)}</span>
              ) : null}
              <Badge size="compact" variant="muted">
                {multiDiff.commitHash}
              </Badge>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-auto px-2 pb-2"
        style={{ overflowAnchor: "none" }}
        data-diff-stack-scroll-container
      >
        <div className="flex min-w-0 max-w-full flex-col gap-2 rounded-md">
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
                onOpenFile={handleOpenFile}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default GitDiffEditorStack;
