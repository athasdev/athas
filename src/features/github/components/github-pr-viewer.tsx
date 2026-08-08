import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import { toast } from "sonner";
import type { Label, PullRequestDetails } from "../types/github.types";
import type {
  Commit,
  FilePatchState,
  FileStatusFilter,
  TabType,
} from "../types/github-pr-viewer.types";
import {
  buildPRBufferPath,
  isPRFilesViewPath,
  parseSelectedFilePathFromPRBufferPath,
} from "../utils/github-link-utils";
import {
  buildDiffSectionIndex,
  extractFilePatch,
  getCommentKey,
  normalizeCommit,
  resolveSafeRepoFilePath,
  toFileDiffFromMetadata,
} from "../utils/github-pr-viewer-utils";
import { copyToClipboard } from "../utils/github-viewer-utils";
import { getGitHubAvatarUrl } from "../utils/github-avatar-url";
import { useGitHubStore } from "../stores/github.store";
import { PRActivityPanel } from "./pr-activity-panel";
import { PRFilesPanel } from "./pr-files-panel";
import { GitHubPRViewerHeader } from "./github-pr-viewer-header";
import { GitHubPRSidebar } from "./github-pr-sidebar";
import {
  GitHubPRInlineAction,
  type GitHubPRInlineActionKind,
  type GitHubPRMergeMethod,
} from "./github-pr-inline-action";
import { GitHubAvatar } from "./github-avatar";
import { GitHubInlineTitle } from "./github-inline-editors";
import {
  GitHubDetailLayout,
  GitHubViewerHeader,
  GitHubViewerLoadingState,
  GitHubViewerShell,
} from "./github-viewer-shell";

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
  const [fileQuery, setFileQuery] = useState("");
  const [fileStatusFilter, setFileStatusFilter] = useState<FileStatusFilter>("all");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    () => parseSelectedFilePathFromPRBufferPath(prBuffer?.path ?? "") ?? null,
  );
  const [isFileTreeVisible, setIsFileTreeVisible] = useState(true);
  const [filePatches, setFilePatches] = useState<Record<string, FilePatchState>>({});
  const [labels, setLabels] = useState<Label[]>([]);
  const [inlineAction, setInlineAction] = useState<GitHubPRInlineActionKind | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);

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
    setFileQuery("");
    setFileStatusFilter("all");
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

  const diffDebugSummary = useMemo(() => {
    const patchStates = Object.values(filePatches);
    return {
      errorCount: patchStates.filter((patch) => patch.error).length,
    };
  }, [filePatches]);

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

  const availableLabels = useMemo(() => {
    const labelsByName = new Map(labels.map((label) => [label.name, label]));
    for (const label of selectedPRDetails?.labels ?? []) labelsByName.set(label.name, label);
    return Array.from(labelsByName.values());
  }, [labels, selectedPRDetails?.labels]);

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

  const openInlineAction = useCallback(
    (kind: GitHubPRInlineActionKind) => {
      if (prBuffer) {
        updateBuffer({
          ...prBuffer,
          path: buildPRBufferPath(prNumber, null, "activity"),
        });
      }
      setActiveTab("activity");
      setInlineAction(kind);
    },
    [prBuffer, prNumber, updateBuffer],
  );

  const submitInlineAction = useCallback(
    async (body: string, method: GitHubPRMergeMethod) => {
      if (!repoPath || !inlineAction || mutationKey) return;
      setMutationKey(inlineAction);
      try {
        if (inlineAction === "comment") {
          await invoke("github_add_pr_comment", { repoPath, prNumber, body });
        } else if (inlineAction === "approve" || inlineAction === "request-changes") {
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
          completedAction === "comment"
            ? "Comment added"
            : completedAction === "approve"
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

  const handleToggleFilesView = useCallback(() => {
    const nextTab = activeTab === "files" ? "activity" : "files";
    if (prBuffer) {
      updateBuffer({
        ...prBuffer,
        path: buildPRBufferPath(prNumber, nextTab === "files" ? selectedFilePath : null, nextTab),
      });
    }
    setActiveTab(nextTab);
  }, [activeTab, prBuffer, prNumber, selectedFilePath, updateBuffer]);

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
      <GitHubViewerShell
        header={
          <GitHubViewerHeader
            title={prBuffer?.name || `PR #${prNumber}`}
            meta={detailsError && !isLoadingDetails ? detailsError : `Pull request #${prNumber}`}
            leading={
              prBuffer?.authorAvatarUrl ? (
                <GitHubAvatar
                  name={prBuffer.name}
                  avatarUrl={prBuffer.authorAvatarUrl}
                  className="size-6"
                />
              ) : null
            }
            actions={
              detailsError && !isLoadingDetails ? (
                <Button
                  onClick={handleRefresh}
                  variant="ghost"
                  className="text-subtle-foreground"
                  size="xs"
                >
                  Retry
                </Button>
              ) : null
            }
          />
        }
      >
        {detailsError && !isLoadingDetails ? null : (
          <GitHubViewerLoadingState label={`Loading PR #${prNumber}`} />
        )}
      </GitHubViewerShell>
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
  const reviewSummary =
    pr.reviewDecision === "CHANGES_REQUESTED"
      ? "changes requested"
      : pr.reviewDecision === "REVIEW_REQUIRED"
        ? "review required"
        : null;
  const repositoryUrl = pr.url.replace(/\/pull\/\d+$/, "");
  return (
    <GitHubViewerShell
      contentClassName={activeTab === "files" ? "px-0 pb-0 sm:px-0" : undefined}
      header={
        <GitHubPRViewerHeader
          pr={pr}
          activeView={activeTab}
          changedFilesCount={changedFilesCount}
          additions={pr.additions}
          deletions={pr.deletions}
          isRefreshingDetails={isRefreshingDetails}
          onRefresh={handleRefresh}
          onCheckout={() => {
            void handleCheckout();
          }}
          onOpenInBrowser={handleOpenInBrowser}
          onCopyPRLink={handleCopyPRLink}
          onCopyBranchName={handleCopyBranchName}
          onToggleFilesView={handleToggleFilesView}
          onComment={() => openInlineAction("comment")}
          onApprove={() => openInlineAction("approve")}
          onRequestChanges={() => openInlineAction("request-changes")}
          onMerge={() => openInlineAction("merge")}
          onClosePR={() => void closePullRequest()}
        />
      }
    >
      {detailsError && (
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2 bg-destructive/8 px-1 py-2">
          <p className="font-sans ui-text-sm truncate text-destructive/90">{detailsError}</p>
          <Button
            onClick={handleRefresh}
            variant="default"
            className="shrink-0 border border-destructive/40 text-destructive/90 hover:bg-destructive/10"
            size="xs"
          >
            Retry
          </Button>
        </div>
      )}

      {activeTab === "activity" && (
        <GitHubDetailLayout
          sidebar={
            <GitHubPRSidebar
              pr={pr}
              changedFilesCount={changedFilesCount}
              checksSummary={checksSummary}
              reviewSummary={reviewSummary}
              onShowFiles={handleToggleFilesView}
              availableLabels={availableLabels}
              onLabelsChange={(nextLabels) => void updatePR({ labels: nextLabels })}
              onAssigneesChange={(assignees) => void updatePR({ assignees })}
            />
          }
        >
          <div className="space-y-8">
            <section className="space-y-2">
              <GitHubInlineTitle value={pr.title} onSave={(title) => updatePR({ title })} />
              <div className="font-sans ui-text-sm flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-subtle-foreground">
                <GitHubAvatar
                  login={pr.author.login}
                  avatarUrl={pr.author.avatarUrl}
                  size={32}
                  className="size-5"
                />
                <span className="text-foreground">{pr.author.login}</span>
                <span>&middot;</span>
                <span className="font-mono">{pr.baseRef}</span>
                <span>&larr;</span>
                <span className="min-w-0 truncate font-mono">{pr.headRef}</span>
              </div>
            </section>

            {inlineAction ? (
              <GitHubPRInlineAction
                kind={inlineAction}
                isSubmitting={mutationKey === inlineAction}
                onCancel={() => setInlineAction(null)}
                onSubmit={submitInlineAction}
              />
            ) : null}

            <PRActivityPanel
              body={pr.body}
              repositoryUrl={repositoryUrl}
              repoPath={repoPath ?? undefined}
              activityItems={activityItems}
              isLoadingContent={isLoadingContent}
              contentError={contentError}
              onRetry={handleRefresh}
              onBodySave={(body) => updatePR({ body })}
            />
          </div>
        </GitHubDetailLayout>
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
            isFileTreeVisible={isFileTreeVisible}
            diffDebugSummary={diffDebugSummary}
            patchError={selectedDiffFile ? filePatches[selectedDiffFile.path]?.error : undefined}
            onRetry={handleRefresh}
            onToggleFileTree={() => setIsFileTreeVisible((current) => !current)}
            onFileQueryChange={setFileQuery}
            onFileStatusFilterChange={setFileStatusFilter}
            onSelectFile={setSelectedFilePath}
            onOpenChangedFile={handleOpenChangedFile}
          />
        </div>
      )}
    </GitHubViewerShell>
  );
});

GitHubPRViewer.displayName = "GitHubPRViewer";

export default GitHubPRViewer;
