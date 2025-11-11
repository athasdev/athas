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
    <div className="ui-font flex-shrink-0 rounded bg-secondary-bg px-2 py-0.5 text-[10px] text-text-lighter">
      {displayText}
    </div>
  );
};
