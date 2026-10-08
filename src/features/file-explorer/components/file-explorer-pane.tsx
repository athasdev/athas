import { memo } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { EmptyState } from "@/ui/empty";
import { SidebarPanel } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { FileExplorerTree } from "./file-explorer-tree";
import { useProjectStore } from "@/features/window/stores/project.store";

function FileExplorerPaneComponent() {
  const setFiles = useFileSystemStore((state) => state.setFiles);
  const handleCreateNewFolderInDirectory = useFileSystemStore(
    (state) => state.handleCreateNewFolderInDirectory,
  );
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const handleFileOpen = useFileSystemStore((state) => state.handleFileOpen);
  const handleCreateNewFileInDirectory = useFileSystemStore(
    (state) => state.handleCreateNewFileInDirectory,
  );
  const handleDeletePath = useFileSystemStore((state) => state.handleDeletePath);
  const refreshDirectory = useFileSystemStore((state) => state.refreshDirectory);
  const handleFileMove = useFileSystemStore((state) => state.handleFileMove);
  const handleRevealInFolder = useFileSystemStore((state) => state.handleRevealInFolder);
  const handleDuplicatePath = useFileSystemStore((state) => state.handleDuplicatePath);
  const handleRenamePath = useFileSystemStore((state) => state.handleRenamePath);

  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const files = useFileSystemStore.use.files();
  const isFileTreeLoading = useFileSystemStore.use.isFileTreeLoading();
  const isSwitchingProject = useFileSystemStore.use.isSwitchingProject();

  const activePath = useSidebarStore((state) => state.activePath);
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
