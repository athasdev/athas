import {
  ColumnsIcon as Columns2,
  DotsThreeIcon as MoreHorizontal,
  MagnifyingGlassIcon as Search,
  RowsIcon as Rows3,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Breadcrumb, {
  BreadcrumbActionButton,
} from "@/features/editor/components/toolbar/breadcrumb";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import {
  type FileNavigatorItem,
  type FileNavigatorTone,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { ReviewWorkspace } from "@/features/review/components/review-workspace";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { buildSearchRegex, type SearchOptions } from "@/features/editor/utils/search";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { showAlertDialog } from "@/ui/dialog";
import { Empty, EmptyDescription } from "@/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import Tooltip from "@/ui/tooltip";
import { SEARCH_TOGGLE_ICONS, SearchPopover } from "@/ui/search";
import { getFileDiff } from "../../api/git-diff-api";
import { getRemotes } from "../../api/git-remotes-api";
import { isGitChangeRelevant, subscribeToGitChanges } from "../../events/git-events";
import type { MultiFileDiff } from "../../types/git-diff.types";
import type { GitDiff } from "../../types/git.types";
import { gitDiffCache } from "../../utils/git-diff-cache";
import { getFileStatus } from "../../utils/git-diff-helpers";
import { getGitAuthorAvatarUrl } from "../../utils/git-author-avatar";
import { openCommitFileBuffer } from "../../utils/open-commit-file-buffer";
import { findMultiDiffMatches, getMultiDiffSectionKey } from "../../utils/multi-diff-search";
import { resolveMultiDiffSelection, selectMultiDiffFile } from "../../utils/multi-diff-selection";
import { createSingleFileWorkingTreeDiff } from "../../utils/working-tree-multi-diff";
import { DiffFileContent } from "./diff-file-content";

function countStats(diff: GitDiff) {
  if (typeof diff.additions === "number" || typeof diff.deletions === "number") {
    return {
      additions: diff.additions ?? 0,
      deletions: diff.deletions ?? 0,
    };
  }

  let additions = 0;
  let deletions = 0;

  for (const line of diff.lines) {
    if (line.line_type === "added") additions++;
    if (line.line_type === "removed") deletions++;
  }

  return { additions, deletions };
}

function hasRenderableDiff(diff: GitDiff | null): diff is GitDiff {
  return !!diff && (diff.lines.length > 0 || diff.is_image === true || diff.is_binary === true);
}

const statusTone: Record<string, FileNavigatorTone> = {
  added: "added",
  deleted: "deleted",
  modified: "modified",
  renamed: "renamed",
};

function parseGitHubRemoteSlug(remoteUrl: string): { owner: string; repo: string } | null {
  const normalized = remoteUrl.trim();
  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    const [, owner, repo] = httpsMatch;
    return { owner, repo };
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    const [, owner, repo] = sshMatch;
    return { owner, repo };
  }

  return null;
}

function buildGitHubReferenceUrl(remoteUrl: string, gitRef: string): string | null {
  const slug = parseGitHubRemoteSlug(remoteUrl);
  if (!slug) return null;

  const comparisonMatch = gitRef.match(/^(.+?)(?:\.{2,3})(.+)$/);
  if (comparisonMatch) {
    const [, baseRef, targetRef] = comparisonMatch;
    return `https://github.com/${slug.owner}/${slug.repo}/compare/${encodeURIComponent(
      baseRef,
    )}...${encodeURIComponent(targetRef)}`;
  }

  return `https://github.com/${slug.owner}/${slug.repo}/commit/${encodeURIComponent(gitRef)}`;
}

const GitDiffEditorStack = memo(function GitDiffEditorStack({
  multiDiff,
}: {
  multiDiff: MultiFileDiff;
}) {
  const activeBuffer = useBufferStore((state) => {
    return getBufferById(state.buffers, state.activeBufferId);
  });
  const updateBufferContent = useBufferStore.use.actions().updateBufferContent;
  const closeBuffer = useBufferStore.use.actions().closeBuffer;
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const account = useAuthStore((state) => state.user);
  const isFindVisible = useUIState((state) => state.isFindVisible);
  const setIsFindVisible = useUIState((state) => state.setIsFindVisible);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [showWhitespace, setShowWhitespace] = useState(false);
  const isWorkingTree = multiDiff.commitHash === "working-tree";
  const isCommitDiff = /^[0-9a-f]{7,40}$/i.test(multiDiff.commitHash);
  const isWorkingTreeBuffer = activeBuffer?.path === "diff://working-tree/all-files";
  const isActiveMultiDiff = activeBuffer?.type === "diff" && activeBuffer.diffData === multiDiff;
  const isRefreshingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const diffStackScrollRef = useRef<HTMLDivElement>(null);
  const selectedSectionRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
  });
  const [currentSearchMatchIndex, setCurrentSearchMatchIndex] = useState(-1);
  const searchMatches = useMemo(
    () => findMultiDiffMatches(multiDiff, searchQuery, searchOptions),
    [multiDiff, searchOptions, searchQuery],
  );
  const currentSearchMatch =
    currentSearchMatchIndex >= 0 ? (searchMatches[currentSearchMatchIndex] ?? null) : null;
  const isInvalidSearch =
    searchOptions.useRegex &&
    searchQuery.length > 0 &&
    buildSearchRegex(searchQuery, searchOptions) === null;
  const [githubCommitUrl, setGitHubCommitUrl] = useState<string | null>(null);
  const indexingProgress = multiDiff.indexingProgress;
  const isIndexingDiffs = Boolean(multiDiff.isLoading);
  const indexingLabel = indexingProgress
    ? `${indexingProgress.label ?? "Indexing"} ${indexingProgress.processed.toLocaleString()}/${indexingProgress.total.toLocaleString()}`
    : "Indexing changes";
  const indexedFileLabel = indexingProgress
    ? `${multiDiff.files.length.toLocaleString()} of ${indexingProgress.total.toLocaleString()} changed files`
    : `${multiDiff.totalFiles.toLocaleString()} changed file${multiDiff.totalFiles !== 1 ? "s" : ""}`;
  const diffFileItems = useMemo<FileNavigatorItem[]>(
    () =>
      multiDiff.files.map((diff, index) => {
        const filePath = diff.new_path || diff.old_path || diff.file_path;
        const { additions, deletions } = countStats(diff);
        const status = getFileStatus(diff);

        return {
          key: getMultiDiffSectionKey(multiDiff, diff, index),
          path: filePath,
          iconTone: statusTone[status] ?? "neutral",
          metadata: [
            ...(additions > 0 ? [{ label: `+${additions}`, tone: "added" as const }] : []),
            ...(deletions > 0 ? [{ label: `-${deletions}`, tone: "deleted" as const }] : []),
          ],
        };
      }),
    [multiDiff],
  );
  const selectedFile = useMemo(() => resolveMultiDiffSelection(multiDiff), [multiDiff]);
  const selectedFileKey = selectedFile?.key ?? null;
  const selectedDiffFile = selectedFile
    ? { diff: selectedFile.diff, sectionKey: selectedFile.key }
    : null;
  const canOpenCommitFile = Boolean(multiDiff.repoPath ?? rootFolderPath) && isCommitDiff;
  const commitAuthor = multiDiff.commitAuthor?.trim() || "Unknown author";
  const commitAvatarUrl = isCommitDiff
    ? getGitAuthorAvatarUrl(
        {
          hash: multiDiff.commitHash,
          message: multiDiff.commitMessage || multiDiff.title || "Commit",
          author: commitAuthor,
          email: multiDiff.commitEmail,
          date: multiDiff.commitDate || "",
        },
        account,
      )
    : null;
  const handleOpenCommitFile = useCallback(
    async (sectionKey: string) => {
      const repoPath = multiDiff.repoPath ?? rootFolderPath;
      if (!repoPath || !canOpenCommitFile) return;

      const fileIndex = multiDiff.files.findIndex(
        (diff, index) => getMultiDiffSectionKey(multiDiff, diff, index) === sectionKey,
      );
      const diff = multiDiff.files[fileIndex];
      if (!diff) return;
      const filePath = diff.new_path || diff.old_path || diff.file_path;

      try {
        await openCommitFileBuffer({ repoPath, commitHash: multiDiff.commitHash, filePath });
      } catch (error) {
        await showAlertDialog(
          `Failed to open ${filePath} at ${multiDiff.commitHash.slice(0, 7)}:\n${error}`,
          "Open Commit File",
        );
      }
    },
    [canOpenCommitFile, multiDiff, rootFolderPath],
  );
  const navigateSearch = useCallback(
    (direction: 1 | -1) => {
      if (searchMatches.length === 0) return;
      setCurrentSearchMatchIndex((current) => {
        const base = current >= 0 ? current : direction === 1 ? -1 : 0;
        return (base + direction + searchMatches.length) % searchMatches.length;
      });
    },
    [searchMatches.length],
  );
  const handleSelectFile = useCallback(
    (sectionKey: string) => {
      const nextMultiDiff = selectMultiDiffFile(multiDiff, sectionKey);
      if (activeBuffer?.type === "diff" && nextMultiDiff !== multiDiff) {
        updateBufferContent(activeBuffer.id, activeBuffer.content, false, nextMultiDiff);
      }
      window.requestAnimationFrame(() => {
        diffStackScrollRef.current?.scrollTo({ top: 0, left: 0 });
      });
    },
    [activeBuffer, multiDiff, updateBufferContent],
  );

  useEffect(() => {
    if (searchMatches.length === 0) {
      setCurrentSearchMatchIndex(-1);
      return;
    }

    setCurrentSearchMatchIndex(0);
  }, [searchMatches]);

  useEffect(() => {
    if (!isFindVisible || !isActiveMultiDiff) return;
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [isActiveMultiDiff, isFindVisible]);

  useEffect(() => {
    if (!currentSearchMatch) return;

    handleSelectFile(currentSearchMatch.sectionKey);

    let revealTimer: number | null = null;
    const revealFrame = window.requestAnimationFrame(() => {
      revealTimer = window.setTimeout(() => {
        const line = selectedSectionRef.current?.querySelector(
          `[data-diff-search-line="${currentSearchMatch.lineIndex}"]`,
        );
        line?.scrollIntoView({ block: "center", inline: "nearest" });
      }, 50);
    });

    return () => {
      window.cancelAnimationFrame(revealFrame);
      if (revealTimer !== null) window.clearTimeout(revealTimer);
    };
  }, [currentSearchMatch, handleSelectFile]);

  useEffect(() => {
    if (!isActiveMultiDiff) return;

    const handleSearchShortcut = (event: KeyboardEvent) => {
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (hasCommandModifier && key === "f") {
        event.preventDefault();
        setIsFindVisible(true);
        window.requestAnimationFrame(() => searchInputRef.current?.select());
        return;
      }

      if (hasCommandModifier && key === "g" && searchMatches.length > 0) {
        event.preventDefault();
        setIsFindVisible(true);
        navigateSearch(event.shiftKey ? -1 : 1);
      }
    };

    document.addEventListener("keydown", handleSearchShortcut, { capture: true });
    return () => document.removeEventListener("keydown", handleSearchShortcut, { capture: true });
  }, [isActiveMultiDiff, navigateSearch, searchMatches.length, setIsFindVisible]);

  const refreshWorkingTreeBuffer = useCallback(async () => {
    if (
      !isWorkingTree ||
      !isWorkingTreeBuffer ||
      !rootFolderPath ||
      !activeBuffer ||
      !selectedDiffFile
    ) {
      return;
    }
    if (isRefreshingRef.current) return;

    isRefreshingRef.current = true;

    try {
      gitDiffCache.invalidate(rootFolderPath);
      const selectedFileKey = selectedDiffFile.sectionKey;
      const selectedFilePath = selectedFileKey.replace(/^(staged|unstaged):/, "");
      let isStaged = selectedFileKey.startsWith("staged:");
      let nextDiff = await getFileDiff(rootFolderPath, selectedFilePath, isStaged);

      if (!hasRenderableDiff(nextDiff)) {
        isStaged = !isStaged;
        nextDiff = await getFileDiff(rootFolderPath, selectedFilePath, isStaged);
      }

      if (!hasRenderableDiff(nextDiff)) {
        closeBuffer(activeBuffer.id);
        return;
      }

      const nextFileKey = `${isStaged ? "staged" : "unstaged"}:${selectedFilePath}`;
      updateBufferContent(
        activeBuffer.id,
        "",
        false,
        createSingleFileWorkingTreeDiff({
          repoPath: rootFolderPath,
          fileKey: nextFileKey,
          diff: nextDiff,
          title: multiDiff.title,
        }),
      );
    } finally {
      isRefreshingRef.current = false;
    }
  }, [
    activeBuffer,
    closeBuffer,
    isWorkingTree,
    isWorkingTreeBuffer,
    multiDiff.title,
    rootFolderPath,
    selectedDiffFile,
    updateBufferContent,
  ]);

  useEffect(() => {
    if (!isWorkingTree) return;

    let timeoutId: number | null = null;
    const unsubscribe = subscribeToGitChanges((change) => {
      const selectedFilePath = selectedDiffFile?.sectionKey.replace(/^(staged|unstaged):/, "");
      if (!isGitChangeRelevant(change, multiDiff.repoPath ?? rootFolderPath, selectedFilePath)) {
        return;
      }
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void refreshWorkingTreeBuffer();
      }, 50);
    });

    return () => {
      unsubscribe();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [
    isWorkingTree,
    multiDiff.repoPath,
    refreshWorkingTreeBuffer,
    rootFolderPath,
    selectedDiffFile?.sectionKey,
  ]);

  useEffect(() => {
    if (isWorkingTree || multiDiff.commitHash.startsWith("stash@{")) {
      setGitHubCommitUrl(null);
      return;
    }

    const repoPath = multiDiff.repoPath ?? rootFolderPath;
    if (!repoPath) {
      setGitHubCommitUrl(null);
      return;
    }

    let isCancelled = false;

    const loadGitHubCommitUrl = async () => {
      const remotes = await getRemotes(repoPath);
      const candidate =
        remotes.find((remote) => remote.name === "origin")?.url ?? remotes[0]?.url ?? null;
      const nextUrl = candidate ? buildGitHubReferenceUrl(candidate, multiDiff.commitHash) : null;
      if (!isCancelled) {
        setGitHubCommitUrl(nextUrl);
      }
    };

    void loadGitHubCommitUrl();

    return () => {
      isCancelled = true;
    };
  }, [isWorkingTree, multiDiff.commitHash, multiDiff.repoPath, rootFolderPath]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      <Breadcrumb
        filePathOverride={multiDiff.title || "Uncommitted Changes"}
        interactive={false}
        showPath={false}
        showDefaultActions={false}
        extraLeftContent={
          isCommitDiff ? (
            <div className="ui-text-sm flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
              <Avatar name={commitAuthor} src={commitAvatarUrl} className="size-5" />
              <span className="truncate font-medium text-foreground">
                {multiDiff.commitMessage || multiDiff.title || "Commit"}
              </span>
            </div>
          ) : (
            <div className="ui-text-sm flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-subtle-foreground">
              <span className="shrink-0 font-medium text-foreground">
                {multiDiff.title || "Uncommitted Changes"}
              </span>
              <span className="truncate">{indexedFileLabel}</span>
              <span className="shrink-0 text-git-added">+{multiDiff.totalAdditions}</span>
              <span className="shrink-0 text-git-deleted">-{multiDiff.totalDeletions}</span>
              {isIndexingDiffs ? <span>{indexingLabel}</span> : null}
            </div>
          )
        }
        rightContent={
          <div className="flex items-center gap-1">
            <BreadcrumbActionButton
              type="button"
              active={isFindVisible}
              onClick={() => setIsFindVisible(!isFindVisible)}
              tooltip="Search changes"
              tooltipSide="bottom"
              aria-label="Search changes"
            >
              <Search />
            </BreadcrumbActionButton>
            <div className="flex items-center gap-0.5">
              <BreadcrumbActionButton
                type="button"
                active={viewMode === "unified"}
                onClick={() => setViewMode("unified")}
                tooltip="Unified view"
                tooltipSide="bottom"
                aria-label="Unified view"
              >
                <Rows3 weight="duotone" />
              </BreadcrumbActionButton>
              <BreadcrumbActionButton
                type="button"
                active={viewMode === "split"}
                onClick={() => setViewMode("split")}
                tooltip="Split view"
                tooltipSide="bottom"
                aria-label="Split view"
              >
                <Columns2 weight="duotone" />
              </BreadcrumbActionButton>
            </div>
            <DropdownMenu>
              <Tooltip content="Diff actions" side="bottom">
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Diff actions"
                    />
                  }
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent>
                {canOpenCommitFile && selectedFileKey ? (
                  <DropdownMenuItem onClick={() => void handleOpenCommitFile(selectedFileKey)}>
                    Open file at {multiDiff.commitHash.slice(0, 7)}
                  </DropdownMenuItem>
                ) : null}
                {githubCommitUrl ? (
                  <DropdownMenuItem onClick={() => void openUrl(githubCommitUrl)}>
                    View on GitHub
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => setShowWhitespace((current) => !current)}>
                  {showWhitespace ? "Hide whitespace" : "Show whitespace"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {isFindVisible && isActiveMultiDiff ? (
        <SearchPopover
          value={searchQuery}
          onChange={setSearchQuery}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setIsFindVisible(false);
            } else if (event.key === "Enter") {
              event.preventDefault();
              navigateSearch(event.shiftKey ? -1 : 1);
            }
          }}
          onClose={() => setIsFindVisible(false)}
          placeholder="Search changes"
          inputRef={searchInputRef}
          matchLabel={
            searchQuery
              ? isInvalidSearch
                ? "Invalid expression"
                : searchMatches.length > 0
                  ? `${currentSearchMatchIndex + 1} of ${searchMatches.length}`
                  : "No results"
              : null
          }
          matchTone={
            isInvalidSearch || (searchQuery.length > 0 && searchMatches.length === 0)
              ? "warning"
              : "default"
          }
          onNext={() => navigateSearch(1)}
          onPrevious={() => navigateSearch(-1)}
          canNavigate={searchMatches.length > 0}
          options={[
            {
              id: "case-sensitive",
              label: "Match case",
              icon: SEARCH_TOGGLE_ICONS.caseSensitive,
              active: searchOptions.caseSensitive,
              onToggle: () =>
                setSearchOptions((current) => ({
                  ...current,
                  caseSensitive: !current.caseSensitive,
                })),
            },
            {
              id: "whole-word",
              label: "Match whole word",
              icon: SEARCH_TOGGLE_ICONS.wholeWord,
              active: searchOptions.wholeWord,
              onToggle: () =>
                setSearchOptions((current) => ({
                  ...current,
                  wholeWord: !current.wholeWord,
                })),
            },
            {
              id: "regex",
              label: "Use regular expression",
              icon: SEARCH_TOGGLE_ICONS.regex,
              active: searchOptions.useRegex,
              onToggle: () =>
                setSearchOptions((current) => ({
                  ...current,
                  useRegex: !current.useRegex,
                })),
            },
          ]}
          className="absolute top-9 right-2 z-50 max-w-[calc(100%-1rem)]"
        />
      ) : null}

      {isIndexingDiffs && multiDiff.files.length === 0 ? (
        <Empty className="rounded-none bg-background" role="status" aria-live="polite">
          <EmptyDescription>{indexingLabel}</EmptyDescription>
        </Empty>
      ) : null}

      {isIndexingDiffs && multiDiff.files.length === 0 ? null : (
        <ReviewWorkspace
          items={diffFileItems}
          selectedKey={selectedFileKey}
          onSelect={handleSelectFile}
          isActive={isActiveMultiDiff}
          fileNavigation={multiDiff.fileNavigation}
          contentRef={diffStackScrollRef}
        >
          {selectedDiffFile ? (
            <div
              key={selectedDiffFile.sectionKey}
              ref={selectedSectionRef}
              className="min-w-0 max-w-full overflow-hidden bg-background"
            >
              <DiffFileContent
                diff={selectedDiffFile.diff}
                sectionKey={selectedDiffFile.sectionKey}
                viewMode={viewMode}
                showWhitespace={showWhitespace}
                searchMatches={
                  isFindVisible
                    ? searchMatches.filter(
                        (match) => match.sectionKey === selectedDiffFile.sectionKey,
                      )
                    : []
                }
                currentSearchMatch={isFindVisible ? currentSearchMatch : null}
                searchQuery={isFindVisible ? searchQuery : ""}
                searchOptions={searchOptions}
                canStageHunks={isWorkingTree}
              />
            </div>
          ) : (
            <Empty className="h-full rounded-none bg-background">
              <EmptyDescription>No changed file selected</EmptyDescription>
            </Empty>
          )}
        </ReviewWorkspace>
      )}
    </div>
  );
});

export default GitDiffEditorStack;
