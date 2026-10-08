import { useCachedPullRequest } from "../hooks/use-cached-pull-request";
import {
  getPullRequestStatus,
  PR_STATUS_BADGE_TONE,
  PULL_REQUEST_STATUS_LABEL,
} from "../services/github-pr-viewer-utils";
import type { PaneViewBuffer } from "@/features/panes/services/pane-view-registry";
import Badge from "@/ui/badge";
import {
  BoltIcon,
  CircleDotIcon,
  GitPullRequestIcon,
  PlusIcon,
  RocketIcon,
  TagIcon,
} from "@/ui/icons";

type GitHubResourceBuffer = PaneViewBuffer<
  "pullRequest" | "githubIssue" | "githubDelivery" | "githubAction" | "githubForm"
>;

/** The icon a detached resource window shows for a GitHub resource. */
export function GitHubResourceIcon({ buffer }: { buffer: GitHubResourceBuffer }) {
  switch (buffer.type) {
    case "pullRequest":
      return <GitPullRequestIcon />;
    case "githubIssue":
      return <CircleDotIcon />;
    case "githubDelivery":
      return buffer.kind === "releases" ? <TagIcon /> : <RocketIcon />;
    case "githubAction":
      return <BoltIcon />;
    case "githubForm":
      return <PlusIcon />;
  }
}

/** Live status of a pull request, for chrome that sits outside the viewer. */
export function PullRequestStatusBadge({ buffer }: { buffer: PaneViewBuffer<"pullRequest"> }) {
  const { details: pr } = useCachedPullRequest(buffer.repoPath, buffer.prNumber);
  if (!pr) return null;
  const status = getPullRequestStatus(pr);
  return <Badge tone={PR_STATUS_BADGE_TONE[status]}>{PULL_REQUEST_STATUS_LABEL[status]}</Badge>;
}

/** A pull request's card in the horizontal tab carousel. */
export function PullRequestCarouselCard({ buffer }: { buffer: PaneViewBuffer<"pullRequest"> }) {
  const { details, comments } = useCachedPullRequest(buffer.repoPath, buffer.prNumber);
  const fileCount = details ? details.changedFiles : null;
  const commentCount = comments ? comments.length : null;
  const commitCount = details ? details.commits.length : null;
  const authorLogin = details ? details.author.login : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 bg-surface px-3 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5 size-4 shrink-0 rounded-lg bg-success-soft" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>#{buffer.prNumber ?? "--"}</Badge>
              <div className="min-w-0 truncate font-medium ui-text-sm text-foreground">
                {buffer.name}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ui-text-sm text-subtle-foreground">
              <span className="font-medium text-muted-foreground">
                {authorLogin ? `@${authorLogin}` : "Pull request"}
              </span>
              <span>{fileCount ?? "--"} files</span>
              <span>{commitCount ?? "--"} commits</span>
              <span>{commentCount ?? "--"} comments</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 ui-text-sm">
              <Badge>Description</Badge>
              <Badge>Files</Badge>
              <Badge>Comments</Badge>
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-background px-3 py-3">
        <div className="rounded-lg bg-surface px-3 py-2">
          <div className="line-clamp-5 ui-text-sm leading-6 text-subtle-foreground">
            {details?.body?.trim()
              ? details.body
              : "Activate this card to inspect the full pull request description, changed files, comments, review state, and checkout actions."}
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-surface px-3 py-2 ui-text-sm text-subtle-foreground">
          {buffer.path}
        </div>
      </div>
    </div>
  );
}
