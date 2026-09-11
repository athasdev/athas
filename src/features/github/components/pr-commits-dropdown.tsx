import { openCommitDiffBuffer } from "@/features/git/utils/open-commit-diff-buffer";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuItem,
  DropdownMenuSearch,
  DropdownMenuTrigger,
  DropdownMenuViewport,
} from "@/ui/dropdown";
import { useMenuSearch } from "@/ui/menu-search";
import { ChevronDownIcon, GitCommitIcon } from "@/ui/icons";
import { toast } from "sonner";
import type { Commit } from "../types/github-pr-viewer.types";
import { getTimeAgo } from "../utils/github-viewer-utils";

interface PRCommitsDropdownProps {
  commits: Commit[];
  repoPath?: string;
}

function getCommitAuthor(commit: Commit) {
  const author = commit.authors[0];
  return author?.login || author?.name || "Unknown";
}

export function PRCommitsDropdown({ commits, repoPath }: PRCommitsDropdownProps) {
  const search = useMenuSearch();
  const commitLabel = commits.length === 1 ? "commit" : "commits";
  const filteredCommits = search.filter(commits, (commit) => [
    commit.messageHeadline,
    commit.messageBody,
    commit.oid,
    ...commit.authors.flatMap((author) => [author.login, author.name, author.email]),
  ]);

  const openCommit = async (commit: Commit) => {
    if (!repoPath || !commit.oid) {
      toast.error("Commit diff is not available.");
      return;
    }

    const bufferId = await openCommitDiffBuffer({
      repoPath,
      commitHash: commit.oid,
      message: commit.messageHeadline,
      description: commit.messageBody,
      author: getCommitAuthor(commit),
      date: commit.authoredDate,
    });

    if (!bufferId) toast.error("Commit diff is not available.");
  };

  return (
    <DropdownMenu {...search.menuProps}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="chrome"
            aria-label={`Show ${commits.length} ${commitLabel}`}
          />
        }
      >
        <GitCommitIcon />
        <span>{`Commits ${commits.length}`}</span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="panel" viewport="searchable">
        <DropdownMenuSearch
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          placeholder="Search commits"
          autoFocus
        />
        <DropdownMenuViewport>
          {filteredCommits.length > 0 ? (
            filteredCommits.map((commit) => (
              <DropdownMenuItem
                key={commit.oid}
                className="items-start"
                disabled={!repoPath}
                onClick={() => void openCommit(commit)}
              >
                <GitCommitIcon className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground">{commit.messageHeadline}</span>
                  <span className="block truncate text-subtle-foreground">
                    {`${getCommitAuthor(commit)} · ${getTimeAgo(commit.authoredDate)}`}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-subtle-foreground">
                  {commit.oid.slice(0, 7)}
                </span>
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuEmpty>
              {commits.length === 0 ? "No commits" : "No commits match"}
            </DropdownMenuEmpty>
          )}
        </DropdownMenuViewport>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
