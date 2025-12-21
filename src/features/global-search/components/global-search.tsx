import { X } from "lucide-react";
import { CommandInput, CommandList } from "@/ui/command";
import { cn } from "@/utils/cn";
import { useGlobalSearch } from "../hooks/use-global-search";
import { EmptyState } from "./empty-state";
import { FileCountBadge } from "./file-count-badge";
import { FileListItem } from "./file-list-item";
import { FilePreview } from "./file-preview";

const GlobalSearch = () => {
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
    handlePreviewChange,
    previewFilePath,
    rootFolderPath,
    showPreview,
  } = useGlobalSearch();

  if (!isVisible) {
    return null;
  }

  const hasResults =
    openBufferFiles.length > 0 || recentFilesInResults.length > 0 || otherFiles.length > 0;
  const totalResults = openBufferFiles.length + recentFilesInResults.length + otherFiles.length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16">
      {/* Backdrop - click to close */}
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/20"
        onClick={onClose}
        aria-label="Close global search"
        tabIndex={-1}
      />

      <div
        data-global-search
        className={cn(
          "relative flex overflow-hidden rounded-md border border-border bg-primary-bg shadow-2xl",
          showPreview ? "h-[480px] w-[900px]" : "h-[320px] w-[520px]",
        )}
      >
        {/* Left Column - File List */}
        <div
          className={cn(
            "flex flex-col border-border",
            showPreview ? "w-[450px] border-r" : "w-full",
          )}
        >
          {/* Header */}
          <div className="border-border border-b">
            <div className="flex items-center gap-3 px-4 py-3">
              <CommandInput
                ref={inputRef}
                value={query}
                onChange={setQuery}
                placeholder="Search files globally..."
                className="ui-font"
              />
              <FileCountBadge
                totalFiles={files.length}
                resultCount={totalResults}
                hasQuery={!!debouncedQuery}
                isLoading={isLoadingFiles}
              />
              <button onClick={onClose} className="rounded p-0.5 transition-colors hover:bg-hover">
                <X size={12} className="text-text-lighter" />
              </button>
            </div>
          </div>

          {/* File List */}
          <CommandList ref={scrollContainerRef}>
            {!hasResults ? (
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
                {/* Open Buffers Section */}
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
                        onMouseEnter={() => handlePreviewChange(file.path)}
                        rootFolderPath={rootFolderPath}
                      />
                    ))}
                  </div>
                )}

                {/* Recent Files Section */}
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
                          onMouseEnter={() => handlePreviewChange(file.path)}
                          rootFolderPath={rootFolderPath}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Other Files Section */}
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
                          onMouseEnter={() => handlePreviewChange(file.path)}
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

        {/* Right Column - Preview Pane */}
        {showPreview && (
          <div className="w-[450px] shrink-0">
            <FilePreview filePath={previewFilePath} />
          </div>
        )}
      </div>
    </div>
  );
};

export default GlobalSearch;
