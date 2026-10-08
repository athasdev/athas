import { useEffect, useMemo } from "react";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { useWorkspaceManagementStore } from "../stores/workspace-management.store";
import { useProjectStore } from "@/features/window/stores/project.store";

export function useWorkspaceSelection() {
  const activeRoot = useProjectStore((state) => state.rootFolderPath);
  const tabs = useWorkspaceTabsStore.use.projectTabs();
  const roots = useWorkspaceManagementStore.use.roots();
  const selectedRoot = useWorkspaceManagementStore.use.selectedRoot();
  const drafts = useWorkspaceManagementStore.use.drafts();
  const { load } = useWorkspaceManagementStore.use.actions();
  const root = selectedRoot || activeRoot || roots[0] || tabs[0]?.path;
  const paths = useMemo(
    () => [
      ...new Set([...roots, ...tabs.map((tab) => tab.path), ...(activeRoot ? [activeRoot] : [])]),
    ],
    [roots, tabs, activeRoot],
  );

  useEffect(() => {
    if (root) void load(root);
  }, [root, load]);

  return { root, activeRoot, paths, drafts, draft: root ? drafts[root] : undefined };
}
