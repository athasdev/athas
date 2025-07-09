import { FilePlus, FolderOpen, FolderPlus, Server } from "lucide-react";
import type React from "react";
import { forwardRef } from "react";
import type { FileEntry } from "../../types/app";
import FileTree from "../file-tree";
import GitView from "../git/git-view";
import RemoteConnectionView from "../remote/remote-connection-view";
import SearchView, { type SearchViewRef } from "../search-view";
import Button from "../ui/button";
import { SidebarPaneSelector } from "./sidebar-pane-selector";

interface MainSidebarProps {
  // View states
  isGitViewActive: boolean;
  isSearchViewActive: boolean;
  isRemoteViewActive: boolean;

  // Remote connection
  isRemoteWindow: boolean;
  remoteConnectionName?: string;

  // Core features
  coreFeatures: {
    search: boolean;
    git: boolean;
    remote: boolean;
  };

  // Files and project
  files: FileEntry[];
  rootFolderPath?: string;
  allProjectFiles: FileEntry[];
  activeBufferPath?: string;

  // Handlers
  onViewChange: (view: "files" | "git" | "search" | "remote") => void;
  onOpenExtensions: () => void;
  onOpenFolder: () => void;
  onCreateNewFile: () => void;
  onCreateNewFolderInDirectory: (path: string) => void;
  onFileSelect: (path: string, isDir: boolean, line?: number, column?: number) => void;
  onCreateNewFileInDirectory: (path: string) => void;
  onDeletePath: (path: string) => void;
  onProjectNameMenuOpen: (event: React.MouseEvent) => void;

  // Project name
  projectName: string;
}

export const MainSidebar = forwardRef<SearchViewRef, MainSidebarProps>(
  (
    {
      isGitViewActive,
      isSearchViewActive,
      isRemoteViewActive,
      isRemoteWindow,
      remoteConnectionName,
      coreFeatures,
      files,
      rootFolderPath,
      allProjectFiles,
      activeBufferPath,
      onViewChange,
      onOpenExtensions,
      onOpenFolder,
      onCreateNewFile,
      onCreateNewFolderInDirectory,
      onFileSelect,
      onCreateNewFileInDirectory,
      onDeletePath,
      onProjectNameMenuOpen,
      projectName,
    },
    ref,
  ) => {
    const showFileTreeHeader =
      !isGitViewActive && !isSearchViewActive && !isRemoteViewActive && !isRemoteWindow;

    return (
      <div className="flex flex-col h-full">
        {/* Pane Selection Row */}
        <SidebarPaneSelector
          isGitViewActive={isGitViewActive}
          isSearchViewActive={isSearchViewActive}
          isRemoteViewActive={isRemoteViewActive}
          coreFeatures={coreFeatures}
          onViewChange={onViewChange}
          onOpenExtensions={onOpenExtensions}
        />

        {/* Remote Window Header */}
        {isRemoteWindow && remoteConnectionName && (
          <div className="flex items-center px-3 py-1.5 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
            <Server size={12} className="text-[var(--text-lighter)] mr-2" />
            <span
              className="text-xs font-medium text-[var(--text-color)] cursor-pointer hover:bg-[var(--hover-color)] px-2 py-1 rounded flex-1"
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
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
            <h3
              className="font-mono text-xs font-medium text-[var(--text-color)] tracking-wide cursor-pointer hover:bg-[var(--hover-color)] px-2 py-1 rounded"
              onClick={onProjectNameMenuOpen}
              onContextMenu={onProjectNameMenuOpen}
              title="Click for workspace options"
            >
              {projectName}
            </h3>
            <div className="flex items-center gap-1">
              <Button
                onClick={onOpenFolder}
                variant="ghost"
                size="sm"
                className="text-xs flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--hover-color)]"
                title="Open Folder"
              >
                <FolderOpen size={12} />
              </Button>
              <Button
                onClick={onCreateNewFile}
                variant="ghost"
                size="sm"
                className="text-xs flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--hover-color)]"
                title="New File"
              >
                <FilePlus size={12} />
              </Button>
              <Button
                onClick={() => {
                  if (rootFolderPath) {
                    onCreateNewFolderInDirectory(rootFolderPath);
                  }
                }}
                variant="ghost"
                size="sm"
                className="text-xs flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--hover-color)]"
                title="New Folder"
              >
                <FolderPlus size={12} />
              </Button>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto">
          {isGitViewActive && coreFeatures.git ? (
            <GitView repoPath={rootFolderPath} onFileSelect={onFileSelect} />
          ) : isSearchViewActive && coreFeatures.search ? (
            <SearchView
              ref={ref}
              rootFolderPath={rootFolderPath}
              allProjectFiles={allProjectFiles}
              onFileSelect={(path, line, column) => onFileSelect(path, false, line, column)}
            />
          ) : isRemoteViewActive && coreFeatures.remote ? (
            <RemoteConnectionView onFileSelect={onFileSelect} />
          ) : (
            <FileTree
              files={files}
              activeBufferPath={activeBufferPath}
              onFileSelect={onFileSelect}
              onCreateNewFileInDirectory={onCreateNewFileInDirectory}
              onCreateNewFolderInDirectory={onCreateNewFolderInDirectory}
              onDeletePath={onDeletePath}
            />
          )}
        </div>
      </div>
    );
  },
);
