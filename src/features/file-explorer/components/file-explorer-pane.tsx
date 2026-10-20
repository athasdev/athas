import { memo } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { EmptyState } from "@/ui/empty";
import { ArrowClockwiseIcon, ChevronDoubleUpIcon, FilePlusIcon, FolderPlusIcon } from "@/ui/icons";
import { SidebarIconButton, SidebarPanel } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { FileExplorerTree } from "./file-explorer-tree";
import { useFileTreeStore } from "../stores/file-explorer-tree.store";
import type { SidebarViewHeaderProps } from "@/features/layout/services/sidebar-view-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";

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

/** The Files pane header's actions, all on the project root. */
export function FileExplorerHeaderActions({ rootFolderPath }: SidebarViewHeaderProps) {
  const handleCreateNewFileInDirectory = useFileSystemStore(
    (state) => state.handleCreateNewFileInDirectory,
  );
  const handleCreateNewFolderInDirectory = useFileSystemStore(
    (state) => state.handleCreateNewFolderInDirectory,
  );
  const refreshDirectory = useFileSystemStore((state) => state.refreshDirectory);
  if (!rootFolderPath) return null;
  return (
    <>
      <SidebarIconButton
        tooltip="New File"
        aria-label="New file"
        onClick={() => void handleCreateNewFileInDirectory(rootFolderPath)}
      >
        <FilePlusIcon />
      </SidebarIconButton>
      <SidebarIconButton
        tooltip="New Folder"
        aria-label="New folder"
        onClick={() => void handleCreateNewFolderInDirectory(rootFolderPath)}
      >
        <FolderPlusIcon />
      </SidebarIconButton>
      <SidebarIconButton
        tooltip="Refresh"
        aria-label="Refresh files"
        onClick={() => void refreshDirectory(rootFolderPath, { force: true })}
      >
        <ArrowClockwiseIcon />
      </SidebarIconButton>
      <SidebarIconButton
        tooltip="Collapse All"
        aria-label="Collapse all folders"
        onClick={() => useFileTreeStore.getState().actions.collapseAll()}
      >
        <ChevronDoubleUpIcon />
      </SidebarIconButton>
    </>
  );
}
