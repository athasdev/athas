import { open } from "@tauri-apps/plugin-dialog";
import {
  CaretDownIcon as CaretDown,
  CheckIcon as Check,
  FolderOpenIcon as FolderOpen,
  PlusIcon as Plus,
  ArrowClockwiseIcon as RefreshCw,
} from "@/ui/icons";
import { useCallback, useMemo, useState } from "react";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import { resolveRepositoryPath } from "../api/git-repo-api";
import { useRepositoryStore } from "../stores/git-repository.store";
import GitCommandSurface from "./git-command-surface";

interface GitProjectSelectorProps {
  className?: string;
  onRepositoryChange?: (repoPath: string | null) => void;
}

function getFilteredRepositoryPaths(
  repoPaths: string[],
  activeRepoPath: string | null,
  query: string,
) {
  const sorted = [...repoPaths].sort((a, b) => {
    if (a === activeRepoPath) return -1;
    if (b === activeRepoPath) return 1;
    return getFolderName(a).localeCompare(getFolderName(b));
  });

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return sorted;

  return sorted.filter((repoPath) => {
    const searchable = `${getFolderName(repoPath)} ${repoPath}`.toLowerCase();
    return searchable.includes(normalizedQuery);
  });
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
  const [query, setQuery] = useState("");
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const filteredRepoPaths = useMemo(
    () => getFilteredRepositoryPaths(availableRepoPaths, activeRepoPath, query),
    [activeRepoPath, availableRepoPaths, query],
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
    setQuery("");
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
      setQuery("");
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

  const handleClose = () => {
    setIsOpen(false);
    setQuery("");
  };

  return (
    <>
      <div className={cn("min-w-0 max-w-full", className)}>
        <Button
          type="button"
          variant="ghost"
          compact
          className={cn(
            "h-7 w-fit max-w-full min-w-0 justify-start gap-1.5 px-2.5 text-left text-accent/80 hover:text-accent focus-visible:text-accent",
          )}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          title={activeRepoTitle ?? undefined}
          onClick={() => setIsOpen((open) => !open)}
        >
          <span className="ui-text-sm min-w-0 flex-1 truncate font-medium">{activeRepoLabel}</span>
          <CaretDown
            className={cn(
              "size-3.5 shrink-0 text-accent/65 transition-transform",
              isOpen && "rotate-180 text-accent",
            )}
          />
        </Button>
      </div>

      <GitCommandSurface
        isOpen={isOpen}
        onClose={handleClose}
        query={query}
        onQueryChange={setQuery}
        placeholder="Filter repositories..."
        meta={`${availableRepoPaths.length} repositor${
          availableRepoPaths.length === 1 ? "y" : "ies"
        }`}
      >
        <CommandList>
          {isDiscovering && availableRepoPaths.length === 0 ? (
            <CommandEmpty>Detecting repositories...</CommandEmpty>
          ) : null}

          {!isDiscovering && filteredRepoPaths.length === 0 ? (
            <CommandEmpty>
              {query.trim() ? "No matching repositories" : "No repositories found"}
            </CommandEmpty>
          ) : null}

          {filteredRepoPaths.length > 0 ? (
            <div className="space-y-1">
              {filteredRepoPaths.map((repoPath) => (
                <RepositoryRow
                  key={repoPath}
                  repoPath={repoPath}
                  workspaceRootPath={workspaceRootPath}
                  isCurrent={repoPath === activeRepoPath}
                  isAdded={manualRepoPaths.includes(repoPath)}
                  onSelect={() => handleSelectRepositoryPath(repoPath)}
                />
              ))}
            </div>
          ) : null}
        </CommandList>

        <CommandFooter>
          <CommandFooterAction
            type="button"
            onClick={() => void handleBrowseRepository()}
            disabled={isSelectingRepo}
          >
            <Plus />
            {isSelectingRepo ? "Adding..." : "Add"}
          </CommandFooterAction>
          <CommandFooterAction
            type="button"
            onClick={() => void refreshWorkspaceRepositories()}
            disabled={isDiscovering}
          >
            <RefreshCw />
            Refresh
          </CommandFooterAction>
          {manualRepoPaths.length > 0 ? (
            <CommandFooterAction type="button" onClick={handleClearAddedRepositories}>
              Clear Added
            </CommandFooterAction>
          ) : null}
          {selectionError ? (
            <span className="ui-text-sm min-w-0 flex-1 truncate text-error/90">
              {selectionError}
            </span>
          ) : null}
        </CommandFooter>
      </GitCommandSurface>
    </>
  );
};

function RepositoryRow({
  repoPath,
  workspaceRootPath,
  isCurrent,
  isAdded,
  onSelect,
}: {
  repoPath: string;
  workspaceRootPath: string | null;
  isCurrent: boolean;
  isAdded: boolean;
  onSelect: () => void;
}) {
  const relativePath = workspaceRootPath ? getRelativePath(repoPath, workspaceRootPath) : repoPath;

  return (
    <CommandItemRow
      type="button"
      onClick={onSelect}
      isSelected={isCurrent}
      icon={
        isCurrent ? (
          <Check className="size-3.5 text-success" />
        ) : (
          <FolderOpen className="size-3.5 text-text-lighter" />
        )
      }
      title={getFolderName(repoPath)}
      description={relativePath === "." ? repoPath : relativePath}
      accessory={isAdded ? <CommandItemBadge>added</CommandItemBadge> : null}
      className="min-h-9"
    />
  );
}

export default GitProjectSelector;
