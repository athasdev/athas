import { RefreshCw } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { Button } from "@/ui/button";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import type { Commit, FilePatchState, FileStatusFilter, TabType } from "../types/pr-viewer";
import {
  buildPRBufferPath,
  parseSelectedFilePathFromPRBufferPath,
} from "../utils/github-link-utils";
import {
  buildDiffSectionIndex,
  copyToClipboard,
  extractFilePatch,
  getCommentKey,
  normalizeCommit,
  resolveSafeRepoFilePath,
  toFileDiffFromMetadata,
} from "../utils/pr-viewer-utils";
import { useGitHubStore } from "../stores/github-store";
import { PRActivityPanel } from "./pr-activity-panel";
import { PRFilesPanel } from "./pr-files-panel";
import { PRViewerHeader } from "./pr-viewer-header";

interface PRViewerProps {
  prNumber: number;
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
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const { selectPR, fetchPRContent, openPRInBrowser, checkoutPR } = useGitHubStore().actions;
  const repoPath = selectedRepoPath ?? rootFolderPath;
  const prBuffer = buffers.find(
    (buffer): buffer is Extract<(typeof buffers)[number], { type: "pullRequest" }> =>
      buffer.type === "pullRequest" && buffer.prNumber === prNumber,
  );

  const [activeTab, setActiveTab] = useState<TabType>("activity");
  const [fileQuery, setFileQuery] = useState("");
  const [fileStatusFilter, setFileStatusFilter] = useState<FileStatusFilter>("all");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    () => parseSelectedFilePathFromPRBufferPath(prBuffer?.path ?? "") ?? null,
  );
  const [isWideSplit, setIsWideSplit] = useState(false);
  const [filePatches, setFilePatches] = useState<Record<string, FilePatchState>>({});

  useEffect(() => {
    if (repoPath && prNumber) {
      void selectPR(repoPath, prNumber);
    }
  }, [repoPath, prNumber, selectPR]);

  useEffect(() => {
    const deepLinkedFilePath = parseSelectedFilePathFromPRBufferPath(prBuffer?.path ?? "");
    setActiveTab(deepLinkedFilePath ? "files" : "activity");
    setFileQuery("");
    setFileStatusFilter("all");
    setSelectedFilePath(deepLinkedFilePath ?? null);
    setFilePatches({});
  }, [prNumber, repoPath]);

  useEffect(() => {
    const deepLinkedFilePath = parseSelectedFilePathFromPRBufferPath(prBuffer?.path ?? "");
    if (deepLinkedFilePath) {
      if (activeTab !== "files") {
        setActiveTab("files");
      }
      if (deepLinkedFilePath !== selectedFilePath) {
        setSelectedFilePath(deepLinkedFilePath);
      }
      return;
    }

    if (selectedFilePath !== null) {
      setSelectedFilePath(null);
    }
    if (activeTab === "files") {
      setActiveTab("activity");
    }
  }, [activeTab, prBuffer?.path, selectedFilePath]);

  useEffect(() => {
    if (!repoPath || !prNumber) return;
    if (activeTab === "files") {
      void fetchPRContent(repoPath, prNumber, { mode: "files" });
    } else if (activeTab === "activity") {
      void fetchPRContent(repoPath, prNumber, { mode: "comments" });
    }
  }, [activeTab, repoPath, prNumber, fetchPRContent]);

  useEffect(() => {
    if (!repoPath || !prNumber || !selectedPRDetails || activeTab !== "activity") return;

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
    const authorAvatarUrl =
      selectedPRDetails.author.avatarUrl ||
      `https://github.com/${encodeURIComponent(selectedPRDetails.author.login || "github")}.png?size=32`;

    if (!prBuffer || prBuffer.type !== "pullRequest") {
      return;
    }

    if (prBuffer.name === selectedPRDetails.title && prBuffer.authorAvatarUrl === authorAvatarUrl) {
      return;
    }

    updateBuffer({
      ...prBuffer,
      name: selectedPRDetails.title,
      authorAvatarUrl,
    });
  }, [buffers, prBuffer, selectedPRDetails, updateBuffer]);

  useEffect(() => {
    if (!prBuffer || prBuffer.type !== "pullRequest") return;

    const nextPath = buildPRBufferPath(prNumber, activeTab === "files" ? selectedFilePath : null);
    if (prBuffer.path === nextPath) return;

    updateBuffer({
      ...prBuffer,
      path: nextPath,
    });
  }, [activeTab, prBuffer, prNumber, selectedFilePath, updateBuffer]);

  const baseDiffFiles = useMemo(() => {
    return selectedPRFiles.map(toFileDiffFromMetadata).filter((file) => file.path.length > 0);
  }, [selectedPRFiles]);

  const diffSectionIndex = useMemo(() => {
    return buildDiffSectionIndex(selectedPRDiff ?? "");
  }, [selectedPRDiff]);

  const diffDebugSummary = useMemo(() => {
    const patchStates = Object.values(filePatches);
    return {
      diffReady: Boolean(selectedPRDiff),
      indexedSections: Object.keys(diffSectionIndex).length,
      loadingCount: patchStates.filter((patch) => patch.loading).length,
      loadedCount: patchStates.filter((patch) => patch.data).length,
      errorCount: patchStates.filter((patch) => patch.error).length,
    };
  }, [diffSectionIndex, filePatches, selectedPRDiff]);

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

  useEffect(() => {
    if (!selectedPRDiff) return;

    const nextPatches: Record<string, FilePatchState> = {};

    for (const file of baseDiffFiles) {
      try {
        const patch = extractFilePatch(selectedPRDiff, file.path, diffSectionIndex);
        if (!patch) {
          console.warn("PR file patch could not be resolved from diff", {
            prNumber,
            path: file.path,
            availableSections: Object.keys(diffSectionIndex),
          });
        }

        nextPatches[file.path] = {
          loading: false,
          data: patch ?? {
            path: file.path,
            oldPath: file.oldPath,
            status: file.status,
            lines: [],
          },
        };
      } catch (error) {
        console.error("Failed to eagerly build PR file patch", {
          prNumber,
          path: file.path,
          error,
        });
        nextPatches[file.path] = {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    setFilePatches(nextPatches);
  }, [baseDiffFiles, diffSectionIndex, prNumber, selectedPRDiff]);

  const commits = useMemo(() => {
    if (!Array.isArray(selectedPRDetails?.commits)) return [];
    return selectedPRDetails.commits
      .map((commit, index) => normalizeCommit(commit, index))
      .filter((commit): commit is Commit => !!commit);
  }, [selectedPRDetails?.commits]);

  const reviewerLogins = useMemo(() => {
    return (selectedPRDetails?.reviewRequests ?? []).map((reviewer) => reviewer.login);
  }, [selectedPRDetails?.reviewRequests]);

  const passedChecksCount = useMemo(() => {
    return (selectedPRDetails?.statusChecks ?? []).filter((check) => check.conclusion === "SUCCESS")
      .length;
  }, [selectedPRDetails?.statusChecks]);

  const activityItems = useMemo(() => {
    const commentItems = selectedPRComments.map((comment, index) => ({
      id: getCommentKey(comment) || `comment-${index}`,
      createdAt: new Date(comment.createdAt).getTime(),
      type: "comment" as const,
      comment,
    }));

    const commitItems = commits.map((commit) => ({
      id: commit.oid,
      createdAt: new Date(commit.authoredDate).getTime(),
      type: "commit" as const,
      commit,
    }));

    return [...commentItems, ...commitItems].sort((a, b) => a.createdAt - b.createdAt);
  }, [commits, selectedPRComments]);

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

  const selectedDiffFile = useMemo(() => {
    if (filteredDiff.length === 0) return null;
    return filteredDiff.find((file) => file.path === selectedFilePath) ?? filteredDiff[0] ?? null;
  }, [filteredDiff, selectedFilePath]);

  useEffect(() => {
    if (activeTab !== "files") return;
    if (filteredDiff.length === 0) {
      setSelectedFilePath(null);
      return;
    }

    setSelectedFilePath((current) => {
      if (current && filteredDiff.some((file) => file.path === current)) {
        return current;
      }
      return filteredDiff[0]?.path ?? null;
    });
  }, [activeTab, filteredDiff]);

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
      } else if (activeTab === "activity") {
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

  const handleToggleFilesView = useCallback(() => {
    setActiveTab((current) => {
      const next = current === "files" ? "activity" : "files";

      if (next === "files" && repoPath) {
        void fetchPRContent(repoPath, prNumber, { mode: "files" });
      }

      return next;
    });
  }, [fetchPRContent, prNumber, repoPath]);

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

  if (!selectedPRDetails) {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-primary-bg">
        {isLoadingDetails && (
          <div className="h-px w-full overflow-hidden bg-border">
            <div className="h-full w-1/4 animate-pulse bg-accent/70" />
          </div>
        )}
        <div className="px-3 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            {prBuffer?.authorAvatarUrl ? (
              <img
                src={prBuffer.authorAvatarUrl}
                alt=""
                className="mt-0.5 size-6 rounded-full bg-secondary-bg"
                loading="lazy"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="ui-font ui-text-lg truncate text-text">
                {prBuffer?.name || `PR #${prNumber}`}
              </div>
              <div className="ui-text-sm mt-1 text-text-lighter">
                {detailsError && !isLoadingDetails ? detailsError : `Loading PR #${prNumber}...`}
              </div>
            </div>
            {detailsError && !isLoadingDetails ? (
              <Button
                onClick={handleRefresh}
                variant="ghost"
                size="xs"
                className="text-text-lighter"
              >
                Retry
              </Button>
            ) : (
              <RefreshCw className={cn("text-text-lighter", isLoadingDetails && "animate-spin")} />
            )}
          </div>
        </div>
      </div>
    );
  }

  const isRefreshingDetails = isLoadingDetails && !!selectedPRDetails;
  const pr = selectedPRDetails;
  const changedFilesCount = pr.changedFiles || selectedPRFiles.length || 0;
  const checksSummary =
    pr.statusChecks?.length > 0
      ? `${passedChecksCount} checks passed${pr.mergeable === "CONFLICTING" ? " · has conflicts" : ""}`
      : pr.mergeable === "CONFLICTING"
        ? "Has conflicts"
        : "No checks reported";
  const changesSummary = `${changedFilesCount} files +${pr.additions} -${pr.deletions}`;
  const reviewSummary =
    pr.reviewDecision === "CHANGES_REQUESTED"
      ? "changes requested"
      : pr.reviewDecision === "REVIEW_REQUIRED"
        ? "review required"
        : null;
  const issueBaseUrl = pr.url.replace(/\/pull\/\d+$/, "");
  const metaItems = [
    pr.reviewDecision === "APPROVED" ? "Approved" : null,
    pr.mergeStateStatus === "BEHIND" ? "Behind base" : null,
    pr.isDraft ? "Draft" : null,
    pr.assignees?.length
      ? `Assigned ${pr.assignees.map((assignee) => assignee.login).join(", ")}`
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

      <PRViewerHeader
        pr={pr}
        activeView={activeTab}
        changesSummary={changesSummary}
        checksSummary={checksSummary}
        reviewerLogins={reviewerLogins}
        reviewSummary={reviewSummary}
        metaItems={metaItems}
        isRefreshingDetails={isRefreshingDetails}
        onRefresh={handleRefresh}
        onCheckout={() => {
          void handleCheckout();
        }}
        onOpenInBrowser={handleOpenInBrowser}
        onCopyPRLink={handleCopyPRLink}
        onCopyBranchName={handleCopyBranchName}
        onToggleFilesView={handleToggleFilesView}
      />

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

      <div className="min-w-0 px-3 pb-4 sm:px-5">
        {activeTab === "activity" && (
          <PRActivityPanel
            body={pr.body}
            issueBaseUrl={issueBaseUrl}
            repoPath={repoPath ?? undefined}
            activityItems={activityItems}
            isLoadingContent={isLoadingContent}
            contentError={contentError}
            onRetry={handleRefresh}
          />
        )}

        {activeTab === "files" && (
          <div className="min-w-0 space-y-3 pt-1">
            <PRFilesPanel
              selectedPRDiff={selectedPRDiff}
              isLoadingContent={isLoadingContent}
              contentError={contentError}
              diffFiles={diffFiles}
              filteredDiff={filteredDiff}
              selectedDiffFile={selectedDiffFile}
              fileQuery={fileQuery}
              fileStatusFilter={fileStatusFilter}
              selectedFilePath={selectedFilePath}
              isWideSplit={isWideSplit}
              diffDebugSummary={diffDebugSummary}
              patchError={selectedDiffFile ? filePatches[selectedDiffFile.path]?.error : undefined}
              onRetry={handleRefresh}
              onToggleSplit={() => setIsWideSplit((current) => !current)}
              onFileQueryChange={setFileQuery}
              onFileStatusFilterChange={setFileStatusFilter}
              onSelectFile={setSelectedFilePath}
              onOpenChangedFile={handleOpenChangedFile}
            />
          </div>
        )}
      </div>
    </div>
  );
});

PRViewer.displayName = "PRViewer";

export default PRViewer;
