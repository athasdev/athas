import { lazy } from "react";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";
import {
  GitHubResourceIcon,
  PullRequestCarouselCard,
  PullRequestStatusBadge,
} from "../components/github-resource-chrome";

const GitHubPRViewer = lazy(() => import("../components/github-pr-viewer"));
const GitHubIssueViewer = lazy(() => import("../components/github-issue-viewer"));
const GitHubDeliveryViewer = lazy(() => import("../delivery/components/github-delivery-viewer"));
const GitHubActionViewer = lazy(() => import("../components/github-action-viewer"));
const GitHubCreateView = lazy(() =>
  import("../components/github-create-view").then((module) => ({
    default: module.GitHubCreateView,
  })),
);
/** The resource views of GitHub buffers; detached resource windows register these too. */
export function registerGitHubResourceViews() {
  registerPaneView("pullRequest", {
    component: GitHubPRViewer,
    getProps: (buffer) => ({ prNumber: buffer.prNumber, bufferId: buffer.id }),
    carouselCard: PullRequestCarouselCard,
    resource: { icon: GitHubResourceIcon, badge: PullRequestStatusBadge },
  });
  registerPaneView("githubIssue", {
    component: GitHubIssueViewer,
    getProps: (buffer) => ({
      issueNumber: buffer.issueNumber,
      repoPath: buffer.repoPath,
      bufferId: buffer.id,
    }),
    resource: { icon: GitHubResourceIcon },
  });
  registerPaneView("githubDelivery", {
    component: GitHubDeliveryViewer,
    getProps: (buffer) => ({ buffer }),
    keyByBuffer: true,
    resource: { icon: GitHubResourceIcon },
  });
  registerPaneView("githubAction", {
    component: GitHubActionViewer,
    getProps: (buffer) => ({
      runId: buffer.runId,
      notification: buffer.notification,
      repoPath: buffer.repoPath,
      bufferId: buffer.id,
    }),
    resource: { icon: GitHubResourceIcon },
  });
  registerPaneView("githubForm", {
    component: GitHubCreateView,
    getProps: (buffer) => ({ buffer }),
    resource: { icon: GitHubResourceIcon },
  });
}
