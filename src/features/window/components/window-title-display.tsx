import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
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
        "flex h-6 min-w-[120px] max-w-[260px] items-center justify-center rounded-md px-2",
        "ui-text-sm text-text-lighter transition-colors hover:bg-hover/60 hover:text-text",
      )}
      aria-label="Switch project"
    >
      <span className="truncate">{title}</span>
    </button>
  );
}
