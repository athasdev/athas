import { open } from "@tauri-apps/plugin-dialog";
import { Check, FolderOpen, ArrowClockwise as RefreshCw } from "@phosphor-icons/react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandFooter, CommandItem, CommandList } from "@/ui/command";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import { resolveRepositoryPath } from "../api/git-repo-api";
import { useRepositoryStore } from "../stores/git-repository-store";
import GitCommandSurface from "./git-command-surface";

interface GitProjectSelectorProps {
  placement?: "up" | "down";
  className?: string;
  inputClassName?: string;
  onRepositoryChange?: (repoPath: string | null) => void;
}

function getRepositoryLabel(repoPath: string | null) {
  return repoPath ? getFolderName(repoPath) : "Select repo";
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
  placement = "down",
  className,
  inputClassName,
  onRepositoryChange,
}: GitProjectSelectorProps) => {
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const workspaceRootPath = useRepositoryStore.use.workspaceRootPath();
  const availableRepoPaths = useRepositoryStore.use.availableRepoPaths();
  const manualRepoPath = useRepositoryStore.use.manualRepoPath();
  const isDiscovering = useRepositoryStore.use.isDiscovering();
  const {
    selectRepository,
    setManualRepository,
    clearManualRepository,
    refreshWorkspaceRepositories,
  } = useRepositoryStore.use.actions();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const triggerText = getRepositoryLabel(activeRepoPath);
  const triggerTextWidthCh = Math.min(Math.max(triggerText.length + 1, 8), 38);
  const filteredRepoPaths = useMemo(
    () => getFilteredRepositoryPaths(availableRepoPaths, activeRepoPath, query),
    [activeRepoPath, availableRepoPaths, query],
  );

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setSelectionError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleOpenDropdown = async () => {
    if (isOpen) return;
    setIsOpen(true);
    await refreshWorkspaceRepositories();
  };

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

  const handleUseWorkspaceRepositories = () => {
    clearManualRepository();
    setSelectionError(null);
    setIsOpen(false);
    onRepositoryChange?.(useRepositoryStore.getState().activeRepoPath);
  };

  const handleCommandKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, Math.max(filteredRepoPaths.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selectedRepoPath = filteredRepoPaths[selectedIndex];
      if (selectedRepoPath) {
        handleSelectRepositoryPath(selectedRepoPath);
      }
    }
  };

  return (
    <>
      <Button
        onClick={() => void handleOpenDropdown()}
        disabled={isSelectingRepo}
        variant="ghost"
        className={cn(
          "inline-flex max-w-full shrink overflow-hidden px-2 text-text-lighter hover:bg-hover/80 sm:max-w-[360px]",
          isOpen ? "bg-hover/80" : "cursor-pointer",
          className,
        )}
        aria-label="Search repositories"
      >
        <FolderOpen className="shrink-0" />
        <span
          className={cn("ui-text-sm min-w-0 truncate font-normal", inputClassName)}
          style={{ maxWidth: `${triggerTextWidthCh}ch` }}
        >
          {triggerText}
        </span>
      </Button>

      <GitCommandSurface
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        query={query}
        onQueryChange={setQuery}
        onInputKeyDown={handleCommandKeyDown}
        placeholder="Search repositories..."
        meta={`${availableRepoPaths.length} repo${availableRepoPaths.length === 1 ? "" : "s"}`}
        placement={placement === "up" ? "bottom" : "top"}
      >
        <CommandList>
          {filteredRepoPaths.length === 0 ? (
            <CommandEmpty>
              {isDiscovering ? "Detecting repositories..." : "No repositories found"}
            </CommandEmpty>
          ) : null}
          {filteredRepoPaths.length > 0 ? (
            <div className="space-y-1">
              {filteredRepoPaths.map((repoPath, index) => (
                <RepositoryRow
                  key={repoPath}
                  repoPath={repoPath}
                  workspaceRootPath={workspaceRootPath}
                  isCurrent={repoPath === activeRepoPath}
                  isSelected={selectedIndex === index}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onSelect={() => handleSelectRepositoryPath(repoPath)}
                />
              ))}
            </div>
          ) : null}
        </CommandList>

        <CommandFooter>
          <Button
            type="button"
            onClick={() => void handleBrowseRepository()}
            disabled={isSelectingRepo}
            variant="ghost"
            compact
            className="h-7 justify-start px-2 text-text-lighter"
          >
            <FolderOpen />
            {isSelectingRepo ? "Selecting..." : "Browse"}
          </Button>
          {manualRepoPath ? (
            <Button
              type="button"
              onClick={handleUseWorkspaceRepositories}
              variant="ghost"
              className="h-7 justify-start px-2 text-text-lighter"
              compact
            >
              <RefreshCw />
              Use workspace repositories
            </Button>
          ) : null}
          {selectionError ? (
            <div className="ui-text-sm min-w-0 truncate rounded-lg border border-error/30 bg-error/5 px-2 py-1 text-error/90">
              {selectionError}
            </div>
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
  isSelected,
  onMouseEnter,
  onSelect,
}: {
  repoPath: string;
  workspaceRootPath: string | null;
  isCurrent: boolean;
  isSelected: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  const relativePath = workspaceRootPath ? getRelativePath(repoPath, workspaceRootPath) : repoPath;

  return (
    <CommandItem
      isSelected={isSelected}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
      className={cn("group ui-font", isCurrent ? "text-text" : "text-text-lighter hover:text-text")}
    >
      {isCurrent ? (
        <Check size={14} className="shrink-0 text-success" />
      ) : (
        <FolderOpen size={14} className="shrink-0 text-text-lighter" />
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className="ui-text-xs text-text">{getFolderName(repoPath)}</span>
        <span className="ui-text-xs ml-2 text-text-lighter/80">
          {relativePath === "." ? repoPath : relativePath}
        </span>
      </span>
      {isCurrent ? <span className="ui-text-xs ml-auto shrink-0 text-success">current</span> : null}
    </CommandItem>
  );
}

export default GitProjectSelector;
