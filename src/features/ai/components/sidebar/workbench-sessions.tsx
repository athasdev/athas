import { type ReactNode, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { CloudRunSidebarRow } from "@/features/ai/cloud-agents/components/cloud-run-sidebar-row";
import type { CloudAgentRun } from "@/features/ai/cloud-agents/services/cloud-agents-api";
import { openAgentInNewWindow } from "@/features/ai/detached/services/agent-window-service";
import { useAgentWindowStore } from "@/features/ai/detached/stores/agent-window.store";
import { useActiveSessionId } from "@/features/layout/hooks/use-active-session-id";
import { useInboxSessions } from "@/features/ai/hooks/use-inbox-sessions";
import { type SessionRowStatus, useSessionStatus } from "@/features/ai/hooks/use-session-status";
import type { SidebarProjectSessions } from "@/features/ai/hooks/use-sidebar-sessions";
import { getChatAttentionLabel } from "@/features/ai/lib/chat-attention";
import { resolveAgentSessionIconId } from "@/features/ai/services/agent-session-icon";
import { openAgentSession } from "@/features/ai/services/agent-project-navigation";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { getProjectNameFromPath } from "@/features/workspace/services/project-tab-path";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloudIcon,
  DotsIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  InboxIcon,
  PencilLineIcon,
  PinIcon,
  PinSlashIcon,
  TrashIcon,
  WarningCircleIcon,
  WindowExpandIcon,
  XCircleIcon,
} from "@/ui/icons";
import { InlineRenameInput } from "@/ui/input";
import {
  SidebarIconButton,
  SidebarListActionRow,
  SidebarListEditor,
  SidebarListItem,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { StatusDot } from "@/ui/status-dot";
import { formatCompactRelativeDate } from "@/utils/date";

/** Sessions a project lists before "Show more". */
const PROJECT_SESSION_LIMIT = 5;
const WEEK_MS = 7 * 86_400_000;

const STATUS_LABELS: Record<SessionRowStatus["status"], string> = {
  running: "Working",
  "needs-input": "Needs your input",
  failed: "Failed",
  review: "Changes ready to review",
  pr: "Pull request opened",
  merged: "Pull request merged",
  idle: "",
};

function StatusIcon({
  status,
  attention,
  providerIconId,
}: SessionRowStatus & { providerIconId: string }): ReactNode {
  switch (status) {
    case "running":
      return <Spinner label={STATUS_LABELS.running} compact />;
    case "needs-input":
      return (
        <span
          className="flex text-warning"
          role="img"
          aria-label={attention ? getChatAttentionLabel(attention) : STATUS_LABELS[status]}
        >
          <WarningCircleIcon />
        </span>
      );
    case "failed":
      return (
        <span className="flex text-destructive" role="img" aria-label={STATUS_LABELS.failed}>
          <XCircleIcon />
        </span>
      );
    case "review":
      return (
        <span className="flex text-success" role="img" aria-label={STATUS_LABELS.review}>
          <CheckCircleIcon />
        </span>
      );
    case "pr":
      return (
        <span className="flex text-success" role="img" aria-label={STATUS_LABELS.pr}>
          <GitPullRequestIcon />
        </span>
      );
    case "merged":
      return (
        <span className="flex text-merged" role="img" aria-label={STATUS_LABELS.merged}>
          <GitMergeIcon />
        </span>
      );
    case "idle":
      return <ProviderIcon providerId={providerIconId} size={14} />;
  }
}

function relativeTime(date: Date) {
  return formatCompactRelativeDate(date, {
    afterWeek: Date.now() - date.getTime() < WEEK_MS ? "days" : "weeks",
    includeAgo: false,
    justNowLabel: "now",
  });
}

/**
 * One session in the sidebar: what it is doing, its title, an unread dot, whether it runs in the
 * cloud and when it was last active. Its menu pins, renames, archives or deletes it.
 */
export function SessionSidebarRow({
  chat,
  description,
}: {
  chat: ChatSession;
  /** A second line, such as the project in the Inbox. */
  description?: string;
}) {
  const activeSessionId = useActiveSessionId();
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const isInAnotherWindow = useAgentWindowStore((state) => Boolean(state.sessions[chat.id]));
  const { deleteChat, updateChatTitle, setChatPinned, setChatArchived } = useAIChatStore(
    (state) => state.actions,
  );
  const status = useSessionStatus(chat);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(chat.title);
  const providerIconId = resolveAgentSessionIconId(chat, aiProviderId);
  const isCloud = Boolean(chat.sessionSettings?.cloud);
  const statusLabel = STATUS_LABELS[status.status];
  const label = [chat.title, statusLabel, status.unread ? "unread" : ""].filter(Boolean).join(", ");

  const startRename = () => {
    setRenameValue(chat.title);
    setIsRenaming(true);
  };

  if (isRenaming) {
    return (
      <SidebarListEditor leading={<ProviderIcon providerId={providerIconId} size={14} />}>
        <InlineRenameInput
          value={renameValue}
          onValueChange={setRenameValue}
          onSubmit={(nextTitle) => {
            if (nextTitle !== chat.title) updateChatTitle(chat.id, nextTitle);
            setIsRenaming(false);
          }}
          onCancel={() => setIsRenaming(false)}
          aria-label={`Rename ${chat.title}`}
        />
      </SidebarListEditor>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        <SidebarListActionRow
          data-session-id={chat.id}
          data-session-status={status.status}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarIconButton
                    disabled={isInAnotherWindow}
                    tooltip="More actions"
                    aria-label={`More actions for ${chat.title}`}
                  />
                }
              >
                <DotsIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void openAgentInNewWindow(chat.id)}>
                  <WindowExpandIcon />
                  Open in New Window
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChatPinned(chat.id, !chat.isPinned)}>
                  {chat.isPinned ? <PinSlashIcon /> : <PinIcon />}
                  {chat.isPinned ? "Unpin" : "Pin"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={startRename}>
                  <PencilLineIcon />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChatArchived(chat.id, true)}>
                  <ArchiveIcon />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => deleteChat(chat.id)}>
                  <TrashIcon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        >
          <SidebarListItem
            active={chat.id === activeSessionId}
            aria-label={label}
            title={chat.title}
            leading={<StatusIcon {...status} providerIconId={providerIconId} />}
            description={description}
            trailing={
              <span className="flex items-center gap-1.5 text-subtle-foreground ui-text-caption">
                {status.unread ? <StatusDot tone="unread" /> : null}
                {isCloud ? <CloudIcon aria-label="Runs in the cloud" /> : null}
                {chat.isPinned ? <PinIcon aria-label="Pinned" /> : null}
                <span className="tabular-nums">{relativeTime(chat.lastMessageAt)}</span>
              </span>
            }
            onClick={() => void openAgentSession(chat.id)}
            onDoubleClick={() => void openAgentInNewWindow(chat.id)}
          >
            {chat.title}
          </SidebarListItem>
        </SidebarListActionRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={isInAnotherWindow} onClick={startRename}>
          <PencilLineIcon />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          disabled={isInAnotherWindow}
          onClick={() => setChatArchived(chat.id, true)}
        >
          <ArchiveIcon />
          Archive
        </ContextMenuItem>
        <ContextMenuItem
          disabled={isInAnotherWindow}
          variant="destructive"
          onClick={() => deleteChat(chat.id)}
        >
          <TrashIcon />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A project's sessions under its header: the most recent first, the rest one click away. */
export function ProjectSessionList({
  sessions,
  projectPath,
}: {
  sessions: SidebarProjectSessions | undefined;
  projectPath: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const chats = sessions?.chats ?? [];
  const visible = showAll ? chats : chats.slice(0, PROJECT_SESSION_LIMIT);
  const hidden = chats.length - visible.length;
  return (
    <div role="group" className="flex flex-col gap-px">
      {visible.map((chat) => (
        <SessionSidebarRow key={chat.id} chat={chat} />
      ))}
      {hidden > 0 || showAll ? (
        <SidebarListItem
          leading={showAll ? <ChevronDownIcon /> : <ChevronRightIcon />}
          aria-expanded={showAll}
          onClick={() => setShowAll((open) => !open)}
        >
          {showAll ? "Show less" : `Show ${hidden} more`}
        </SidebarListItem>
      ) : null}
      {sessions?.cloudRuns.map((run) => (
        <CloudRunSidebarRow key={run.id} run={run} workspacePath={projectPath} />
      ))}
    </div>
  );
}

/** Cloud sessions and runs that belong to none of the open projects. */
export function OtherCloudSessions({
  chats,
  runs,
}: {
  chats: ChatSession[];
  runs: CloudAgentRun[];
}) {
  if (chats.length === 0 && runs.length === 0) return null;
  return (
    <section className="flex flex-col gap-px" aria-label="Cloud sessions">
      <SidebarSectionLabel leading={<CloudIcon />}>Cloud</SidebarSectionLabel>
      {chats.map((chat) => (
        <SessionSidebarRow key={chat.id} chat={chat} />
      ))}
      {runs.map((run) => (
        <CloudRunSidebarRow key={run.id} run={run} workspacePath={null} />
      ))}
    </section>
  );
}

/** Archived sessions, folded until asked for, each one restorable. */
export function ArchivedSessions({ chats }: { chats: ChatSession[] }) {
  const [open, setOpen] = useState(false);
  const { deleteChat, setChatArchived } = useAIChatStore((state) => state.actions);
  if (chats.length === 0) return null;
  return (
    <section className="flex flex-col gap-px" aria-label="Archived sessions">
      <SidebarListItem
        leading={open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Archived ({chats.length})
      </SidebarListItem>
      {open
        ? chats.map((chat) => (
            <SidebarListActionRow
              key={chat.id}
              actions={[
                <SidebarIconButton
                  key="restore"
                  tooltip="Restore"
                  aria-label={`Restore ${chat.title}`}
                  onClick={() => setChatArchived(chat.id, false)}
                >
                  <ArrowCounterClockwiseIcon />
                </SidebarIconButton>,
                <SidebarIconButton
                  key="delete"
                  tone="danger"
                  tooltip="Delete"
                  aria-label={`Delete ${chat.title}`}
                  onClick={() => deleteChat(chat.id)}
                >
                  <TrashIcon />
                </SidebarIconButton>,
              ]}
            >
              <SidebarListItem onClick={() => void openAgentSession(chat.id)}>
                {chat.title}
              </SidebarListItem>
            </SidebarListActionRow>
          ))
        : null}
    </section>
  );
}

/** The Inbox: every session that needs the user, from any project. */
export function SessionInboxList() {
  const sessions = useInboxSessions();
  if (sessions.length === 0) {
    return (
      <EmptyState
        layout="sidebar"
        icon={<InboxIcon />}
        title="Nothing needs you"
        message="Sessions that wait on you, or finish while you are away, show up here."
      />
    );
  }
  return (
    <div role="group" aria-label="Inbox" className="flex flex-col gap-px">
      {sessions.map((chat) => (
        <SessionSidebarRow
          key={chat.id}
          chat={chat}
          description={chat.workspacePath ? getProjectNameFromPath(chat.workspacePath) : undefined}
        />
      ))}
    </div>
  );
}
