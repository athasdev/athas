import type { RefObject } from "react";
import { FileResultsWorkspace } from "@/features/file-explorer/components/file-results-workspace";
import {
  type FileNavigatorItem,
  type FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import type { SearchExcerpt } from "../utils/search-excerpts";
import { SearchExcerptResults } from "./search-excerpt-results";

interface GlobalSearchResultsProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  fileNavigatorItems: FileNavigatorItem[];
  selectedFileNavigatorKey: string | null;
  onFileNavigatorSelect: (filePath: string) => void;
  fileNavigatorViewMode: FileNavigatorViewMode;
  onFileNavigatorViewModeChange: (viewMode: FileNavigatorViewMode) => void;
  navigatorSearchResetKey: string;
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

export function GlobalSearchResults({
  scrollContainerRef,
  loadMoreRef,
  fileNavigatorItems,
  selectedFileNavigatorKey,
  onFileNavigatorSelect,
  fileNavigatorViewMode,
  onFileNavigatorViewModeChange,
  navigatorSearchResetKey,
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
  return (
    <FileResultsWorkspace
      items={fileNavigatorItems}
      selectedKey={selectedFileNavigatorKey}
      onSelect={onFileNavigatorSelect}
      ariaLabel="Search result files"
      viewMode={fileNavigatorViewMode}
      onViewModeChange={onFileNavigatorViewModeChange}
      navigatorSearchResetKey={navigatorSearchResetKey}
      scrollContainerRef={scrollContainerRef}
      orientation="both"
    >
      <div className="min-w-0 max-w-full">
        <SearchExcerptResults
          excerpts={excerpts}
          selectedItemKey={selectedItemKey}
          onOpen={onOpen}
          onExpandContext={onExpandContext}
          onCollapseContext={onCollapseContext}
          isContextExpanded={isContextExpanded}
        />
      </div>
      {hasMore ? (
        <div ref={loadMoreRef} className="ui-text-sm px-3 py-3 text-center text-subtle-foreground">
          {isLoadingMore
            ? "Loading more results"
            : `Showing ${displayedCount} of ${hasMoreResults ? `${totalMatches}+` : totalMatches} results`}
        </div>
      ) : null}
    </FileResultsWorkspace>
  );
}
