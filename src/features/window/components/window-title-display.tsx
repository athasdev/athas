import { LayoutPanelTop } from "lucide-react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { UnifiedTab } from "@/ui/unified-tab";

const getWorkspaceName = (path?: string) => {
  if (!path) return "Athas";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
};

export default function WindowTitleDisplay() {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const activeProject = projectTabs.find((tab) => tab.isActive);
  const title = activeProject?.name || getWorkspaceName(rootFolderPath);

  return (
    <UnifiedTab
      isActive
      size="sm"
      className="min-w-[180px] cursor-default justify-center border border-border/70 bg-primary-bg/70 px-4 text-text"
    >
      <LayoutPanelTop size={12} className="text-text-lighter" />
      <span className="truncate">{title}</span>
    </UnifiedTab>
  );
}
