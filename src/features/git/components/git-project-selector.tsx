import { open } from "@tauri-apps/plugin-dialog";
import {
  CaretDown,
  CaretRight,
  Check,
  FolderOpen,
  Plus,
  ArrowClockwise as RefreshCw,
} from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import { resolveRepositoryPath } from "../api/git-repo-api";
import { useRepositoryStore } from "../stores/git-repository-store";

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
  const [isExpanded, setIsExpanded] = useState(true);
  const [query, setQuery] = useState("");
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const filteredRepoPaths = useMemo(
    () => getFilteredRepositoryPaths(availableRepoPaths, activeRepoPath, query),
    [activeRepoPath, availableRepoPaths, query],
  );

  const handleSelectRepositoryPath = (repoPath: string) => {
    selectRepository(repoPath);
    setSelectionError(null);
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
      setIsExpanded(true);
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
    <div className={cn("min-w-0 shrink-0", className)}>
      <button
        type="button"
        className="ui-font flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-text-lighter transition-colors hover:bg-hover/60 hover:text-text focus-visible:bg-hover/70 focus-visible:text-text focus-visible:outline-none"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((expanded) => !expanded)}
      >
        {isExpanded ? (
          <CaretDown className="size-3.5 shrink-0" />
        ) : (
          <CaretRight className="size-3.5 shrink-0" />
        )}
        <FolderOpen className="size-3.5 shrink-0" />
        <span className="ui-text-sm min-w-0 flex-1 truncate text-text">Repositories</span>
        <span className="ui-text-xs shrink-0 rounded bg-hover/70 px-1.5 py-0.5">
          {availableRepoPaths.length}
        </span>
      </button>

      {isExpanded ? (
        <div className="mt-1 flex min-w-0 flex-col gap-1">
          {availableRepoPaths.length > 6 ? (
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              variant="ghost"
              size="xs"
              placeholder="Filter repositories"
              className="h-6 rounded-md border-transparent bg-transparent"
            />
          ) : null}

          <div className="flex min-w-0 flex-col gap-0.5">
            {isDiscovering && availableRepoPaths.length === 0 ? (
              <div className="ui-text-xs flex h-7 items-center gap-2 px-2 text-text-lighter">
                <LoadingIndicator label="Detecting repositories" compact />
                Detecting repositories
              </div>
            ) : null}

            {!isDiscovering && filteredRepoPaths.length === 0 ? (
              <div className="ui-text-xs px-2 py-1.5 text-text-lighter">
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

          <div className="flex min-w-0 flex-wrap items-center gap-1 px-1 pt-1">
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
      ) : null}
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
        "ui-font flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
        isCurrent ? "bg-hover/70 text-text" : "text-text-lighter hover:bg-hover/50 hover:text-text",
      )}
    >
      {isCurrent ? (
        <Check className="size-3.5 shrink-0 text-success" />
      ) : (
        <FolderOpen className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="ui-text-sm block truncate">{getFolderName(repoPath)}</span>
        <span className="ui-text-xs block truncate text-text-lighter/80">
          {relativePath === "." ? repoPath : relativePath}
        </span>
      </span>
      {isAdded ? (
        <span className="ui-text-xs shrink-0 rounded border border-border/60 px-1 text-text-lighter">
          added
        </span>
      ) : null}
    </button>
  );
}

export default GitProjectSelector;
