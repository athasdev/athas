import Command, {
  CommandHeader,
  CommandHeaderBadge,
  CommandInput,
  CommandList,
} from "@/ui/command";
import { useQuickOpen } from "../hooks/use-quick-open";
import { getWorkspaceSymbolKey } from "../hooks/use-workspace-symbol-search";
import { EmptyState } from "./empty-state";
import { FileCountBadge } from "./file-count-badge";
import { FileListItem } from "./file-list-item";
import { SymbolListItem } from "./symbol-list-item";

const QuickOpen = () => {
  const {
    isVisible,
    query,
    setQuery,
    debouncedQuery,
    inputRef,
    handleInputKeyDown,
    scrollContainerRef,
    onClose,
    files,
    isLoadingFiles,
    isIndexing,
    openBufferFiles,
    recentFilesInResults,
    otherFiles,
    selectedIndex,
    handleItemSelect,
    handleItemHover,
    setSelectedIndex,
    rootFolderPath,
    isSymbolMode,
    symbols,
    isLoadingSymbols,
    handleSymbolSelect,
    isWorkspaceSymbolMode,
    workspaceSymbols,
    isLoadingWorkspaceSymbols,
    handleWorkspaceSymbolSelect,
  } = useQuickOpen();

  if (!isVisible) {
    return null;
  }

  const hasResults =
    openBufferFiles.length > 0 || recentFilesInResults.length > 0 || otherFiles.length > 0;
  const totalResults = openBufferFiles.length + recentFilesInResults.length + otherFiles.length;
  const symbolSearchQuery = isSymbolMode || isWorkspaceSymbolMode ? query.slice(1).trim() : query;

  return (
    <Command isVisible={isVisible} onClose={onClose}>
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={handleInputKeyDown}
          placeholder={
            isSymbolMode
              ? "Type to filter symbols..."
              : isWorkspaceSymbolMode
                ? "Type to search symbols across the project..."
                : "Type to search files..."
          }
          className="font-sans"
        />
        {isSymbolMode ? (
          <CommandHeaderBadge>
            {isLoadingSymbols ? "..." : `${symbols.length} symbols`}
          </CommandHeaderBadge>
        ) : isWorkspaceSymbolMode ? (
          <CommandHeaderBadge>
            {isLoadingWorkspaceSymbols ? "..." : `${workspaceSymbols.length} symbols`}
          </CommandHeaderBadge>
        ) : (
          <FileCountBadge
            totalFiles={files.length}
            resultCount={totalResults}
            hasQuery={!!debouncedQuery}
            isLoading={isLoadingFiles}
          />
        )}
      </CommandHeader>

      <CommandList ref={scrollContainerRef}>
        {isSymbolMode ? (
          symbols.length === 0 ? (
            <div className="flex items-center justify-center p-4 text-text-lighter">
              <span className="font-sans ui-text-base">
                {isLoadingSymbols ? "Loading symbols..." : "No symbols found"}
              </span>
            </div>
          ) : (
            symbols.map((symbol, index) => (
              <SymbolListItem
                key={`${symbol.name}:${symbol.line}`}
                symbol={symbol}
                index={index}
                isSelected={index === selectedIndex}
                onClick={handleSymbolSelect}
                onMouseEnter={(idx) => setSelectedIndex(idx)}
                searchQuery={symbolSearchQuery}
              />
            ))
          )
        ) : isWorkspaceSymbolMode ? (
          workspaceSymbols.length === 0 ? (
            <div className="flex items-center justify-center p-4 text-text-lighter">
              <span className="font-sans ui-text-base">
                {isLoadingWorkspaceSymbols ? "Loading symbols..." : "No symbols found"}
              </span>
            </div>
          ) : (
            workspaceSymbols.map((symbol, index) => (
              <SymbolListItem
                key={getWorkspaceSymbolKey(symbol)}
                symbol={symbol}
                index={index}
                isSelected={index === selectedIndex}
                onClick={handleWorkspaceSymbolSelect}
                onMouseEnter={(idx) => setSelectedIndex(idx)}
                searchQuery={symbolSearchQuery}
                showFilePath
              />
            ))
          )
        ) : !hasResults ? (
          <EmptyState
            isLoadingFiles={isLoadingFiles}
            isIndexing={isIndexing}
            debouncedQuery={debouncedQuery}
            query={query}
            filesLength={files.length}
            hasRootFolder={!!rootFolderPath}
          />
        ) : (
          <>
            {openBufferFiles.length > 0 && (
              <div className="p-0">
                {openBufferFiles.map((file, index) => (
                  <FileListItem
                    key={`open-${file.path}`}
                    file={file}
                    category="open"
                    index={index}
                    isSelected={index === selectedIndex}
                    onClick={handleItemSelect}
                    onMouseEnter={handleItemHover}
                    rootFolderPath={rootFolderPath}
                    searchQuery={debouncedQuery}
                  />
                ))}
              </div>
            )}

            {recentFilesInResults.length > 0 && (
              <div className="p-0">
                {recentFilesInResults.map((file, index) => {
                  const globalIndex = openBufferFiles.length + index;
                  return (
                    <FileListItem
                      key={`recent-${file.path}`}
                      file={file}
                      category="recent"
                      index={globalIndex}
                      isSelected={globalIndex === selectedIndex}
                      onClick={handleItemSelect}
                      onMouseEnter={handleItemHover}
                      rootFolderPath={rootFolderPath}
                      searchQuery={debouncedQuery}
                    />
                  );
                })}
              </div>
            )}

            {otherFiles.length > 0 && (
              <div className="p-0">
                {otherFiles.map((file, index) => {
                  const globalIndex = openBufferFiles.length + recentFilesInResults.length + index;
                  return (
                    <FileListItem
                      key={`other-${file.path}`}
                      file={file}
                      category="other"
                      index={globalIndex}
                      isSelected={globalIndex === selectedIndex}
                      onClick={handleItemSelect}
                      onMouseEnter={handleItemHover}
                      rootFolderPath={rootFolderPath}
                      searchQuery={debouncedQuery}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </CommandList>
    </Command>
  );
};

export default QuickOpen;
