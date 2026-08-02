import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { cn } from "@/utils/cn";

const getWorkspaceName = (path?: string) => {
  if (!path) return "";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
};

export default function WindowTitleDisplay() {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);
  const activeProject = projectTabs.find((tab) => tab.isActive);
  const title = activeProject?.name || getWorkspaceName(rootFolderPath);

  if (!title) {
    return <div className="h-6 min-w-[120px]" aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      onClick={() => setIsProjectPickerVisible(true)}
      className={cn(
        "athas-title-project-surface ui-text-chrome flex h-(--athas-chrome-control-height) w-fit max-w-[260px] items-center justify-center rounded-[var(--athas-chrome-radius)] border border-transparent px-2",
        "text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
      )}
      aria-label="Switch project"
    >
      <span className="truncate">{title}</span>
    </button>
  );
}
