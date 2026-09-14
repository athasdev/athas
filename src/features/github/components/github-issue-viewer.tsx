import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircleIcon,
  CircleDotIcon,
  LockIcon,
  LockOpenIcon,
  OpenExternalIcon,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  ViewerErrorState,
  ViewerLoadingState,
  ViewerState,
} from "@/features/viewer/components/viewer-state";
import { Button } from "@/ui/button";
import { DropdownMenuItem } from "@/ui/dropdown";
import Badge from "@/ui/badge";
import {
  ResourceActionsMenu,
  ResourceDocument,
  ResourceSection,
  ResourceSidebarLayout,
  ResourceSummary,
} from "@/ui/resource";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import Select from "@/ui/select";
import { useGitHubStore } from "../stores/github.store";
import type {
  IssueComment,
  IssueDetails,
  IssueMilestone,
  IssueType,
  Label,
} from "../types/github.types";
import {
  GITHUB_ISSUE_DETAILS_TTL_MS,
  githubIssueDetailsCache,
  githubIssueListCache,
} from "../utils/github-data-cache";
import { getGitHubMilestoneUrl } from "../utils/github-link-utils";
import { copyToClipboard, getTimeAgo } from "../utils/github-viewer-utils";
import { getGitHubAvatarUrl } from "../utils/github-avatar-url";
import { CommentItem } from "./comment-item";
import { GitHubInlineMarkdown, GitHubInlineTitle } from "./github-inline-editors";
import { GitHubMetaChip, GitHubUserChip } from "./github-chips";
import { GitHubCommentComposer } from "./github-comment-composer";
import { GitHubAssigneePicker, GitHubLabelPicker } from "./github-metadata-pickers";
import { LabelBadges } from "./pr-status";

interface GitHubIssueViewerProps {
  issueNumber: number;
  repoPath?: string;
  bufferId: string;
}

const GitHubIssueViewer = memo(({ issueNumber, repoPath, bufferId }: GitHubIssueViewerProps) => {
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const buffer = useBufferStore((state) => state.buffers.find((item) => item.id === bufferId));
  const [details, setDetails] = useState<IssueDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCommentCount, setVisibleCommentCount] = useState(8);
  const [commentBody, setCommentBody] = useState("");
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [milestones, setMilestones] = useState<IssueMilestone[]>([]);
  const [issueTypes, setIssueTypes] = useState<IssueType[]>([]);
  const currentUser = useGitHubStore((state) => state.currentUser);
  const repositoryUrl = useMemo(
    () => details?.url.replace(/\/issues\/\d+$/, "") ?? undefined,
    [details?.url],
  );
  const visibleComments = useMemo(
    () => details?.comments.slice(0, visibleCommentCount) ?? [],
    [details?.comments, visibleCommentCount],
  );
  const availableLabels = useMemo(() => {
    const labelsByName = new Map(labels.map((label) => [label.name, label]));
    for (const label of details?.labels ?? []) labelsByName.set(label.name, label);
    return Array.from(labelsByName.values());
  }, [details?.labels, labels]);

  const fetchIssue = useCallback(
    async (force = false) => {
      if (!repoPath) {
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cacheKey = `${repoPath}::${issueNumber}`;
      const cached = githubIssueDetailsCache.getFreshValue(cacheKey, GITHUB_ISSUE_DETAILS_TTL_MS);
      if (cached && !force) {
        setDetails(cached);
        setError(null);
        setIsLoading(false);
        return;
      }

      const stale = githubIssueDetailsCache.getSnapshot(cacheKey)?.value;
      if (stale && !force) {
        setDetails(stale);
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextDetails = await githubIssueDetailsCache.load(
          cacheKey,
          () =>
            invoke<IssueDetails>("github_get_issue_details", {
              repoPath,
              issueNumber,
            }),
          { force, ttlMs: GITHUB_ISSUE_DETAILS_TTL_MS },
        );
        setDetails(nextDetails);
        setError(null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setIsLoading(false);
      }
    },
    [issueNumber, repoPath],
  );

  useEffect(() => {
    void fetchIssue();
  }, [fetchIssue]);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;

    void Promise.all([
      invoke<Label[]>("github_list_labels", { repoPath }).catch(() => []),
      invoke<IssueMilestone[]>("github_list_milestones", { repoPath }).catch(() => []),
      invoke<IssueType[]>("github_list_issue_types", { repoPath }).catch(() => []),
    ]).then(([nextLabels, nextMilestones, nextIssueTypes]) => {
      if (cancelled) return;
      setLabels(nextLabels);
      setMilestones(nextMilestones);
      setIssueTypes(nextIssueTypes);
    });

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    if (!details || !buffer || buffer.type !== "githubIssue") return;

    const authorAvatarUrl = getGitHubAvatarUrl(details.author);

    if (
      buffer.name === details.title &&
      buffer.authorAvatarUrl === authorAvatarUrl &&
      buffer.url === details.url
    ) {
      return;
    }

    updateBuffer({
      ...buffer,
      name: details.title,
      authorAvatarUrl,
      url: details.url,
    });
  }, [buffer, details, updateBuffer]);

  useEffect(() => {
    setVisibleCommentCount(8);
  }, [details?.number]);

  useEffect(() => {
    const totalComments = details?.comments.length ?? 0;
    if (totalComments <= visibleCommentCount) return;

    let cancelled = false;
    const idleApi = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const schedule = idleApi.requestIdleCallback;

    const revealMore = () => {
      if (cancelled) return;
      setVisibleCommentCount((current) => Math.min(current + 12, totalComments));
    };

    if (typeof schedule === "function") {
      const idleId = schedule(revealMore, { timeout: 200 });
      return () => {
        cancelled = true;
        idleApi.cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = window.setTimeout(revealMore, 16);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [details?.comments.length, visibleCommentCount]);

  const handleOpenInBrowser = useCallback(() => {
    if (!details?.url) {
      toast.error("Issue link is not available.");
      return;
    }
    void openUrl(details.url);
  }, [details?.url]);

  const handleCopyIssueLink = useCallback(() => {
    if (!details?.url) {
      toast.error("Issue link is not available.");
      return;
    }
    void copyToClipboard(details.url, "Issue link copied");
  }, [details?.url]);

  const applyIssueDetails = useCallback(
    (nextDetails: IssueDetails) => {
      if (!repoPath) return;
      githubIssueDetailsCache.set(`${repoPath}::${issueNumber}`, nextDetails);
      githubIssueListCache.clear();
      setDetails(nextDetails);
    },
    [issueNumber, repoPath],
  );

  const runMutation = useCallback(
    async <T,>(key: string, mutation: () => Promise<T>, onSuccess: (value: T) => void) => {
      if (mutationKey) return false;
      setMutationKey(key);
      try {
        const result = await mutation();
        onSuccess(result);
        return true;
      } catch (nextError) {
        toast.error(nextError instanceof Error ? nextError.message : String(nextError));
        return false;
      } finally {
        setMutationKey(null);
      }
    },
    [mutationKey],
  );

  const updateIssueState = useCallback(
    async (state: "open" | "closed", stateReason: "reopened" | "completed" | "not_planned") => {
      if (!repoPath) return;
      await runMutation(
        "state",
        () =>
          invoke<IssueDetails>("github_update_issue_state", {
            repoPath,
            issueNumber,
            state,
            stateReason,
          }),
        (nextDetails) => {
          applyIssueDetails(nextDetails);
          toast.success(state === "open" ? "Issue reopened" : "Issue closed");
        },
      );
    },
    [applyIssueDetails, issueNumber, repoPath, runMutation],
  );

  const updateIssue = useCallback(
    (
      changes: Partial<
        Pick<IssueDetails, "title" | "body" | "labels" | "assignees" | "milestone" | "issueType">
      >,
    ) => {
      if (!repoPath || !details) return Promise.resolve(false);
      const next = { ...details, ...changes };

      return runMutation(
        "edit",
        () =>
          invoke<IssueDetails>("github_update_issue", {
            repoPath,
            issueNumber,
            title: next.title,
            body: next.body,
            labels: next.labels.map((label) => label.name),
            assignees: next.assignees.map((assignee) => assignee.login),
            milestone: next.milestone?.number ?? null,
            issueType: next.issueType?.name ?? null,
          }),
        (nextDetails) => {
          applyIssueDetails(nextDetails);
          toast.success("Issue updated");
        },
      );
    },
    [applyIssueDetails, details, issueNumber, repoPath, runMutation],
  );

  const updateLock = useCallback(
    async (lockReason?: "off-topic" | "too heated" | "resolved" | "spam") => {
      if (!repoPath || !details) return;
      const shouldUnlock = details.locked;
      await runMutation(
        "lock",
        () =>
          shouldUnlock
            ? invoke("github_unlock_issue", { repoPath, issueNumber })
            : invoke("github_lock_issue", { repoPath, issueNumber, lockReason }),
        () => {
          githubIssueDetailsCache.clear(`${repoPath}::${issueNumber}`);
          void fetchIssue(true);
          toast.success(shouldUnlock ? "Issue unlocked" : "Issue locked");
        },
      );
    },
    [details, fetchIssue, issueNumber, repoPath, runMutation],
  );

  const addComment = useCallback(async () => {
    if (!repoPath || !commentBody.trim() || details?.locked) return false;
    return runMutation(
      "new-comment",
      () =>
        invoke<IssueComment>("github_add_issue_comment", {
          repoPath,
          issueNumber,
          body: commentBody,
        }),
      (comment) => {
        if (details) applyIssueDetails({ ...details, comments: [...details.comments, comment] });
        setCommentBody("");
        setVisibleCommentCount(Number.MAX_SAFE_INTEGER);
        toast.success("Comment added");
      },
    );
  }, [applyIssueDetails, commentBody, details, issueNumber, repoPath, runMutation]);

  const editComment = useCallback(
    (commentId: number, body: string) => {
      if (!repoPath) return Promise.resolve(false);
      return runMutation(
        `comment-${commentId}`,
        () => invoke<IssueComment>("github_update_issue_comment", { repoPath, commentId, body }),
        (comment) => {
          if (details) {
            applyIssueDetails({
              ...details,
              comments: details.comments.map((item) => (item.id === commentId ? comment : item)),
            });
          }
          toast.success("Comment updated");
        },
      );
    },
    [applyIssueDetails, details, repoPath, runMutation],
  );

  const deleteComment = useCallback(
    async (commentId: number) => {
      if (!repoPath) return;
      await runMutation(
        `comment-${commentId}`,
        () => invoke("github_delete_issue_comment", { repoPath, commentId }),
        () => {
          if (details) {
            applyIssueDetails({
              ...details,
              comments: details.comments.filter((item) => item.id !== commentId),
            });
          }
          toast.success("Comment deleted");
        },
      );
    },
    [applyIssueDetails, details, repoPath, runMutation],
  );

  const isOpen = details?.state.toLowerCase() === "open";
  const assigneeLogins = details?.assignees.map((assignee) => assignee.login) ?? [];
  const changeAssignees = (usernames: string[]) => {
    if (!details) return;
    void updateIssue({
      assignees: usernames.map(
        (login) => details.assignees.find((assignee) => assignee.login === login) ?? { login },
      ),
    });
  };
  const selectedLabelNames = new Set(details?.labels.map((label) => label.name) ?? []);
  const changeLabels = (selectedNames: Set<string>) => {
    void updateIssue({
      labels: availableLabels.filter((label) => selectedNames.has(label.name)),
    });
  };

  return (
    <ResourceDocument
      summary={
        details ? (
          <ResourceSummary
            actions={
              <>
                {isOpen ? (
                  <Button
                    type="button"
                    onClick={() => void updateIssueState("closed", "completed")}
                    disabled={Boolean(mutationKey)}
                    variant="ghost"
                  >
                    {mutationKey === "state" ? (
                      <Spinner label="Closing" compact />
                    ) : (
                      <CheckCircleIcon />
                    )}
                    Close
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => void updateIssueState("open", "reopened")}
                    disabled={!details || Boolean(mutationKey)}
                    variant="ghost"
                  >
                    {mutationKey === "state" ? (
                      <Spinner label="Reopening" compact />
                    ) : (
                      <CircleDotIcon />
                    )}
                    Reopen
                  </Button>
                )}
                <ResourceActionsMenu label="Issue actions">
                  {isOpen ? (
                    <DropdownMenuItem
                      disabled={Boolean(mutationKey)}
                      onClick={() => void updateIssueState("closed", "not_planned")}
                    >
                      Close as not planned
                    </DropdownMenuItem>
                  ) : null}
                  {details?.locked ? (
                    <DropdownMenuItem
                      disabled={Boolean(mutationKey)}
                      onClick={() => void updateLock()}
                    >
                      <LockOpenIcon />
                      Unlock conversation
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem
                        disabled={Boolean(mutationKey)}
                        onClick={() => void updateLock("resolved")}
                      >
                        <LockIcon />
                        Lock as resolved
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={Boolean(mutationKey)}
                        onClick={() => void updateLock("off-topic")}
                      >
                        Lock as off-topic
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={Boolean(mutationKey)}
                        onClick={() => void updateLock("too heated")}
                      >
                        Lock as too heated
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={Boolean(mutationKey)}
                        onClick={() => void updateLock("spam")}
                      >
                        Lock as spam
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem
                    disabled={isLoading && Boolean(details)}
                    onClick={() => void fetchIssue(true)}
                  >
                    {isLoading && details ? "Refreshing..." : "Refresh"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleOpenInBrowser}>Open on GitHub</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyIssueLink}>Copy link</DropdownMenuItem>
                </ResourceActionsMenu>
              </>
            }
            icon={<CircleDotIcon className={isOpen ? "text-success" : "text-subtle-foreground"} />}
            title={
              <GitHubInlineTitle value={details.title} onSave={(title) => updateIssue({ title })} />
            }
            badges={
              <>
                <Badge variant={isOpen ? "success" : "muted"}>
                  {details.stateReason
                    ? `${details.state.toLowerCase()} as ${details.stateReason.replace("_", " ")}`
                    : details.state.toLowerCase()}
                </Badge>
                {details.locked ? (
                  <Badge variant="warning">
                    <LockIcon />
                    {details.activeLockReason ? `Locked as ${details.activeLockReason}` : "Locked"}
                  </Badge>
                ) : null}
              </>
            }
            meta={
              <>
                <GitHubMetaChip title="Issue number">{`#${issueNumber}`}</GitHubMetaChip>
                <GitHubUserChip
                  login={details.author.login}
                  avatarUrl={details.author.avatarUrl}
                  className="text-foreground"
                  avatarSize="sm"
                />
                <GitHubMetaChip title={new Date(details.createdAt).toLocaleString()}>
                  {`Opened ${getTimeAgo(details.createdAt)}`}
                </GitHubMetaChip>
                <GitHubMetaChip title={new Date(details.updatedAt).toLocaleString()}>
                  {`Updated ${getTimeAgo(details.updatedAt)}`}
                </GitHubMetaChip>
                {isLoading ? <Spinner label="Refreshing" compact /> : null}
                {details.closedAt ? (
                  <GitHubMetaChip title={new Date(details.closedAt).toLocaleString()}>
                    {`Closed ${getTimeAgo(details.closedAt)}`}
                  </GitHubMetaChip>
                ) : null}
                {details.closedBy ? (
                  <GitHubUserChip
                    login={details.closedBy.login}
                    avatarUrl={details.closedBy.avatarUrl}
                    prefix={<span className="mr-1 text-subtle-foreground">Closed by</span>}
                  />
                ) : null}
                <GitHubMetaChip title="Comments">
                  {`${details.comments.length} comment${details.comments.length === 1 ? "" : "s"}`}
                </GitHubMetaChip>
              </>
            }
          />
        ) : null
      }
    >
      {error ? (
        <ViewerErrorState
          message={error}
          actionLabel="Retry"
          onAction={() => void fetchIssue(true)}
          layout="section"
        />
      ) : details ? (
        <ResourceSidebarLayout
          sidebar={
            <>
              <ResourceSection title="Type">
                <Select
                  value={details.issueType?.name ?? "none"}
                  options={[
                    { value: "none", label: "No type" },
                    ...issueTypes.map((issueType) => ({
                      value: issueType.name,
                      label: issueType.name,
                    })),
                  ]}
                  onChange={(value) => {
                    const issueType = issueTypes.find((item) => item.name === value) ?? null;
                    void updateIssue({ issueType });
                  }}
                  variant="ghost"
                  width="full"
                  align="start"
                  aria-label="Issue type"
                />
              </ResourceSection>

              <ResourceSection
                title="Milestone"
                action={
                  details.milestone && repositoryUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      tooltip="Open milestone on GitHub"
                      onClick={() =>
                        void openUrl(
                          getGitHubMilestoneUrl(repositoryUrl, details.milestone?.number ?? 0),
                        )
                      }
                    >
                      <OpenExternalIcon />
                    </Button>
                  ) : null
                }
              >
                <Select
                  value={details.milestone?.number.toString() ?? "none"}
                  options={[
                    { value: "none", label: "No milestone" },
                    ...milestones.map((milestone) => ({
                      value: milestone.number.toString(),
                      label: milestone.title,
                    })),
                  ]}
                  onChange={(value) => {
                    const milestone =
                      milestones.find((item) => item.number.toString() === value) ?? null;
                    void updateIssue({ milestone });
                  }}
                  variant="ghost"
                  width="full"
                  align="start"
                  aria-label="Issue milestone"
                />
              </ResourceSection>

              <ResourceSection
                title="Assignees"
                action={
                  details.assignees.length > 0 ? (
                    <GitHubAssigneePicker value={assigneeLogins} onChange={changeAssignees} />
                  ) : null
                }
              >
                {details.assignees.length > 0 ? (
                  <div className="space-y-2">
                    {details.assignees.map((assignee) => (
                      <div key={assignee.login} className="flex min-w-0 items-center">
                        <GitHubUserChip
                          login={assignee.login}
                          avatarUrl={assignee.avatarUrl}
                          className="text-foreground"
                          avatarSize="sm"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <GitHubAssigneePicker
                    value={assigneeLogins}
                    onChange={changeAssignees}
                    label="Add assignees"
                  />
                )}
              </ResourceSection>

              <ResourceSection
                title="Labels"
                action={
                  details.labels.length > 0 ? (
                    <GitHubLabelPicker
                      labels={availableLabels}
                      selectedNames={selectedLabelNames}
                      onChange={changeLabels}
                    />
                  ) : null
                }
              >
                {details.labels.length > 0 ? (
                  <LabelBadges labels={details.labels} repositoryUrl={repositoryUrl} />
                ) : (
                  <GitHubLabelPicker
                    labels={availableLabels}
                    selectedNames={selectedLabelNames}
                    onChange={changeLabels}
                    label="Add labels"
                  />
                )}
              </ResourceSection>
            </>
          }
        >
          <div className="space-y-8">
            <ResourceSection title="Description">
              <GitHubInlineMarkdown
                value={details.body}
                emptyLabel="No description provided"
                repositoryUrl={repositoryUrl}
                repoPath={repoPath}
                onSave={(body) => updateIssue({ body })}
              />
            </ResourceSection>

            <ResourceSection title="Activity">
              <div className="w-full space-y-3">
                {details.comments.length > 0 ? (
                  visibleComments.map((comment, index) => (
                    <CommentItem
                      key={comment.id || `${comment.author.login}-${comment.createdAt}-${index}`}
                      comment={comment}
                      repositoryUrl={repositoryUrl}
                      repoPath={repoPath}
                      canManage={
                        Boolean(currentUser) &&
                        currentUser?.toLowerCase() === comment.author.login.toLowerCase()
                      }
                      isBusy={mutationKey === `comment-${comment.id}`}
                      onEdit={(body) => editComment(comment.id, body)}
                      onDelete={() => deleteComment(comment.id)}
                    />
                  ))
                ) : (
                  <ViewerState description="No comments yet" layout="section" className="min-h-0" />
                )}
                {details.comments.length > visibleComments.length ? (
                  <div className="px-1 py-2">
                    <Spinner
                      label={`Loading ${details.comments.length - visibleComments.length} more comments`}
                      showLabel
                      compact
                    />
                  </div>
                ) : null}
                <GitHubCommentComposer
                  value={commentBody}
                  onChange={setCommentBody}
                  onSubmit={addComment}
                  isSubmitting={mutationKey === "new-comment"}
                  disabled={details.locked || Boolean(mutationKey)}
                  placeholder={
                    details.locked ? "This conversation is locked" : "Leave a comment..."
                  }
                  currentUser={currentUser}
                  repositoryUrl={repositoryUrl}
                  repoPath={repoPath ?? undefined}
                />
              </div>
            </ResourceSection>
          </div>
        </ResourceSidebarLayout>
      ) : (
        <ViewerLoadingState label="Loading issue" layout="section" />
      )}
    </ResourceDocument>
  );
});

GitHubIssueViewer.displayName = "GitHubIssueViewer";

export default GitHubIssueViewer;
