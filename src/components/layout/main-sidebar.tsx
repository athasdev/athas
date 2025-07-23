import { FilePlus, FolderOpen, FolderPlus, Server } from "lucide-react";
import type React from "react";
import { forwardRef, useMemo } from "react";
import { cn } from "@/utils/cn";
import { useBufferStore } from "../../stores/buffer-store";
import { useFileSystemStore } from "../../stores/file-system-store";
import { useProjectStore } from "../../stores/project-store";
import { useSidebarStore } from "../../stores/sidebar-store";
import { useUIState } from "../../stores/ui-state-store";
import type { FileEntry } from "../../types/app";
import FileTree from "../file-tree/file-tree";
import GitView from "../git/git-view";
import RemoteConnectionView from "../remote/remote-connection-view";
import SearchView, { type SearchViewRef } from "../search-view";
import Button from "../ui/button";
import { SidebarPaneSelector } from "./sidebar-pane-selector";

// Helper function to flatten the file tree
const flattenFileTree = (files: FileEntry[]): FileEntry[] => {
  const result: FileEntry[] = [];

  const traverse = (entries: FileEntry[]) => {
    for (const entry of entries) {
      result.push(entry);
      if (entry.isDir && entry.children) {
        traverse(entry.children);
      }
    }
  };

  traverse(files);
  return result;
};

export const MainSidebar = forwardRef<SearchViewRef>((_, ref) => {
  // Get state from stores
  const {
    isGitViewActive,
    isSearchViewActive,
    isRemoteViewActive,
    setActiveView,
    setProjectNameMenu,
  } = useUIState();
  const { getProjectName } = useProjectStore();
  const {
    files,
    rootFolderPath,
    isFileTreeLoading,
    setFiles,
    handleOpenFolder,
    handleCreateNewFile,
    handleCreateNewFolderInDirectory,
    handleFileSelect,
    handleCreateNewFileInDirectory,
    handleDeletePath,
    refreshDirectory,
    handleFileMove,
  } = useFileSystemStore();
  const { activeBufferPath, coreFeatures, isRemoteWindow, remoteConnectionName } =
    useSidebarStore();
  const showFileTreeHeader =
    !isGitViewActive && !isSearchViewActive && !isRemoteViewActive && !isRemoteWindow;
  const projectName = getProjectName();

  // Handlers
  const onOpenExtensions = () => {
    const { openBuffer } = useBufferStore.getState();
    openBuffer(
      "extensions://marketplace",
      "Extensions",
      "", // Content will be handled by the component
      false, // not an image
      false, // not SQLite
      false, // not a diff
      true, // is virtual
    );
  };

  const onProjectNameMenuOpen = (event: React.MouseEvent) => {
    event.preventDefault();
    setProjectNameMenu({ x: event.clientX, y: event.clientY });
  };

  // Get all project files by flattening the file tree
  const allProjectFiles = useMemo(() => {
    return flattenFileTree(files);
  }, [files]);

  return (
    <div className="flex h-full flex-col">
      {/* Pane Selection Row */}
      <SidebarPaneSelector
        isGitViewActive={isGitViewActive}
        isSearchViewActive={isSearchViewActive}
        isRemoteViewActive={isRemoteViewActive}
        coreFeatures={coreFeatures}
        onViewChange={setActiveView}
        onOpenExtensions={onOpenExtensions}
      />

      {/* Remote Window Header */}
      {isRemoteWindow && remoteConnectionName && (
        <div className="flex items-center border-border border-b bg-secondary-bg px-2 py-1.5">
          <Server size={12} className="mr-2 text-text-lighter" />
          <span
            className="flex-1 cursor-pointer rounded px-2 py-1 font-medium text-text text-xs hover:bg-hover"
            onClick={onProjectNameMenuOpen}
            onContextMenu={onProjectNameMenuOpen}
            title="Click for workspace options"
          >
            {remoteConnectionName}
          </span>
        </div>
      )}

      {/* File Tree Header */}
      {showFileTreeHeader && (
        <div className="flex items-center justify-between border-border border-b bg-secondary-bg px-2 py-1.5">
          <h3
            className="cursor-pointer rounded px-2 py-1 font-medium font-mono text-text text-xs tracking-wide hover:bg-hover"
            onClick={onProjectNameMenuOpen}
            onContextMenu={onProjectNameMenuOpen}
            title="Click for workspace options"
          >
            {projectName}
          </h3>
          <div className="flex items-center gap-0.5">
            <Button
              onClick={handleOpenFolder}
              variant="ghost"
              size="sm"
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded p-0",
                "text-text-lighter hover:bg-hover hover:text-text",
              )}
              title="Open Folder"
            >
              <FolderOpen size={12} />
            </Button>
            <Button
              onClick={handleCreateNewFile}
              variant="ghost"
              size="sm"
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded p-0",
                "text-text-lighter hover:bg-hover hover:text-text",
              )}
              title="New File"
            >
              <FilePlus size={12} />
            </Button>
            <Button
              onClick={() => {
                if (rootFolderPath) {
                  handleCreateNewFolderInDirectory(rootFolderPath);
                }
              }}
              variant="ghost"
              size="sm"
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded p-0",
                "text-text-lighter hover:bg-hover hover:text-text",
              )}
              title="New Folder"
            >
              <FolderPlus size={12} />
            </Button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        {isGitViewActive && coreFeatures.git ? (
          <GitView repoPath={rootFolderPath} onFileSelect={handleFileSelect} />
        ) : isSearchViewActive && coreFeatures.search ? (
          <SearchView
            ref={ref}
            rootFolderPath={rootFolderPath}
            allProjectFiles={allProjectFiles}
            onFileSelect={(path, line, column) => handleFileSelect(path, false, line, column)}
          />
        ) : isRemoteViewActive && coreFeatures.remote ? (
          <RemoteConnectionView onFileSelect={handleFileSelect} />
        ) : isFileTreeLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="paper-text-secondary text-sm">Loading file tree...</div>
          </div>
        ) : (
          <FileTree
            files={files}
            activeBufferPath={activeBufferPath}
            rootFolderPath={rootFolderPath}
            onFileSelect={handleFileSelect}
            onCreateNewFileInDirectory={handleCreateNewFileInDirectory}
            onCreateNewFolderInDirectory={handleCreateNewFolderInDirectory}
            onDeletePath={handleDeletePath}
            onUpdateFiles={setFiles}
            onRefreshDirectory={refreshDirectory}
            onFileMove={handleFileMove}
          />
        )}
      </div>
    </div>
  );
});
