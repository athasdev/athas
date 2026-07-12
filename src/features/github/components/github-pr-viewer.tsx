import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import type { GitDiff, GitDiffLine } from "@/features/git/types/git.types";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import { Button } from "@/ui/button";
import { toast } from "@/ui/toast";
import type {
  Commit,
  FilePatchState,
  FileStatusFilter,
  TabType,
} from "../types/github-pr-viewer.types";
import {
  buildPRBufferPath,
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
import { useGitHubStore } from "../stores/github.store";
import { PRActivityPanel } from "./pr-activity-panel";
import { PRFilesPanel } from "./pr-files-panel";
import { GitHubPRViewerHeader } from "./github-pr-viewer-header";
import { GitHubPRActionDialog, type GitHubPRActionKind } from "./github-pr-action-dialog";
import { GitHubTitleBodyForm } from "./github-title-body-form";
import { GitHubAvatar } from "./github-avatar";
import {
  GitHubViewerHeader,
  GitHubViewerLoadingState,
  GitHubViewerShell,
} from "./github-viewer-shell";

function parsePatchLinesToGitDiffLines(patchLines: string[]): GitDiffLine[] {
  const result: GitDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of patchLines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number.parseInt(match[1], 10);
        newLine = Number.parseInt(match[2], 10);
      }
      result.push({ line_type: "header", content: line });
    } else if (line.startsWith("+")) {
      result.push({
        line_type: "added",
        content: line.slice(1),
        new_line_number: newLine,
      });
      newLine++;
    } else if (line.startsWith("-")) {
      result.push({
        line_type: "removed",
        content: line.slice(1),
        old_line_number: oldLine,
      });
      oldLine++;
    } else {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      result.push({
        line_type: "context",
        content,
        old_line_number: oldLine,
        new_line_number: newLine,
      });
      oldLine++;
      newLine++;
    }
  }

  return result;
}

interface GitHubPRViewerProps {
  prNumber: number;
}

const GitHubPRViewer = memo(({ prNumber }: GitHubPRViewerProps) => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const selectedRepoPath = useRepositoryStore.use.activeRepoPath();
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const prBuffer = useBufferStore((state) => {
    const buffer = state.buffers.find(
      (candidate) => candidate.type === "pullRequest" && candidate.prNumber === prNumber,
    );
    return buffer?.type === "pullRequest" ? buffer : undefined;
  });
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
  const { selectPR, fetchPRContent, fetchPRs, openPRInBrowser, checkoutPR } =
    useGitHubStore().actions;
  const repoPath = prBuffer?.repoPath ?? selectedRepoPath ?? rootFolderPath;

  const [activeTab, setActiveTab] = useState<TabType>("activity");
  const [fileQuery, setFileQuery] = useState("");
  const [fileStatusFilter, setFileStatusFilter] = useState<FileStatusFilter>("all");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    () => parseSelectedFilePathFromPRBufferPath(prBuffer?.path ?? "") ?? null,
  );
  const [isFileTreeVisible, setIsFileTreeVisible] = useState(true);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [activeAction, setActiveAction] = useState<GitHubPRActionKind | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
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
    setIsEditingDetails(false);
    setActiveAction(null);
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

    const authorAvatarUrl =
      selectedPRDetails.author.avatarUrl ||
      `https://github.com/${encodeURIComponent(selectedPRDetails.author.login || "github")}.png?size=32`;

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
        toast.success(`Checked out PR #${prNumber}`);
        window.dispatchEvent(new CustomEvent("git-status-updated"));
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

  const handleSaveDetails = useCallback(
    async ({ title, body }: { title: string; body: string }) => {
      if (!repoPath || !selectedPRDetails || !prBuffer) return;

      setIsSavingDetails(true);
      try {
        await invoke("github_update_pull_request", {
          repoPath,
          prNumber,
          title,
          body,
        });
        updateBuffer({
          ...prBuffer,
          name: title,
        });
        await selectPR(repoPath, prNumber, { force: true });
        void fetchPRs(repoPath, { force: true });
        setIsEditingDetails(false);
        toast.success(`Updated PR #${prNumber}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update pull request");
      } finally {
        setIsSavingDetails(false);
      }
    },
    [fetchPRs, prBuffer, prNumber, repoPath, selectPR, selectedPRDetails, updateBuffer],
  );

  const refreshAfterPRAction = useCallback(
    async (mode: "comments" | "full" = "full") => {
      if (!repoPath) return;

      await selectPR(repoPath, prNumber, { force: true });
      void fetchPRs(repoPath, { force: true });
      void fetchPRContent(repoPath, prNumber, { force: true, mode });
    },
    [fetchPRContent, fetchPRs, prNumber, repoPath, selectPR],
  );

  const handleSubmitAction = useCallback(
    async ({ body, method }: { body: string; method?: "merge" | "squash" | "rebase" }) => {
      if (!repoPath || !activeAction) return;

      setIsSubmittingAction(true);
      try {
        if (activeAction === "comment") {
          await invoke("github_add_pr_comment", { repoPath, prNumber, body });
          await refreshAfterPRAction("comments");
          toast.success("Comment added");
        } else if (activeAction === "approve") {
          await invoke("github_submit_pr_review", {
            repoPath,
            prNumber,
            event: "APPROVE",
            body,
          });
          await refreshAfterPRAction("comments");
          toast.success("Pull request approved");
        } else if (activeAction === "request-changes") {
          await invoke("github_submit_pr_review", {
            repoPath,
            prNumber,
            event: "REQUEST_CHANGES",
            body,
          });
          await refreshAfterPRAction("comments");
          toast.success("Changes requested");
        } else if (activeAction === "merge") {
          await invoke("github_merge_pull_request", {
            repoPath,
            prNumber,
            method: method ?? "squash",
          });
          await refreshAfterPRAction("full");
          toast.success("Pull request merged");
        } else if (activeAction === "close") {
          await invoke("github_close_pull_request", { repoPath, prNumber });
          await refreshAfterPRAction("full");
          toast.success("Pull request closed");
        }

        setActiveAction(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Pull request action failed");
      } finally {
        setIsSubmittingAction(false);
      }
    },
    [activeAction, prNumber, refreshAfterPRAction, repoPath],
  );

  const handleToggleFilesView = useCallback(() => {
    if (!selectedPRDiff || !selectedPRDetails) {
      // Diff not loaded yet — fetch first, then open
      if (repoPath) {
        void fetchPRContent(repoPath, prNumber, { mode: "files" }).then(() => {
          // Will be handled on next render when data is available
        });
      }
      return;
    }

    const sectionIndex = buildDiffSectionIndex(selectedPRDiff);
    const prFiles = selectedPRFiles.map(toFileDiffFromMetadata).filter((f) => f.path.length > 0);

    const gitDiffs: GitDiff[] = [];
    for (const file of prFiles) {
      const patch = extractFilePatch(selectedPRDiff, file.path, sectionIndex);
      const lines = patch?.lines ?? [];
      const diffLines = parsePatchLinesToGitDiffLines(lines);

      gitDiffs.push({
        file_path: file.path,
        old_path: file.oldPath,
        new_path: file.path,
        is_new: file.status === "added",
        is_deleted: file.status === "deleted",
        is_renamed: file.status === "renamed",
        lines: diffLines,
      });
    }

    const totalAdditions =
      selectedPRDetails.additions ?? prFiles.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions =
      selectedPRDetails.deletions ?? prFiles.reduce((sum, f) => sum + f.deletions, 0);

    const multiDiff: MultiFileDiff = {
      title: `PR #${prNumber}: ${selectedPRDetails.title}`,
      commitHash: `pr-${prNumber}`,
      files: gitDiffs,
      totalFiles: gitDiffs.length,
      totalAdditions,
      totalDeletions,
      isLoading: false,
    };

    const virtualPath = `diff://pr-${prNumber}/changes`;
    useBufferStore
      .getState()
      .actions.openBuffer(
        virtualPath,
        `PR #${prNumber} Changes`,
        "",
        false,
        undefined,
        true,
        true,
        multiDiff,
      );
  }, [fetchPRContent, prNumber, repoPath, selectedPRDiff, selectedPRDetails, selectedPRFiles]);

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
                  className="text-text-lighter"
                  compact
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
    <GitHubViewerShell
      header={
        <GitHubPRViewerHeader
          pr={pr}
          activeView={activeTab}
          changedFilesCount={changedFilesCount}
          additions={pr.additions}
          deletions={pr.deletions}
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
          onEdit={() => {
            setActiveTab("activity");
            setIsEditingDetails(true);
          }}
          onComment={() => setActiveAction("comment")}
          onApprove={() => setActiveAction("approve")}
          onRequestChanges={() => setActiveAction("request-changes")}
          onMerge={() => setActiveAction("merge")}
          onClosePR={() => setActiveAction("close")}
        />
      }
    >
      {activeAction ? (
        <GitHubPRActionDialog
          kind={activeAction}
          prNumber={prNumber}
          isSubmitting={isSubmittingAction}
          onClose={() => {
            if (!isSubmittingAction) {
              setActiveAction(null);
            }
          }}
          onSubmit={(value) => void handleSubmitAction(value)}
        />
      ) : null}

      {detailsError && (
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2 bg-error/8 px-1 py-2">
          <p className="font-sans ui-text-sm truncate text-error/90">{detailsError}</p>
          <Button
            onClick={handleRefresh}
            variant="default"
            className="shrink-0 border-error/40 text-error/90 hover:bg-error/10"
            compact
          >
            Retry
          </Button>
        </div>
      )}

      {activeTab === "activity" && (
        <PRActivityPanel
          body={pr.body}
          issueBaseUrl={issueBaseUrl}
          repoPath={repoPath ?? undefined}
          activityItems={activityItems}
          isLoadingContent={isLoadingContent}
          contentError={contentError}
          editForm={
            isEditingDetails ? (
              <GitHubTitleBodyForm
                title={pr.title}
                body={pr.body}
                titlePlaceholder="Pull request title"
                submitLabel="Save"
                isSubmitting={isSavingDetails}
                onCancel={() => setIsEditingDetails(false)}
                onSubmit={(value) => void handleSaveDetails(value)}
              />
            ) : undefined
          }
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
