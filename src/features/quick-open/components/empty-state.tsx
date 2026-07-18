import { CommandEmpty } from "@/ui/command";
import { Spinner } from "@/ui/spinner";

interface EmptyStateProps {
  isLoadingFiles: boolean;
  isIndexing: boolean;
  debouncedQuery: string;
  query: string;
  filesLength: number;
  hasRootFolder: boolean;
}

export const EmptyState = ({
  isLoadingFiles,
  isIndexing,
  debouncedQuery,
  query,
  filesLength,
  hasRootFolder,
}: EmptyStateProps) => {
  const getMessage = () => {
    if (!hasRootFolder) {
      return "Open a folder to start searching files";
    }
    if (debouncedQuery) {
      return "No matching files found";
    }
    if (query) {
      return "Searching...";
    }
    if (filesLength === 0) {
      return "No files found in project";
    }
    return "No files available";
  };

  return (
    <CommandEmpty>
      <div className="font-sans text-text-lighter">
        {isIndexing ? (
          <Spinner label="Indexing project files" showLabel compact />
        ) : isLoadingFiles ? (
          <Spinner label="Loading files" showLabel compact />
        ) : (
          getMessage()
        )}
      </div>
    </CommandEmpty>
  );
};
