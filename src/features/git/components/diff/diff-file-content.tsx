import { lazy, memo, Suspense, useCallback, useMemo, type ComponentProps } from "react";
import { ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { calculateLineHeight, splitLines } from "@/features/editor/utils/lines";
import {
  buildSearchRegex,
  findAllMatches,
  type SearchOptions,
} from "@/features/editor/utils/search";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { useDiffEditorBuffer } from "../../hooks/use-diff-editor-buffer";
import type { GitDiff } from "../../types/git.types";
import {
  serializeGitDiffForEditor,
  serializeGitDiffSourceForEditor,
  serializeGitDiffSourceForSplitEditor,
} from "../../utils/diff-editor-content";
import {
  DIFF_INLINE_RENDER_LINE_THRESHOLD,
  shouldUseScrollableDiffEditor,
} from "../../utils/diff-viewer-scale";
import type { MultiDiffSearchMatch } from "../../utils/multi-diff-search";
import DiffLineBackgroundLayer from "./diff-line-background-layer";
import { BinaryDiffViewer } from "./git-diff-binary";
import ImageDiffViewer from "./git-diff-image";
import TextDiffViewer from "./git-diff-text";

const CodeEditor = lazy(() => import("@/features/editor/components/code-editor"));

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
};

function DiffCodeEditor(props: ComponentProps<typeof CodeEditor>) {
  return (
    <Suspense fallback={<ViewerLoadingState label="Preparing diff" layout="section" />}>
      <CodeEditor {...props} />
    </Suspense>
  );
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
      <DiffCodeEditor
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
    if (isAbsoluteProviderPath) return sourcePath;
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
          <DiffCodeEditor
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
          <DiffCodeEditor
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
      <DiffCodeEditor
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

export const DiffFileContent = memo(function DiffFileContent({
  diff,
  sectionKey,
  viewMode = "unified",
  showWhitespace = false,
  searchMatches = [],
  currentSearchMatch = null,
  searchQuery = "",
  searchOptions = DEFAULT_SEARCH_OPTIONS,
  canStageHunks = false,
}: {
  diff: GitDiff;
  sectionKey: string;
  viewMode?: "unified" | "split";
  showWhitespace?: boolean;
  searchMatches?: MultiDiffSearchMatch[];
  currentSearchMatch?: MultiDiffSearchMatch | null;
  searchQuery?: string;
  searchOptions?: SearchOptions;
  canStageHunks?: boolean;
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
      canStageHunks={canStageHunks}
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
