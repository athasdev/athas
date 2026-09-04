import { CommandEmpty, CommandItemBadge, CommandItemRow, CommandList } from "@/ui/command";
import { ClockCounterClockwiseIcon, GitDiffIcon } from "@/ui/icons";
import { formatRelativeDate } from "@/utils/date";
import { matchesSearchQuery } from "@/utils/search-match";
import type { GitCommit, GitFile } from "../types/git.types";

export function GitBrowseCommand({
  section,
  query,
  files,
  commits,
  onClose,
  onFileSelect,
  onCommitSelect,
}: {
  section: "changes" | "history";
  query: string;
  files: GitFile[];
  commits: GitCommit[];
  onClose: () => void;
  onFileSelect: (file: GitFile) => void;
  onCommitSelect: (commit: GitCommit) => void;
}) {
  const filteredFiles = files.filter((file) =>
    matchesSearchQuery(query.trim(), [file.path, file.status, file.staged ? "staged" : "unstaged"]),
  );
  const filteredCommits = commits.filter((commit) =>
    matchesSearchQuery(query.trim(), [
      commit.message,
      commit.description ?? "",
      commit.author,
      commit.hash,
    ]),
  );
  const isChanges = section === "changes";

  return (
    <CommandList>
      {isChanges ? (
        filteredFiles.length === 0 ? (
          <CommandEmpty>{query.trim() ? "No matching changes" : "Working tree clean"}</CommandEmpty>
        ) : (
          filteredFiles.map((file) => (
            <CommandItemRow
              key={`${file.staged}:${file.path}`}
              icon={<GitDiffIcon />}
              title={file.path}
              description={file.status}
              accessory={<CommandItemBadge>{file.staged ? "Staged" : "Unstaged"}</CommandItemBadge>}
              onClick={() => {
                onClose();
                onFileSelect(file);
              }}
            />
          ))
        )
      ) : filteredCommits.length === 0 ? (
        <CommandEmpty>{query.trim() ? "No matching commits" : "No commits"}</CommandEmpty>
      ) : (
        filteredCommits.map((commit) => (
          <CommandItemRow
            key={commit.hash}
            icon={<ClockCounterClockwiseIcon />}
            title={commit.message}
            description={`${commit.author} · ${formatRelativeDate(commit.date)}`}
            contentLayout="stacked"
            accessory={<CommandItemBadge>{commit.hash.slice(0, 7)}</CommandItemBadge>}
            onClick={() => {
              onClose();
              onCommitSelect(commit);
            }}
          />
        ))
      )}
    </CommandList>
  );
}
