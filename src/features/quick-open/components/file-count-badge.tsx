import { CommandHeaderBadge } from "@/ui/command";

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

  return <CommandHeaderBadge>{displayText}</CommandHeaderBadge>;
};
