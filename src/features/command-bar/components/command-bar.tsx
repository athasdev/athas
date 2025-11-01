import Command, { CommandHeader, CommandInput, CommandList } from "@/ui/command";
import { useCommandBar } from "../hooks/use-command-bar";
import { EmptyState } from "./empty-state";
import { FileCountBadge } from "./file-count-badge";
import { FileListItem } from "./file-list-item";

const CommandBar = () => {
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
    rootFolderPath,
  } = useCommandBar();

  if (!isVisible) {
    return null;
  }

  const hasResults =
    openBufferFiles.length > 0 || recentFilesInResults.length > 0 || otherFiles.length > 0;
  const totalResults = openBufferFiles.length + recentFilesInResults.length + otherFiles.length;

  return (
    <Command isVisible={isVisible} className="max-h-80">
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          placeholder="Type to search files..."
          className="font-mono"
        />
        <FileCountBadge
          totalFiles={files.length}
          resultCount={totalResults}
          hasQuery={!!debouncedQuery}
          isLoading={isLoadingFiles}
        />
      </CommandHeader>

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
                  const globalIndex = openBufferFiles.length + recentFilesInResults.length + index;
                  return (
                    <FileListItem
                      key={`other-${file.path}`}
                      file={file}
                      category="other"
                      index={globalIndex}
                      isSelected={globalIndex === selectedIndex}
                      onClick={handleItemSelect}
                      rootFolderPath={rootFolderPath}
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

export default CommandBar;
