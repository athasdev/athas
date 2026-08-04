import { memo } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { SidebarPanel } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { FileExplorerTree } from "./file-explorer-tree";

function FileExplorerPaneComponent() {
  const setFiles = useFileSystemStore.use.setFiles?.();
  const handleCreateNewFolderInDirectory =
    useFileSystemStore.use.handleCreateNewFolderInDirectory?.();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const handleFileOpen = useFileSystemStore.use.handleFileOpen?.();
  const handleCreateNewFileInDirectory = useFileSystemStore.use.handleCreateNewFileInDirectory?.();
  const handleDeletePath = useFileSystemStore.use.handleDeletePath?.();
  const refreshDirectory = useFileSystemStore.use.refreshDirectory?.();
  const handleFileMove = useFileSystemStore.use.handleFileMove?.();
  const handleRevealInFolder = useFileSystemStore.use.handleRevealInFolder?.();
  const handleDuplicatePath = useFileSystemStore.use.handleDuplicatePath?.();
  const handleRenamePath = useFileSystemStore.use.handleRenamePath?.();

  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const files = useFileSystemStore.use.files();
  const isFileTreeLoading = useFileSystemStore.use.isFileTreeLoading();
  const isSwitchingProject = useFileSystemStore.use.isSwitchingProject();

  const activePath = useSidebarStore.use.activePath?.();
  const updateActivePath = useSidebarStore.use.actions().updateActivePath;

  return (
    <SidebarPanel className="relative">
      {(!isFileTreeLoading || isSwitchingProject) && (
        <FileExplorerTree
          files={files}
          activePath={activePath}
          updateActivePath={updateActivePath}
          rootFolderPath={rootFolderPath}
          onFileSelect={handleFileSelect}
          onFileOpen={handleFileOpen}
          onCreateNewFileInDirectory={handleCreateNewFileInDirectory}
          onCreateNewFolderInDirectory={handleCreateNewFolderInDirectory}
          onDeletePath={handleDeletePath}
          onUpdateFiles={setFiles}
          onRefreshDirectory={refreshDirectory}
          onRenamePath={handleRenamePath}
          onRevealInFinder={handleRevealInFolder}
          onFileMove={handleFileMove}
          onDuplicatePath={handleDuplicatePath}
        />
      )}

      {isFileTreeLoading && !isSwitchingProject && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center p-3">
          <div className="rounded-full border border-border/60 bg-surface/92 px-3 py-1.5 shadow-(--shadow-popover) backdrop-blur-sm">
            <Spinner label="Loading files" showLabel className="ui-text-sm" />
          </div>
        </div>
      )}
    </SidebarPanel>
  );
}

export const FileExplorerPane = memo(FileExplorerPaneComponent);
