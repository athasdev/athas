import { TagIcon, RocketIcon } from "@/ui/icons";
import { useMemo, useRef, useState, type RefObject } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { openFiles } from "@/features/file-system/controllers/platform";
import { useGitStore } from "@/features/git/stores/git.store";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearch,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  DatabaseIcon,
  FileTextIcon,
  FilesIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  PlayCircleIcon,
  PlusIcon,
  TerminalWindowIcon,
  UploadIcon,
} from "@/ui/icons";
import { GithubMark } from "@/ui/brand-marks";
import { matchesSearchQuery } from "@/utils/search-match";
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
  const [bufferQuery, setBufferQuery] = useState("");
  const [githubQuery, setGithubQuery] = useState("");
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
  const filteredBuffers = useMemo(
    () =>
      openTabs.filter((buffer) =>
        matchesSearchQuery(bufferQuery, [
          buffer.name,
          buffer.path,
          buffer.type,
          getBufferContextDescription(buffer),
        ]),
      ),
    [bufferQuery, openTabs],
  );
  const filteredGithubBuffers = useMemo(
    () =>
      githubBuffers.filter((buffer) =>
        matchesSearchQuery(githubQuery, [
          buffer.name,
          buffer.path,
          getBufferContextDescription(buffer),
        ]),
      ),
    [githubBuffers, githubQuery],
  );
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
      <DropdownMenuItem disabled>{emptyLabel}</DropdownMenuItem>
    );

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setBufferQuery("");
          setGithubQuery("");
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
      <DropdownMenuContent align="start" className="min-w-52">
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
            className="h-80 min-w-80"
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
            <GitBranchIcon />
            <span className="min-w-0 flex-1 truncate">Git changes</span>
            <span className="shrink-0 text-subtle-foreground tabular-nums">
              {gitContextFiles.length}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 min-w-72">
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
              <DropdownMenuItem disabled>No attachable Git changes</DropdownMenuItem>
            )}
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
          <DropdownMenuSubContent className="max-h-80 min-w-72">
            <DropdownMenuSearch
              value={githubQuery}
              onChange={(event) => setGithubQuery(event.target.value)}
              placeholder="Search GitHub tabs..."
              autoFocus
            />
            {renderBufferOptions(filteredGithubBuffers, "No open GitHub tabs")}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FilesIcon />
            <span className="min-w-0 flex-1 truncate">Open tabs</span>
            <span className="shrink-0 text-subtle-foreground tabular-nums">{openTabs.length}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 min-w-72">
            <DropdownMenuSearch
              value={bufferQuery}
              onChange={(event) => setBufferQuery(event.target.value)}
              placeholder="Search open tabs..."
              autoFocus
            />
            {renderBufferOptions(filteredBuffers, "No matching open tabs")}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
