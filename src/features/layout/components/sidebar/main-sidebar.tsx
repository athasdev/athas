import { memo } from "react";
import { FileExplorerTree } from "@/features/file-explorer/components/file-explorer-tree";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import GitView from "@/features/git/components/git-view";
import GitHubPRsView from "@/features/github/components/github-prs-view";
import { useSettingsStore } from "@/features/settings/store";
import { useSidebarStore } from "@/features/layout/stores/sidebar-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import { ExtensionErrorBoundary } from "@/extensions/ui/components/extension-error-boundary";
import { cn } from "@/utils/cn";

export const MainSidebar = memo(() => {
  // Get state from stores
  const { isGitViewActive, isGitHubPRsViewActive, activeSidebarView } = useUIState();
  const extensionViews = useExtensionViews();

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
  const isSwitchingProject = useFileSystemStore.use.isSwitchingProject();

  // sidebar store
  const activePath = useSidebarStore.use.activePath?.();
  const updateActivePath = useSidebarStore.use.updateActivePath?.();

  const { settings } = useSettingsStore();
  const isFilesViewActive =
    !isGitViewActive && !isGitHubPRsViewActive && activeSidebarView === "files";

  return (
    <div className="flex h-full min-h-0 flex-col">
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

        <div
          className={cn(
            "relative h-full",
            (!isFilesViewActive || isGitViewActive || isGitHubPRsViewActive) && "hidden",
          )}
        >
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
            <div className="pointer-events-none absolute inset-0 flex items-start justify-center p-3">
              <div className="rounded-full border border-border/60 bg-secondary-bg/92 px-3 py-1.5 text-text-lighter text-xs shadow-lg backdrop-blur-sm">
                Loading files...
              </div>
            </div>
          )}
        </div>

        {Array.from(extensionViews).map(([viewId, view]) => (
          <div key={viewId} className={cn("h-full", activeSidebarView !== viewId && "hidden")}>
            <ExtensionErrorBoundary extensionId={view.extensionId} name={view.title}>
              {view.render()}
            </ExtensionErrorBoundary>
          </div>
        ))}
      </div>
    </div>
  );
});
