import { open } from "@tauri-apps/plugin-dialog";
import {
  CaretDownIcon as CaretDown,
  FolderOpenIcon as FolderOpen,
  PlusIcon as Plus,
  ArrowClockwiseIcon as RefreshCw,
} from "@/ui/icons";
import { useCallback, useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import { resolveRepositoryPath } from "../api/git-repo-api";
import { useRepositoryStore } from "../stores/git-repository.store";

interface GitProjectSelectorProps {
  className?: string;
  onRepositoryChange?: (repoPath: string | null) => void;
}

function getSortedRepositoryPaths(repoPaths: string[], activeRepoPath: string | null) {
  const sorted = [...repoPaths].sort((a, b) => {
    if (a === activeRepoPath) return -1;
    if (b === activeRepoPath) return 1;
    return getFolderName(a).localeCompare(getFolderName(b));
  });
  return sorted;
}

const GitProjectSelector = ({ className, onRepositoryChange }: GitProjectSelectorProps) => {
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const workspaceRootPath = useRepositoryStore.use.workspaceRootPath();
  const availableRepoPaths = useRepositoryStore.use.availableRepoPaths();
  const manualRepoPaths = useRepositoryStore.use.manualRepoPaths();
  const isDiscovering = useRepositoryStore.use.isDiscovering();
  const {
    selectRepository,
    setManualRepository,
    clearManualRepository,
    refreshWorkspaceRepositories,
  } = useRepositoryStore.use.actions();
  const [isOpen, setIsOpen] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const sortedRepoPaths = useMemo(
    () => getSortedRepositoryPaths(availableRepoPaths, activeRepoPath),
    [activeRepoPath, availableRepoPaths],
  );
  const activeRelativePath =
    activeRepoPath && workspaceRootPath ? getRelativePath(activeRepoPath, workspaceRootPath) : null;
  const activeRepoLabel = activeRepoPath ? getFolderName(activeRepoPath) : "Select Repository";
  const activeRepoTitle =
    activeRepoPath && activeRelativePath && activeRelativePath !== "."
      ? activeRelativePath
      : activeRepoPath;

  const handleSelectRepositoryPath = (repoPath: string) => {
    selectRepository(repoPath);
    setSelectionError(null);
    setIsOpen(false);
    onRepositoryChange?.(repoPath);
  };

  const handleBrowseRepository = useCallback(async () => {
    setIsSelectingRepo(true);
    setSelectionError(null);

    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return;

      const resolvedRepoPath = await resolveRepositoryPath(selected);
      if (!resolvedRepoPath) {
        setSelectionError("Selected folder is not inside a Git repository.");
        return;
      }

      setManualRepository(resolvedRepoPath);
      setIsOpen(false);
      onRepositoryChange?.(resolvedRepoPath);
    } catch (error) {
      console.error("Failed to select repository:", error);
      setSelectionError(error instanceof Error ? error.message : "Failed to select repository.");
    } finally {
      setIsSelectingRepo(false);
    }
  }, [onRepositoryChange, setManualRepository]);

  const handleClearAddedRepositories = () => {
    clearManualRepository();
    setSelectionError(null);
    onRepositoryChange?.(useRepositoryStore.getState().activeRepoPath);
  };

  return (
    <div className={cn("min-w-0 max-w-full", className)}>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="default"
              size="sm"
              className="w-fit max-w-full min-w-0 justify-start text-left"
              title={activeRepoTitle ?? undefined}
            />
          }
        >
          <FolderOpen />
          <span className="ui-text-sm min-w-0 flex-1 truncate font-medium">{activeRepoLabel}</span>
          <CaretDown
            className={cn(
              "size-3.5 shrink-0 text-subtle-foreground transition-transform",
              isOpen && "rotate-180 text-foreground",
            )}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Repositories</DropdownMenuLabel>
          {isDiscovering && availableRepoPaths.length === 0 ? (
            <DropdownMenuItem disabled>
              <Spinner compact />
              Detecting repositories...
            </DropdownMenuItem>
          ) : null}

          {!isDiscovering && sortedRepoPaths.length === 0 ? (
            <DropdownMenuItem disabled>No repositories found</DropdownMenuItem>
          ) : null}

          <DropdownMenuRadioGroup
            value={activeRepoPath ?? ""}
            onValueChange={handleSelectRepositoryPath}
          >
            {sortedRepoPaths.map((repoPath) => {
              const relativePath = workspaceRootPath
                ? getRelativePath(repoPath, workspaceRootPath)
                : repoPath;

              return (
                <DropdownMenuRadioItem
                  key={repoPath}
                  value={repoPath}
                  closeOnClick
                  className="min-w-0"
                >
                  <FolderOpen />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{getFolderName(repoPath)}</span>
                    <span className="block truncate text-subtle-foreground ui-text-sm">
                      {relativePath === "." ? repoPath : relativePath}
                    </span>
                  </span>
                  {manualRepoPaths.includes(repoPath) ? (
                    <Badge variant="muted" size="compact" className="mr-4">
                      Added
                    </Badge>
                  ) : null}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => void handleBrowseRepository()}
            disabled={isSelectingRepo}
          >
            <Plus />
            {isSelectingRepo ? "Adding Repository..." : "Add Repository..."}
          </DropdownMenuItem>
          <DropdownMenuItem
            closeOnClick={false}
            disabled={isDiscovering}
            onClick={() => void refreshWorkspaceRepositories()}
          >
            {isDiscovering ? <Spinner compact /> : <RefreshCw />}
            Refresh
          </DropdownMenuItem>
          {manualRepoPaths.length > 0 ? (
            <DropdownMenuItem onClick={handleClearAddedRepositories}>Clear Added</DropdownMenuItem>
          ) : null}
          {selectionError ? (
            <DropdownMenuLabel className="whitespace-normal text-destructive" role="alert">
              {selectionError}
            </DropdownMenuLabel>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default GitProjectSelector;
