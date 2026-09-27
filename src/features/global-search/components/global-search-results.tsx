import { MinusIcon, PlusIcon } from "@/ui/icons";
import { type Ref, type RefCallback, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type MultibufferSection,
  MultibufferWorkspace,
  type MultibufferWorkspaceHandle,
} from "@/features/editor/components/multibuffer/multibuffer-workspace";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import {
  type FileNavigatorItem,
  type FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { Button } from "@/ui/button";
import type { SearchExcerpt } from "../utils/search-excerpts";
import { estimateSearchExcerptHeight } from "../utils/search-excerpt-virtualization";
import { SearchExcerptCode, type SearchExcerptTypography } from "./search-excerpt-code";

interface GlobalSearchResultsProps {
  workspaceRef: Ref<MultibufferWorkspaceHandle>;
  scrollContainerRef: RefCallback<HTMLDivElement>;
  loadMoreRef: RefCallback<HTMLDivElement> | Ref<HTMLDivElement | null>;
  fileNavigatorItems: FileNavigatorItem[];
  selectedFileNavigatorKey: string | null;
  onFileNavigatorSelect: (filePath: string) => void;
  fileNavigatorViewMode: FileNavigatorViewMode;
  onFileNavigatorViewModeChange: (viewMode: FileNavigatorViewMode) => void;
  navigatorSearchResetKey: string;
  showFileNavigator: boolean;
  onShowFileNavigatorChange: (visible: boolean) => void;
  excerpts: SearchExcerpt[];
  selectedItemKey: string | null;
  onOpen: (filePath: string, lineNumber?: number, columnNumber?: number) => void;
  onExpandContext: (filePath: string) => void;
  onCollapseContext: (filePath: string) => void;
  isContextExpanded: (filePath: string) => boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  displayedCount: number;
  totalMatches: number;
  hasMoreResults: boolean;
}

interface SearchExcerptBodyProps {
  excerpt: SearchExcerpt;
  selectedItemKey: string | null;
  typography: SearchExcerptTypography;
  onOpen: (filePath: string, lineNumber?: number, columnNumber?: number) => void;
}

function SearchExcerptBody({
  excerpt,
  selectedItemKey,
  typography,
  onOpen,
}: SearchExcerptBodyProps) {
  const selectedMatch =
    (selectedItemKey
      ? excerpt.matches.find((match) => match.itemKey === selectedItemKey)
      : undefined) ?? excerpt.matches[0];
  const selectedHighlightIndexes =
    selectedMatch?.itemKey === selectedItemKey ? selectedMatch.highlightIndexes : [];
  const openReadonlyLocation = useCallback(
    ({ line, column }: { line: number; column: number }) => {
      const mappedLine = excerpt.lineNumberMap[line];
      if (mappedLine === null || mappedLine === undefined) return;
      onOpen(excerpt.filePath, mappedLine, column + 1);
    },
    [excerpt.filePath, excerpt.lineNumberMap, onOpen],
  );

  return (
    <SearchExcerptCode
      excerpt={excerpt}
      selectedHighlightIndexes={selectedHighlightIndexes}
      shouldHighlightSyntax
      typography={typography}
      onOpenLocation={openReadonlyLocation}
    />
  );
}

export function GlobalSearchResults({
  workspaceRef,
  scrollContainerRef,
  loadMoreRef,
  fileNavigatorItems,
  selectedFileNavigatorKey,
  onFileNavigatorSelect,
  fileNavigatorViewMode,
  onFileNavigatorViewModeChange,
  navigatorSearchResetKey,
  showFileNavigator,
  onShowFileNavigatorChange,
  excerpts,
  selectedItemKey,
  onOpen,
  onExpandContext,
  onCollapseContext,
  isContextExpanded,
  hasMore,
  isLoadingMore,
  displayedCount,
  totalMatches,
  hasMoreResults,
}: GlobalSearchResultsProps) {
  const editorSettings = useEditorSettingsStore(
    useShallow((state) => ({
      fontSize: state.fontSize,
      fontFamily: state.fontFamily,
      lineHeight: state.lineHeight,
      tabSize: state.tabSize,
      lineNumbers: state.lineNumbers,
    })),
  );
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const typography = useMemo<SearchExcerptTypography>(() => {
    const fontSize = editorSettings.fontSize * zoomLevel;
    return {
      fontSize,
      fontFamily: editorSettings.fontFamily,
      lineHeight: calculateLineHeight(fontSize, editorSettings.lineHeight),
      tabSize: editorSettings.tabSize,
      showLineNumbers: editorSettings.lineNumbers,
    };
  }, [editorSettings, zoomLevel]);
  const selectedExcerptId = useMemo(() => {
    if (!selectedItemKey) return null;

    for (const excerpt of excerpts) {
      for (const match of excerpt.matches) {
        if (match.itemKey === selectedItemKey) return excerpt.id;
      }
    }

    return null;
  }, [excerpts, selectedItemKey]);

  const sections = useMemo<MultibufferSection[]>(
    () =>
      excerpts.map((excerpt) => {
        const excerptSelectedItemKey = excerpt.id === selectedExcerptId ? selectedItemKey : null;
        const selectedMatch =
          (excerptSelectedItemKey
            ? excerpt.matches.find((match) => match.itemKey === excerptSelectedItemKey)
            : undefined) ?? excerpt.matches[0];
        const isExpanded = isContextExpanded(excerpt.filePath);

        return {
          key: excerpt.id,
          path: excerpt.displayPath || excerpt.filePath,
          iconPath: excerpt.filePath,
          estimatedHeight: estimateSearchExcerptHeight(excerpt, typography.lineHeight),
          onOpen: selectedMatch
            ? () => onOpen(excerpt.filePath, selectedMatch.targetLine, selectedMatch.targetColumn)
            : undefined,
          trailing: (
            <>
              {selectedMatch ? <span>:{selectedMatch.targetLine}</span> : null}
              <span>
                {excerpt.matchCount} {excerpt.matchCount === 1 ? "match" : "matches"}
              </span>
            </>
          ),
          actions: (
            <Button
              type="button"
              variant="ghost"
              iconOnly
              onClick={(event) => {
                event.stopPropagation();
                if (isExpanded) onCollapseContext(excerpt.filePath);
                else onExpandContext(excerpt.filePath);
              }}
              tooltip={isExpanded ? "Collapse context" : "Expand context"}
              aria-label={isExpanded ? "Collapse context" : "Expand context"}
            >
              {isExpanded ? <MinusIcon size={14} /> : <PlusIcon size={14} />}
            </Button>
          ),
          render: () => (
            <SearchExcerptBody
              excerpt={excerpt}
              selectedItemKey={excerptSelectedItemKey}
              typography={typography}
              onOpen={onOpen}
            />
          ),
        };
      }),
    [
      excerpts,
      isContextExpanded,
      onCollapseContext,
      onExpandContext,
      onOpen,
      selectedExcerptId,
      selectedItemKey,
      typography,
    ],
  );

  return (
    <MultibufferWorkspace
      ref={workspaceRef}
      sections={sections}
      navigatorItems={fileNavigatorItems}
      selectedKey={selectedFileNavigatorKey}
      onSelect={onFileNavigatorSelect}
      navigatorLabel="Search result files"
      navigatorOpen={showFileNavigator}
      onNavigatorOpenChange={onShowFileNavigatorChange}
      navigatorViewMode={fileNavigatorViewMode}
      onNavigatorViewModeChange={onFileNavigatorViewModeChange}
      navigatorSearchResetKey={navigatorSearchResetKey}
      scrollContainerRef={scrollContainerRef}
      footer={
        hasMore ? (
          <div
            ref={loadMoreRef}
            className="ui-text-sm px-3 py-3 text-center text-subtle-foreground"
          >
            {isLoadingMore
              ? "Loading more results"
              : `Showing ${displayedCount} of ${hasMoreResults ? `${totalMatches}+` : totalMatches} results`}
          </div>
        ) : null
      }
    />
  );
}
