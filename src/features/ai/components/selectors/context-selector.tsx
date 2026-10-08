import { TagIcon, RocketIcon } from "@/ui/icons";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { openFiles } from "@/features/file-system/controllers/platform";
import { useGitStore } from "@/features/git/stores/git.store";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { formatContextReference, listProjectFolders } from "@/features/ai/lib/context-references";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuEmpty,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuViewport,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { useMenuSearch } from "@/ui/menu-search";
import {
  DatabaseIcon,
  FileTextIcon,
  FilesIcon,
  FolderIcon,
  GitBranchIcon,
  GitDiffIcon,
  HistoryIcon,
  GitPullRequestIcon,
  PlayCircleIcon,
  PlusIcon,
  TerminalWindowIcon,
  UploadIcon,
  WarningIcon,
} from "@/ui/icons";
import { GithubMark } from "@/ui/brand-marks";
import { AIFileSelector } from "../mentions/ai-file-selector";
import {
  getGitContextFiles,
  groupContextBuffers,
} from "@/features/ai/utils/context-selector-model";

function getBufferContextDescription(buffer: PaneContent) {
  if (buffer.type === "terminal") return buffer.workingDirectory || "Terminal";
  if (buffer.type === "database") return `${buffer.databaseType} database`;
  if (buffer.type === "pullRequest") return `Pull request #${buffer.prNumber}`;
  if (buffer.type === "githubIssue") return `Issue #${buffer.issueNumber}`;
  if (buffer.type === "githubAction") return `Action run #${buffer.runId}`;
  if (buffer.type === "githubDelivery")
    return `${buffer.kind === "releases" ? "Release" : "Deployment"} · ${buffer.name}`;
  return buffer.path;
}

function getBufferContextIcon(buffer: PaneContent) {
  if (buffer.type === "terminal") return <TerminalWindowIcon />;
  if (buffer.type === "database") return <DatabaseIcon />;
  if (buffer.type === "pullRequest") return <GitPullRequestIcon />;
  if (buffer.type === "githubIssue") return <FileTextIcon />;
  if (buffer.type === "githubAction") return <PlayCircleIcon />;
  if (buffer.type === "githubDelivery")
    return buffer.kind === "releases" ? <TagIcon /> : <RocketIcon />;
  return <ThemedFileIcon fileName={buffer.name} isDir={false} />;
}

interface ContextSelectorProps {
  buffers: PaneContent[];
  selectedBufferIds: Set<string>;
  selectedFilesPaths: Set<string>;
  onToggleBuffer: (bufferId: string) => void;
  onToggleFile: (filePath: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function ContextSelector({
  buffers,
  selectedBufferIds,
  selectedFilesPaths,
  onToggleBuffer,
  onToggleFile,
  isOpen,
  onOpenChange,
  triggerRef,
}: ContextSelectorProps) {
  const bufferSearch = useMenuSearch();
  const githubSearch = useMenuSearch();
  const folderSearch = useMenuSearch();
  const chatSearch = useMenuSearch();
  const [projectFolders, setProjectFolders] = useState<ReturnType<typeof listProjectFolders>>([]);
  const getAllProjectFiles = useFileSystemStore((state) => state.getAllProjectFiles);
  const problemCount = useDiagnosticsStore(
    ({ diagnosticCounts }) =>
      diagnosticCounts.error + diagnosticCounts.warning + diagnosticCounts.info,
  );
  const chats = useAIChatStore((state) => state.chats);
  const [fileQuery, setFileQuery] = useState("");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const fileSearchInputRef = useRef<HTMLInputElement>(null);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const workspaceGitStatus = useGitStore((state) => state.workspaceGitStatus);
  const currentWorkspaceRepoPath = useGitStore((state) => state.currentWorkspaceRepoPath);

  const { github: githubBuffers, openTabs } = useMemo(
    () => groupContextBuffers(buffers),
    [buffers],
  );
  const filteredBuffers = bufferSearch.filter(openTabs, (buffer) => [
    buffer.name,
    buffer.path,
    buffer.type,
    getBufferContextDescription(buffer),
  ]);
  const filteredGithubBuffers = githubSearch.filter(githubBuffers, (buffer) => [
    buffer.name,
    buffer.path,
    getBufferContextDescription(buffer),
  ]);
  const selectableBuffers = useMemo(
    () => [...openTabs, ...githubBuffers],
    [githubBuffers, openTabs],
  );
  const bufferByPath = useMemo(
    () => new Map(selectableBuffers.map((buffer) => [buffer.path, buffer])),
    [selectableBuffers],
  );
  const gitContextFiles = useMemo(
    () =>
      getGitContextFiles(workspaceGitStatus, currentWorkspaceRepoPath ?? rootFolderPath ?? null),
    [currentWorkspaceRepoPath, rootFolderPath, workspaceGitStatus],
  );

  useEffect(() => {
    if (!isOpen || !rootFolderPath) return;
    let cancelled = false;
    void getAllProjectFiles()
      .then((entries) => {
        if (!cancelled) setProjectFolders(listProjectFolders(entries, rootFolderPath));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [getAllProjectFiles, isOpen, rootFolderPath]);

  const filteredFolders = folderSearch
    .filter(projectFolders, (folder) => [folder.relativePath])
    .slice(0, 100);
  const pastChats = useMemo(
    () =>
      chats
        .filter((chat) => !chat.archivedAt)
        .sort((left, right) => right.lastMessageAt.getTime() - left.lastMessageAt.getTime())
        .slice(0, 50),
    [chats],
  );
  const filteredChats = chatSearch.filter(pastChats, (chat) => [chat.title]);

  const renderReferenceToggle = (
    reference: Parameters<typeof formatContextReference>[0],
    icon: ReactNode,
    label: string,
    detail?: ReactNode,
  ) => {
    const value = formatContextReference(reference);
    return (
      <DropdownMenuCheckboxItem
        key={value}
        checked={selectedFilesPaths.has(value)}
        closeOnClick={false}
        onCheckedChange={() => onToggleFile(value)}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {detail}
      </DropdownMenuCheckboxItem>
    );
  };

  const handleAttachFiles = async () => {
    const selectedPaths = await openFiles();
    for (const path of selectedPaths) {
      if (!selectedFilesPaths.has(path)) onToggleFile(path);
    }
  };

  const renderBufferOptions = (options: PaneContent[], emptyLabel: string) =>
    options.length > 0 ? (
      options.map((buffer) => (
        <DropdownMenuCheckboxItem
          key={buffer.id}
          checked={selectedBufferIds.has(buffer.id)}
          closeOnClick={false}
          onCheckedChange={() => onToggleBuffer(buffer.id)}
        >
          {getBufferContextIcon(buffer)}
          <span className="min-w-0 flex-1 truncate">{buffer.name}</span>
          <span className="max-w-36 truncate text-subtle-foreground">
            {getBufferContextDescription(buffer)}
          </span>
        </DropdownMenuCheckboxItem>
      ))
    ) : (
      <DropdownMenuEmpty>{emptyLabel}</DropdownMenuEmpty>
    );

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          bufferSearch.reset();
          githubSearch.reset();
          folderSearch.reset();
          chatSearch.reset();
          setFileQuery("");
          setSelectedFileIndex(0);
        }
        onOpenChange(open);
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            tooltip="Add context"
            aria-label="Add context"
            iconOnly
          />
        }
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="default">
        <DropdownMenuItem onClick={() => void handleAttachFiles()}>
          <UploadIcon />
          Attach files…
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FileTextIcon />
            Project files
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            size="panel"
            className="h-80"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <AIFileSelector
              query={fileQuery}
              onQueryChange={setFileQuery}
              onSelect={(file) => {
                const buffer = bufferByPath.get(file.path);
                if (buffer) {
                  onToggleBuffer(buffer.id);
                } else {
                  onToggleFile(file.path);
                }
                fileSearchInputRef.current?.focus();
              }}
              rootFolderPath={rootFolderPath}
              selectedIndex={selectedFileIndex}
              onSelectedIndexChange={setSelectedFileIndex}
              searchInputRef={fileSearchInputRef}
              emptyLabel="No matching files"
              compact
              autoFocusSearchInput
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderIcon />
            Folders
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent size="wide" viewport="searchable">
            <DropdownMenuSearch
              value={folderSearch.query}
              onChange={(event) => folderSearch.setQuery(event.target.value)}
              placeholder="Search folders..."
              autoFocus
            />
            <DropdownMenuViewport>
              {filteredFolders.length > 0 ? (
                filteredFolders.map((folder) =>
                  renderReferenceToggle(
                    { kind: "folder", path: folder.path },
                    <FolderIcon />,
                    folder.relativePath,
                  ),
                )
              ) : (
                <DropdownMenuEmpty>No matching folders</DropdownMenuEmpty>
              )}
            </DropdownMenuViewport>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <GitBranchIcon />
            <span className="min-w-0 flex-1 truncate">Git changes</span>
            <span className="shrink-0 text-subtle-foreground tabular-nums">
              {gitContextFiles.length}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent size="wide" viewport="list">
            {renderReferenceToggle(
              { kind: "gitDiff", scope: "working" },
              <GitDiffIcon />,
              "Working tree diff",
            )}
            {renderReferenceToggle(
              { kind: "gitDiff", scope: "staged" },
              <GitDiffIcon />,
              "Staged diff",
            )}
            <DropdownMenuSeparator />
            {gitContextFiles.length > 0 ? (
              gitContextFiles.map((file) => (
                <DropdownMenuCheckboxItem
                  key={file.absolutePath}
                  checked={selectedFilesPaths.has(file.absolutePath)}
                  closeOnClick={false}
                  onCheckedChange={() => onToggleFile(file.absolutePath)}
                >
                  <ThemedFileIcon fileName={file.path} isDir={false} />
                  <span className="min-w-0 flex-1 truncate">{file.path}</span>
                  <span className="text-subtle-foreground">
                    {file.staged ? "Staged" : file.status}
                  </span>
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <DropdownMenuEmpty>No attachable Git changes</DropdownMenuEmpty>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {renderReferenceToggle(
          { kind: "problems" },
          <WarningIcon />,
          "Problems",
          <span className="shrink-0 text-subtle-foreground tabular-nums">{problemCount}</span>,
        )}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <HistoryIcon />
            <span className="min-w-0 flex-1 truncate">Past chats</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent size="wide" viewport="searchable">
            <DropdownMenuSearch
              value={chatSearch.query}
              onChange={(event) => chatSearch.setQuery(event.target.value)}
              placeholder="Search chats..."
              autoFocus
            />
            <DropdownMenuViewport>
              {filteredChats.length > 0 ? (
                filteredChats.map((chat) =>
                  renderReferenceToggle(
                    { kind: "chat", chatId: chat.id, title: chat.title },
                    <HistoryIcon />,
                    chat.title || "Untitled chat",
                  ),
                )
              ) : (
                <DropdownMenuEmpty>No matching chats</DropdownMenuEmpty>
              )}
            </DropdownMenuViewport>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <GithubMark />
            <span className="min-w-0 flex-1 truncate">GitHub</span>
            <span className="shrink-0 text-subtle-foreground tabular-nums">
              {githubBuffers.length}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent size="wide" viewport="searchable">
            <DropdownMenuSearch
              value={githubSearch.query}
              onChange={(event) => githubSearch.setQuery(event.target.value)}
              placeholder="Search GitHub tabs..."
              autoFocus
            />
            <DropdownMenuViewport>
              {renderBufferOptions(filteredGithubBuffers, "No open GitHub tabs")}
            </DropdownMenuViewport>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FilesIcon />
            <span className="min-w-0 flex-1 truncate">Open tabs</span>
            <span className="shrink-0 text-subtle-foreground tabular-nums">{openTabs.length}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent size="wide" viewport="searchable">
            <DropdownMenuSearch
              value={bufferSearch.query}
              onChange={(event) => bufferSearch.setQuery(event.target.value)}
              placeholder="Search open tabs..."
              autoFocus
            />
            <DropdownMenuViewport>
              {renderBufferOptions(filteredBuffers, "No matching open tabs")}
            </DropdownMenuViewport>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
