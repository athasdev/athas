import { ColumnsIcon, GitBranchIcon, GitCommitIcon, RowsIcon, SearchIcon } from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  getMultibufferSectionSelector,
  type MultibufferSection,
  MultibufferWorkspace,
  type MultibufferWorkspaceHandle,
} from "@/features/editor/components/multibuffer/multibuffer-workspace";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import {
  type FileNavigatorTone,
  type FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { buildSearchRegex, type SearchOptions } from "@/features/editor/utils/search";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { showAlertDialog } from "@/ui/dialog";
import { Empty, EmptyDescription } from "@/ui/empty";
import { DropdownMenuItem } from "@/ui/dropdown";
import { ResourceActionsMenu } from "@/ui/resource";
import { SEARCH_TOGGLE_ICONS, SearchPopover } from "@/ui/search";
import { joinPath } from "@/utils/path-helpers";
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
import {
  getMultiDiffFilePath,
  resolveMultiDiffSelection,
  selectMultiDiffFile,
} from "../../utils/multi-diff-selection";
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

function estimateDiffSectionHeight(diff: GitDiff) {
  if (diff.is_image || diff.is_binary) return 160;
  return Math.min(760, 40 + diff.lines.length * 20);
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
  bufferId,
  multiDiff,
}: {
  bufferId: string;
  multiDiff: MultiFileDiff;
}) {
  const diffBuffer = useBufferStore((state) => {
    return getBufferById(state.buffers, bufferId);
  });
  const isActiveBuffer = useBufferStore((state) => state.activeBufferId === bufferId);
  const updateBufferContent = useBufferStore.use.actions().updateBufferContent;
  const closeBuffer = useBufferStore.use.actions().closeBuffer;
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const account = useAuthStore((state) => state.user);
  const isFindVisible = useUIState((state) => state.isFindVisible);
  const setIsFindVisible = useUIState((state) => state.setIsFindVisible);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [isNavigatorOpen, setIsNavigatorOpen] = useState(true);
  const [navigatorViewMode, setNavigatorViewMode] = useState<FileNavigatorViewMode>("flat");
  const isWorkingTree = multiDiff.commitHash === "working-tree";
  const isCommitDiff = /^[0-9a-f]{7,40}$/i.test(multiDiff.commitHash);
  const isWorkingTreeBuffer = diffBuffer?.path === "diff://working-tree/all-files";
  const isActiveMultiDiff = isActiveBuffer && diffBuffer?.type === "diff";
  const isRefreshingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<MultibufferWorkspaceHandle>(null);
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
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
  const repoPath = multiDiff.repoPath ?? rootFolderPath;
  const canOpenCommitFile = Boolean(repoPath) && isCommitDiff;
  const commitAuthor = multiDiff.commitAuthor?.trim() || "Unknown author";
  const commitAvatarUrl = isCommitDiff
    ? getGitAuthorAvatarUrl({ email: multiDiff.commitEmail }, account)
    : null;
  const [selectedKey, setSelectedKey] = useState<string | null>(
    () => resolveMultiDiffSelection(multiDiff)?.key ?? null,
  );
  const [activeKey, setActiveKey] = useState<string | null>(selectedKey);

  useEffect(() => {
    const externalKey = resolveMultiDiffSelection(multiDiff)?.key ?? null;
    if (externalKey) setSelectedKey(externalKey);
    // Only react to the buffer's own selection changing (source control sidebar,
    // commit deep links), not to every republished diff payload.
  }, [multiDiff.selectedFileKey, multiDiff.selectedFilePath]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeSection = useMemo(() => {
    const index = multiDiff.files.findIndex(
      (diff, fileIndex) => getMultiDiffSectionKey(multiDiff, diff, fileIndex) === activeKey,
    );
    const diff = multiDiff.files[index];
    return diff ? { diff, sectionKey: activeKey as string } : null;
  }, [activeKey, multiDiff]);

  const findSectionDiff = useCallback(
    (sectionKey: string) => {
      const index = multiDiff.files.findIndex(
        (diff, fileIndex) => getMultiDiffSectionKey(multiDiff, diff, fileIndex) === sectionKey,
      );
      return multiDiff.files[index] ?? null;
    },
    [multiDiff],
  );

  const handleOpenCommitFile = useCallback(
    async (sectionKey: string) => {
      if (!repoPath || !canOpenCommitFile) return;

      const diff = findSectionDiff(sectionKey);
      if (!diff) return;
      const filePath = getMultiDiffFilePath(diff);

      try {
        await openCommitFileBuffer({ repoPath, commitHash: multiDiff.commitHash, filePath });
      } catch (error) {
        await showAlertDialog(
          `Failed to open ${filePath} at ${multiDiff.commitHash.slice(0, 7)}:\n${error}`,
          "Open Commit File",
        );
      }
    },
    [canOpenCommitFile, findSectionDiff, multiDiff.commitHash, repoPath],
  );

  const handleOpenWorkingTreeFile = useCallback(
    (sectionKey: string) => {
      if (!repoPath) return;
      const diff = findSectionDiff(sectionKey);
      if (!diff || diff.is_deleted) return;
      void handleFileSelect(joinPath(repoPath, getMultiDiffFilePath(diff)), false);
    },
    [findSectionDiff, handleFileSelect, repoPath],
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
      setSelectedKey(sectionKey);
      const nextMultiDiff = selectMultiDiffFile(multiDiff, sectionKey);
      if (diffBuffer?.type === "diff" && nextMultiDiff !== multiDiff) {
        updateBufferContent(diffBuffer.id, diffBuffer.content, false, nextMultiDiff);
      }
    },
    [diffBuffer, multiDiff, updateBufferContent],
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

    workspaceRef.current?.scrollToSection(currentSearchMatch.sectionKey);

    let revealTimer: number | null = null;
    const revealFrame = window.requestAnimationFrame(() => {
      revealTimer = window.setTimeout(() => {
        const line = scrollElementRef.current?.querySelector(
          `${getMultibufferSectionSelector(currentSearchMatch.sectionKey)} [data-diff-search-line="${currentSearchMatch.lineIndex}"]`,
        );
        line?.scrollIntoView({ block: "center", inline: "nearest" });
      }, 50);
    });

    return () => {
      window.cancelAnimationFrame(revealFrame);
      if (revealTimer !== null) window.clearTimeout(revealTimer);
    };
  }, [currentSearchMatch]);

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
      !diffBuffer ||
      !activeSection
    ) {
      return;
    }
    if (isRefreshingRef.current) return;

    isRefreshingRef.current = true;

    try {
      gitDiffCache.invalidate(rootFolderPath);
      const selectedFileKey = activeSection.sectionKey;
      const selectedFilePath = selectedFileKey.replace(/^(staged|unstaged):/, "");
      let isStaged = selectedFileKey.startsWith("staged:");
      let nextDiff = await getFileDiff(rootFolderPath, selectedFilePath, isStaged);

      if (!hasRenderableDiff(nextDiff)) {
        isStaged = !isStaged;
        nextDiff = await getFileDiff(rootFolderPath, selectedFilePath, isStaged);
      }

      if (!hasRenderableDiff(nextDiff)) {
        closeBuffer(diffBuffer.id);
        return;
      }

      const nextFileKey = `${isStaged ? "staged" : "unstaged"}:${selectedFilePath}`;
      updateBufferContent(
        diffBuffer.id,
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
    activeSection,
    diffBuffer,
    closeBuffer,
    isWorkingTree,
    isWorkingTreeBuffer,
    multiDiff.title,
    rootFolderPath,
    updateBufferContent,
  ]);

  useEffect(() => {
    if (!isWorkingTree) return;

    let timeoutId: number | null = null;
    const unsubscribe = subscribeToGitChanges((change) => {
      const selectedFilePath = activeSection?.sectionKey.replace(/^(staged|unstaged):/, "");
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
    activeSection?.sectionKey,
    isWorkingTree,
    multiDiff.repoPath,
    refreshWorkingTreeBuffer,
    rootFolderPath,
  ]);

  useEffect(() => {
    if (isWorkingTree || multiDiff.commitHash.startsWith("stash@{")) {
      setGitHubCommitUrl(null);
      return;
    }

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
  }, [isWorkingTree, multiDiff.commitHash, repoPath]);

  const sections = useMemo<MultibufferSection[]>(
    () =>
      multiDiff.files.map((diff, index) => {
        const sectionKey = getMultiDiffSectionKey(multiDiff, diff, index);
        const filePath = getMultiDiffFilePath(diff);
        const { additions, deletions } = countStats(diff);
        const status = getFileStatus(diff);
        const sectionSearchMatches = isFindVisible
          ? searchMatches.filter((match) => match.sectionKey === sectionKey)
          : [];
        const canOpen = isWorkingTree ? Boolean(repoPath) && !diff.is_deleted : canOpenCommitFile;

        return {
          key: sectionKey,
          path: filePath,
          iconTone: statusTone[status] ?? "neutral",
          metadata: [
            ...(additions > 0 ? [{ label: `+${additions}`, tone: "added" as const }] : []),
            ...(deletions > 0 ? [{ label: `-${deletions}`, tone: "deleted" as const }] : []),
          ],
          trailing: (
            <>
              {additions > 0 ? <span className="text-git-added">+{additions}</span> : null}
              {deletions > 0 ? <span className="text-git-deleted">-{deletions}</span> : null}
            </>
          ),
          onOpen: canOpen
            ? () =>
                isWorkingTree
                  ? handleOpenWorkingTreeFile(sectionKey)
                  : void handleOpenCommitFile(sectionKey)
            : undefined,
          openAriaLabel: canOpen ? `Open ${filePath}` : `Go to ${filePath}`,
          estimatedHeight: estimateDiffSectionHeight(diff),
          render: () => (
            <DiffFileContent
              diff={diff}
              sectionKey={sectionKey}
              viewMode={viewMode}
              showWhitespace={showWhitespace}
              searchMatches={sectionSearchMatches}
              currentSearchMatch={isFindVisible ? currentSearchMatch : null}
              searchQuery={isFindVisible ? searchQuery : ""}
              searchOptions={searchOptions}
              canStageHunks={isWorkingTree}
            />
          ),
        };
      }),
    [
      canOpenCommitFile,
      currentSearchMatch,
      handleOpenCommitFile,
      handleOpenWorkingTreeFile,
      isFindVisible,
      isWorkingTree,
      multiDiff,
      repoPath,
      searchMatches,
      searchOptions,
      searchQuery,
      showWhitespace,
      viewMode,
    ],
  );

  const setScrollContainer = useCallback((element: HTMLDivElement | null) => {
    scrollElementRef.current = element;
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      <MultibufferWorkspace
        ref={workspaceRef}
        sections={sections}
        selectedKey={selectedKey}
        onSelect={handleSelectFile}
        onActiveKeyChange={setActiveKey}
        navigatorLabel="Changed files"
        navigatorOpen={isNavigatorOpen}
        onNavigatorOpenChange={setIsNavigatorOpen}
        navigatorViewMode={navigatorViewMode}
        onNavigatorViewModeChange={setNavigatorViewMode}
        scrollContainerRef={setScrollContainer}
        header={{
          icon: isCommitDiff ? <GitCommitIcon /> : <GitBranchIcon />,
          title: isCommitDiff ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar name={commitAuthor} src={commitAvatarUrl} size="sm" />
              <span className="truncate">
                {multiDiff.commitMessage || multiDiff.title || "Commit"}
              </span>
            </span>
          ) : (
            multiDiff.title || "Uncommitted Changes"
          ),
          detail: (
            <span className="flex items-center gap-1.5">
              {isCommitDiff ? (
                <span className="font-mono">{multiDiff.commitHash.slice(0, 7)}</span>
              ) : null}
              <span>{indexedFileLabel}</span>
              <span className="font-mono">
                <span className="text-git-added">+{multiDiff.totalAdditions}</span>{" "}
                <span className="text-git-deleted">-{multiDiff.totalDeletions}</span>
              </span>
              {isIndexingDiffs ? <span>{indexingLabel}</span> : null}
            </span>
          ),
          actions: (
            <>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                type="button"
                active={viewMode === "unified"}
                onClick={() => setViewMode("unified")}
                tooltip="Unified view"
                aria-label="Unified view"
              >
                <RowsIcon />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                type="button"
                active={viewMode === "split"}
                onClick={() => setViewMode("split")}
                tooltip="Split view"
                aria-label="Split view"
              >
                <ColumnsIcon />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                type="button"
                active={isFindVisible}
                onClick={() => setIsFindVisible(!isFindVisible)}
                tooltip="Search changes"
                aria-label="Search changes"
              >
                <SearchIcon />
              </Button>
              <ResourceActionsMenu label="Diff actions" size="sm">
                {canOpenCommitFile && activeKey ? (
                  <DropdownMenuItem onClick={() => void handleOpenCommitFile(activeKey)}>
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
              </ResourceActionsMenu>
            </>
          ),
        }}
        overlay={
          isFindVisible && isActiveMultiDiff ? (
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
              className="absolute top-2 right-4 z-50 max-w-[calc(100%-2rem)]"
            />
          ) : null
        }
        emptyState={
          <Empty className="h-full bg-background" role="status" aria-live="polite">
            <EmptyDescription>
              {isIndexingDiffs ? indexingLabel : "No changed files"}
            </EmptyDescription>
          </Empty>
        }
      />
    </div>
  );
});

export default GitDiffEditorStack;
