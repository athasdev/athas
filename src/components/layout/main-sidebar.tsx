import { FilePlus, FolderOpen, FolderPlus, Server } from "lucide-react";
import type React from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import RemoteConnectionView from "@/components/remote/remote-connection-view";
import FileTree from "@/file-explorer/views/file-tree";
import { useFileSystemStore } from "@/file-system/controllers/store";
import type { FileEntry } from "@/file-system/models/app";
import { useSettingsStore } from "@/settings/store";
import { useBufferStore } from "@/stores/buffer-store";
import { useProjectStore } from "@/stores/project-store";
import { useSearchViewStore } from "@/stores/search-view-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";
import GitView from "@/version-control/git/views/git-view";
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

export const MainSidebar = memo(() => {
  // Get state from stores
  const {
    isGitViewActive,
    isSearchViewActive,
    isRemoteViewActive,
    setActiveView,
    setProjectNameMenu,
    isExtensionsViewActive,
  } = useUIState();
  const { getProjectName } = useProjectStore();
  const [projectName, setProjectName] = useState<string>("Explorer");

  // Ref for SearchView to enable focus functionality
  const searchViewRef = useRef<SearchViewRef>(null);
  const { setSearchViewRef } = useSearchViewStore();

  // file system store
  const setFiles = useFileSystemStore.use.setFiles?.();
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder?.();
  const handleCreateNewFile = useFileSystemStore.use.handleCreateNewFile?.();
  const handleCreateNewFolderInDirectory =
    useFileSystemStore.use.handleCreateNewFolderInDirectory?.();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const handleCreateNewFileInDirectory = useFileSystemStore.use.handleCreateNewFileInDirectory?.();
  const handleCreateNewFolder = useFileSystemStore.use.handleCreateNewFolder?.();
  const handleDeletePath = useFileSystemStore.use.handleDeletePath?.();
  const refreshDirectory = useFileSystemStore.use.refreshDirectory?.();
  const handleFileMove = useFileSystemStore.use.handleFileMove?.();
  const handleRevealInFolder = useFileSystemStore.use.handleRevealInFolder?.();
  const handleDuplicatePath = useFileSystemStore.use.handleDuplicatePath?.();
  const handleRenamePath = useFileSystemStore.use.handleRenamePath?.();

  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const files = useFileSystemStore.use.files();
  const isFileTreeLoading = useFileSystemStore.use.isFileTreeLoading();

  // sidebar store
  const activePath = useSidebarStore.use.activePath?.();
  const remoteConnectionName = useSidebarStore.use.remoteConnectionName?.();

  // Check if this is a remote window directly from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const isRemoteWindow = !!urlParams.get("remote");
  const updateActivePath = useSidebarStore.use.updateActivePath?.();

  const { settings } = useSettingsStore();

  // Load project name asynchronously
  useEffect(() => {
    const loadProjectName = async () => {
      try {
        const name = await getProjectName();
        setProjectName(name);
      } catch (error) {
        console.error("Error loading project name:", error);
      }
    };

    loadProjectName();
  }, [getProjectName, isRemoteWindow]);

  // Register search view ref with store when it becomes available
  useEffect(() => {
    if (searchViewRef.current) {
      setSearchViewRef(searchViewRef.current);
    }

    return () => {
      setSearchViewRef(null);
    };
  }, [setSearchViewRef]);

  // Additional effect to ensure ref is registered when search becomes active
  useEffect(() => {
    if (isSearchViewActive && searchViewRef.current) {
      setSearchViewRef(searchViewRef.current);
    }
  }, [isSearchViewActive, setSearchViewRef]);

  // Handlers
  const onOpenExtensions = () => {
    const { openBuffer } = useBufferStore.getState().actions;
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

  // Get all project files by flattening the file tree - memoized for performance
  const allProjectFiles = useMemo(() => {
    return flattenFileTree(files);
  }, [files]);

  // Memoize expensive computations
  const memoizedShowFileTreeHeader = useMemo(() => {
    return !isGitViewActive && !isSearchViewActive && !isRemoteViewActive && !isRemoteWindow;
  }, [isGitViewActive, isSearchViewActive, isRemoteViewActive, isRemoteWindow]);

  return (
    <div className="flex h-full flex-col ">
      {/* Pane Selection Row */}
      <SidebarPaneSelector
        isGitViewActive={isGitViewActive}
        isSearchViewActive={isSearchViewActive}
        isRemoteViewActive={isRemoteViewActive}
        isExtensionsViewActive={isExtensionsViewActive}
        isRemoteWindow={isRemoteWindow}
        coreFeatures={settings.coreFeatures}
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
      {memoizedShowFileTreeHeader && (
        <div className="flex flex-wrap items-center justify-between bg-secondary-bg px-2 py-1.5">
          <h3
            className="min-w-0 flex-shrink cursor-pointer truncate rounded px-2 py-1 font-medium font-mono text-text text-xs tracking-wide hover:bg-hover"
            onClick={onProjectNameMenuOpen}
            onContextMenu={onProjectNameMenuOpen}
            title="Click for workspace options"
          >
            {projectName}
          </h3>
          <div className="flex flex-shrink-0 items-center gap-0.5">
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
              onClick={handleCreateNewFolder}
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

      <div className="flex-1 overflow-hidden">
        {settings.coreFeatures.git && (
          <div className={cn("h-full", !isGitViewActive && "hidden")}>
            <GitView repoPath={rootFolderPath} onFileSelect={handleFileSelect} />
          </div>
        )}

        {settings.coreFeatures.search && (
          <div className={cn("h-full", !isSearchViewActive && "hidden")}>
            <SearchView
              ref={searchViewRef}
              rootFolderPath={rootFolderPath}
              allProjectFiles={allProjectFiles}
              onFileSelect={(path, line, column) => handleFileSelect(path, false, line, column)}
            />
          </div>
        )}

        {settings.coreFeatures.remote && (
          <div className={cn("h-full", !isRemoteViewActive && "hidden")}>
            <RemoteConnectionView onFileSelect={handleFileSelect} />
          </div>
        )}

        <div
          className={cn(
            "h-full",
            (isGitViewActive || isSearchViewActive || isRemoteViewActive) && "hidden",
          )}
        >
          {isFileTreeLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-sm text-text">Loading file tree...</div>
            </div>
          ) : (
            <FileTree
              files={files}
              activePath={activePath}
              updateActivePath={updateActivePath}
              rootFolderPath={rootFolderPath}
              onFileSelect={handleFileSelect}
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
        </div>
      </div>
    </div>
  );
});
