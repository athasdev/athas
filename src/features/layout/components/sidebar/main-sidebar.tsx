import { memo } from "react";
import { FileTree } from "@/features/file-explorer/components/file-tree";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import GitView from "@/features/git/components/view";
import GitHubPRsView from "@/features/github/components/github-prs-view";
import { useSettingsStore } from "@/features/settings/store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";

export const MainSidebar = memo(() => {
  // Get state from stores
  const { isGitViewActive, isGitHubPRsViewActive } = useUIState();

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

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <div className="min-h-0 flex-1 overflow-hidden">
        {settings.coreFeatures.git && (
          <div className={cn("h-full", !isGitViewActive && "hidden")}>
            <GitView
              repoPath={rootFolderPath}
              onFileSelect={handleFileSelect}
              isActive={isGitViewActive}
            />
          </div>
        )}

        {settings.coreFeatures.github && (
          <div className={cn("h-full", !isGitHubPRsViewActive && "hidden")}>
            <GitHubPRsView />
          </div>
        )}

        <div className={cn("h-full", (isGitViewActive || isGitHubPRsViewActive) && "hidden")}>
          {isFileTreeLoading ? (
            <div className="flex h-full flex-1 items-center justify-center p-4">
              <div className="rounded-lg border border-border/60 bg-secondary-bg px-3 py-2 text-text-lighter text-xs">
                Loading files...
              </div>
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
