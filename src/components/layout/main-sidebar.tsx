import { FilePlus, FolderOpen, FolderPlus, Server } from "lucide-react";
import type React from "react";
import { forwardRef, useMemo } from "react";
import { cn } from "@/utils/cn";
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

interface MainSidebarProps {
  // Handlers that still need to be passed as props
  onOpenExtensions: () => void;
  onOpenFolder: () => void;
  onCreateNewFile: () => void;
  onCreateNewFolderInDirectory: (path: string) => void;
  onFileSelect: (path: string, isDir: boolean, line?: number, column?: number) => void;
  onCreateNewFileInDirectory: (path: string) => void;
  onDeletePath: (path: string, isDir: boolean) => void;
  onUpdateFiles: (files: FileEntry[]) => void;
  onProjectNameMenuOpen: (event: React.MouseEvent) => void;
  onRefreshDirectory?: (path: string) => void;
  onFileMove?: (oldPath: string, newPath: string) => void;
}

export const MainSidebar = forwardRef<SearchViewRef, MainSidebarProps>(
  (
    {
      onOpenExtensions,
      onOpenFolder,
      onCreateNewFile,
      onCreateNewFolderInDirectory,
      onFileSelect,
      onCreateNewFileInDirectory,
      onDeletePath,
      onUpdateFiles,
      onProjectNameMenuOpen,
      onRefreshDirectory,
      onFileMove,
    },
    ref,
  ) => {
    // Get state from stores
    const { isGitViewActive, isSearchViewActive, isRemoteViewActive, setActiveView } = useUIState();
    const { files, rootFolderPath, allProjectFiles, getProjectName, setFiles } = useProjectStore();

    // Sort files similar to VS Code: directories first, then files, each group alphabetically (case-insensitive, natural order)
    const sortedFiles = useMemo(() => {
      const sortEntries = (entries: FileEntry[]): FileEntry[] => {
        return [...entries]
          .sort((a, b) => {
            if (a.isDir && !b.isDir) return -1; // directories before files
            if (!a.isDir && b.isDir) return 1; // files after directories
            // alphabetical sort, case-insensitive, with numeric ordering
            return a.name.localeCompare(b.name, undefined, {
              numeric: true,
              sensitivity: "base",
            });
          })
          .map(entry => ({
            ...entry,
            children: entry.children ? sortEntries(entry.children) : undefined,
          }));
      };

      return sortEntries(files);
    }, [files]);

    const { activeBufferPath, coreFeatures, isRemoteWindow, remoteConnectionName } =
      useSidebarStore();
    const showFileTreeHeader =
      !isGitViewActive && !isSearchViewActive && !isRemoteViewActive && !isRemoteWindow;
    const projectName = getProjectName();

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
                onClick={onOpenFolder}
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
                onClick={onCreateNewFile}
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
                    onCreateNewFolderInDirectory(rootFolderPath);
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
              files={sortedFiles}
              activeBufferPath={activeBufferPath}
              rootFolderPath={rootFolderPath}
              onFileSelect={onFileSelect}
              onCreateNewFileInDirectory={onCreateNewFileInDirectory}
              onCreateNewFolderInDirectory={onCreateNewFolderInDirectory}
              onDeletePath={onDeletePath}
              onUpdateFiles={files => {
                setFiles(files);
                onUpdateFiles(files);
              }}
              onRefreshDirectory={onRefreshDirectory}
              onFileMove={onFileMove}
            />
          )}
        </div>
      </div>
    );
  },
);
