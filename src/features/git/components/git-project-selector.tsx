import { open } from "@tauri-apps/plugin-dialog";
import {
  CaretDownIcon as CaretDown,
  CheckIcon as Check,
  FolderOpenIcon as FolderOpen,
  PlusIcon as Plus,
  ArrowClockwiseIcon as RefreshCw,
} from "@phosphor-icons/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import { resolveRepositoryPath } from "../api/git-repo-api";
import { useRepositoryStore } from "../stores/git-repository.store";

interface GitProjectSelectorProps {
  className?: string;
  triggerClassName?: string;
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

const GitProjectSelector = ({
  className,
  triggerClassName,
  onRepositoryChange,
}: GitProjectSelectorProps) => {
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
  const triggerRef = useRef<HTMLButtonElement>(null);
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
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "ui-font flex h-7 w-fit max-w-full min-w-0 items-center gap-1.5 rounded-md px-2.5 text-left text-accent/80 transition-colors hover:text-accent focus-visible:text-accent focus-visible:outline-none",
          triggerClassName,
        )}
        aria-haspopup="menu"
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
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        anchorRef={triggerRef}
        anchorAlign="start"
        className="w-[min(360px,calc(100vw-16px))]"
        closeOnSelect={false}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="px-1 pb-1">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              variant="ghost"
              size="xs"
              placeholder="Filter repositories"
              className="h-7 rounded-md border-transparent bg-transparent"
            />
          </div>

          <div className="scrollbar-none flex max-h-60 min-w-0 flex-col gap-0.5 overflow-y-auto">
            {isDiscovering && availableRepoPaths.length === 0 ? (
              <div className="ui-text-xs flex h-8 items-center gap-2 px-2 text-text-lighter">
                <LoadingIndicator label="Detecting repositories" compact />
                Detecting repositories
              </div>
            ) : null}

            {!isDiscovering && filteredRepoPaths.length === 0 ? (
              <div className="ui-text-xs px-2 py-2 text-text-lighter">
                {query.trim() ? "No matching repositories" : "No repositories found"}
              </div>
            ) : null}

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

          <div className="flex min-w-0 flex-wrap items-center gap-1 border-border/60 border-t px-1 pt-1">
            <Button
              type="button"
              variant="ghost"
              compact
              className="h-6 px-1.5 ui-text-xs text-text-lighter"
              onClick={() => void handleBrowseRepository()}
              disabled={isSelectingRepo}
            >
              <Plus />
              {isSelectingRepo ? "Adding..." : "Add"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              compact
              className="h-6 px-1.5 ui-text-xs text-text-lighter"
              onClick={() => void refreshWorkspaceRepositories()}
              disabled={isDiscovering}
            >
              <RefreshCw />
              Refresh
            </Button>
            {manualRepoPaths.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                compact
                className="h-6 px-1.5 ui-text-xs text-text-lighter"
                onClick={handleClearAddedRepositories}
              >
                Clear Added
              </Button>
            ) : null}
          </div>

          {selectionError ? (
            <div className="ui-text-xs mx-1 rounded-md border border-error/30 bg-error/5 px-2 py-1 text-error/90">
              {selectionError}
            </div>
          ) : null}
        </div>
      </Dropdown>
    </div>
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
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "ui-font flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left transition-colors",
        isCurrent ? "bg-hover/70 text-text" : "text-text-lighter hover:bg-hover/50 hover:text-text",
      )}
    >
      {isCurrent ? (
        <Check className="size-3.5 shrink-0 text-success" />
      ) : (
        <FolderOpen className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex flex-1 items-baseline gap-1.5">
        <span className="ui-text-sm min-w-0 shrink-0 max-w-[45%] truncate text-text">
          {getFolderName(repoPath)}
        </span>
        <span className="ui-text-xs min-w-0 flex-1 truncate text-text-lighter/75">
          {relativePath === "." ? repoPath : relativePath}
        </span>
      </span>
      {isAdded ? <span className="ui-text-xs shrink-0 text-text-lighter/75">added</span> : null}
    </button>
  );
}

export default GitProjectSelector;
