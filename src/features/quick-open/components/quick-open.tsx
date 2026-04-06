import { FilePreview } from "@/features/global-search/components/file-preview";
import Command, { CommandHeader, CommandInput, CommandList } from "@/ui/command";
import { cn } from "@/utils/cn";
import { useQuickOpen } from "../hooks/use-quick-open";
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
    previewFilePath,
    rootFolderPath,
    showPreview,
    isSymbolMode,
    symbols,
    isLoadingSymbols,
    handleSymbolSelect,
  } = useQuickOpen();

  if (!isVisible) {
    return null;
  }

  const hasResults =
    openBufferFiles.length > 0 || recentFilesInResults.length > 0 || otherFiles.length > 0;
  const totalResults = openBufferFiles.length + recentFilesInResults.length + otherFiles.length;

  return (
    <Command
      isVisible={isVisible}
      onClose={onClose}
      className={cn(
        "overflow-hidden",
        showPreview ? "h-[520px] max-h-[520px] w-[980px]" : "max-h-80",
      )}
    >
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          placeholder={isSymbolMode ? "Type to filter symbols..." : "Type to search files..."}
          className="ui-font"
        />
        {isSymbolMode ? (
          <span className="ui-font ui-text-xs shrink-0 text-text-lighter">
            {isLoadingSymbols ? "..." : `${symbols.length} symbols`}
          </span>
        ) : (
          <FileCountBadge
            totalFiles={files.length}
            resultCount={totalResults}
            hasQuery={!!debouncedQuery}
            isLoading={isLoadingFiles}
          />
        )}
      </CommandHeader>

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden",
            showPreview ? "border-border border-r" : "w-full",
          )}
        >
          <CommandList ref={scrollContainerRef}>
            {isSymbolMode ? (
              symbols.length === 0 ? (
                <div className="flex items-center justify-center p-4 text-text-lighter">
                  <span className="ui-font ui-text-sm">
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
                        />
                      );
                    })}
                  </div>
                )}

                {otherFiles.length > 0 && (
                  <div className="p-0">
                    {otherFiles.map((file, index) => {
                      const globalIndex =
                        openBufferFiles.length + recentFilesInResults.length + index;
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
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </CommandList>
        </div>

        {showPreview && (
          <div className="w-[460px] shrink-0">
            <FilePreview filePath={previewFilePath} />
          </div>
        )}
      </div>
    </Command>
  );
};

export default QuickOpen;
