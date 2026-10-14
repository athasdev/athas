import { useMemo, useState } from "react";
import { AgentAttentionDot } from "@/features/ai/components/agent-attention-dot";
import { AgentSessionSidebarItem } from "@/features/ai/components/agent-session-sidebar-item";
import { AgentSessionIcon } from "@/features/ai/components/icons/agent-session-icon";
import { openAgentInNewWindow } from "@/features/ai/detached/services/agent-window-service";
import { useAgentWindowStore } from "@/features/ai/detached/stores/agent-window.store";
import { useAgentDisplayNames } from "@/features/ai/hooks/use-agent-display-names";
import { useChatAttention } from "@/features/ai/hooks/use-chat-attention";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import { selectAcpAgentStatus } from "@/features/ai/services/acp-session-state";
import {
  groupAgentSessionsByActivity,
  isAgentSessionWorking,
} from "@/features/ai/lib/agent-session-groups";
import { resolveAgentSessionIconId } from "@/features/ai/services/agent-session-icon";
import { selectAgentSessions } from "@/features/ai/services/agent-session-list";
import {
  openAgentSession,
  startAgentInProject,
} from "@/features/ai/services/agent-project-navigation";
import { groupAgentSessionsByProject } from "@/features/ai/lib/agent-project-groups";
import { useProjectAgentStatus } from "@/features/ai/hooks/use-project-agent-status";
import {
  canBrowseAgentSessions,
  openAgentSessions,
} from "@/features/ai/services/open-agent-sessions";
import { isAcpAgent } from "@/features/ai/services/ai-chat-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import { getModelById, getProviderById } from "@/features/ai/types/providers.types";
import { useGitStore } from "@/features/git/stores/git.store";
import { getProjectNameFromPath } from "@/features/workspace/services/project-tab-path";
import {
  useWorkspaceTabsStore,
  type ProjectTab,
} from "@/features/workspace/stores/workspace-tabs.store";
import { ProjectGlyph } from "@/features/workspace/project-icons/components/project-glyph";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { EmptyState } from "@/ui/empty";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DotsIcon,
  DownloadIcon,
  PencilLineIcon,
  PlusIcon,
  TrashIcon,
  ArrowCounterClockwiseIcon,
} from "@/ui/icons";
import { InlineRenameInput } from "@/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  SidebarFilterBar,
  SidebarIconButton,
  SidebarListActionRow,
  SidebarListEditor,
  SidebarListItem,
  SidebarPanel,
  SidebarScrollArea,
  SidebarSectionHeader,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { matchesSearchQuery } from "@/utils/search-match";
import { AgentsPlanFooter } from "./agents-plan-footer";
import { useProjectStore } from "@/features/workspace/stores/project.store";

interface AgentRowContext {
  currentChatId: string | null;
  aiProviderId: string;
  aiModelId: string;
  currentBranch: string | null;
  workspacePath: string | null;
  getAgentName: (agentId: string) => string;
}

function AgentRow({ chat, context }: { chat: ChatSession; context: AgentRowContext }) {
  const isInAnotherWindow = useAgentWindowStore((state) => Boolean(state.sessions[chat.id]));
  const attention = useChatAttention(chat.id);
  const working = useAIChatStore((state) => isAgentSessionWorking(state.messagesByChat[chat.id]));
  const { deleteChat, updateChatTitle, setChatPinned, setChatArchived } = useAIChatStore(
    (state) => state.actions,
  );
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(chat.title);
  const providerId = chat.providerId || context.aiProviderId;

  if (isRenaming) {
    return (
      <SidebarListEditor leading={<AgentSessionIcon session={chat} size={16} />}>
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
        <AgentSessionSidebarItem
          title={chat.title}
          active={chat.id === context.currentChatId}
          pinned={chat.isPinned}
          attention={attention}
          providerIconId={resolveAgentSessionIconId(chat, context.aiProviderId)}
          agentLabel={
            chat.agentId === "custom"
              ? getProviderById(providerId)?.name || providerId
              : context.getAgentName(chat.agentId)
          }
          modelLabel={
            chat.agentId === "custom"
              ? getModelById(providerId, chat.modelId || context.aiModelId)?.name ||
                chat.modelId ||
                context.aiModelId
              : chat.modelId || "Agent default"
          }
          createdAt={chat.createdAt}
          lastActiveAt={chat.lastMessageAt}
          working={working}
          projectName={getProjectNameFromPath(chat.workspacePath || context.workspacePath || "")}
          workspacePath={chat.workspacePath || context.workspacePath}
          branch={chat.branch || context.currentBranch}
          onOpen={() => void openAgentSession(chat.id)}
          onOpenInNewWindow={() => void openAgentInNewWindow(chat.id)}
          actionsDisabled={isInAnotherWindow}
          onPinChange={(pinned) => setChatPinned(chat.id, pinned)}
          onArchive={() => setChatArchived(chat.id, true)}
          onRename={() => {
            setRenameValue(chat.title);
            setIsRenaming(true);
          }}
          onDelete={() => deleteChat(chat.id)}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={isInAnotherWindow}
          onClick={() => {
            setRenameValue(chat.title);
            setIsRenaming(true);
          }}
        >
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

function ArchivedAgentRow({ chat }: { chat: ChatSession }) {
  const { deleteChat, setChatArchived } = useAIChatStore((state) => state.actions);

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        <SidebarListActionRow
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarIconButton
                    tooltip="More actions"
                    aria-label={`More actions for ${chat.title}`}
                  />
                }
              >
                <DotsIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setChatArchived(chat.id, false)}>
                  <ArrowCounterClockwiseIcon />
                  Restore
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
            leading={<AgentSessionIcon session={chat} size={16} />}
            onClick={() => void openAgentSession(chat.id)}
          >
            {chat.title}
          </SidebarListItem>
        </SidebarListActionRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => setChatArchived(chat.id, false)}>
          <ArrowCounterClockwiseIcon />
          Restore
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => deleteChat(chat.id)}>
          <TrashIcon />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const PROJECT_SESSION_LIMIT = 5;

function ProjectAgentSection({
  project,
  chats,
  context,
  showEmpty,
}: {
  project: ProjectTab;
  chats: ChatSession[];
  context: AgentRowContext;
  showEmpty: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const status = useProjectAgentStatus(chats);
  const visibleChats = showAll ? chats : chats.slice(0, PROJECT_SESSION_LIMIT);
  const hiddenCount = chats.length - visibleChats.length;
  const startAgent = () => void startAgentInProject(project.id);

  return (
    <section className="flex flex-col gap-0.5" aria-label={`${project.name} agents`}>
      <SidebarSectionHeader
        expanded={expanded}
        onToggle={() => setExpanded((open) => !open)}
        title={project.path}
        action={
          <>
            {expanded ? null : status.attention ? (
              <span className="flex h-chrome-control items-center px-1.5">
                <AgentAttentionDot attention={status.attention} />
              </span>
            ) : status.working ? (
              <span className="flex h-chrome-control items-center px-1.5">
                <Spinner label={`An agent is working in ${project.name}`} compact />
              </span>
            ) : null}
            {chats.length > 0 ? (
              <SidebarIconButton
                tooltip={`New Agent in ${project.name}`}
                aria-label={`New Agent in ${project.name}`}
                onClick={startAgent}
              >
                <PlusIcon />
              </SidebarIconButton>
            ) : null}
          </>
        }
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <ProjectGlyph projectPath={project.path} iconPath={project.customIcon} />
          {project.name}
        </span>
      </SidebarSectionHeader>
      {expanded ? (
        <>
          {visibleChats.map((chat) => (
            <AgentRow key={chat.id} chat={chat} context={context} />
          ))}
          {hiddenCount > 0 || showAll ? (
            <SidebarListItem
              leading={showAll ? <ChevronDownIcon /> : <ChevronRightIcon />}
              aria-expanded={showAll}
              onClick={() => setShowAll((open) => !open)}
            >
              {showAll ? "Show less" : `Show ${hiddenCount} more`}
            </SidebarListItem>
          ) : null}
          {chats.length === 0 && showEmpty ? (
            <SidebarListItem leading={<PlusIcon />} onClick={startAgent}>
              New Agent
            </SidebarListItem>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/**
 * The agents sidebar: the agent sessions of the workspace, pinned ones first, with the actions to
 * start, find, rename, archive and delete them. With several projects open it lists every open
 * project's sessions under that project, so agents in other projects stay in view. Opened from
 * the activity rail.
 */
export function AgentsSidebar() {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const browseSessionsAgentId = useAIChatStore((state) => {
    const agentId =
      state.chats.find((chat) => chat.id === state.currentChatId)?.agentId ?? state.selectedAgentId;
    const status = selectAcpAgentStatus(state, agentId, useProjectStore.getState().rootFolderPath);
    return isAcpAgent(agentId) && canBrowseAgentSessions(status, agentId) ? agentId : null;
  });
  const workspacePath = useProjectStore((state) => state.rootFolderPath) ?? null;
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const aiModelId = useSettingsStore((state) => state.settings.aiModelId);
  const currentBranch = useGitStore((state) => state.gitStatus?.branch ?? null);
  const handleNewAgent = useNewAgentAction();
  const { getName: getAgentName } = useAgentDisplayNames();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const isMultiProject = projectTabs.length > 1;

  const context: AgentRowContext = {
    currentChatId,
    aiProviderId,
    aiModelId,
    currentBranch,
    workspacePath,
    getAgentName,
  };

  const { pinned, recentGroups, projectGroups, archived } = useMemo(() => {
    const matches = (chat: ChatSession) =>
      matchesSearchQuery(query, [
        chat.title,
        chat.agentId === "custom" ? null : getAgentName(chat.agentId),
        chat.branch,
      ]);
    const scope = isMultiProject ? { anyWorkspace: true } : { workspacePath };
    const active = selectAgentSessions(chats, { ...scope, keepIds: [currentChatId] }).filter(
      matches,
    );
    const archivedSessions = selectAgentSessions(chats, {
      ...scope,
      includeArchived: "only",
    }).filter(matches);
    if (isMultiProject) {
      return {
        pinned: [],
        recentGroups: [],
        projectGroups: groupAgentSessionsByProject(active, projectTabs),
        archived: groupAgentSessionsByProject(archivedSessions, projectTabs).flatMap(
          (group) => group.chats,
        ),
      };
    }
    return {
      pinned: active.filter((chat) => chat.isPinned),
      recentGroups: groupAgentSessionsByActivity(active.filter((chat) => !chat.isPinned)),
      projectGroups: [],
      archived: archivedSessions,
    };
  }, [chats, currentChatId, getAgentName, isMultiProject, projectTabs, query, workspacePath]);

  const hasQuery = query.trim().length > 0;
  const visibleProjectGroups = hasQuery
    ? projectGroups.filter((group) => group.chats.length > 0)
    : projectGroups;
  const isEmpty =
    pinned.length === 0 &&
    recentGroups.length === 0 &&
    visibleProjectGroups.length === 0 &&
    archived.length === 0;

  return (
    <SidebarPanel data-slot="agents-sidebar">
      <SidebarFilterBar
        value={query}
        onChange={setQuery}
        placeholder="Filter agents"
        aria-label="Filter agents"
        actionsLabel="Agent actions"
        actions={
          <>
            {browseSessionsAgentId ? (
              <SidebarIconButton
                tooltip="Import agent session"
                aria-label="Import agent session"
                onClick={() => openAgentSessions(browseSessionsAgentId)}
              >
                <DownloadIcon />
              </SidebarIconButton>
            ) : null}
            <SidebarIconButton tooltip="New Agent" aria-label="New Agent" onClick={handleNewAgent}>
              <PlusIcon />
            </SidebarIconButton>
          </>
        }
      />
      <SidebarScrollArea>
        {isEmpty ? (
          <EmptyState
            layout="sidebar"
            title={query.trim() ? undefined : "No agents yet"}
            message={
              query.trim()
                ? "No matching agents"
                : "Start an agent to work on this workspace with you."
            }
            action={
              query.trim()
                ? undefined
                : { label: "New Agent", icon: <PlusIcon />, onClick: handleNewAgent }
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {pinned.length > 0 ? (
              <section className="flex flex-col gap-0.5" aria-label="Pinned agents">
                <SidebarSectionLabel>Pinned</SidebarSectionLabel>
                {pinned.map((chat) => (
                  <AgentRow key={chat.id} chat={chat} context={context} />
                ))}
              </section>
            ) : null}
            {visibleProjectGroups.map((group) => (
              <ProjectAgentSection
                key={group.project.id}
                project={group.project}
                chats={group.chats}
                context={context}
                showEmpty={!hasQuery}
              />
            ))}
            {recentGroups.map((group) => (
              <section key={group.id} className="flex flex-col gap-0.5" aria-label={group.label}>
                <SidebarSectionLabel>{group.label}</SidebarSectionLabel>
                {group.chats.map((chat) => (
                  <AgentRow key={chat.id} chat={chat} context={context} />
                ))}
              </section>
            ))}
            {archived.length > 0 ? (
              <section className="flex flex-col gap-0.5" aria-label="Archived agents">
                <SidebarListItem
                  leading={showArchived ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived((open) => !open)}
                >
                  Archived ({archived.length})
                </SidebarListItem>
                {showArchived
                  ? archived.map((chat) => <ArchivedAgentRow key={chat.id} chat={chat} />)
                  : null}
              </section>
            ) : null}
          </div>
        )}
      </SidebarScrollArea>
      <AgentsPlanFooter />
    </SidebarPanel>
  );
}
