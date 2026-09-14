import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { ViewerErrorState } from "@/features/viewer/components/viewer-state";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import { DropdownMenuItem } from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import Badge from "@/ui/badge";
import { GitMergeIcon, GitPullRequestIcon } from "@/ui/icons";
import {
  ResourceActionsMenu,
  ResourceContent,
  ResourceDocument,
  ResourceSidebarLayout,
  ResourceSummary,
  ResourceWorkspace,
} from "@/ui/resource";
import { toast } from "sonner";
import type { Label, PullRequestDetails } from "../types/github.types";
import type { Commit, FilePatchState, TabType } from "../types/github-pr-viewer.types";
import {
  buildPRBufferPath,
  isPRFilesViewPath,
  parseSelectedFilePathFromPRBufferPath,
} from "../utils/github-link-utils";
import {
  buildDiffSectionIndex,
  extractFilePatch,
  getPullRequestStatus,
  normalizeCommit,
  PR_STATUS_BADGE_VARIANT,
  PULL_REQUEST_STATUS_LABEL,
  resolveSafeRepoFilePath,
  toFileDiffFromMetadata,
} from "../utils/github-pr-viewer-utils";
import { copyToClipboard, getTimeAgo } from "../utils/github-viewer-utils";
import { getGitHubAvatarUrl } from "../utils/github-avatar-url";
import { useGitHubStore } from "../stores/github.store";
import { PRTimeline } from "./pr-timeline";
import { PRFilesPanel } from "./pr-files-panel";
import { getMergeStatusInfo } from "./pr-status";
import { GitHubPRTabs } from "./github-pr-tabs";
import {
  GitHubPRBodySkeleton,
  GitHubPRSummarySkeleton,
  GitHubPRTabsSkeleton,
} from "./github-pr-skeleton";
import { GitHubPRSidebar } from "./github-pr-sidebar";
import {
  GitHubPRInlineAction,
  type GitHubPRInlineActionKind,
  type GitHubPRMergeMethod,
} from "./github-pr-inline-action";
import { GitHubBranchChip, GitHubMetaChip, GitHubUserChip } from "./github-chips";

interface GitHubPRViewerProps {
  prNumber: number;
  bufferId: string;
}

const GitHubPRViewer = memo(({ prNumber, bufferId }: GitHubPRViewerProps) => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const selectedRepoPath = useRepositoryStore.use.activeRepoPath();
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const prBuffer = useBufferStore((state) => {
    const buffer = state.buffers.find(
      (candidate) =>
        candidate.id === bufferId &&
        candidate.type === "pullRequest" &&
        candidate.prNumber === prNumber,
    );
    return buffer?.type === "pullRequest" ? buffer : undefined;
  });
  const selectedPRDetails = useGitHubStore.use.selectedPRDetails();
  const isActiveBuffer = useBufferStore((state) => state.activeBufferId === bufferId);
  const selectedPRDiff = useGitHubStore.use.selectedPRDiff();
  const selectedPRFiles = useGitHubStore.use.selectedPRFiles();
  const selectedPRComments = useGitHubStore.use.selectedPRComments();
  const isLoadingDetails = useGitHubStore.use.isLoadingDetails();
  const isLoadingContent = useGitHubStore.use.isLoadingContent();
  const detailsError = useGitHubStore.use.detailsError();
  const contentError = useGitHubStore.use.contentError();
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const { selectPR, fetchPRs, fetchPRContent, openPRInBrowser, checkoutPR } =
    useGitHubStore.use.actions();
  const repoPath = prBuffer?.repoPath ?? selectedRepoPath ?? rootFolderPath;

  const [activeTab, setActiveTab] = useState<TabType>(() =>
    isPRFilesViewPath(prBuffer?.path ?? "") ? "files" : "activity",
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    () => parseSelectedFilePathFromPRBufferPath(prBuffer?.path ?? "") ?? null,
  );
  const [filePatches, setFilePatches] = useState<Record<string, FilePatchState>>({});
  const [labels, setLabels] = useState<Label[]>([]);
  const [inlineAction, setInlineAction] = useState<GitHubPRInlineActionKind | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const composerRef = useRef<HTMLDivElement | null>(null);
  const currentUser = useGitHubStore((state) => state.currentUser);

  useEffect(() => {
    if (repoPath && prNumber) {
      void selectPR(repoPath, prNumber);
    }
  }, [repoPath, prNumber, selectPR]);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;

    void invoke<Label[]>("github_list_labels", { repoPath })
      .catch(() => [])
      .then((nextLabels) => {
        if (!cancelled) setLabels(nextLabels);
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    const deepLinkedFilePath = parseSelectedFilePathFromPRBufferPath(prBuffer?.path ?? "");
    setActiveTab(isPRFilesViewPath(prBuffer?.path ?? "") ? "files" : "activity");
    setSelectedFilePath(deepLinkedFilePath ?? null);
    setFilePatches({});
  }, [prNumber, repoPath]);

  useEffect(() => {
    const deepLinkedFilePath = parseSelectedFilePathFromPRBufferPath(prBuffer?.path ?? "");
    if (isPRFilesViewPath(prBuffer?.path ?? "")) {
      if (activeTab !== "files") {
        setActiveTab("files");
      }
      if (deepLinkedFilePath && deepLinkedFilePath !== selectedFilePath) {
        setSelectedFilePath(deepLinkedFilePath);
      }
      return;
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
    if (!selectedPRDetails || !prBuffer) return;

    const authorAvatarUrl = getGitHubAvatarUrl(selectedPRDetails.author);

    if (prBuffer.name === selectedPRDetails.title && prBuffer.authorAvatarUrl === authorAvatarUrl) {
      return;
    }

    updateBuffer({
      ...prBuffer,
      name: selectedPRDetails.title,
      authorAvatarUrl,
    });
  }, [prBuffer, selectedPRDetails, updateBuffer]);

  useEffect(() => {
    if (!prBuffer || prBuffer.type !== "pullRequest") return;

    const nextPath = buildPRBufferPath(
      prNumber,
      activeTab === "files" ? selectedFilePath : null,
      activeTab,
    );
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

  const passedChecksCount = useMemo(() => {
    return (selectedPRDetails?.statusChecks ?? []).filter((check) => check.conclusion === "SUCCESS")
      .length;
  }, [selectedPRDetails?.statusChecks]);

  const availableLabels = useMemo(() => {
    const labelsByName = new Map(labels.map((label) => [label.name, label]));
    for (const label of selectedPRDetails?.labels ?? []) labelsByName.set(label.name, label);
    return Array.from(labelsByName.values());
  }, [labels, selectedPRDetails?.labels]);

  const selectedDiffFile = useMemo(() => {
    if (diffFiles.length === 0) return null;
    return diffFiles.find((file) => file.path === selectedFilePath) ?? diffFiles[0] ?? null;
  }, [diffFiles, selectedFilePath]);

  useEffect(() => {
    if (activeTab !== "files") return;
    if (diffFiles.length === 0) {
      setSelectedFilePath(null);
      return;
    }

    setSelectedFilePath((current) => {
      if (current && diffFiles.some((file) => file.path === current)) {
        return current;
      }
      return diffFiles[0]?.path ?? null;
    });
  }, [activeTab, diffFiles]);

  const handleOpenInBrowser = useCallback(() => {
    if (repoPath) {
      openPRInBrowser(repoPath, prNumber);
    }
  }, [repoPath, prNumber, openPRInBrowser]);

  const handleCheckout = useCallback(async () => {
    if (repoPath) {
      try {
        await checkoutPR(repoPath, prNumber);
        toast.success(`Checked out PR #${prNumber}`);
      } catch (err) {
        console.error("Failed to checkout PR:", err);
        toast.error(err instanceof Error ? err.message : `Failed to checkout PR #${prNumber}`);
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

  const refreshPR = useCallback(
    async (mode: "comments" | "full" = "full") => {
      if (!repoPath) return;
      await selectPR(repoPath, prNumber, { force: true });
      void fetchPRs(repoPath, { force: true });
      await fetchPRContent(repoPath, prNumber, { force: true, mode });
    },
    [fetchPRContent, fetchPRs, prNumber, repoPath, selectPR],
  );

  const updatePR = useCallback(
    async (
      changes: Partial<Pick<PullRequestDetails, "title" | "body" | "labels" | "assignees">>,
    ) => {
      if (!repoPath || !selectedPRDetails || mutationKey) return false;
      const next = { ...selectedPRDetails, ...changes };
      setMutationKey("edit");
      try {
        await invoke<PullRequestDetails>("github_update_pull_request", {
          repoPath,
          prNumber,
          title: next.title,
          body: next.body,
          labels: next.labels.map((label) => label.name),
          assignees: next.assignees.map((assignee) => assignee.login),
        });
        await refreshPR("comments");
        toast.success("Pull request updated");
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update pull request");
        return false;
      } finally {
        setMutationKey(null);
      }
    },
    [mutationKey, prNumber, refreshPR, repoPath, selectedPRDetails],
  );

  const showActivityTab = useCallback(() => {
    if (prBuffer) {
      updateBuffer({
        ...prBuffer,
        path: buildPRBufferPath(prNumber, null, "activity"),
      });
    }
    setActiveTab("activity");
  }, [prBuffer, prNumber, updateBuffer]);

  const openInlineAction = useCallback(
    (kind: GitHubPRInlineActionKind) => {
      showActivityTab();
      setInlineAction(kind);
    },
    [showActivityTab],
  );

  const submitComment = useCallback(async () => {
    const body = commentDraft.trim();
    if (!repoPath || !body || mutationKey) return false;
    setMutationKey("comment");
    try {
      await invoke("github_add_pr_comment", { repoPath, prNumber, body });
      setCommentDraft("");
      toast.success("Comment added");
      void refreshPR("comments").catch(() => {
        toast.error("Comment posted, but the conversation could not refresh. Reload to see it.");
      });
      return true;
    } finally {
      setMutationKey(null);
    }
  }, [commentDraft, mutationKey, prNumber, refreshPR, repoPath]);

  const editComment = useCallback(
    async (commentId: number, body: string) => {
      if (!repoPath || mutationKey) return false;
      setMutationKey(`comment-${commentId}`);
      try {
        await invoke("github_update_issue_comment", { repoPath, commentId, body });
        await refreshPR("comments");
        toast.success("Comment updated");
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update the comment");
        return false;
      } finally {
        setMutationKey(null);
      }
    },
    [mutationKey, refreshPR, repoPath],
  );

  const deleteComment = useCallback(
    async (commentId: number) => {
      if (!repoPath || mutationKey) return;
      setMutationKey(`comment-${commentId}`);
      try {
        await invoke("github_delete_issue_comment", { repoPath, commentId });
        await refreshPR("comments");
        toast.success("Comment deleted");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete the comment");
      } finally {
        setMutationKey(null);
      }
    },
    [mutationKey, refreshPR, repoPath],
  );

  const submitInlineAction = useCallback(
    async (body: string, method: GitHubPRMergeMethod) => {
      if (!repoPath || !inlineAction || mutationKey) return;
      setMutationKey(inlineAction);
      try {
        if (inlineAction === "approve" || inlineAction === "request-changes") {
          await invoke("github_submit_pr_review", {
            repoPath,
            prNumber,
            event: inlineAction === "approve" ? "APPROVE" : "REQUEST_CHANGES",
            body,
          });
        } else {
          await invoke("github_merge_pull_request", { repoPath, prNumber, method });
        }

        await refreshPR(inlineAction === "merge" ? "full" : "comments");
        const completedAction = inlineAction;
        setInlineAction(null);
        toast.success(
          completedAction === "approve"
            ? "Pull request approved"
            : completedAction === "request-changes"
              ? "Changes requested"
              : "Pull request merged",
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Pull request action failed");
      } finally {
        setMutationKey(null);
      }
    },
    [inlineAction, mutationKey, prNumber, refreshPR, repoPath],
  );

  const closePullRequest = useCallback(async () => {
    if (!repoPath || mutationKey) return;
    const confirmed = await showConfirmDialog("Close this pull request without merging it?", {
      title: "Close pull request",
      confirmLabel: "Close PR",
    });
    if (!confirmed) return;

    setMutationKey("close");
    try {
      await invoke("github_close_pull_request", { repoPath, prNumber });
      await refreshPR("full");
      toast.success("Pull request closed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to close pull request");
    } finally {
      setMutationKey(null);
    }
  }, [mutationKey, prNumber, refreshPR, repoPath]);

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

  const handleShowView = useCallback(
    (nextTab: TabType) => {
      if (nextTab === activeTab) return;

      if (prBuffer) {
        updateBuffer({
          ...prBuffer,
          path: buildPRBufferPath(prNumber, nextTab === "files" ? selectedFilePath : null, nextTab),
        });
      }
      setActiveTab(nextTab);
    },
    [activeTab, prBuffer, prNumber, selectedFilePath, updateBuffer],
  );

  const handleShowOverview = useCallback(() => {
    handleShowView("activity");
  }, [handleShowView]);

  const handleShowFiles = useCallback(() => {
    handleShowView("files");
  }, [handleShowView]);

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
    const failed = Boolean(detailsError) && !isLoadingDetails;
    return (
      <ResourceDocument
        summary={
          failed ? (
            <ResourceSummary
              icon={<GitPullRequestIcon className="text-subtle-foreground" />}
              title={<span className="block truncate">{prBuffer?.name || `PR #${prNumber}`}</span>}
              description={detailsError}
              actions={
                <Button onClick={handleRefresh} variant="ghost">
                  Retry
                </Button>
              }
            />
          ) : (
            <GitHubPRSummarySkeleton />
          )
        }
        tabs={failed ? null : <GitHubPRTabsSkeleton />}
      >
        {failed ? null : <GitHubPRBodySkeleton />}
      </ResourceDocument>
    );
  }

  const isRefreshingDetails = isLoadingDetails && !!selectedPRDetails;
  const pr = selectedPRDetails;
  const status = getPullRequestStatus(pr);
  const checksSummary =
    pr.statusChecks?.length > 0
      ? `${passedChecksCount} checks passed${pr.mergeable === "CONFLICTING" ? " · has conflicts" : ""}`
      : pr.mergeable === "CONFLICTING"
        ? "Has conflicts"
        : "No checks reported";
  const repositoryUrl = pr.url.replace(/\/pull\/\d+$/, "");

  const isClosed = status === "closed" || status === "merged";
  const mergeStatus = getMergeStatusInfo({
    status,
    mergeStateStatus: pr.mergeStateStatus,
    mergeable: pr.mergeable,
    reviewDecision: pr.reviewDecision,
  });
  const MergeStatusIcon = mergeStatus.icon;
  const actions = (
    <>
      <Badge variant={PR_STATUS_BADGE_VARIANT[status]}>{PULL_REQUEST_STATUS_LABEL[status]}</Badge>
      {mergeStatus.ready ? (
        <Button onClick={() => openInlineAction("merge")} variant="accent" size="chrome">
          <GitMergeIcon />
          Merge
        </Button>
      ) : (
        <Button variant="default" size="chrome" disabled tooltip={mergeStatus.text}>
          <MergeStatusIcon />
          {mergeStatus.text}
        </Button>
      )}
      <ResourceActionsMenu label="Pull request actions" size="chrome">
        <DropdownMenuItem onClick={() => void handleCheckout()}>Checkout branch</DropdownMenuItem>
        <DropdownMenuItem disabled={isClosed} onClick={() => openInlineAction("approve")}>
          Approve
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isClosed} onClick={() => openInlineAction("request-changes")}>
          Request changes
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isClosed} onClick={() => void closePullRequest()}>
          Close pull request
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isRefreshingDetails} onClick={handleRefresh}>
          {isRefreshingDetails ? "Refreshing..." : "Refresh"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleOpenInBrowser}>Open on GitHub</DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyPRLink}>Copy link</DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyBranchName}>Copy branch name</DropdownMenuItem>
      </ResourceActionsMenu>
    </>
  );

  const summary = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <GitHubMetaChip title="Pull request number">{`#${pr.number}`}</GitHubMetaChip>
      <GitHubUserChip
        login={pr.author.login}
        avatarUrl={pr.author.avatarUrl}
        className="text-foreground"
        avatarSize="sm"
      />
      <GitHubMetaChip title={new Date(pr.createdAt).toLocaleString()}>
        {`Opened ${getTimeAgo(pr.createdAt)}`}
      </GitHubMetaChip>
      <GitHubMetaChip title={new Date(pr.updatedAt).toLocaleString()}>
        {`Updated ${getTimeAgo(pr.updatedAt)}`}
      </GitHubMetaChip>
      {isRefreshingDetails ? <Spinner label="Refreshing" compact /> : null}
      <span className="flex min-w-0 items-center gap-1">
        <GitHubBranchChip name={pr.headRef} repositoryUrl={repositoryUrl} className="max-w-64" />
        <span aria-hidden="true" className="text-subtle-foreground">
          →
        </span>
        <GitHubBranchChip name={pr.baseRef} repositoryUrl={repositoryUrl} className="max-w-64" />
      </span>
    </div>
  );

  const tabs = (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <GitHubPRTabs
        activeView={activeTab}
        commits={commits}
        repoPath={repoPath ?? undefined}
        additions={pr.additions}
        deletions={pr.deletions}
        onShowOverview={handleShowOverview}
        onShowChanges={handleShowFiles}
      />
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </div>
  );

  const errorState = detailsError ? (
    <ViewerErrorState
      message={detailsError}
      actionLabel="Retry"
      onAction={handleRefresh}
      layout="section"
      className="mb-3 min-h-0 shrink-0"
    />
  ) : null;

  return (
    <ResourceWorkspace summary={summary} tabs={tabs}>
      {activeTab === "files" ? (
        <div className="min-h-0 min-w-0 flex-1">
          {errorState}
          <PRFilesPanel
            selectedPRDiff={selectedPRDiff}
            isLoadingContent={isLoadingContent}
            contentError={contentError}
            diffFiles={diffFiles}
            selectedDiffFile={selectedDiffFile}
            selectedFilePath={selectedFilePath}
            isActive={isActiveBuffer}
            patchError={selectedDiffFile ? filePatches[selectedDiffFile.path]?.error : undefined}
            onRetry={handleRefresh}
            onSelectFile={setSelectedFilePath}
            onOpenChangedFile={handleOpenChangedFile}
          />
        </div>
      ) : (
        <ResourceContent>
          {errorState}
          <ResourceSidebarLayout
            sidebar={
              <GitHubPRSidebar
                pr={pr}
                checksSummary={checksSummary}
                availableLabels={availableLabels}
                onLabelsChange={(nextLabels) => void updatePR({ labels: nextLabels })}
                onAssigneesChange={(assignees) => void updatePR({ assignees })}
                repoPath={repoPath ?? undefined}
                repositoryUrl={repositoryUrl}
              />
            }
          >
            <PRTimeline
              pr={pr}
              commits={commits}
              comments={selectedPRComments}
              repositoryUrl={repositoryUrl}
              repoPath={repoPath ?? undefined}
              currentUser={currentUser}
              isLoadingContent={isLoadingContent}
              contentError={contentError}
              onRetry={handleRefresh}
              onBodySave={(body) => updatePR({ body })}
              commentDraft={commentDraft}
              onCommentDraftChange={setCommentDraft}
              onSubmitComment={submitComment}
              isSubmittingComment={mutationKey === "comment"}
              commentDisabled={Boolean(mutationKey) || !repoPath}
              onEditComment={editComment}
              onDeleteComment={deleteComment}
              busyCommentId={
                mutationKey?.startsWith("comment-")
                  ? Number(mutationKey.slice("comment-".length))
                  : null
              }
              composerRef={composerRef}
            >
              {inlineAction ? (
                <GitHubPRInlineAction
                  kind={inlineAction}
                  isSubmitting={mutationKey === inlineAction}
                  onCancel={() => setInlineAction(null)}
                  onSubmit={submitInlineAction}
                />
              ) : null}
            </PRTimeline>
          </ResourceSidebarLayout>
        </ResourceContent>
      )}
    </ResourceWorkspace>
  );
});

GitHubPRViewer.displayName = "GitHubPRViewer";

export default GitHubPRViewer;
