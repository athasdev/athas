import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { CloudRunSidebarRow } from "@/features/ai/cloud-agents/components/cloud-run-sidebar-row";
import type { CloudAgentRun } from "@/features/ai/cloud-agents/services/cloud-agents-api";
import { openAgentInNewWindow } from "@/features/ai/detached/services/agent-window-service";
import { useAgentWindowStore } from "@/features/ai/detached/stores/agent-window.store";
import { useActiveSessionId } from "@/features/layout/hooks/use-active-session-id";
import { type SessionRowStatus, useSessionStatus } from "@/features/ai/hooks/use-session-status";
import type { SidebarProjectSessions } from "@/features/ai/hooks/use-sidebar-sessions";
import { getChatAttentionLabel } from "@/features/ai/lib/chat-attention";
import { resolveAgentSessionIconId } from "@/features/ai/services/agent-session-icon";
import {
  openAgentSession,
  openOutsideAgentSession,
  startProjectlessChat,
} from "@/features/ai/services/agent-project-navigation";
import type { OutsideAgentSession } from "@/features/ai/services/outside-agent-sessions";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import { useWorkbenchSidebarStore } from "@/features/layout/stores/workbench-sidebar.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { showConfirmDialog } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
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
  PencilLineIcon,
  PinIcon,
  PinSlashIcon,
  PlusIcon,
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
import { formatCompactRelativeDate } from "@/utils/date";

/** Sessions a list shows before "Show more". */
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

async function confirmDeleteChat(chat: ChatSession) {
  const confirmed = await showConfirmDialog(`Delete “${chat.title}”? This cannot be undone.`, {
    title: "Delete Session",
    confirmLabel: "Delete",
    destructive: true,
  });
  if (confirmed) useAIChatStore.getState().actions.deleteChat(chat.id);
}

/**
 * One session in the sidebar: what it is doing, its title, whether it runs in the cloud and when
 * it was last active. Its menu pins, renames, archives or deletes it.
 */
export function SessionSidebarRow({ chat }: { chat: ChatSession }) {
  const activeSessionId = useActiveSessionId();
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const isInAnotherWindow = useAgentWindowStore((state) => Boolean(state.sessions[chat.id]));
  const { updateChatTitle, setChatPinned, setChatArchived } = useAIChatStore(
    (state) => state.actions,
  );
  const status = useSessionStatus(chat);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(chat.title);
  const providerIconId = resolveAgentSessionIconId(chat, aiProviderId);
  const isCloud = Boolean(chat.sessionSettings?.cloud);
  const statusLabel = STATUS_LABELS[status.status];
  const label = [chat.title, statusLabel].filter(Boolean).join(", ");

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
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => void confirmDeleteChat(chat)}
                >
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
            trailing={
              <span className="flex items-center gap-1.5 text-subtle-foreground ui-text-caption">
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
          onClick={() => void confirmDeleteChat(chat)}
        >
          <TrashIcon />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

type SessionEntry =
  | { kind: "chat"; chat: ChatSession; at: number }
  | { kind: "outside"; session: OutsideAgentSession; at: number };

/** A conversation an agent keeps outside Athas; opening it imports it as a chat. */
function OutsideSessionRow({
  session,
  onOpen,
}: {
  session: OutsideAgentSession;
  onOpen: (session: OutsideAgentSession) => Promise<unknown>;
}) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await onOpen(session);
    } catch (error) {
      toast.error("Couldn't open the session", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setOpening(false);
    }
  };
  return (
    <SidebarListItem
      aria-label={`${session.title}, from outside Athas`}
      title={session.title}
      leading={
        opening ? (
          <Spinner compact label="Opening" />
        ) : (
          <ProviderIcon providerId={session.agentId} size={14} />
        )
      }
      trailing={
        <span className="text-subtle-foreground tabular-nums ui-text-caption">
          {relativeTime(session.updatedAt)}
        </span>
      }
      onClick={() => void open()}
    >
      <span className="text-muted-foreground">{session.title}</span>
    </SidebarListItem>
  );
}

/** Session rows, the most recent first and the rest one click away. */
function SessionRows({
  chats,
  outside = [],
  onOpenOutside,
}: {
  chats: ChatSession[];
  outside?: OutsideAgentSession[];
  onOpenOutside?: (session: OutsideAgentSession) => Promise<unknown>;
}) {
  const [showAll, setShowAll] = useState(false);
  const entries: SessionEntry[] = [
    ...chats.map((chat) => ({ kind: "chat" as const, chat, at: chat.lastMessageAt.getTime() })),
    ...(onOpenOutside ? outside : []).map((session) => ({
      kind: "outside" as const,
      session,
      at: session.updatedAt.getTime(),
    })),
  ].sort((left, right) => right.at - left.at);
  const visible = showAll ? entries : entries.slice(0, PROJECT_SESSION_LIMIT);
  const hidden = entries.length - visible.length;
  return (
    <>
      {visible.map((entry) =>
        entry.kind === "chat" ? (
          <SessionSidebarRow key={entry.chat.id} chat={entry.chat} />
        ) : onOpenOutside ? (
          <OutsideSessionRow
            key={`${entry.session.agentId}:${entry.session.sessionId}`}
            session={entry.session}
            onOpen={onOpenOutside}
          />
        ) : null,
      )}
      {hidden > 0 || showAll ? (
        <SidebarListItem
          leading={showAll ? <ChevronDownIcon /> : <ChevronRightIcon />}
          aria-expanded={showAll}
          onClick={() => setShowAll((open) => !open)}
        >
          {showAll ? "Show less" : `Show ${hidden} more`}
        </SidebarListItem>
      ) : null}
    </>
  );
}

/** A project's sessions under its header, with the conversations agents keep for it elsewhere. */
export function ProjectSessionList({
  sessions,
  projectId,
  projectPath,
  outside,
}: {
  sessions: SidebarProjectSessions | undefined;
  projectId: string;
  projectPath: string;
  outside?: OutsideAgentSession[];
}) {
  return (
    <div role="group" className="flex flex-col gap-px">
      <SessionRows
        chats={sessions?.chats ?? []}
        outside={outside}
        onOpenOutside={(session) => openOutsideAgentSession(projectId, projectPath, session)}
      />
      {sessions?.cloudRuns.map((run) => (
        <CloudRunSidebarRow key={run.id} run={run} workspacePath={projectPath} />
      ))}
    </div>
  );
}

export function PinnedSessions({ chats }: { chats: ChatSession[] }) {
  if (chats.length === 0) return null;
  return (
    <section className="flex flex-col gap-px" aria-label="Pinned sessions">
      {chats.map((chat) => (
        <SessionSidebarRow key={chat.id} chat={chat} />
      ))}
    </section>
  );
}

/** Sessions of no project or of a project that is not open, and a way to start one. */
export function ChatSessions({ chats }: { chats: ChatSession[] }) {
  const collapsed = useWorkbenchSidebarStore.use.chatsCollapsed();
  const { toggleChatsCollapsed } = useWorkbenchSidebarStore.use.actions();
  return (
    <section className="flex flex-col gap-px" aria-label="Chats">
      <SidebarListActionRow
        actions={
          <SidebarIconButton
            tooltip="New chat"
            aria-label="New chat"
            onClick={() => void startProjectlessChat()}
          >
            <PlusIcon />
          </SidebarIconButton>
        }
      >
        <SidebarListItem
          aria-expanded={!collapsed}
          leading={collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          onClick={toggleChatsCollapsed}
        >
          Chats
        </SidebarListItem>
      </SidebarListActionRow>
      {collapsed ? null : <SessionRows chats={chats} />}
    </section>
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
  const setChatArchived = useAIChatStore((state) => state.actions.setChatArchived);
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
                  onClick={() => void confirmDeleteChat(chat)}
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
