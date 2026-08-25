import {
  ArrowClockwiseIcon as Refresh,
  DownloadSimpleIcon as Download,
  FileIcon,
  FolderIcon,
  UploadSimpleIcon as Upload,
} from "@/ui/icons";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { SearchField } from "@/ui/search";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import type { DockerContainer, DockerContainerFileEntry } from "../types/docker.types";
import type { DockerLogFilter, DockerLogLine } from "../hooks/use-docker-container-logs";
import { formatDockerFileSize, getParentContainerPath } from "../utils/docker-sidebar-utils";

export type DockerContainerDetailTab = "logs" | "files";

interface DockerContainerDetailProps {
  container: DockerContainer;
  activeTab: DockerContainerDetailTab;
  logStreamId: string | null;
  logLines: DockerLogLine[];
  filteredLogLines: DockerLogLine[];
  logQuery: string;
  logFilter: DockerLogFilter;
  logError: string | null;
  containerPath: string;
  containerFiles: DockerContainerFileEntry[];
  isFilesLoading: boolean;
  filesError: string | null;
  onTabChange: (tab: DockerContainerDetailTab) => void;
  onClearLogs: () => void;
  onLogQueryChange: (query: string) => void;
  onLogFilterChange: (filter: DockerLogFilter) => void;
  onContainerPathChange: (path: string) => void;
  onRefreshFiles: () => void | Promise<void>;
  onCopyToContainer: () => void | Promise<void>;
  onCopyFromContainer: (entry: DockerContainerFileEntry) => void | Promise<void>;
}

export function DockerContainerDetail({
  container,
  activeTab,
  logStreamId,
  logLines,
  filteredLogLines,
  logQuery,
  logFilter,
  logError,
  containerPath,
  containerFiles,
  isFilesLoading,
  filesError,
  onTabChange,
  onClearLogs,
  onLogQueryChange,
  onLogFilterChange,
  onContainerPathChange,
  onRefreshFiles,
  onCopyToContainer,
  onCopyFromContainer,
}: DockerContainerDetailProps) {
  return (
    <div className="max-h-72 shrink-0 border-t border-border/70 bg-surface/35">
      <div className="flex h-8 items-center justify-between gap-2 px-2">
        <div className="min-w-0">
          <div className="truncate ui-text-sm font-medium text-foreground">{container.name}</div>
          <div className="ui-text-sm text-subtle-foreground">
            {activeTab === "logs"
              ? logStreamId
                ? "Streaming logs"
                : "Logs stopped"
              : containerPath}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(["logs", "files"] as DockerContainerDetailTab[]).map((tab) => (
            <Button
              key={tab}
              type="button"
              variant={activeTab === tab ? "accent" : "ghost"}
              size="xs"
              className="h-6 px-1.5 ui-text-sm capitalize"
              onClick={() => onTabChange(tab)}
            >
              {tab}
            </Button>
          ))}
          {activeTab === "logs" ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 px-1.5 ui-text-sm"
              disabled={logLines.length === 0}
              onClick={onClearLogs}
            >
              Clear
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 px-1.5 ui-text-sm"
              onClick={() => void onCopyToContainer()}
            >
              <Upload className="size-3.5" />
              Copy In
            </Button>
          )}
        </div>
      </div>
      {activeTab === "logs" ? (
        <>
          <div className="flex items-center gap-1 border-t border-border/50 px-2 py-1">
            <SearchField
              value={logQuery}
              onChange={onLogQueryChange}
              placeholder="Search logs"
              aria-label="Search container logs"
              size="xs"
              className="min-w-0 flex-1"
            />
            {(["all", "stderr", "errors"] as DockerLogFilter[]).map((filter) => (
              <Button
                key={filter}
                type="button"
                variant={logFilter === filter ? "accent" : "ghost"}
                size="xs"
                className="h-6 px-1.5 ui-text-sm capitalize"
                onClick={() => onLogFilterChange(filter)}
              >
                {filter === "stderr" ? "Err" : filter}
              </Button>
            ))}
          </div>
          {logError ? (
            <div className="border-t border-border/50 px-2 py-1 ui-text-sm text-destructive">
              {logError}
            </div>
          ) : null}
          <div className="ui-text-sm max-h-36 overflow-auto border-t border-border/50 px-2 py-1 font-mono leading-4">
            {filteredLogLines.length > 0 ? (
              filteredLogLines.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    "whitespace-pre-wrap wrap-break-word",
                    entry.stream === "stderr" ? "text-destructive" : "text-subtle-foreground",
                  )}
                >
                  {entry.line}
                </div>
              ))
            ) : (
              <div className="text-subtle-foreground">
                {logLines.length > 0 ? "No matching log lines." : "Waiting for logs."}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1 border-t border-border/50 px-2 py-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 px-1.5 ui-text-sm"
              disabled={containerPath === "/"}
              onClick={() => onContainerPathChange(getParentContainerPath(containerPath))}
            >
              Up
            </Button>
            <div className="ui-text-sm min-w-0 flex-1 truncate rounded border border-border/70 bg-background px-2 py-1 font-mono text-subtle-foreground">
              {containerPath}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ui-text-sm"
              disabled={isFilesLoading}
              onClick={() => void onRefreshFiles()}
              aria-label="Refresh container files"
            >
              {isFilesLoading ? <Spinner compact /> : <Refresh className="size-3.5" />}
            </Button>
          </div>
          {filesError ? (
            <div className="border-t border-border/50 px-2 py-1 ui-text-sm text-destructive">
              {filesError}
            </div>
          ) : null}
          <div className="max-h-44 overflow-auto border-t border-border/50 py-1">
            {isFilesLoading ? (
              <div className="px-2 py-2 ui-text-sm text-subtle-foreground">Loading files...</div>
            ) : containerFiles.length > 0 ? (
              containerFiles.map((entry) => (
                <div
                  key={entry.path}
                  role={entry.isDirectory ? "button" : undefined}
                  tabIndex={entry.isDirectory ? 0 : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1 text-left",
                    entry.isDirectory && "hover:bg-accent",
                  )}
                  onClick={() => {
                    if (entry.isDirectory) onContainerPathChange(entry.path);
                  }}
                  onKeyDown={(event) => {
                    if (!entry.isDirectory) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onContainerPathChange(entry.path);
                    }
                  }}
                >
                  {entry.isDirectory ? (
                    <FolderIcon
                      className="size-4 shrink-0 text-subtle-foreground"
                      weight="duotone"
                    />
                  ) : (
                    <FileIcon className="size-4 shrink-0 text-subtle-foreground" weight="duotone" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate ui-text-sm text-foreground">{entry.name}</div>
                    <div className="truncate ui-text-sm text-subtle-foreground">
                      {entry.isDirectory ? "Directory" : formatDockerFileSize(entry.size)}
                      {entry.mode ? ` · ${entry.mode}` : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="ui-text-sm"
                    tooltip="Copy to host"
                    tooltipSide="left"
                    aria-label={`Copy ${entry.name} to host`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onCopyFromContainer(entry);
                    }}
                  >
                    <Download className="size-3.5" weight="fill" />
                  </Button>
                </div>
              ))
            ) : (
              <EmptyState layout="sidebar" message="No files found." />
            )}
          </div>
        </>
      )}
    </div>
  );
}
