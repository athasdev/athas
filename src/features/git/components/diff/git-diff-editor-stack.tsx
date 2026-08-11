import {
  ColumnsIcon as Columns2,
  DotsThreeIcon as MoreHorizontal,
  ListBulletsIcon as ListBullets,
  MagnifyingGlassIcon as Search,
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
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import {
  buildSearchRegex,
  findAllMatches,
  type SearchOptions,
} from "@/features/editor/utils/search";
import { formatRelativeDate } from "@/utils/date";
import { cn } from "@/utils/cn";
import { joinPath } from "@/utils/path-helpers";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription } from "@/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import Tooltip from "@/ui/tooltip";
import { SEARCH_TOGGLE_ICONS, SearchPopover } from "@/ui/search";
import { getFileDiff } from "../../api/git-diff-api";
import { getRemotes } from "../../api/git-remotes-api";
import { isGitChangeRelevant, subscribeToGitChanges } from "../../events/git-events";
import { useDiffEditorBuffer } from "../../hooks/use-diff-editor-buffer";
import type { MultiFileDiff } from "../../types/git-diff.types";
import type { GitDiff } from "../../types/git.types";
import { gitDiffCache } from "../../utils/git-diff-cache";
import { getFileStatus } from "../../utils/git-diff-helpers";
import {
  findMultiDiffMatches,
  getMultiDiffSectionKey,
  type MultiDiffSearchMatch,
} from "../../utils/multi-diff-search";
import {
  DIFF_INLINE_RENDER_LINE_THRESHOLD,
  getInitialExpandedDiffFileKeys,
  shouldUseScrollableDiffEditor,
} from "../../utils/diff-viewer-scale";
import { createSingleFileWorkingTreeDiff } from "../../utils/working-tree-multi-diff";
import {
  serializeGitDiffForEditor,
  serializeGitDiffSourceForEditor,
  serializeGitDiffSourceForSplitEditor,
} from "../../utils/diff-editor-content";
import DiffLineBackgroundLayer from "./diff-line-background-layer";
import ImageDiffViewer from "./git-diff-image";
import { BinaryDiffViewer } from "./git-diff-binary";
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

function hasRenderableDiff(diff: GitDiff | null): diff is GitDiff {
  return !!diff && (diff.lines.length > 0 || diff.is_image === true || diff.is_binary === true);
}

const statusTextClass: Record<string, string> = {
  added: "text-git-added",
  deleted: "text-git-deleted",
  modified: "text-git-modified",
  renamed: "text-git-renamed",
};

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

function getContentSearchMatches(
  content: string,
  searchQuery: string,
  searchOptions: SearchOptions,
) {
  const regex = buildSearchRegex(searchQuery, searchOptions);
  return regex ? findAllMatches(content, regex) : [];
}

function LargeDiffSectionEditor({
  diff,
  cacheKey,
  searchQuery,
  searchOptions,
  currentSearchMatchIndex,
}: {
  diff: GitDiff;
  cacheKey: string;
  searchQuery: string;
  searchOptions: SearchOptions;
  currentSearchMatchIndex: number;
}) {
  const sourcePath = diff.new_path || diff.old_path || diff.file_path;
  const editorContent = useMemo(() => serializeGitDiffForEditor(diff), [diff]);
  const highlightMatches = useMemo(
    () => getContentSearchMatches(editorContent, searchQuery, searchOptions),
    [editorContent, searchOptions, searchQuery],
  );
  const bufferId = useDiffEditorBuffer({
    cacheKey: `${cacheKey}_large`,
    content: editorContent,
    sourcePath,
    name: `${sourcePath.split("/").pop() || "Diff"}.diff`,
  });

  return (
    <div
      className="relative overflow-hidden bg-background"
      style={{ height: "min(72vh, 760px)", minHeight: "420px" }}
    >
      <CodeEditor
        bufferId={bufferId}
        isActiveSurface={false}
        showToolbar={false}
        readOnly={true}
        scrollable={true}
        highlightMatches={highlightMatches}
        currentHighlightIndex={currentSearchMatchIndex}
      />
    </div>
  );
}

function EmbeddedDiffSectionEditor({
  diff,
  cacheKey,
  viewMode,
  searchQuery,
  searchOptions,
  searchMatches,
  currentSearchMatch,
}: {
  diff: GitDiff;
  cacheKey: string;
  viewMode: "unified" | "split";
  searchQuery: string;
  searchOptions: SearchOptions;
  searchMatches: MultiDiffSearchMatch[];
  currentSearchMatch: MultiDiffSearchMatch | null;
}) {
  const fontSize = useEditorSettingsStore.use.fontSize();
  const editorLineHeight = useEditorSettingsStore.use.lineHeight();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const sourcePath = diff.new_path || diff.old_path || diff.file_path;
  const unifiedContent = useMemo(() => serializeGitDiffSourceForEditor(diff), [diff]);
  const splitContent = useMemo(() => serializeGitDiffSourceForSplitEditor(diff), [diff]);
  const unifiedHighlightMatches = useMemo(
    () => getContentSearchMatches(unifiedContent.content, searchQuery, searchOptions),
    [searchOptions, searchQuery, unifiedContent.content],
  );
  const leftHighlightMatches = useMemo(
    () => getContentSearchMatches(splitContent.left.content, searchQuery, searchOptions),
    [searchOptions, searchQuery, splitContent.left.content],
  );
  const rightHighlightMatches = useMemo(
    () => getContentSearchMatches(splitContent.right.content, searchQuery, searchOptions),
    [searchOptions, searchQuery, splitContent.right.content],
  );
  const unifiedCurrentMatchIndex = currentSearchMatch
    ? searchMatches.indexOf(currentSearchMatch)
    : -1;
  const leftSearchMatches = searchMatches.filter(
    (match) => diff.lines[match.lineIndex]?.line_type !== "added",
  );
  const rightSearchMatches = searchMatches.filter(
    (match) => diff.lines[match.lineIndex]?.line_type !== "removed",
  );
  const leftCurrentMatchIndex = currentSearchMatch
    ? leftSearchMatches.indexOf(currentSearchMatch)
    : -1;
  const rightCurrentMatchIndex = currentSearchMatch
    ? rightSearchMatches.indexOf(currentSearchMatch)
    : -1;
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
      <div className="grid grid-cols-2 bg-background" style={{ height: `${height}px` }}>
        <div className="relative overflow-hidden border-border border-r bg-background">
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
            highlightMatches={leftHighlightMatches}
            currentHighlightIndex={leftCurrentMatchIndex}
            onReadonlySurfaceClick={({ line, column }) =>
              void openSourceLocation(line, column, splitContent.left.actualLines)
            }
          />
        </div>
        <div className="relative overflow-hidden bg-background">
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
            highlightMatches={rightHighlightMatches}
            currentHighlightIndex={rightCurrentMatchIndex}
            onReadonlySurfaceClick={({ line, column }) =>
              void openSourceLocation(line, column, splitContent.right.actualLines)
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden bg-background" style={{ height: `${height}px` }}>
      <DiffLineBackgroundLayer lineKinds={unifiedContent.lineKinds} lineHeight={lineHeight} />
      <CodeEditor
        bufferId={unifiedBufferId}
        isActiveSurface={false}
        showToolbar={false}
        readOnly={true}
        scrollable={false}
        highlightMatches={unifiedHighlightMatches}
        currentHighlightIndex={unifiedCurrentMatchIndex}
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
  searchQuery,
  searchOptions,
  searchMatches,
  currentSearchMatch,
}: {
  diff: GitDiff;
  cacheKey: string;
  viewMode: "unified" | "split";
  searchQuery: string;
  searchOptions: SearchOptions;
  searchMatches: MultiDiffSearchMatch[];
  currentSearchMatch: MultiDiffSearchMatch | null;
}) {
  const currentSearchMatchIndex = currentSearchMatch
    ? searchMatches.indexOf(currentSearchMatch)
    : -1;

  if (shouldUseScrollableDiffEditor(diff)) {
    return (
      <LargeDiffSectionEditor
        diff={diff}
        cacheKey={cacheKey}
        searchQuery={searchQuery}
        searchOptions={searchOptions}
        currentSearchMatchIndex={currentSearchMatchIndex}
      />
    );
  }

  return (
    <EmbeddedDiffSectionEditor
      diff={diff}
      cacheKey={cacheKey}
      viewMode={viewMode}
      searchQuery={searchQuery}
      searchOptions={searchOptions}
      searchMatches={searchMatches}
      currentSearchMatch={currentSearchMatch}
    />
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
    <div ref={bodyRef} style={{ contentVisibility: "auto", containIntrinsicSize: "960px" }}>
      {shouldMount ? children : <div className="h-80 bg-background" />}
    </div>
  );
});

const DiffFileBody = memo(function DiffFileBody({
  diff,
  sectionKey,
  viewMode,
  showWhitespace,
  searchMatches,
  currentSearchMatch,
  searchQuery,
  searchOptions,
}: {
  diff: GitDiff;
  sectionKey: string;
  viewMode: "unified" | "split";
  showWhitespace: boolean;
  searchMatches: MultiDiffSearchMatch[];
  currentSearchMatch: MultiDiffSearchMatch | null;
  searchQuery: string;
  searchOptions: SearchOptions;
}) {
  const filePath = diff.new_path || diff.old_path || diff.file_path;
  const fileName = filePath.split("/").pop() || filePath;
  const shouldUseInlineTextDiff =
    !shouldUseScrollableDiffEditor(diff) && diff.lines.length <= DIFF_INLINE_RENDER_LINE_THRESHOLD;
  const searchHighlights = useMemo(() => {
    const highlights = new Map<number, Array<{ start: number; end: number; isCurrent: boolean }>>();

    for (const match of searchMatches) {
      const lineHighlights = highlights.get(match.lineIndex) ?? [];
      lineHighlights.push({
        start: match.start,
        end: match.end,
        isCurrent: match === currentSearchMatch,
      });
      highlights.set(match.lineIndex, lineHighlights);
    }

    return highlights;
  }, [currentSearchMatch, searchMatches]);

  if (diff.is_image) {
    return <ImageDiffViewer diff={diff} fileName={fileName} onClose={() => {}} />;
  }

  if (diff.is_binary) {
    return <BinaryDiffViewer fileName={fileName} />;
  }

  return shouldUseInlineTextDiff ? (
    <TextDiffViewer
      diff={diff}
      isStaged={sectionKey.startsWith("staged:")}
      viewMode={viewMode}
      showWhitespace={showWhitespace}
      isEmbeddedInScrollView={true}
      searchHighlights={searchHighlights}
    />
  ) : (
    <DiffSectionEditor
      diff={diff}
      cacheKey={sectionKey}
      viewMode={viewMode}
      searchQuery={searchQuery}
      searchOptions={searchOptions}
      searchMatches={searchMatches}
      currentSearchMatch={currentSearchMatch}
    />
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
  searchMatches,
  currentSearchMatch,
  searchQuery,
  searchOptions,
}: {
  diff: GitDiff;
  sectionKey: string;
  expanded: boolean;
  onToggle: (sectionKey: string) => void;
  onOpenFile: (filePath: string) => void | Promise<void>;
  viewMode: "unified" | "split";
  showWhitespace: boolean;
  searchMatches: MultiDiffSearchMatch[];
  currentSearchMatch: MultiDiffSearchMatch | null;
  searchQuery: string;
  searchOptions: SearchOptions;
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

  return (
    <section
      className={cn(
        "relative isolate min-w-0 max-w-full bg-background",
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
        <div className="min-w-0 max-w-full overflow-hidden">
          <LazyDiffSectionBody expanded={expanded}>
            <DiffFileBody
              diff={diff}
              sectionKey={sectionKey}
              viewMode={viewMode}
              showWhitespace={showWhitespace}
              searchMatches={searchMatches}
              currentSearchMatch={currentSearchMatch}
              searchQuery={searchQuery}
              searchOptions={searchOptions}
            />
          </LazyDiffSectionBody>
        </div>
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
  const isFindVisible = useUIState((state) => state.isFindVisible);
  const setIsFindVisible = useUIState((state) => state.setIsFindVisible);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [isFileTreeVisible, setIsFileTreeVisible] = useState(true);
  const [fileNavigatorViewMode, setFileNavigatorViewMode] = useState<FileNavigatorViewMode>("tree");
  const isWorkingTree = multiDiff.commitHash === "working-tree";
  const isWorkingTreeBuffer = activeBuffer?.path === "diff://working-tree/all-files";
  const isActiveMultiDiff = activeBuffer?.type === "diff" && activeBuffer.diffData === multiDiff;
  const isRefreshingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const diffStackScrollRef = useRef<HTMLDivElement>(null);
  const sectionElementsRef = useRef(new Map<string, HTMLDivElement>());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
  });
  const [currentSearchMatchIndex, setCurrentSearchMatchIndex] = useState(-1);
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(
    () =>
      multiDiff.initiallyExpandedFileKey ??
      (multiDiff.files[0] ? getMultiDiffSectionKey(multiDiff, multiDiff.files[0], 0) : null),
  );
  const searchMatches = useMemo(
    () => findMultiDiffMatches(multiDiff, searchQuery, searchOptions),
    [multiDiff, searchOptions, searchQuery],
  );
  const currentSearchMatch =
    currentSearchMatchIndex >= 0 ? (searchMatches[currentSearchMatchIndex] ?? null) : null;
  const isInvalidSearch =
    searchOptions.useRegex &&
    searchQuery.length > 0 &&
    buildSearchRegex(searchQuery, searchOptions) === null;
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
          key: getMultiDiffSectionKey(multiDiff, diff, index),
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
  const selectedDiffFile = useMemo(() => {
    if (!selectedFileKey) return null;

    const index = multiDiff.files.findIndex(
      (diff, fileIndex) => getMultiDiffSectionKey(multiDiff, diff, fileIndex) === selectedFileKey,
    );
    if (index < 0) return null;

    return {
      diff: multiDiff.files[index],
      sectionKey: selectedFileKey,
    };
  }, [multiDiff, selectedFileKey]);
  const handleToggleSection = useCallback((sectionKey: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }, []);
  const navigateSearch = useCallback(
    (direction: 1 | -1) => {
      if (searchMatches.length === 0) return;
      setCurrentSearchMatchIndex((current) => {
        const base = current >= 0 ? current : direction === 1 ? -1 : 0;
        return (base + direction + searchMatches.length) % searchMatches.length;
      });
    },
    [searchMatches.length],
  );
  const registerSectionElement = useCallback((sectionKey: string, node: HTMLDivElement | null) => {
    if (node) {
      sectionElementsRef.current.set(sectionKey, node);
      return;
    }

    sectionElementsRef.current.delete(sectionKey);
  }, []);
  const handleSelectFileFromTree = useCallback(
    (sectionKey: string) => {
      setSelectedFileKey(sectionKey);

      if (isWorkingTree) {
        window.requestAnimationFrame(() => {
          diffStackScrollRef.current?.scrollTo({ top: 0, left: 0 });
        });
        return;
      }

      setExpandedFiles((prev) => {
        if (prev.has(sectionKey)) return prev;
        const next = new Set(prev);
        next.add(sectionKey);
        return next;
      });

      window.requestAnimationFrame(() => {
        const scrollContainer = diffStackScrollRef.current;
        const section = sectionElementsRef.current.get(sectionKey);
        if (!scrollContainer || !section) return;

        const scrollContainerRect = scrollContainer.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        scrollContainer.scrollTo({
          top: scrollContainer.scrollTop + sectionRect.top - scrollContainerRect.top,
        });
      });
    },
    [isWorkingTree],
  );
  useEffect(() => {
    const nextKeys = new Set(
      multiDiff.files.map((diff, index) => getMultiDiffSectionKey(multiDiff, diff, index)),
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
        (multiDiff.files[0] ? getMultiDiffSectionKey(multiDiff, multiDiff.files[0], 0) : null)
      );
    });
  }, [multiDiff.fileKeys, multiDiff.files, multiDiff.initiallyExpandedFileKey]);

  useEffect(() => {
    if (searchMatches.length === 0) {
      setCurrentSearchMatchIndex(-1);
      return;
    }

    setCurrentSearchMatchIndex(0);
  }, [searchMatches]);

  useEffect(() => {
    if (!isFindVisible || !isActiveMultiDiff) return;
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [isActiveMultiDiff, isFindVisible]);

  useEffect(() => {
    if (!currentSearchMatch) return;

    setSelectedFileKey(currentSearchMatch.sectionKey);
    if (!isWorkingTree) {
      setExpandedFiles((previous) => {
        if (previous.has(currentSearchMatch.sectionKey)) return previous;
        const next = new Set(previous);
        next.add(currentSearchMatch.sectionKey);
        return next;
      });
    }

    let revealTimer: number | null = null;
    const revealFrame = window.requestAnimationFrame(() => {
      const section = sectionElementsRef.current.get(currentSearchMatch.sectionKey);
      if (!isWorkingTree) {
        section?.scrollIntoView({ block: "center" });
      }

      revealTimer = window.setTimeout(() => {
        const currentSection = sectionElementsRef.current.get(currentSearchMatch.sectionKey);
        const line = currentSection?.querySelector(
          `[data-diff-search-line="${currentSearchMatch.lineIndex}"]`,
        );
        line?.scrollIntoView({ block: "center", inline: "nearest" });
      }, 50);
    });

    return () => {
      window.cancelAnimationFrame(revealFrame);
      if (revealTimer !== null) window.clearTimeout(revealTimer);
    };
  }, [currentSearchMatch, isWorkingTree]);

  useEffect(() => {
    if (!isActiveMultiDiff) return;

    const handleSearchShortcut = (event: KeyboardEvent) => {
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (hasCommandModifier && key === "f") {
        event.preventDefault();
        setIsFindVisible(true);
        window.requestAnimationFrame(() => searchInputRef.current?.select());
        return;
      }

      if (hasCommandModifier && key === "g" && searchMatches.length > 0) {
        event.preventDefault();
        setIsFindVisible(true);
        navigateSearch(event.shiftKey ? -1 : 1);
      }
    };

    document.addEventListener("keydown", handleSearchShortcut, { capture: true });
    return () => document.removeEventListener("keydown", handleSearchShortcut, { capture: true });
  }, [isActiveMultiDiff, navigateSearch, searchMatches.length, setIsFindVisible]);

  const refreshWorkingTreeBuffer = useCallback(async () => {
    if (
      !isWorkingTree ||
      !isWorkingTreeBuffer ||
      !rootFolderPath ||
      !activeBuffer ||
      !selectedDiffFile
    ) {
      return;
    }
    if (isRefreshingRef.current) return;

    isRefreshingRef.current = true;

    try {
      gitDiffCache.invalidate(rootFolderPath);
      const selectedFileKey = selectedDiffFile.sectionKey;
      const selectedFilePath = selectedFileKey.replace(/^(staged|unstaged):/, "");
      let isStaged = selectedFileKey.startsWith("staged:");
      let nextDiff = await getFileDiff(rootFolderPath, selectedFilePath, isStaged);

      if (!hasRenderableDiff(nextDiff)) {
        isStaged = !isStaged;
        nextDiff = await getFileDiff(rootFolderPath, selectedFilePath, isStaged);
      }

      if (!hasRenderableDiff(nextDiff)) {
        closeBuffer(activeBuffer.id);
        return;
      }

      const nextFileKey = `${isStaged ? "staged" : "unstaged"}:${selectedFilePath}`;
      updateBufferContent(
        activeBuffer.id,
        "",
        false,
        createSingleFileWorkingTreeDiff({
          repoPath: rootFolderPath,
          fileKey: nextFileKey,
          diff: nextDiff,
          title: multiDiff.title,
        }),
      );
    } finally {
      isRefreshingRef.current = false;
    }
  }, [
    activeBuffer,
    closeBuffer,
    isWorkingTree,
    isWorkingTreeBuffer,
    multiDiff.title,
    rootFolderPath,
    selectedDiffFile,
    updateBufferContent,
  ]);

  useEffect(() => {
    if (!isWorkingTree) return;

    let timeoutId: number | null = null;
    const unsubscribe = subscribeToGitChanges((change) => {
      const selectedFilePath = selectedDiffFile?.sectionKey.replace(/^(staged|unstaged):/, "");
      if (!isGitChangeRelevant(change, multiDiff.repoPath ?? rootFolderPath, selectedFilePath)) {
        return;
      }
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void refreshWorkingTreeBuffer();
      }, 50);
    });

    return () => {
      unsubscribe();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [
    isWorkingTree,
    multiDiff.repoPath,
    refreshWorkingTreeBuffer,
    rootFolderPath,
    selectedDiffFile?.sectionKey,
  ]);

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
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      <Breadcrumb
        filePathOverride={multiDiff.title || "Uncommitted Changes"}
        interactive={false}
        showPath={false}
        showDefaultActions={false}
        extraLeftContent={
          <div className="ui-text-sm flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-subtle-foreground">
            <span className="shrink-0 font-medium text-foreground">
              {multiDiff.title || "Uncommitted Changes"}
            </span>
            <span className="truncate">{indexedFileLabel}</span>
            <span className="shrink-0 text-git-added">+{multiDiff.totalAdditions}</span>
            <span className="shrink-0 text-git-deleted">-{multiDiff.totalDeletions}</span>
            {isIndexingDiffs ? <span>{indexingLabel}</span> : null}
          </div>
        }
        rightContent={
          <div className="flex items-center gap-1">
            <BreadcrumbActionButton
              type="button"
              active={isFindVisible}
              onClick={() => setIsFindVisible(!isFindVisible)}
              tooltip="Search changes"
              tooltipSide="bottom"
              aria-label="Search changes"
            >
              <Search />
            </BreadcrumbActionButton>
            {!isWorkingTree ? (
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
            ) : null}
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

      {isFindVisible && isActiveMultiDiff ? (
        <SearchPopover
          value={searchQuery}
          onChange={setSearchQuery}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setIsFindVisible(false);
            } else if (event.key === "Enter") {
              event.preventDefault();
              navigateSearch(event.shiftKey ? -1 : 1);
            }
          }}
          onClose={() => setIsFindVisible(false)}
          placeholder="Search changes"
          inputRef={searchInputRef}
          matchLabel={
            searchQuery
              ? isInvalidSearch
                ? "Invalid expression"
                : searchMatches.length > 0
                  ? `${currentSearchMatchIndex + 1} of ${searchMatches.length}`
                  : "No results"
              : null
          }
          matchTone={
            isInvalidSearch || (searchQuery.length > 0 && searchMatches.length === 0)
              ? "warning"
              : "default"
          }
          onNext={() => navigateSearch(1)}
          onPrevious={() => navigateSearch(-1)}
          canNavigate={searchMatches.length > 0}
          options={[
            {
              id: "case-sensitive",
              label: "Match case",
              icon: SEARCH_TOGGLE_ICONS.caseSensitive,
              active: searchOptions.caseSensitive,
              onToggle: () =>
                setSearchOptions((current) => ({
                  ...current,
                  caseSensitive: !current.caseSensitive,
                })),
            },
            {
              id: "whole-word",
              label: "Match whole word",
              icon: SEARCH_TOGGLE_ICONS.wholeWord,
              active: searchOptions.wholeWord,
              onToggle: () =>
                setSearchOptions((current) => ({
                  ...current,
                  wholeWord: !current.wholeWord,
                })),
            },
            {
              id: "regex",
              label: "Use regular expression",
              icon: SEARCH_TOGGLE_ICONS.regex,
              active: searchOptions.useRegex,
              onToggle: () =>
                setSearchOptions((current) => ({
                  ...current,
                  useRegex: !current.useRegex,
                })),
            },
          ]}
          className="absolute top-9 right-2 z-50 max-w-[calc(100%-1rem)]"
        />
      ) : null}

      {!isWorkingTree &&
      (multiDiff.commitMessage || multiDiff.commitAuthor || multiDiff.commitDate) ? (
        <div className="border-border/60 border-b bg-background px-4 py-3">
          <div className="max-w-4xl">
            {multiDiff.commitMessage ? (
              <div className="ui-text-base font-medium leading-snug text-foreground">
                {multiDiff.commitMessage}
              </div>
            ) : null}
            {multiDiff.commitDescription ? (
              <div className="ui-text-sm mt-1 whitespace-pre-wrap leading-relaxed text-subtle-foreground">
                {multiDiff.commitDescription}
              </div>
            ) : null}
            <div className="ui-text-sm mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-subtle-foreground">
              {multiDiff.commitAuthor ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Avatar name={multiDiff.commitAuthor} className="size-5" />
                  {multiDiff.commitAuthor}
                </span>
              ) : null}
              {multiDiff.commitDate ? (
                <span>{formatRelativeDate(multiDiff.commitDate)}</span>
              ) : null}
              <code className="font-mono text-subtle-foreground" title={multiDiff.commitHash}>
                {multiDiff.commitHash.slice(0, 7)}
              </code>
            </div>
          </div>
        </div>
      ) : null}

      {isIndexingDiffs && multiDiff.files.length === 0 ? (
        <Empty className="rounded-none bg-background" role="status" aria-live="polite">
          <EmptyDescription>{indexingLabel}</EmptyDescription>
        </Empty>
      ) : null}

      {isIndexingDiffs && multiDiff.files.length === 0 ? null : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {!isWorkingTree && isFileTreeVisible ? (
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
            ref={diffStackScrollRef}
            className="min-h-0 flex-1 overflow-auto"
            style={{ overflowAnchor: "none" }}
            data-diff-stack-scroll-container
          >
            {isWorkingTree ? (
              selectedDiffFile ? (
                <div
                  key={selectedDiffFile.sectionKey}
                  ref={(node) => registerSectionElement(selectedDiffFile.sectionKey, node)}
                  className="min-w-0 max-w-full overflow-hidden bg-background"
                >
                  <DiffFileBody
                    diff={selectedDiffFile.diff}
                    sectionKey={selectedDiffFile.sectionKey}
                    viewMode={viewMode}
                    showWhitespace={showWhitespace}
                    searchMatches={
                      isFindVisible
                        ? searchMatches.filter(
                            (match) => match.sectionKey === selectedDiffFile.sectionKey,
                          )
                        : []
                    }
                    currentSearchMatch={isFindVisible ? currentSearchMatch : null}
                    searchQuery={isFindVisible ? searchQuery : ""}
                    searchOptions={searchOptions}
                  />
                </div>
              ) : (
                <Empty className="h-full rounded-none bg-background">
                  <EmptyDescription>No changed file selected</EmptyDescription>
                </Empty>
              )
            ) : (
              <div className="flex min-w-0 max-w-full flex-col">
                {multiDiff.files.map((diff, index) => {
                  const sectionKey = getMultiDiffSectionKey(multiDiff, diff, index);
                  const sectionSearchMatches = searchMatches.filter(
                    (match) => match.sectionKey === sectionKey,
                  );

                  return (
                    <div key={sectionKey} ref={(node) => registerSectionElement(sectionKey, node)}>
                      <DiffFileSection
                        diff={diff}
                        sectionKey={sectionKey}
                        expanded={expandedFiles.has(sectionKey)}
                        viewMode={viewMode}
                        showWhitespace={showWhitespace}
                        searchMatches={isFindVisible ? sectionSearchMatches : []}
                        currentSearchMatch={isFindVisible ? currentSearchMatch : null}
                        searchQuery={isFindVisible ? searchQuery : ""}
                        searchOptions={searchOptions}
                        onToggle={handleToggleSection}
                        onOpenFile={handleOpenFile}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default GitDiffEditorStack;
