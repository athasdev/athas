import { lazy } from "react";
import { useCachedPullRequest } from "@/features/github/hooks/use-cached-pull-request";
import {
  getPullRequestStatus,
  PR_STATUS_BADGE_TONE,
  PULL_REQUEST_STATUS_LABEL,
} from "@/features/github/services/github-pr-viewer-utils";
import Badge from "@/ui/badge";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import {
  BoltIcon,
  CircleDotIcon,
  GitPullRequestIcon,
  PlusIcon,
  RocketIcon,
  TagIcon,
} from "@/ui/icons";

const GitHubPRViewer = lazy(() => import("@/features/github/components/github-pr-viewer"));
const GitHubIssueViewer = lazy(() => import("@/features/github/components/github-issue-viewer"));
const GitHubDeliveryViewer = lazy(
  () => import("@/features/github/delivery/components/github-delivery-viewer"),
);
const GitHubActionViewer = lazy(() => import("@/features/github/components/github-action-viewer"));
const GitHubCreateView = lazy(() =>
  import("@/features/github/components/github-create-view").then((module) => ({
    default: module.GitHubCreateView,
  })),
);

/**
 * Buffers that show a single external resource rather than a file. They render
 * the same way inside a pane and inside a detached window.
 */
export type ResourceBuffer = Extract<
  PaneContent,
  { type: "pullRequest" | "githubIssue" | "githubDelivery" | "githubAction" | "githubForm" }
>;

export function isResourceBuffer(buffer: PaneContent): buffer is ResourceBuffer {
  return (
    buffer.type === "pullRequest" ||
    buffer.type === "githubIssue" ||
    buffer.type === "githubDelivery" ||
    buffer.type === "githubAction" ||
    buffer.type === "githubForm"
  );
}

export function ResourceBufferView({ buffer }: { buffer: ResourceBuffer }) {
  switch (buffer.type) {
    case "pullRequest":
      return <GitHubPRViewer prNumber={buffer.prNumber} bufferId={buffer.id} />;
    case "githubIssue":
      return (
        <GitHubIssueViewer
          issueNumber={buffer.issueNumber}
          repoPath={buffer.repoPath}
          bufferId={buffer.id}
        />
      );
    case "githubDelivery":
      return <GitHubDeliveryViewer key={buffer.id} buffer={buffer} />;
    case "githubAction":
      return (
        <GitHubActionViewer
          runId={buffer.runId}
          notification={buffer.notification}
          repoPath={buffer.repoPath}
          bufferId={buffer.id}
        />
      );
    case "githubForm":
      return <GitHubCreateView buffer={buffer} />;
  }
}

export function ResourceBufferIcon({ buffer }: { buffer: ResourceBuffer }) {
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

/** Live status of the resource, for chrome that sits outside the viewer. */
export function ResourceBufferBadge({ buffer }: { buffer: ResourceBuffer }) {
  if (buffer.type !== "pullRequest") return null;
  return <PullRequestStatusBadge repoPath={buffer.repoPath} prNumber={buffer.prNumber} />;
}

function PullRequestStatusBadge({ repoPath, prNumber }: { repoPath?: string; prNumber: number }) {
  const { details: pr } = useCachedPullRequest(repoPath, prNumber);
  if (!pr) return null;
  const status = getPullRequestStatus(pr);
  return <Badge tone={PR_STATUS_BADGE_TONE[status]}>{PULL_REQUEST_STATUS_LABEL[status]}</Badge>;
}
