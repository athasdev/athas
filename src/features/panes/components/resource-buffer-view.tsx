import { lazy } from "react";
import { useGitHubStore } from "@/features/github/stores/github.store";
import {
  getPullRequestStatus,
  PR_STATUS_BADGE_VARIANT,
  PULL_REQUEST_STATUS_LABEL,
} from "@/features/github/utils/github-pr-viewer-utils";
import Badge from "@/ui/badge";
import type { OpenContentSpec, PaneContent } from "@/features/panes/types/pane-content.types";
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

/** The spec that reopens this buffer elsewhere, or null when it cannot be reopened. */
export function toResourceContentSpec(buffer: ResourceBuffer): OpenContentSpec | null {
  switch (buffer.type) {
    case "pullRequest":
      return {
        type: "pullRequest",
        prNumber: buffer.prNumber,
        repoPath: buffer.repoPath,
        authorAvatarUrl: buffer.authorAvatarUrl,
        name: buffer.name,
      };
    case "githubIssue":
      return {
        type: "githubIssue",
        issueNumber: buffer.issueNumber,
        repoPath: buffer.repoPath,
        authorAvatarUrl: buffer.authorAvatarUrl,
        name: buffer.name,
        url: buffer.url,
      };
    case "githubDelivery":
      return {
        type: "githubDelivery",
        kind: buffer.kind,
        repoPath: buffer.repoPath,
        resourceId: buffer.resourceId,
        name: buffer.name,
      };
    case "githubAction":
      if (buffer.runId !== undefined) {
        return {
          type: "githubAction",
          runId: buffer.runId,
          repoPath: buffer.repoPath,
          name: buffer.name,
          url: buffer.url,
        };
      }
      if (buffer.notification) {
        return {
          type: "githubAction",
          notification: buffer.notification,
          repoPath: buffer.repoPath,
          name: buffer.name,
          url: buffer.url,
        };
      }
      return null;
    case "githubForm":
      return {
        type: "githubForm",
        repoPath: buffer.repoPath,
        formKind: buffer.formKind,
        operation: buffer.operation,
        defaultHead: buffer.defaultHead,
      };
  }
}

/** Live status of the resource, for chrome that sits outside the viewer. */
export function ResourceBufferBadge({ buffer }: { buffer: ResourceBuffer }) {
  const pr = useGitHubStore((state) => state.selectedPRDetails);
  if (buffer.type !== "pullRequest" || !pr || pr.number !== buffer.prNumber) return null;
  const status = getPullRequestStatus(pr);
  return (
    <Badge variant={PR_STATUS_BADGE_VARIANT[status]}>{PULL_REQUEST_STATUS_LABEL[status]}</Badge>
  );
}
