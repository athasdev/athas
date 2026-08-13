import { useMemo, useRef, useState, type RefObject } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
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
  DatabaseIcon as Database,
  FileTextIcon as FileText,
  FilesIcon as Files,
  GitPullRequestIcon as GitPullRequest,
  GlobeIcon as Globe,
  PlayCircleIcon as PlayCircle,
  PlusIcon as Plus,
  TerminalWindowIcon as TerminalWindow,
} from "@/ui/icons";
import { matchesSearchQuery } from "@/utils/search-match";
import { AIFileSelector } from "../mentions/ai-file-selector";

function getBufferContextDescription(buffer: PaneContent) {
  if (buffer.type === "webViewer") return buffer.url;
  if (buffer.type === "terminal") return buffer.workingDirectory || "Terminal";
  if (buffer.type === "database") return `${buffer.databaseType} database`;
  if (buffer.type === "pullRequest") return `Pull request #${buffer.prNumber}`;
  if (buffer.type === "githubIssue") return `Issue #${buffer.issueNumber}`;
  if (buffer.type === "githubAction") return `Action run #${buffer.runId}`;
  return buffer.path;
}

function getBufferContextIcon(buffer: PaneContent) {
  if (buffer.type === "webViewer") return <Globe />;
  if (buffer.type === "terminal") return <TerminalWindow />;
  if (buffer.type === "database") return <Database />;
  if (buffer.type === "pullRequest") return <GitPullRequest />;
  if (buffer.type === "githubIssue") return <FileText />;
  if (buffer.type === "githubAction") return <PlayCircle />;
  return <ThemedFileIcon fileName={buffer.name} isDir={false} />;
}

interface ContextSelectorProps {
  buffers: PaneContent[];
  selectedBufferIds: Set<string>;
  onToggleBuffer: (bufferId: string) => void;
  onToggleFile: (filePath: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function ContextSelector({
  buffers,
  selectedBufferIds,
  onToggleBuffer,
  onToggleFile,
  isOpen,
  onOpenChange,
  triggerRef,
}: ContextSelectorProps) {
  const [bufferQuery, setBufferQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const fileSearchInputRef = useRef<HTMLInputElement>(null);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);

  const selectableBuffers = useMemo(
    () => buffers.filter((buffer) => buffer.type !== "agent" && buffer.type !== "newTab"),
    [buffers],
  );
  const filteredBuffers = useMemo(
    () =>
      selectableBuffers.filter((buffer) =>
        matchesSearchQuery(bufferQuery, [
          buffer.name,
          buffer.path,
          buffer.type,
          getBufferContextDescription(buffer),
        ]),
      ),
    [bufferQuery, selectableBuffers],
  );
  const bufferByPath = useMemo(
    () => new Map(selectableBuffers.map((buffer) => [buffer.path, buffer])),
    [selectableBuffers],
  );

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setBufferQuery("");
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
            size="icon-sm"
          />
        }
      >
        <Plus />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Files />
            Open tabs
            <span className="ml-auto text-subtle-foreground tabular-nums">
              {selectableBuffers.length}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 min-w-72">
            <DropdownMenuSearch
              value={bufferQuery}
              onChange={(event) => setBufferQuery(event.target.value)}
              placeholder="Search open tabs..."
              autoFocus
            />
            {filteredBuffers.length > 0 ? (
              filteredBuffers.map((buffer) => (
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
              <DropdownMenuItem disabled>No matching open tabs</DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FileText />
            Files
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="h-80 min-w-80"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <AIFileSelector
              files={[]}
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
              listClassName="max-h-66"
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
