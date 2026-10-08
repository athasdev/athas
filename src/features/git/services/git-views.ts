import { lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const loadDiffViewer = () => import("../components/diff/git-diff-viewer");
const DiffViewer = lazy(loadDiffViewer);
const GitView = lazy(() => import("../stream/stream-view"));

export function registerGitViews() {
  registerPaneView("diff", {
    component: DiffViewer,
    getProps: (buffer) => ({ bufferId: buffer.id }),
    keyByBuffer: true,
    prefetch: loadDiffViewer,
  });
  registerSidebarView({
    id: "git",
    order: 10,
    component: GitView,
    getProps: ({ rootFolderPath, onFileSelect, isActive }) => ({
      repoPath: rootFolderPath,
      onFileSelect,
      isActive,
    }),
    isAvailable: ({ coreFeatures }) => coreFeatures.git,
    loadsOnDemand: true,
  });
}
