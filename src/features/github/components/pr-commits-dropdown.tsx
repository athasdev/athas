import { useMemo, useState } from "react";
import { openCommitDiffBuffer } from "@/features/git/utils/open-commit-diff-buffer";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSearch,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { CaretDownIcon, GitCommitIcon } from "@/ui/icons";
import { matchesSearchQuery } from "@/utils/search-match";
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
  const [query, setQuery] = useState("");
  const commitLabel = commits.length === 1 ? "commit" : "commits";
  const filteredCommits = useMemo(
    () =>
      commits.filter((commit) =>
        matchesSearchQuery(query, [
          commit.messageHeadline,
          commit.messageBody,
          commit.oid,
          ...commit.authors.flatMap((author) => [author.login, author.name, author.email]),
        ]),
      ),
    [commits, query],
  );

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
    <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            shape="pill"
            aria-label={`Show ${commits.length} ${commitLabel}`}
          />
        }
      >
        <GitCommitIcon />
        <span>{`Commits ${commits.length}`}</span>
        <CaretDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-96 max-w-[calc(100vw-1rem)]">
        <DropdownMenuSearch
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commits"
          autoFocus
        />
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
          <DropdownMenuLabel>
            {commits.length === 0 ? "No commits" : "No commits match"}
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
