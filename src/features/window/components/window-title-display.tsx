import { Folder, Server } from "lucide-react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
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
  const activeProject = projectTabs.find((tab) => tab.isActive);
  const title = activeProject?.name || getWorkspaceName(rootFolderPath);
  const isRemote = (activeProject?.path || rootFolderPath || "").startsWith("remote://");

  if (!title) {
    return <div className="h-6 min-w-[120px]" aria-hidden="true" />;
  }

  return (
    <div
      className={cn(
        "flex h-6 min-w-[120px] max-w-[260px] items-center justify-center gap-1.5 px-2",
        "ui-text-sm text-text-lighter",
      )}
    >
      {isRemote ? (
        <Server className="size-3.5 shrink-0" />
      ) : (
        <Folder className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{title}</span>
    </div>
  );
}
