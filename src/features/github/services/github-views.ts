import { lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";
import { registerGitHubResourceViews } from "./github-resource-views";

const GitHubPRsView = lazy(() => import("../components/github-prs-view"));
// Markdown documents edit in the GitHub-flavored markdown editor.
const MarkdownDocumentView = lazy(() =>
  import("../components/markdown-document-view").then((module) => ({
    default: module.MarkdownDocumentView,
  })),
);

export function registerGitHubViews() {
  registerGitHubResourceViews();
  registerSidebarView({
    id: "github-prs",
    order: 20,
    component: GitHubPRsView,
    isAvailable: ({ coreFeatures }) => coreFeatures.github,
    loadsOnDemand: true,
    suspendWhenHidden: true,
  });
  registerPaneView("markdownDocument", {
    component: MarkdownDocumentView,
    getProps: (buffer) => ({ bufferId: buffer.id }),
  });
}
