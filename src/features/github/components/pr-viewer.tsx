import {
  Check,
  CheckCircle2,
  Copy,
  FileCode2,
  ExternalLink,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  Search,
  SlidersHorizontal,
  User,
} from "lucide-react";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { ReactNode } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import Badge from "@/ui/badge";
import { Button, buttonVariants } from "@/ui/button";
import { toast } from "@/ui/toast";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { Tabs, type TabsItem } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import type { Commit, FilePatchState, FileStatusFilter, TabType } from "../types/pr-viewer";
import {
  buildDiffSectionIndex,
  copyToClipboard,
  EXPAND_ALL_EAGER_PATCH_LIMIT,
  EXPANDED_PATCH_BACKGROUND_BATCH,
  extractFilePatch,
  getCommentKey,
  normalizeCommit,
  resolveSafeRepoFilePath,
  toFileDiffFromMetadata,
} from "../utils/pr-viewer-utils";
import { useGitHubStore } from "../stores/github-store";
import { CommentItem } from "./comment-item";
import { CommitItem } from "./commit-item";
import { FileDiffView } from "./file-diff-view";
import GitHubMarkdown from "./github-markdown";

const prInlineButtonClass = cn(
  buttonVariants({ variant: "outline", size: "xs" }),
  "text-text-lighter",
);

interface PRViewerProps {
  prNumber: number;
}

interface OverviewFieldProps {
  icon?: ReactNode;
  children: ReactNode;
}

function OverviewField({ icon, children }: OverviewFieldProps) {
  return (
    <div className="ui-font ui-text-sm flex min-w-0 items-center gap-2 text-text-lighter">
      {icon ? <span className="shrink-0 text-text-lighter">{icon}</span> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const PRViewer = memo(({ prNumber }: PRViewerProps) => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const selectedRepoPath = useRepositoryStore.use.activeRepoPath();
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const buffers = useBufferStore.use.buffers();
  const {
    selectedPRDetails,
    selectedPRDiff,
    selectedPRFiles,
    selectedPRComments,
    isLoadingDetails,
    isLoadingContent,
    detailsError,
    contentError,
  } = useGitHubStore();
  const { selectPR, fetchPRContent, openPRInBrowser, checkoutPR } = useGitHubStore().actions;
  const repoPath = selectedRepoPath ?? rootFolderPath;

  const [activeTab, setActiveTab] = useState<TabType>("description");
  const [fileQuery, setFileQuery] = useState("");
  const [fileStatusFilter, setFileStatusFilter] = useState<FileStatusFilter>("all");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [filePatches, setFilePatches] = useState<Record<string, FilePatchState>>({});
  const patchLoadSeqRef = useRef(0);
  const [, startTabTransition] = useTransition();

  useEffect(() => {
    if (repoPath && prNumber) {
      void selectPR(repoPath, prNumber);
    }
  }, [repoPath, prNumber, selectPR]);

  useEffect(() => {
    setActiveTab("description");
    setExpandedFiles(new Set());
    setFilePatches({});
    patchLoadSeqRef.current += 1;
  }, [prNumber, repoPath]);

  useEffect(() => {
    if (!repoPath || !prNumber) return;
    if (activeTab === "files") {
      void fetchPRContent(repoPath, prNumber, { mode: "files" });
    } else if (activeTab === "comments") {
      void fetchPRContent(repoPath, prNumber, { mode: "comments" });
    }
  }, [activeTab, repoPath, prNumber, fetchPRContent]);

  useEffect(() => {
    if (!repoPath || !prNumber || !selectedPRDetails || activeTab !== "description") return;

    const requestIdle = (
      window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      }
    ).requestIdleCallback;

    const prefetch = () => {
      void fetchPRContent(repoPath, prNumber, { mode: "comments" });

      if ((selectedPRDetails.changedFiles ?? 0) <= 12) {
        void fetchPRContent(repoPath, prNumber, { mode: "files" });
      }
    };

    if (typeof requestIdle === "function") {
      requestIdle(prefetch, { timeout: 250 });
      return;
    }

    const timeoutId = window.setTimeout(prefetch, 120);
    return () => window.clearTimeout(timeoutId);
  }, [activeTab, fetchPRContent, prNumber, repoPath, selectedPRDetails]);

  useEffect(() => {
    if (!selectedPRDetails) return;

    const prBuffer = buffers.find(
      (buffer) => buffer.type === "pullRequest" && buffer.prNumber === selectedPRDetails.number,
    );
    if (!prBuffer || prBuffer.name === selectedPRDetails.title) return;

    useBufferStore.getState().actions.updateBuffer({
      ...prBuffer,
      name: selectedPRDetails.title,
    });
  }, [buffers, selectedPRDetails]);

  const baseDiffFiles = useMemo(() => {
    return selectedPRFiles.map(toFileDiffFromMetadata).filter((file) => file.path.length > 0);
  }, [selectedPRFiles]);

  const baseDiffByPath = useMemo(() => {
    return new Map(baseDiffFiles.map((file) => [file.path, file]));
  }, [baseDiffFiles]);

  const diffSectionIndex = useMemo(() => {
    return buildDiffSectionIndex(selectedPRDiff ?? "");
  }, [selectedPRDiff]);

  const diffFiles = useMemo(() => {
    return baseDiffFiles.map((file) => {
      const patch = filePatches[file.path];
      return {
        ...file,
        oldPath: patch?.data?.oldPath ?? file.oldPath,
        status: patch?.data?.status ?? file.status,
        lines: patch?.data?.lines,
      };
    });
  }, [baseDiffFiles, filePatches]);

  const commits = useMemo(() => {
    if (!Array.isArray(selectedPRDetails?.commits)) return [];
    return selectedPRDetails.commits
      .map((commit, index) => normalizeCommit(commit, index))
      .filter((commit): commit is Commit => !!commit);
  }, [selectedPRDetails?.commits]);

  const reviewerLogins = useMemo(() => {
    return (selectedPRDetails?.reviewRequests ?? []).map((reviewer) => `@${reviewer.login}`);
  }, [selectedPRDetails?.reviewRequests]);

  const passedChecksCount = useMemo(() => {
    return (selectedPRDetails?.statusChecks ?? []).filter(
      (check) => check.conclusion === "SUCCESS",
    ).length;
  }, [selectedPRDetails?.statusChecks]);

  const tabItems = useMemo<TabsItem[]>(() => {
    return [
      {
        id: "description",
        label: "Description",
        icon: <FileText />,
        isActive: activeTab === "description",
        onClick: () =>
          startTabTransition(() => {
            setActiveTab("description");
          }),
        tooltip: { content: "PR description", side: "bottom" },
      },
      {
        id: "files",
        label: (
          <span className="flex items-center gap-1.5">
            <span>Files</span>
            <Badge variant="muted" size="compact" shape="pill">
              {selectedPRDetails?.changedFiles || selectedPRFiles.length || 0}
            </Badge>
          </span>
        ),
        icon: <FileCode2 />,
        isActive: activeTab === "files",
        onClick: () =>
          startTabTransition(() => {
            setActiveTab("files");
          }),
        tooltip: { content: "Changed files and diff", side: "bottom" },
      },
      {
        id: "commits",
        label: (
          <span className="flex items-center gap-1.5">
            <span>Commits</span>
            <Badge variant="muted" size="compact" shape="pill">
              {commits.length}
            </Badge>
          </span>
        ),
        icon: <GitCommit />,
        isActive: activeTab === "commits",
        onClick: () =>
          startTabTransition(() => {
            setActiveTab("commits");
          }),
        tooltip: { content: "Commits in this PR", side: "bottom" },
      },
      {
        id: "comments",
        label: (
          <span className="flex items-center gap-1.5">
            <span>Comments</span>
            <Badge variant="muted" size="compact" shape="pill">
              {selectedPRComments.length}
            </Badge>
          </span>
        ),
        icon: <MessageSquare />,
        isActive: activeTab === "comments",
        onClick: () =>
          startTabTransition(() => {
            setActiveTab("comments");
          }),
        tooltip: { content: "Discussion and comments", side: "bottom" },
      },
    ];
  }, [
    activeTab,
    commits.length,
    selectedPRComments.length,
    selectedPRDetails?.changedFiles,
    selectedPRFiles.length,
    startTabTransition,
  ]);

  const deferredFileQuery = useDeferredValue(fileQuery);
  const filteredDiff = useMemo(() => {
    const query = deferredFileQuery.trim().toLowerCase();
    return diffFiles.filter((file) => {
      if (fileStatusFilter !== "all" && file.status !== fileStatusFilter) return false;
      if (!query) return true;
      return (
        file.path.toLowerCase().includes(query) ||
        file.oldPath?.toLowerCase().includes(query) ||
        false
      );
    });
  }, [diffFiles, deferredFileQuery, fileStatusFilter]);

  const handleOpenInBrowser = useCallback(() => {
    if (repoPath) {
      openPRInBrowser(repoPath, prNumber);
    }
  }, [repoPath, prNumber, openPRInBrowser]);

  const handleCheckout = useCallback(async () => {
    if (repoPath) {
      try {
        await checkoutPR(repoPath, prNumber);
      } catch (err) {
        console.error("Failed to checkout PR:", err);
      }
    }
  }, [repoPath, prNumber, checkoutPR]);

  const handleRefresh = useCallback(() => {
    if (repoPath) {
      void selectPR(repoPath, prNumber, { force: true });
      if (activeTab === "files") {
        void fetchPRContent(repoPath, prNumber, { force: true, mode: "files" });
      } else if (activeTab === "comments") {
        void fetchPRContent(repoPath, prNumber, {
          force: true,
          mode: "comments",
        });
      }
    }
  }, [activeTab, repoPath, prNumber, selectPR, fetchPRContent]);

  const handleCopyPRLink = useCallback(() => {
    if (!selectedPRDetails?.url) {
      toast.error("PR link is not available.");
      return;
    }
    void copyToClipboard(selectedPRDetails.url, "PR link copied");
  }, [selectedPRDetails?.url]);

  const handleCopyBranchName = useCallback(() => {
    if (!selectedPRDetails?.headRef) {
      toast.error("Branch name is not available.");
      return;
    }
    void copyToClipboard(selectedPRDetails.headRef, "Branch name copied");
  }, [selectedPRDetails?.headRef]);

  const loadFilePatch = useCallback(
    (path: string) => {
      if (!selectedPRDiff) return;
      let shouldSchedule = false;
      setFilePatches((prev) => {
        const existing = prev[path];
        if (existing?.loading || existing?.data) {
          return prev;
        }
        shouldSchedule = true;
        return {
          ...prev,
          [path]: { ...existing, loading: true, error: undefined },
        };
      });
      if (!shouldSchedule) return;

      const loadSeq = patchLoadSeqRef.current;
      const run = () => {
        try {
          const patch = extractFilePatch(selectedPRDiff, path, diffSectionIndex);
          if (patchLoadSeqRef.current !== loadSeq) return;

          setFilePatches((prev) => ({
            ...prev,
            [path]: {
              loading: false,
              data: patch ?? {
                path,
                status: baseDiffByPath.get(path)?.status ?? "modified",
                lines: [],
              },
            },
          }));
        } catch (error) {
          if (patchLoadSeqRef.current !== loadSeq) return;
          setFilePatches((prev) => ({
            ...prev,
            [path]: {
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        }
      };

      if (typeof window !== "undefined") {
        const requestIdle = (
          window as Window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
          }
        ).requestIdleCallback;
        if (typeof requestIdle === "function") {
          requestIdle(() => run(), { timeout: 120 });
          return;
        }
      }
      window.setTimeout(run, 0);
    },
    [selectedPRDiff, diffSectionIndex, baseDiffByPath],
  );

  const handleToggleFileExpanded = useCallback(
    (path: string) => {
      let shouldLoad = false;
      setExpandedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          shouldLoad = true;
        }
        return next;
      });

      if (shouldLoad) {
        loadFilePatch(path);
      }
    },
    [loadFilePatch],
  );

  const handleExpandAllFiles = useCallback(() => {
    const paths = filteredDiff.map((file) => file.path);
    setExpandedFiles(new Set(paths));

    for (const path of paths.slice(0, EXPAND_ALL_EAGER_PATCH_LIMIT)) {
      loadFilePatch(path);
    }
  }, [filteredDiff, loadFilePatch]);

  const handleCollapseAllFiles = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  useEffect(() => {
    if (activeTab !== "files" || !selectedPRDiff || expandedFiles.size === 0) return;

    const missingPatches = Array.from(expandedFiles).filter((path) => {
      const patchState = filePatches[path];
      return !patchState?.loading && !patchState?.data && !patchState?.error;
    });
    if (missingPatches.length === 0) return;

    for (const path of missingPatches.slice(0, EXPANDED_PATCH_BACKGROUND_BATCH)) {
      loadFilePatch(path);
    }
  }, [activeTab, expandedFiles, filePatches, selectedPRDiff, loadFilePatch]);

  const handleOpenChangedFile = useCallback(
    (relativePath: string) => {
      if (!repoPath) {
        toast.error("No repository selected.");
        return;
      }

      const fullPath = resolveSafeRepoFilePath(repoPath, relativePath);
      if (!fullPath) {
        toast.error("Invalid file path in diff.");
        return;
      }

      void handleFileSelect(fullPath, false);
    },
    [repoPath, handleFileSelect],
  );

  if (isLoadingDetails && !selectedPRDetails) {
    return (
      <div className="flex h-full flex-col bg-primary-bg">
        <div className="flex flex-1 items-center justify-center">
          <RefreshCw className="animate-spin text-text-lighter" />
          <span className="ml-2 ui-font ui-text-sm text-text-lighter">Loading PR #{prNumber}...</span>
        </div>
      </div>
    );
  }

  if (detailsError && !selectedPRDetails) {
    return (
      <div className="flex h-full flex-col bg-primary-bg">
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
          <p className="ui-font ui-text-sm text-error">{detailsError}</p>
          <Button onClick={handleRefresh} variant="secondary" size="sm" className="mt-3">
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!selectedPRDetails) {
    return null;
  }

  const isRefreshingDetails = isLoadingDetails && !!selectedPRDetails;
  const pr = selectedPRDetails;
  const changedFilesCount = pr.changedFiles || selectedPRFiles.length || 0;
  const checksSummary =
    pr.statusChecks?.length > 0 ? `${passedChecksCount} checks passed` : "No checks reported";
  const changesSummary = `${changedFilesCount} files +${pr.additions} -${pr.deletions}`;
  const metaItems = [
    pr.reviewDecision === "APPROVED"
      ? "Approved"
      : pr.reviewDecision === "CHANGES_REQUESTED"
        ? "Changes requested"
        : pr.reviewDecision === "REVIEW_REQUIRED"
          ? "Review required"
          : null,
    pr.mergeable === "CONFLICTING"
      ? "Has conflicts"
      : pr.mergeStateStatus === "BEHIND"
        ? "Behind base"
        : null,
    pr.isDraft ? "Draft" : null,
    pr.assignees?.length
      ? `Assigned ${pr.assignees.map((assignee) => `@${assignee.login}`).join(", ")}`
      : null,
    pr.linkedIssues?.length
      ? `Linked ${pr.linkedIssues.map((issue) => `#${issue.number}`).join(", ")}`
      : null,
    pr.labels?.length ? pr.labels.map((label) => label.name).join(", ") : null,
  ].filter((item): item is string => !!item);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-primary-bg">
      {isRefreshingDetails && (
        <div className="h-px w-full overflow-hidden bg-border">
          <div className="h-full w-1/3 animate-pulse bg-accent/70" />
        </div>
      )}

      <div className="shrink-0 px-3 py-4 sm:px-5">
        <div className="flex flex-col gap-4 border-border/60 border-b pb-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="ui-font ui-text-lg leading-tight font-medium text-text">{pr.title}</h1>
              <div className="ui-font ui-text-sm mt-1 flex flex-wrap items-center gap-x-2 text-text-lighter">
                <span>{`athas#${pr.number}`}</span>
                <span>&middot;</span>
                <span>{pr.baseRef}</span>
                <span>{`← ${pr.headRef}`}</span>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <Tooltip content="Refresh PR data" side="bottom">
                <Button
                  onClick={handleRefresh}
                  disabled={isRefreshingDetails}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh PR data"
                >
                  <RefreshCw className={isRefreshingDetails ? "animate-spin" : ""} />
                </Button>
              </Tooltip>
              <Tooltip content="Checkout PR branch" side="bottom">
                <Button
                  onClick={handleCheckout}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Checkout PR branch"
                >
                  <GitBranch />
                </Button>
              </Tooltip>
              <Tooltip content="Open on GitHub" side="bottom">
                <Button
                  onClick={handleOpenInBrowser}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open pull request in browser"
                >
                  <ExternalLink />
                </Button>
              </Tooltip>
              <Tooltip content="Copy PR link" side="bottom">
                <Button
                  onClick={handleCopyPRLink}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy PR link"
                >
                  <Copy />
                </Button>
              </Tooltip>
              <Tooltip content="Copy branch name" side="bottom">
                <Button
                  onClick={handleCopyBranchName}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy branch name"
                >
                  <GitBranch />
                </Button>
              </Tooltip>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <OverviewField icon={<User />}>
              <span className="inline-flex min-w-0 items-center gap-2">
                <img
                  src={
                    pr.author.avatarUrl ||
                    `https://github.com/${encodeURIComponent(pr.author.login || "github")}.png?size=32`
                  }
                  alt={pr.author.login}
                  className="size-4 shrink-0 rounded-full bg-secondary-bg"
                  loading="lazy"
                />
                <span className="truncate text-text-light">{pr.author.login}</span>
              </span>
            </OverviewField>
            <OverviewField icon={<FileCode2 />}>
              <span className="text-text-lighter">Changes </span>
              <span className="text-text-light">{changesSummary}</span>
            </OverviewField>
            <OverviewField icon={<Check />}>
              {pr.statusChecks?.length > 0 && <CheckCircle2 className="mr-1 inline text-green-500" />}
              <span className="text-text-light">{checksSummary}</span>
            </OverviewField>
            <OverviewField icon={<GitPullRequest />}>
              {pr.reviewRequests?.length > 0 ? (
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="text-text-lighter">Reviewers </span>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {pr.reviewRequests.slice(0, 3).map((reviewer) => (
                      <img
                        key={reviewer.login}
                        src={
                          reviewer.avatarUrl ||
                          `https://github.com/${encodeURIComponent(reviewer.login || "github")}.png?size=32`
                        }
                        alt={reviewer.login}
                        className="size-4 shrink-0 rounded-full bg-secondary-bg"
                        loading="lazy"
                      />
                    ))}
                    <span className="truncate text-text-light">{reviewerLogins.join(", ")}</span>
                  </span>
                </span>
              ) : (
                <span className="text-text-light">No reviewers</span>
              )}
            </OverviewField>
          </div>

          {metaItems.length > 0 && (
            <div className="ui-font ui-text-sm flex flex-wrap items-center gap-x-2 text-text-lighter">
              {metaItems.map((item, index) => (
                <span key={`${item}-${index}`} className="inline-flex items-center gap-x-2">
                  {index > 0 ? <span>&middot;</span> : null}
                  <span>{item}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {detailsError && (
        <div className="px-3 pb-3 sm:px-5">
          <div className="flex shrink-0 items-center justify-between gap-2 bg-error/8 px-1 py-2">
            <p className="ui-font ui-text-sm truncate text-error/90">{detailsError}</p>
            <Button
              onClick={handleRefresh}
              variant="outline"
              size="xs"
              className="shrink-0 border-error/40 text-error/90 hover:bg-error/10"
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      <div className="shrink-0 px-3 pb-3 sm:px-5">
        <Tabs items={tabItems} variant="pill" size="md" className="w-fit max-w-full overflow-x-auto" />
      </div>

      <div className="min-w-0 px-3 pb-4 sm:px-5">
        {activeTab === "description" && (
          <div className="min-w-0">
            {pr.body ? (
              <GitHubMarkdown
                content={pr.body}
                className="github-markdown-pr"
                contentClassName="github-markdown-pr-content"
              />
            ) : (
              <p className="ui-font ui-text-sm italic text-text-lighter">No description provided</p>
            )}
          </div>
        )}

        {activeTab === "files" && (
          <div className="min-w-0 space-y-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={handleExpandAllFiles}
                  className={prInlineButtonClass}
                  aria-label="Expand all files"
                >
                  Expand All
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={handleCollapseAllFiles}
                  className={prInlineButtonClass}
                  aria-label="Collapse all files"
                >
                  Collapse All
                </Button>
                <Badge shape="pill" className="text-text-lighter">
                  {filteredDiff.length} of {diffFiles.length} files
                </Badge>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                  placeholder="Search changed files..."
                  leftIcon={Search}
                  size="md"
                  className="w-full border-border/70 bg-primary-bg/70 sm:w-64"
                />
                <Select
                  value={fileStatusFilter}
                  onChange={(value) => setFileStatusFilter(value as FileStatusFilter)}
                  options={[
                    { value: "all", label: "All statuses" },
                    { value: "added", label: "Added" },
                    { value: "modified", label: "Modified" },
                    { value: "deleted", label: "Deleted" },
                    { value: "renamed", label: "Renamed" },
                  ]}
                  size="md"
                  leftIcon={SlidersHorizontal}
                  className="w-full border-border/70 bg-primary-bg/70 sm:w-44"
                />
              </div>
            </div>

            <div className="pt-1">
              {isLoadingContent && !selectedPRDiff ? (
                <div className="flex items-center justify-center p-8">
                  <RefreshCw className="animate-spin text-text-lighter" />
                  <span className="ml-2 ui-font ui-text-sm text-text-lighter">Loading diff...</span>
                </div>
              ) : contentError ? (
                <div className="flex items-center justify-center p-8 text-center">
                  <div>
                    <p className="ui-font ui-text-sm text-error">{contentError}</p>
                    <Button
                      onClick={handleRefresh}
                      variant="outline"
                      size="xs"
                      className="mt-2 border-error/40 text-error/90 hover:bg-error/10"
                    >
                      Retry
                    </Button>
                  </div>
                </div>
              ) : diffFiles.length === 0 ? (
                <div className="flex items-center justify-center p-8">
                  <p className="ui-font ui-text-sm text-text-lighter">No file changes</p>
                </div>
              ) : filteredDiff.length === 0 ? (
                <div className="flex items-center justify-center p-8">
                  <p className="ui-font ui-text-sm text-text-lighter">No files match your filters</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredDiff.map((file) => (
                    <FileDiffView
                      key={file.path}
                      file={file}
                      isExpanded={expandedFiles.has(file.path)}
                      onToggle={() => handleToggleFileExpanded(file.path)}
                      onOpenFile={handleOpenChangedFile}
                      isLoadingPatch={!!filePatches[file.path]?.loading}
                      patchError={filePatches[file.path]?.error}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "commits" && (
          <div className="pt-1">
            {commits.length === 0 ? (
              <div className="flex items-center justify-center p-8">
                <p className="ui-font ui-text-sm text-text-lighter">No commits</p>
              </div>
            ) : (
              <div className="space-y-1">
                {commits.map((commit) => (
                  <CommitItem key={commit.oid} commit={commit} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "comments" && (
          <div className="pt-1">
            {isLoadingContent && selectedPRComments.length === 0 ? (
              <div className="flex items-center justify-center p-8">
                <RefreshCw className="animate-spin text-text-lighter" />
                <span className="ml-2 ui-font ui-text-sm text-text-lighter">
                  Loading comments...
                </span>
              </div>
            ) : contentError ? (
              <div className="flex items-center justify-center p-8 text-center">
                <div>
                  <p className="ui-font ui-text-sm text-error">{contentError}</p>
                  <Button
                    onClick={handleRefresh}
                    variant="outline"
                    size="xs"
                    className="mt-2 border-error/40 text-error/90 hover:bg-error/10"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : selectedPRComments.length === 0 ? (
              <div className="flex items-center justify-center p-8">
                <p className="ui-font ui-text-sm text-text-lighter">No comments</p>
              </div>
            ) : (
              <div className="space-y-1">
                {selectedPRComments.map((comment, index) => (
                  <CommentItem key={getCommentKey(comment) || `${index}`} comment={comment} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

PRViewer.displayName = "PRViewer";

export default PRViewer;
