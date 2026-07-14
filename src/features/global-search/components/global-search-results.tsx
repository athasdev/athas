import type { RefObject } from "react";
import {
  FileNavigatorSidebar,
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
    <div className="flex h-full min-h-0 overflow-hidden">
      <FileNavigatorSidebar
        items={fileNavigatorItems}
        selectedKey={selectedFileNavigatorKey}
        onSelect={onFileNavigatorSelect}
        ariaLabel="Search result files"
        viewMode={fileNavigatorViewMode}
        onViewModeChange={onFileNavigatorViewModeChange}
        borderless
        searchMode="fuzzy"
        compactRows
        searchResetKey={navigatorSearchResetKey}
        className="my-2 ml-2 h-auto self-stretch rounded-xl border border-border/70 bg-secondary-bg/20"
      />
      <div
        ref={scrollContainerRef}
        className="custom-scrollbar-thin min-h-0 flex-1 overflow-auto bg-primary-bg px-2 pb-2"
        style={{ overflowAnchor: "none" }}
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
          <div ref={loadMoreRef} className="ui-text-sm px-3 py-3 text-center text-text-lighter">
            {isLoadingMore
              ? "Loading more results"
              : `Showing ${displayedCount} of ${hasMoreResults ? `${totalMatches}+` : totalMatches} results`}
          </div>
        ) : null}
      </div>
    </div>
  );
}
