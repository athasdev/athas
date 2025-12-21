import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { cn } from "@/utils/cn";
import { useGitHubStore } from "../store";
import type { Label, LinkedIssue, ReviewRequest } from "../types";
import GitHubMarkdown from "./github-markdown";
import {
  AssigneesList,
  CIStatusIndicator,
  LabelBadges,
  LinkedIssuesList,
  MergeStatusBadge,
  ReviewRequestsList,
} from "./pr-status";

interface FileDiff {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  lines: string[];
}

interface Commit {
  oid: string;
  messageHeadline: string;
  messageBody: string;
  authoredDate: string;
  authors: { login: string; name: string; email: string }[];
}

function parseDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const fileChunks = diffText.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split("\n");
    const headerLine = lines[0];

    const pathMatch = headerLine.match(/a\/(.+?) b\/(.+)/);
    if (!pathMatch) continue;

    const oldPath = pathMatch[1];
    const newPath = pathMatch[2];

    let additions = 0;
    let deletions = 0;
    const diffLines: string[] = [];

    let inDiff = false;
    for (const line of lines.slice(1)) {
      if (line.startsWith("@@")) {
        inDiff = true;
        diffLines.push(line);
        continue;
      }
      if (inDiff) {
        diffLines.push(line);
        if (line.startsWith("+") && !line.startsWith("+++")) {
          additions++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          deletions++;
        }
      }
    }

    files.push({
      path: newPath,
      oldPath: oldPath !== newPath ? oldPath : undefined,
      additions,
      deletions,
      lines: diffLines,
    });
  }

  return files;
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface DiffLineDisplayProps {
  line: string;
  index: number;
}

const DiffLineDisplay = memo(({ line, index }: DiffLineDisplayProps) => {
  let bgClass = "";
  let textClass = "text-text";

  if (line.startsWith("@@")) {
    bgClass = "bg-blue-500/10";
    textClass = "text-blue-400";
  } else if (line.startsWith("+")) {
    bgClass = "bg-green-500/10";
    textClass = "text-green-400";
  } else if (line.startsWith("-")) {
    bgClass = "bg-red-500/10";
    textClass = "text-red-400";
  }

  return (
    <div className={cn("px-4 py-0.5 font-mono text-xs", bgClass, textClass)}>
      <span className="mr-4 inline-block w-10 select-none text-right text-text-lighter/50">
        {index + 1}
      </span>
      <span className="whitespace-pre">{line || " "}</span>
    </div>
  );
});

DiffLineDisplay.displayName = "DiffLineDisplay";

interface FileDiffViewProps {
  file: FileDiff;
  defaultExpanded?: boolean;
}

const FileDiffView = memo(({ file, defaultExpanded = false }: FileDiffViewProps) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="border-border border-b">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-hover"
      >
        {isExpanded ? (
          <ChevronDown size={14} className="text-text-lighter" />
        ) : (
          <ChevronRight size={14} className="text-text-lighter" />
        )}
        <FileText size={14} className="text-text-lighter" />
        <span className="flex-1 truncate text-sm text-text">{file.path}</span>
        {file.oldPath && (
          <span className="text-text-lighter text-xs">(renamed from {file.oldPath})</span>
        )}
        <span className="text-green-500 text-xs">+{file.additions}</span>
        <span className="text-red-500 text-xs">-{file.deletions}</span>
      </button>
      {isExpanded && (
        <div className="max-h-[600px] overflow-y-auto border-border border-t bg-primary-bg">
          {file.lines.map((line, index) => (
            <DiffLineDisplay key={index} line={line} index={index} />
          ))}
        </div>
      )}
    </div>
  );
});

FileDiffView.displayName = "FileDiffView";

interface CommitItemProps {
  commit: Commit;
}

const CommitItem = memo(({ commit }: CommitItemProps) => {
  const author = commit.authors[0];
  const shortSha = commit.oid.slice(0, 7);

  return (
    <div className="flex items-start gap-3 border-border border-b px-4 py-3 hover:bg-hover/50">
      <GitCommit size={16} className="mt-0.5 shrink-0 text-text-lighter" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text">{commit.messageHeadline}</p>
        {commit.messageBody && (
          <p className="mt-1 text-text-lighter text-xs">{commit.messageBody}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-text-lighter text-xs">
          <span className="font-medium">{author?.login || author?.name || "Unknown"}</span>
          <span>committed {getTimeAgo(commit.authoredDate)}</span>
          <code className="rounded bg-primary-bg px-1.5 py-0.5 font-mono">{shortSha}</code>
        </div>
      </div>
    </div>
  );
});

CommitItem.displayName = "CommitItem";

interface PRViewerProps {
  prNumber: number;
}

type TabType = "description" | "files" | "commits" | "comments";

const PRViewer = memo(({ prNumber }: PRViewerProps) => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const { selectedPRDetails, selectedPRDiff, selectedPRComments, isLoadingDetails, detailsError } =
    useGitHubStore();
  const { selectPR, openPRInBrowser, checkoutPR } = useGitHubStore().actions;

  const [activeTab, setActiveTab] = useState<TabType>("description");

  // Load PR data when component mounts
  useEffect(() => {
    if (rootFolderPath && prNumber) {
      selectPR(rootFolderPath, prNumber);
    }
  }, [rootFolderPath, prNumber, selectPR]);

  const parsedDiff = useMemo(() => {
    if (!selectedPRDiff) return [];
    return parseDiff(selectedPRDiff);
  }, [selectedPRDiff]);

  const commits = useMemo(() => {
    if (!selectedPRDetails?.commits) return [];
    return selectedPRDetails.commits as Commit[];
  }, [selectedPRDetails?.commits]);

  const handleOpenInBrowser = useCallback(() => {
    if (rootFolderPath) {
      openPRInBrowser(rootFolderPath, prNumber);
    }
  }, [rootFolderPath, prNumber, openPRInBrowser]);

  const handleCheckout = useCallback(async () => {
    if (rootFolderPath) {
      try {
        await checkoutPR(rootFolderPath, prNumber);
      } catch (err) {
        console.error("Failed to checkout PR:", err);
      }
    }
  }, [rootFolderPath, prNumber, checkoutPR]);

  const handleRefresh = useCallback(() => {
    if (rootFolderPath) {
      selectPR(rootFolderPath, prNumber);
    }
  }, [rootFolderPath, prNumber, selectPR]);

  if (isLoadingDetails) {
    return (
      <div className="flex h-full flex-col bg-primary-bg">
        <div className="flex flex-1 items-center justify-center">
          <RefreshCw size={20} className="animate-spin text-text-lighter" />
          <span className="ml-2 text-sm text-text-lighter">Loading PR #{prNumber}...</span>
        </div>
      </div>
    );
  }

  if (detailsError) {
    return (
      <div className="flex h-full flex-col bg-primary-bg">
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
          <p className="text-error text-sm">{detailsError}</p>
          <button
            onClick={handleRefresh}
            className="mt-3 rounded bg-hover px-4 py-2 text-sm text-text hover:bg-selected"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!selectedPRDetails) {
    return null;
  }

  const pr = selectedPRDetails;

  return (
    <div className="flex h-full flex-col bg-primary-bg">
      {/* Header */}
      <div className="shrink-0 border-border border-b bg-secondary-bg px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <GitPullRequest
                size={18}
                className={cn(
                  "shrink-0",
                  pr.state === "MERGED"
                    ? "text-purple-500"
                    : pr.state === "CLOSED"
                      ? "text-red-500"
                      : "text-green-500",
                )}
              />
              <span className="shrink-0 text-sm text-text-lighter">#{pr.number}</span>
              <h1 className="truncate font-medium text-text">{pr.title}</h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-text-lighter text-xs">
              <span className="font-medium text-text-light">{pr.author.login}</span>
              <span>opened {getTimeAgo(pr.createdAt)}</span>
              <div className="flex items-center gap-1">
                <GitBranch size={12} />
                <span className="font-mono">
                  {pr.headRef} → {pr.baseRef}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {pr.isDraft && (
              <span className="mr-2 rounded bg-text-lighter/20 px-2 py-1 text-text-lighter text-xs">
                Draft
              </span>
            )}
            {pr.reviewDecision && (
              <span
                className={cn(
                  "mr-2 rounded px-2 py-1 text-xs",
                  pr.reviewDecision === "APPROVED"
                    ? "bg-green-500/20 text-green-500"
                    : pr.reviewDecision === "CHANGES_REQUESTED"
                      ? "bg-red-500/20 text-red-500"
                      : "bg-yellow-500/20 text-yellow-500",
                )}
              >
                {pr.reviewDecision === "APPROVED"
                  ? "Approved"
                  : pr.reviewDecision === "CHANGES_REQUESTED"
                    ? "Changes Requested"
                    : "Review Required"}
              </span>
            )}
            <button
              onClick={handleRefresh}
              className="rounded p-2 text-text-lighter hover:bg-hover hover:text-text"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={handleCheckout}
              className="rounded p-2 text-text-lighter hover:bg-hover hover:text-text"
              title="Checkout PR branch"
            >
              <GitBranch size={14} />
            </button>
            <button
              onClick={handleOpenInBrowser}
              className="rounded p-2 text-text-lighter hover:bg-hover hover:text-text"
              title="Open in browser"
            >
              <ExternalLink size={14} />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mt-3 flex items-center gap-4 text-xs">
          <span className="text-text-lighter">{pr.changedFiles} files changed</span>
          <span className="text-green-500">+{pr.additions}</span>
          <span className="text-red-500">-{pr.deletions}</span>
          <span className="text-text-lighter">{commits.length} commits</span>
        </div>
      </div>

      {/* Status bar */}
      {(pr.statusChecks?.length > 0 ||
        pr.mergeStateStatus ||
        pr.linkedIssues?.length > 0 ||
        pr.reviewRequests?.length > 0 ||
        pr.labels?.length > 0 ||
        pr.assignees?.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-border border-b bg-secondary-bg/50 px-4 py-2">
          {pr.statusChecks && pr.statusChecks.length > 0 && (
            <CIStatusIndicator checks={pr.statusChecks} />
          )}
          <MergeStatusBadge
            mergeStateStatus={pr.mergeStateStatus}
            mergeable={pr.mergeable}
            reviewDecision={pr.reviewDecision}
          />
          {pr.linkedIssues && pr.linkedIssues.length > 0 && (
            <LinkedIssuesList issues={pr.linkedIssues as LinkedIssue[]} />
          )}
          {pr.reviewRequests && pr.reviewRequests.length > 0 && (
            <ReviewRequestsList reviewRequests={pr.reviewRequests as ReviewRequest[]} />
          )}
          {pr.labels && pr.labels.length > 0 && <LabelBadges labels={pr.labels as Label[]} />}
          {pr.assignees && pr.assignees.length > 0 && <AssigneesList assignees={pr.assignees} />}
        </div>
      )}

      {/* Tabs */}
      <div className="flex shrink-0 border-border border-b bg-secondary-bg">
        <button
          onClick={() => setActiveTab("description")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-sm transition-colors",
            activeTab === "description"
              ? "border-accent border-b-2 text-text"
              : "text-text-lighter hover:text-text",
          )}
        >
          <FileText size={14} />
          Description
        </button>
        <button
          onClick={() => setActiveTab("files")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-sm transition-colors",
            activeTab === "files"
              ? "border-accent border-b-2 text-text"
              : "text-text-lighter hover:text-text",
          )}
        >
          <FileText size={14} />
          Files ({parsedDiff.length})
        </button>
        <button
          onClick={() => setActiveTab("commits")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-sm transition-colors",
            activeTab === "commits"
              ? "border-accent border-b-2 text-text"
              : "text-text-lighter hover:text-text",
          )}
        >
          <GitCommit size={14} />
          Commits ({commits.length})
        </button>
        <button
          onClick={() => setActiveTab("comments")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-sm transition-colors",
            activeTab === "comments"
              ? "border-accent border-b-2 text-text"
              : "text-text-lighter hover:text-text",
          )}
        >
          <MessageSquare size={14} />
          Comments ({selectedPRComments.length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Description Tab */}
        {activeTab === "description" && (
          <div className="p-4">
            {pr.body ? (
              <GitHubMarkdown content={pr.body} />
            ) : (
              <p className="text-sm text-text-lighter italic">No description provided</p>
            )}
          </div>
        )}

        {/* Files Tab */}
        {activeTab === "files" && (
          <div>
            {parsedDiff.length === 0 ? (
              <div className="flex items-center justify-center p-8">
                <p className="text-sm text-text-lighter">No file changes</p>
              </div>
            ) : (
              parsedDiff.map((file, index) => (
                <FileDiffView key={file.path} file={file} defaultExpanded={index === 0} />
              ))
            )}
          </div>
        )}

        {/* Commits Tab */}
        {activeTab === "commits" && (
          <div>
            {commits.length === 0 ? (
              <div className="flex items-center justify-center p-8">
                <p className="text-sm text-text-lighter">No commits</p>
              </div>
            ) : (
              commits.map((commit) => <CommitItem key={commit.oid} commit={commit} />)
            )}
          </div>
        )}

        {/* Comments Tab */}
        {activeTab === "comments" && (
          <div>
            {selectedPRComments.length === 0 ? (
              <div className="flex items-center justify-center p-8">
                <p className="text-sm text-text-lighter">No comments</p>
              </div>
            ) : (
              selectedPRComments.map((comment, index) => (
                <div key={index} className="border-border border-b px-4 py-3">
                  <div className="flex items-center gap-2 text-text-lighter text-xs">
                    <span className="font-medium text-text">{comment.author.login}</span>
                    <span>{formatDate(comment.createdAt)}</span>
                  </div>
                  <div className="mt-2">
                    <GitHubMarkdown content={comment.body} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
});

PRViewer.displayName = "PRViewer";

export default PRViewer;
