import { open } from "@tauri-apps/plugin-dialog";
import { Check, FolderOpen, ArrowClockwise as RefreshCw } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/ui/combobox";
import { cn } from "@/utils/cn";
import { getFolderName, getRelativePath } from "@/utils/path-helpers";
import { resolveRepositoryPath } from "../api/git-repo-api";
import { useRepositoryStore } from "../stores/git-repository-store";

interface GitProjectSelectorProps {
  placement?: "up" | "down";
  className?: string;
  onRepositoryChange?: (repoPath: string | null) => void;
}

const PROJECT_SELECTOR_DROPDOWN_WIDTH = 380;

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
  const [isOpen, setIsOpen] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const triggerText = isOpen
    ? query || getRepositoryLabel(activeRepoPath)
    : getRepositoryLabel(activeRepoPath);
  const triggerTextWidthCh = Math.min(Math.max(triggerText.length + 1, 8), 38);
  const filteredRepoPaths = useMemo(
    () => getFilteredRepositoryPaths(availableRepoPaths, activeRepoPath, query),
    [activeRepoPath, availableRepoPaths, query],
  );

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSelectionError(null);
    }
  }, [isOpen]);

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

  return (
    <Combobox
      items={filteredRepoPaths}
      value={activeRepoPath ?? ""}
      inputValue={isOpen ? query : getRepositoryLabel(activeRepoPath)}
      open={isOpen}
      filter={null}
      itemToStringLabel={(repoPath) => getRepositoryLabel(repoPath)}
      itemToStringValue={(repoPath) => repoPath}
      onInputValueChange={(value) => {
        setQuery(value);
        if (!isOpen) {
          void handleOpenDropdown();
        }
      }}
      onOpenChange={(openValue) => {
        setIsOpen(openValue);
        if (openValue) {
          void refreshWorkspaceRepositories();
        }
      }}
      onValueChange={(value) => {
        if (typeof value === "string" && value) {
          handleSelectRepositoryPath(value);
        }
      }}
    >
      <ComboboxInput
        ref={inputRef}
        onFocus={() => void handleOpenDropdown()}
        onClick={() => void handleOpenDropdown()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsOpen(false);
          }
        }}
        readOnly={!isOpen}
        disabled={isSelectingRepo}
        leftIcon={FolderOpen}
        variant="ghost"
        showTrigger={false}
        showClear={false}
        className={cn(
          "inline-flex w-fit max-w-[360px] shrink-0 hover:bg-hover/80",
          isOpen ? "bg-hover/80" : "cursor-pointer",
          className,
        )}
        inputClassName={cn(
          "truncate pr-0 pl-7 font-normal",
          isOpen ? "cursor-text text-text" : "cursor-pointer text-text-lighter",
        )}
        containerStyle={{ width: "fit-content", maxWidth: "360px" }}
        inputStyle={{ width: `calc(${triggerTextWidthCh}ch + 1.75rem)`, flex: "0 0 auto" }}
        placeholder={getRepositoryLabel(activeRepoPath)}
        aria-label="Search repositories"
      />

      <ComboboxContent
        side={placement === "up" ? "top" : "bottom"}
        className="flex flex-col rounded-2xl p-0"
        style={{
          width: `min(${PROJECT_SELECTOR_DROPDOWN_WIDTH}px, calc(100vw - 16px))`,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: "280px",
        }}
      >
        <ComboboxList className="min-h-0 flex-1 p-2">
          {filteredRepoPaths.length === 0 ? (
            <ComboboxEmpty>
              {isDiscovering ? "Detecting repositories..." : "No repositories found"}
            </ComboboxEmpty>
          ) : null}
          {filteredRepoPaths.length > 0 ? (
            <div className="space-y-1">
              {filteredRepoPaths.map((repoPath) => (
                <RepositoryRow
                  key={repoPath}
                  repoPath={repoPath}
                  workspaceRootPath={workspaceRootPath}
                  isCurrent={repoPath === activeRepoPath}
                />
              ))}
            </div>
          ) : null}
        </ComboboxList>

        <div className="border-border/70 border-t p-2">
          <Button
            type="button"
            onClick={() => void handleBrowseRepository()}
            disabled={isSelectingRepo}
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start px-2 text-text-lighter"
          >
            <FolderOpen />
            {isSelectingRepo ? "Selecting..." : "Browse"}
          </Button>
          {manualRepoPath ? (
            <Button
              type="button"
              onClick={handleUseWorkspaceRepositories}
              variant="ghost"
              size="sm"
              className="mt-1 h-7 w-full justify-start px-2 text-text-lighter"
            >
              <RefreshCw />
              Use workspace repositories
            </Button>
          ) : null}
          {selectionError ? (
            <div className="ui-text-sm mt-1 rounded-lg border border-error/30 bg-error/5 px-2 py-1 text-error/90">
              {selectionError}
            </div>
          ) : null}
        </div>
      </ComboboxContent>
    </Combobox>
  );
};

function RepositoryRow({
  repoPath,
  workspaceRootPath,
  isCurrent,
}: {
  repoPath: string;
  workspaceRootPath: string | null;
  isCurrent: boolean;
}) {
  const relativePath = workspaceRootPath ? getRelativePath(repoPath, workspaceRootPath) : repoPath;

  return (
    <ComboboxItem
      value={repoPath}
      showIndicator={false}
      className={cn(
        "group",
        isCurrent ? "font-medium text-text" : "text-text-lighter hover:text-text",
      )}
    >
      {isCurrent ? (
        <Check className="shrink-0 text-success" />
      ) : (
        <FolderOpen className="shrink-0 text-text-lighter" />
      )}
      <span className="min-w-0 flex-1 truncate">
        <span>{getFolderName(repoPath)}</span>
        <span className="ui-text-sm ml-2 text-text-lighter/80">
          {relativePath === "." ? repoPath : relativePath}
        </span>
      </span>
      {isCurrent ? <span className="ui-text-sm ml-auto shrink-0 text-success">current</span> : null}
    </ComboboxItem>
  );
}

export default GitProjectSelector;
