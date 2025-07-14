import { FilePlus, FolderOpen, FolderPlus, Server } from "lucide-react";
import type React from "react";
import { forwardRef } from "react";
import type { FileEntry } from "../../types/app";
import FileTree from "../file-tree/file-tree";
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
  onUpdateFiles: (files: FileEntry[]) => void;
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
      onUpdateFiles,
      onProjectNameMenuOpen,
      projectName,
    },
    ref,
  ) => {
    const showFileTreeHeader =
      !isGitViewActive && !isSearchViewActive && !isRemoteViewActive && !isRemoteWindow;

    return (
      <div className="flex h-full flex-col">
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
          <div className="flex items-center border-border border-b bg-secondary-bg px-3 py-1.5">
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
          <div className="flex items-center justify-between border-border border-b bg-secondary-bg px-3 py-2">
            <h3
              className="cursor-pointer rounded px-2 py-1 font-medium font-mono text-text text-xs tracking-wide hover:bg-hover"
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
                className="flex h-6 w-6 items-center justify-center rounded text-xs hover:bg-hover"
                title="Open Folder"
              >
                <FolderOpen size={12} />
              </Button>
              <Button
                onClick={onCreateNewFile}
                variant="ghost"
                size="sm"
                className="flex h-6 w-6 items-center justify-center rounded text-xs hover:bg-hover"
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
                className="flex h-6 w-6 items-center justify-center rounded text-xs hover:bg-hover"
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
              rootFolderPath={rootFolderPath}
              onFileSelect={onFileSelect}
              onCreateNewFileInDirectory={onCreateNewFileInDirectory}
              onCreateNewFolderInDirectory={onCreateNewFolderInDirectory}
              onDeletePath={onDeletePath}
              onUpdateFiles={onUpdateFiles}
            />
          )}
        </div>
      </div>
    );
  },
);
