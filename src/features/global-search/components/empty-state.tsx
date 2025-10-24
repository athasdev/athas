import { CommandEmpty } from "@/components/ui/command";

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
    if (isIndexing) {
      return "Indexing project files...";
    }
    if (isLoadingFiles) {
      return "Loading files...";
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
      <div className="font-mono text-text-lighter">{getMessage()}</div>
    </CommandEmpty>
  );
};
