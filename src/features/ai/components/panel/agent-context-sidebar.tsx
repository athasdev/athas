import {
  CircleDotIcon,
  FileTextIcon,
  GitPullRequestIcon,
  LinkIcon,
  SparkleIcon,
  TerminalIcon,
} from "@/ui/icons";
import { openExternalUrl } from "@/utils/external-url";
import { DiffStats } from "@/features/ai/components/diff-stats";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { GenerativeUIRenderer } from "@/extensions/ui/components/generative-ui-renderer";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/stores/buffer-index";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import {
  SidebarHeader,
  SidebarIconButton,
  SidebarListActionRow,
  SidebarListItem,
  SidebarPanel,
  SidebarScrollArea,
  SidebarSectionHeader,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import Tooltip from "@/ui/tooltip";
import { getBaseName, getDirName, joinPath } from "@/utils/path-helpers";
import {
  type AgentSessionChange,
  type AgentSessionResource,
  openAgentSessionReview,
} from "../../lib/agent-session-context";
import { useAIChatStore } from "../../stores/ai-chat.store";
import { useAgentSessionContext } from "../../hooks/use-agent-session-context";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";

type SectionId = "changes" | "files" | "commands" | "resources" | "views";

/**
 * The session the panel follows: the agent buffer in the active pane, else the
 * last one that was active (so clicking a file the agent touched keeps the
 * panel on that session), else the store's current chat.
 */
function useActiveAgentSessionId(): string | null {
  const activeBufferId = useActiveBufferId();
  const activeAgentSessionId = useBufferStore((state) => {
    const buffer = getBufferById(state.buffers, activeBufferId);
    return buffer?.type === "agent" ? buffer.sessionId : null;
  });
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const lastSessionIdRef = useRef<string | null>(null);
  if (activeAgentSessionId) lastSessionIdRef.current = activeAgentSessionId;
  return activeAgentSessionId ?? lastSessionIdRef.current ?? currentChatId;
}

function isAbsolutePath(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function resourceIcon(resource: AgentSessionResource) {
  if (resource.kind === "pullRequest") return <GitPullRequestIcon />;
  if (resource.kind === "issue") return <CircleDotIcon />;
  return <LinkIcon />;
}

/** Opens a path the agent reported, which may be relative to the project. */
export function useOpenAgentPath() {
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath || null);
  return useCallback(
    (path: string) => {
      const absolutePath =
        isAbsolutePath(path) || !rootFolderPath ? path : joinPath(rootFolderPath, path);
      void handleFileSelect(absolutePath, false);
    },
    [handleFileSelect, rootFolderPath],
  );
}

/** The files a session changed, each opening its net diff, with a button to open the file. */
export function AgentSessionChangeRows({ changes }: { changes: AgentSessionChange[] }) {
  const openPath = useOpenAgentPath();

  return changes.map((change) => {
    const fileName = getBaseName(change.displayPath, change.displayPath);
    const directory = getDirName(change.displayPath);
    return (
      <SidebarListActionRow
        key={change.path}
        actions={[
          <SidebarIconButton
            key="open"
            tooltip="Open file"
            aria-label={`Open ${change.displayPath}`}
            onClick={(event) => {
              event.stopPropagation();
              openPath(change.path);
            }}
          >
            <FileTextIcon />
          </SidebarIconButton>,
        ]}
      >
        <Tooltip content={change.displayPath} width="full">
          <SidebarListItem
            density="compact"
            tone={change.phase === "failed" ? "error" : "default"}
            leading={<ThemedFileIcon fileName={fileName} isDir={false} />}
            description={directory || undefined}
            trailing={<DiffStats additions={change.additions} deletions={change.deletions} />}
            onClick={() => openAgentSessionReview([change])}
            data-path={change.path}
          >
            {fileName}
          </SidebarListItem>
        </Tooltip>
      </SidebarListActionRow>
    );
  });
}

export function AgentContextSidebar() {
  const sessionId = useActiveAgentSessionId();
  return <AgentSessionActivity sessionId={sessionId} />;
}

/**
 * What one session is doing and touched: the current step, changes, files read, commands,
 * resources and canvas. Embedded in the session's own panel it leaves out the title and the
 * changes, which the panel shows in their own tab.
 */
export function AgentSessionActivity({
  sessionId,
  embedded = false,
}: {
  sessionId: string | null;
  embedded?: boolean;
}) {
  const { chat, context, loadState, messages, rootFolderPath } = useAgentSessionContext(sessionId);
  const openContent = useBufferStore((state) => state.actions.openContent);
  const openPath = useOpenAgentPath();
  const [collapsed, setCollapsed] = useState<Set<SectionId>>(() => new Set());

  const toggleSection = useCallback((section: SectionId) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const openResource = useCallback(
    (resource: AgentSessionResource) => {
      if (resource.kind === "pullRequest" && rootFolderPath) {
        openContent({ type: "pullRequest", prNumber: resource.number, repoPath: rootFolderPath });
        return;
      }
      if (resource.kind === "issue" && rootFolderPath) {
        openContent({
          type: "githubIssue",
          issueNumber: resource.number,
          repoPath: rootFolderPath,
          url: resource.url,
        });
        return;
      }
      void openExternalUrl(resource.url);
    },
    [openContent, rootFolderPath],
  );

  if (!sessionId || !chat) {
    return (
      <SidebarPanel>
        <EmptyState
          layout="sidebar"
          icon={<SparkleIcon />}
          message="Open an agent session to follow what it is working on"
        />
      </SidebarPanel>
    );
  }

  const { focus, changes, files, commands, resources, views, additions, deletions } = context;
  const isFocusRunning = focus?.phase === "running";

  const renderSection = (
    id: SectionId,
    title: string,
    count: number,
    children: ReactNode,
    action?: ReactNode,
  ) => {
    if (count === 0) return null;
    const expanded = !collapsed.has(id);
    return (
      <section data-slot="agent-context-section" className="min-w-0">
        <SidebarSectionHeader
          expanded={expanded}
          onToggle={() => toggleSection(id)}
          action={
            action ?? (
              <span className="pr-1.5 tabular-nums ui-text-sm text-subtle-foreground">{count}</span>
            )
          }
        >
          {title}
        </SidebarSectionHeader>
        {expanded ? <div className="flex min-w-0 flex-col">{children}</div> : null}
      </section>
    );
  };

  return (
    <SidebarPanel data-slot="agent-context-sidebar">
      {embedded ? null : (
        <SidebarHeader>
          <SidebarSectionLabel leading={<SparkleIcon />} className="min-w-0 flex-1 px-0">
            {chat.title || "Agent"}
          </SidebarSectionLabel>
          {changes.length > 0 ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => openAgentSessionReview(changes)}
              tooltip="Review every change from this session in one diff"
            >
              Review
              <DiffStats additions={additions} deletions={deletions} />
            </Button>
          ) : null}
        </SidebarHeader>
      )}

      <SidebarScrollArea>
        {focus ? (
          <div className="mb-2 min-w-0" data-slot="agent-context-focus">
            <SidebarSectionLabel>{isFocusRunning ? "Now" : "Last"}</SidebarSectionLabel>
            <SidebarListItem
              density="compact"
              tone={focus.phase === "failed" ? "error" : "default"}
              leading={
                isFocusRunning ? (
                  <Spinner compact />
                ) : focus.displayPath ? (
                  <ThemedFileIcon
                    fileName={getBaseName(focus.displayPath, focus.displayPath)}
                    isDir={false}
                  />
                ) : (
                  <SparkleIcon />
                )
              }
              onClick={focus.path ? () => openPath(focus.path as string) : undefined}
              disabled={!focus.path}
            >
              {focus.label}
            </SidebarListItem>
          </div>
        ) : null}

        {loadState === "loading" && !messages?.length ? (
          <div className="px-1.5 py-2">
            <Spinner label="Loading session" showLabel compact />
          </div>
        ) : null}

        {embedded
          ? null
          : renderSection(
              "changes",
              "Changes",
              changes.length,
              <AgentSessionChangeRows changes={changes} />,
              <span className="pr-1.5 ui-text-sm">
                <DiffStats additions={additions} deletions={deletions} />
              </span>,
            )}

        {renderSection(
          "files",
          "Read",
          files.length,
          files.map((file) => {
            const fileName = getBaseName(file.displayPath, file.displayPath);
            return (
              <Tooltip key={file.path} content={file.displayPath} width="full">
                <SidebarListItem
                  density="compact"
                  leading={<ThemedFileIcon fileName={fileName} isDir={false} />}
                  description={getDirName(file.displayPath) || undefined}
                  onClick={() => openPath(file.path)}
                  data-path={file.path}
                >
                  {fileName}
                </SidebarListItem>
              </Tooltip>
            );
          }),
        )}

        {renderSection(
          "commands",
          "Commands",
          commands.length,
          commands.map((command) => (
            <Tooltip key={command.id} content={command.command} width="full">
              <SidebarListItem
                density="compact"
                tone={command.phase === "failed" ? "error" : "default"}
                leading={command.phase === "running" ? <Spinner compact /> : <TerminalIcon />}
                as="div"
              >
                <span className="truncate font-mono">{command.command}</span>
              </SidebarListItem>
            </Tooltip>
          )),
        )}

        {renderSection(
          "resources",
          "Resources",
          resources.length,
          resources.map((resource) => (
            <Tooltip key={resource.id} content={resource.url} width="full">
              <SidebarListItem
                density="compact"
                leading={resourceIcon(resource)}
                onClick={() => openResource(resource)}
              >
                {resource.label}
              </SidebarListItem>
            </Tooltip>
          )),
        )}

        {renderSection(
          "views",
          "Canvas",
          views.length,
          views.map((entry) => (
            <div
              key={entry.id}
              className="mb-2 min-w-0 overflow-hidden rounded-md border border-border bg-surface p-2"
              data-slot="agent-context-view"
            >
              <GenerativeUIRenderer component={entry.view} />
            </div>
          )),
        )}

        {!focus &&
        (embedded || changes.length === 0) &&
        files.length === 0 &&
        commands.length === 0 &&
        loadState !== "loading" ? (
          <EmptyState
            layout="sidebar"
            message="Nothing yet. Files, commands and changes show up here as the agent works."
          />
        ) : null}
      </SidebarScrollArea>
    </SidebarPanel>
  );
}
