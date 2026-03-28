import Badge from "@/ui/badge";

interface FileCountBadgeProps {
  totalFiles: number;
  resultCount: number;
  hasQuery: boolean;
  isLoading: boolean;
}

export const FileCountBadge = ({
  totalFiles,
  resultCount,
  hasQuery,
  isLoading,
}: FileCountBadgeProps) => {
  if (isLoading || totalFiles === 0) return null;

  const displayText = hasQuery
    ? `${resultCount} / ${totalFiles}`
    : `${totalFiles} ${totalFiles === 1 ? "file" : "files"}`;

  return (
    <Badge variant="default" className="shrink-0 border-0 bg-secondary-bg text-text-lighter">
      {displayText}
    </Badge>
  );
};
