import { ArrowLeftIcon as ArrowLeft } from "@/ui/icons";
import { memo, useMemo } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import {
  SidebarListItem,
  SidebarPanel,
  SidebarScrollArea,
  SidebarSectionLabel,
  SidebarTitleBar,
} from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { formatRelativeDate } from "@/utils/date";
import { getBaseName, getDirName } from "@/utils/path-helpers";
import type { GitCommit, GitDiff } from "../types/git.types";
import { getGitAuthorAvatarUrl } from "../utils/git-author-avatar";
import { getFileStatus } from "../utils/git-diff-helpers";

interface GitCommitFilesPanelProps {
  commit: GitCommit;
  files: GitDiff[];
  selectedFilePath: string | null;
  isLoading: boolean;
  onBack: () => void;
  onSelectFile: (filePath: string) => void;
}

const statusTextClass: Record<string, string> = {
  added: "text-git-added",
  deleted: "text-git-deleted",
  modified: "text-git-modified",
  renamed: "text-git-renamed",
};

function getDiffStats(diff: GitDiff) {
  if (typeof diff.additions === "number" || typeof diff.deletions === "number") {
    return { additions: diff.additions ?? 0, deletions: diff.deletions ?? 0 };
  }

  let additions = 0;
  let deletions = 0;
  for (const line of diff.lines) {
    if (line.line_type === "added") additions++;
    if (line.line_type === "removed") deletions++;
  }
  return { additions, deletions };
}

export const GitCommitFilesPanel = memo(function GitCommitFilesPanel({
  commit,
  files,
  selectedFilePath,
  isLoading,
  onBack,
  onSelectFile,
}: GitCommitFilesPanelProps) {
  const account = useAuthStore((state) => state.user);
  const fileRows = useMemo(
    () =>
      files.map((diff) => {
        const path = diff.new_path || diff.old_path || diff.file_path;
        return {
          diff,
          path,
          fileName: getBaseName(path, path),
          directoryPath: getDirName(path),
          status: getFileStatus(diff),
          ...getDiffStats(diff),
        };
      }),
    [files],
  );
  const shortHash = commit.hash.slice(0, 7);
  const avatarUrl = getGitAuthorAvatarUrl(commit, account);

  return (
    <SidebarPanel>
      <SidebarTitleBar
        title={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="max-w-full justify-start px-1.5"
            aria-label="Back to Source Control history"
          >
            <ArrowLeft />
            <span className="truncate">Source Control</span>
          </Button>
        }
      >
        <code className="font-mono text-subtle-foreground" title={commit.hash}>
          {shortHash}
        </code>
      </SidebarTitleBar>

      <div className="shrink-0 border-border/60 border-b px-3 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar name={commit.author} src={avatarUrl} className="mt-0.5 size-7" />
          <div className="min-w-0 flex-1">
            <div
              className="line-clamp-2 font-medium leading-snug text-foreground"
              title={commit.message}
            >
              {commit.message}
            </div>
            <div className="ui-text-sm mt-1 flex min-w-0 items-center gap-2 text-subtle-foreground">
              <span className="truncate">{commit.author}</span>
              <span className="shrink-0">{formatRelativeDate(commit.date)}</span>
            </div>
            {commit.description ? (
              <div
                className="ui-text-sm mt-2 line-clamp-4 whitespace-pre-wrap leading-relaxed text-subtle-foreground"
                title={commit.description}
              >
                {commit.description}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {isLoading && fileRows.length === 0 ? (
        <EmptyState
          layout="sidebar"
          message={<Spinner label="Loading commit files" showLabel compact />}
        />
      ) : (
        <SidebarScrollArea className="min-h-0 flex-1">
          <SidebarSectionLabel>
            {fileRows.length} changed file{fileRows.length === 1 ? "" : "s"}
          </SidebarSectionLabel>
          {fileRows.length === 0 ? (
            <EmptyState layout="sidebar" message="No changed files" />
          ) : (
            <div className="space-y-0.5">
              {fileRows.map(({ path, fileName, directoryPath, status, additions, deletions }) => (
                <SidebarListItem
                  key={path}
                  active={selectedFilePath === path}
                  onClick={() => onSelectFile(path)}
                  title={path}
                  leading={
                    <ThemedFileIcon
                      fileName={path}
                      isDir={false}
                      className={statusTextClass[status]}
                    />
                  }
                  description={directoryPath || undefined}
                  trailing={
                    <span className="flex items-center gap-1 tabular-nums">
                      {additions > 0 ? <span className="text-git-added">+{additions}</span> : null}
                      {deletions > 0 ? (
                        <span className="text-git-deleted">-{deletions}</span>
                      ) : null}
                    </span>
                  }
                  aria-current={selectedFilePath === path ? "true" : undefined}
                >
                  {fileName}
                </SidebarListItem>
              ))}
            </div>
          )}
        </SidebarScrollArea>
      )}
    </SidebarPanel>
  );
});
