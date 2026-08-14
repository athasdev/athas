import { memo } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { EmptyState } from "@/ui/empty";
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
        <EmptyState
          layout="sidebar"
          message={<Spinner label="Loading files" showLabel compact />}
        />
      )}
    </SidebarPanel>
  );
}

export const FileExplorerPane = memo(FileExplorerPaneComponent);
