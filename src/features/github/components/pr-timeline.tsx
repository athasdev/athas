import { openCommitDiffBuffer } from "@/features/git/utils/open-commit-diff-buffer";
import { ViewerErrorState, ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import {
  ChatBubbleTextIcon,
  CheckCircleIcon,
  GitCommitIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  XCircleIcon,
} from "@/ui/icons";
import { ResourceSection } from "@/ui/resource";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import { type ReactNode, type RefObject, useMemo } from "react";
import type { Commit } from "../types/github-pr-viewer.types";
import type {
  PullRequestComment,
  PullRequestDetails,
  PullRequestReview,
} from "../types/github.types";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { CommentItem } from "./comment-item";
import { GitHubUserChip } from "./github-chips";
import { GitHubInlineMarkdown } from "./github-inline-editors";
import { GitHubCommentComposer } from "./github-comment-composer";

type TimelineEvent =
  | { kind: "opened"; at: string; pr: PullRequestDetails; commitCount: number }
  | { kind: "commit"; at: string; commit: Commit }
  | { kind: "review"; at: string; review: PullRequestReview }
  | { kind: "comment"; at: string; comment: PullRequestComment; key: string }
  | { kind: "merged"; at: string; pr: PullRequestDetails }
  | { kind: "closed"; at: string };

interface PRTimelineProps {
  pr: PullRequestDetails;
  commits: Commit[];
  comments: PullRequestComment[];
  repositoryUrl: string;
  repoPath?: string;
  currentUser?: string | null;
  isLoadingContent: boolean;
  contentError: string | null;
  onRetry: () => void;
  onBodySave: (body: string) => Promise<boolean>;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onSubmitComment: () => Promise<boolean>;
  isSubmittingComment: boolean;
  commentDisabled?: boolean;
  onEditComment: (commentId: number, body: string) => Promise<boolean>;
  onDeleteComment: (commentId: number) => Promise<void>;
  busyCommentId: number | null;
  composerRef?: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
}

function getCommitAuthor(commit: Commit) {
  const author = commit.authors[0];
  return author?.login || author?.name || "Unknown";
}

function buildTimeline(
  pr: PullRequestDetails,
  commits: Commit[],
  comments: PullRequestComment[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { kind: "opened", at: pr.createdAt, pr, commitCount: commits.length },
  ];

  for (const commit of commits) {
    if (commit.authoredDate) events.push({ kind: "commit", at: commit.authoredDate, commit });
  }
  for (const review of pr.reviews) {
    if (review.submittedAt) events.push({ kind: "review", at: review.submittedAt, review });
  }
  comments.forEach((comment, index) => {
    events.push({
      kind: "comment",
      at: comment.createdAt,
      comment,
      key: `${comment.author.login}-${comment.createdAt}-${index}`,
    });
  });
  if (pr.mergedAt) {
    events.push({ kind: "merged", at: pr.mergedAt, pr });
  } else if (pr.closedAt) {
    events.push({ kind: "closed", at: pr.closedAt });
  }

  const time = (value: string) => new Date(value).getTime() || 0;
  return events.sort((left, right) => time(left.at) - time(right.at));
}

function EventTime({ at }: { at: string }) {
  return (
    <span className="shrink-0 text-subtle-foreground" title={new Date(at).toLocaleString()}>
      {getTimeAgo(at)}
    </span>
  );
}

function EventRow({
  icon,
  tone = "text-subtle-foreground",
  onClick,
  label,
  children,
}: {
  icon: ReactNode;
  tone?: string;
  /** Makes the whole row a button. */
  onClick?: () => void;
  label?: string;
  children: ReactNode;
}) {
  const contentClassName =
    "flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-sans ui-text-sm leading-6 text-subtle-foreground";
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border/70 [&_svg]:size-3.5 ${tone}`}
      >
        {icon}
      </span>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={`${contentClassName} -mx-1.5 -my-0.5 rounded-chrome px-1.5 py-0.5 text-left transition-colors duration-fast hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none`}
        >
          {children}
        </button>
      ) : (
        <div className={contentClassName}>{children}</div>
      )}
    </div>
  );
}

function ReviewEvent({ review }: { review: PullRequestReview }) {
  const state =
    review.state === "APPROVED"
      ? { icon: <CheckCircleIcon />, tone: "text-success", label: "approved these changes" }
      : review.state === "CHANGES_REQUESTED"
        ? { icon: <XCircleIcon />, tone: "text-destructive", label: "requested changes" }
        : { icon: <ChatBubbleTextIcon />, tone: "text-subtle-foreground", label: "reviewed" };

  return (
    <EventRow icon={state.icon} tone={state.tone}>
      <GitHubUserChip
        login={review.login}
        avatarUrl={review.avatarUrl}
        className="text-foreground"
      />
      <span>{state.label}</span>
      {review.submittedAt ? <EventTime at={review.submittedAt} /> : null}
    </EventRow>
  );
}

export function PRTimeline({
  pr,
  commits,
  comments,
  repositoryUrl,
  repoPath,
  currentUser,
  isLoadingContent,
  contentError,
  onRetry,
  onBodySave,
  commentDraft,
  onCommentDraftChange,
  onSubmitComment,
  isSubmittingComment,
  commentDisabled,
  onEditComment,
  onDeleteComment,
  busyCommentId,
  composerRef,
  children,
}: PRTimelineProps) {
  const events = useMemo(() => buildTimeline(pr, commits, comments), [pr, commits, comments]);

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

  const renderEvent = (event: TimelineEvent) => {
    switch (event.kind) {
      case "opened":
        return (
          <EventRow icon={<GitPullRequestIcon />} tone="text-success">
            <GitHubUserChip
              login={event.pr.author.login}
              avatarUrl={event.pr.author.avatarUrl}
              className="text-foreground"
            />
            <span>
              {`opened this pull request${
                event.commitCount > 0
                  ? ` with ${event.commitCount} commit${event.commitCount === 1 ? "" : "s"}`
                  : ""
              }`}
            </span>
            <EventTime at={event.at} />
          </EventRow>
        );
      case "commit":
        return (
          <EventRow
            icon={<GitCommitIcon />}
            onClick={() => void openCommit(event.commit)}
            label={`Open commit ${event.commit.oid.slice(0, 7)}`}
          >
            <span className="text-foreground">{getCommitAuthor(event.commit)}</span>
            <span>committed</span>
            <span className="font-mono">{event.commit.oid.slice(0, 7)}</span>
            <span className="min-w-0 truncate text-foreground">{event.commit.messageHeadline}</span>
            <EventTime at={event.at} />
          </EventRow>
        );
      case "review":
        return (
          <div className="space-y-3">
            <ReviewEvent review={event.review} />
            {event.review.body.trim() ? (
              <div className="pl-9">
                <CommentItem
                  comment={{
                    author: { login: event.review.login },
                    body: event.review.body,
                    createdAt: event.review.submittedAt ?? event.at,
                  }}
                  repositoryUrl={repositoryUrl}
                  repoPath={repoPath}
                />
              </div>
            ) : null}
          </div>
        );
      case "comment":
        return (
          <div className="space-y-3">
            <EventRow icon={<ChatBubbleTextIcon />}>
              <GitHubUserChip
                login={event.comment.author.login}
                avatarUrl={event.comment.author.avatarUrl}
                className="text-foreground"
              />
              <span>commented</span>
              <EventTime at={event.at} />
            </EventRow>
            <div className="pl-9">
              <CommentItem
                comment={event.comment}
                repositoryUrl={repositoryUrl}
                repoPath={repoPath}
                canManage={
                  Boolean(currentUser) &&
                  currentUser?.toLowerCase() === event.comment.author.login.toLowerCase()
                }
                isBusy={busyCommentId === event.comment.id}
                onEdit={(body) => onEditComment(event.comment.id, body)}
                onDelete={() => onDeleteComment(event.comment.id)}
              />
            </div>
          </div>
        );
      case "merged":
        return (
          <EventRow icon={<GitMergeIcon />} tone="text-primary">
            {event.pr.mergedBy ? (
              <>
                <GitHubUserChip
                  login={event.pr.mergedBy.login}
                  avatarUrl={event.pr.mergedBy.avatarUrl}
                  className="text-foreground"
                />
                <span>merged this pull request</span>
              </>
            ) : (
              <span>Merged</span>
            )}
            <EventTime at={event.at} />
          </EventRow>
        );
      case "closed":
        return (
          <EventRow icon={<XCircleIcon />} tone="text-destructive">
            <span>Closed without merging</span>
            <EventTime at={event.at} />
          </EventRow>
        );
    }
  };

  const eventKey = (event: TimelineEvent) => {
    switch (event.kind) {
      case "commit":
        return `commit-${event.commit.oid}`;
      case "review":
        return `review-${event.review.login}-${event.at}`;
      case "comment":
        return `comment-${event.key}`;
      default:
        return event.kind;
    }
  };

  return (
    <div className="w-full min-w-0 space-y-8">
      <ResourceSection title="Description">
        <GitHubInlineMarkdown
          value={pr.body}
          emptyLabel="No description provided"
          repositoryUrl={repositoryUrl}
          repoPath={repoPath}
          onSave={onBodySave}
        />
      </ResourceSection>

      <ResourceSection title="Activity">
        <div className="space-y-4">
          <ol className="relative space-y-4 before:absolute before:top-3 before:bottom-3 before:left-3 before:w-px before:bg-border/60">
            {events.map((event) => (
              <li key={eventKey(event)} className="relative">
                {renderEvent(event)}
              </li>
            ))}
            {isLoadingContent && comments.length === 0 ? (
              <li className="relative">
                <EventRow icon={<Spinner label="Loading activity" compact />}>
                  <span>Loading activity</span>
                </EventRow>
              </li>
            ) : null}
          </ol>

          {contentError ? (
            <ViewerErrorState
              message={contentError}
              actionLabel="Retry"
              onAction={onRetry}
              layout="section"
              className="min-h-0"
            />
          ) : null}
          {isLoadingContent && comments.length === 0 && events.length <= 1 ? (
            <ViewerLoadingState label="Loading activity" layout="section" className="min-h-0" />
          ) : null}

          {children}

          <GitHubCommentComposer
            value={commentDraft}
            onChange={onCommentDraftChange}
            onSubmit={onSubmitComment}
            isSubmitting={isSubmittingComment}
            disabled={commentDisabled}
            repositoryUrl={repositoryUrl}
            repoPath={repoPath}
            currentUser={currentUser}
            containerRef={composerRef}
          />
        </div>
      </ResourceSection>
    </div>
  );
}
