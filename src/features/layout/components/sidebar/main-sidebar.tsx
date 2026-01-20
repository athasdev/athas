import { memo, useEffect, useMemo, useRef } from "react";
import { FileTree } from "@/features/file-explorer/components/file-tree";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileEntry } from "@/features/file-system/types/app";
import GitHubPRsView from "@/features/github/components/github-prs-view";
import { useSettingsStore } from "@/features/settings/store";
import GitView from "@/features/version-control/git/components/view";
import { useSearchViewStore } from "@/stores/search-view-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";
import SearchView, { type SearchViewRef } from "./search-view";
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
  const { isGitViewActive, isSearchViewActive, isGitHubPRsViewActive, setActiveView } =
    useUIState();

  // Ref for SearchView to enable focus functionality
  const searchViewRef = useRef<SearchViewRef>(null);
  const { setSearchViewRef } = useSearchViewStore();

  // file system store
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

  // sidebar store
  const activePath = useSidebarStore.use.activePath?.();
  const updateActivePath = useSidebarStore.use.updateActivePath?.();

  const { settings } = useSettingsStore();

  // Register search view ref with store when it becomes available
  useEffect(() => {
    if (searchViewRef.current) {
      setSearchViewRef(searchViewRef.current);
    }
  }, [setSearchViewRef]);

  // Additional effect to ensure ref is registered when search becomes active
  useEffect(() => {
    if (isSearchViewActive && searchViewRef.current) {
      setSearchViewRef(searchViewRef.current);
    }
  }, [isSearchViewActive, setSearchViewRef]);

  // Get all project files by flattening the file tree - memoized for performance
  const allProjectFiles = useMemo(() => {
    return isSearchViewActive ? flattenFileTree(files) : [];
  }, [files, isSearchViewActive]);

  return (
    <div className="flex h-full flex-col ">
      {/* Pane Selection Row */}
      <SidebarPaneSelector
        isGitViewActive={isGitViewActive}
        isSearchViewActive={isSearchViewActive}
        isGitHubPRsViewActive={isGitHubPRsViewActive}
        coreFeatures={settings.coreFeatures}
        onViewChange={setActiveView}
      />

      <div className="flex-1 overflow-hidden">
        {settings.coreFeatures.git && (
          <div className={cn("h-full", !isGitViewActive && "hidden")}>
            <GitView
              repoPath={rootFolderPath}
              onFileSelect={handleFileSelect}
              isActive={isGitViewActive}
            />
          </div>
        )}

        {settings.coreFeatures.search && (
          <div className={cn("h-full", !isSearchViewActive && "hidden")}>
            <SearchView
              ref={searchViewRef}
              rootFolderPath={rootFolderPath}
              allProjectFiles={allProjectFiles}
              onFileSelect={(path, line, column) => handleFileSelect(path, false, line, column)}
              onFileOpen={(path, line, column) =>
                handleFileSelect(path, false, line, column, undefined, false)
              }
            />
          </div>
        )}

        {settings.coreFeatures.github && (
          <div className={cn("h-full", !isGitHubPRsViewActive && "hidden")}>
            <GitHubPRsView />
          </div>
        )}

        <div
          className={cn(
            "h-full",
            (isGitViewActive || isSearchViewActive || isGitHubPRsViewActive) && "hidden",
          )}
        >
          {isFileTreeLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-text text-xs">Loading...</div>
            </div>
          ) : (
            <FileTree
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
        </div>
      </div>
    </div>
  );
});
