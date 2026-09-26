import { useMemo, useState } from "react";
import { AgentSessionSidebarItem } from "@/features/ai/components/agent-session-sidebar-item";
import { AgentSessionIcon } from "@/features/ai/components/icons/agent-session-icon";
import { openAgentInNewWindow } from "@/features/ai/detached/agent-window-service";
import { useAgentWindowStore } from "@/features/ai/detached/agent-window.store";
import { useChatAttention } from "@/features/ai/hooks/use-chat-attention";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import { selectAcpAgentStatus } from "@/features/ai/lib/acp-session-state";
import { resolveAgentSessionIconId } from "@/features/ai/lib/agent-session-icon";
import { selectAgentSessions } from "@/features/ai/lib/agent-session-list";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";
import { canBrowseAgentSessions, openAgentSessions } from "@/features/ai/lib/open-agent-sessions";
import { isAcpAgent } from "@/features/ai/services/ai-chat-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import { getModelById, getProviderById } from "@/features/ai/types/providers.types";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useGitStore } from "@/features/git/stores/git.store";
import { getProjectNameFromPath } from "@/features/layout/components/sidebar/project-glyph";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { Empty, EmptyDescription } from "@/ui/empty";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  PencilLineIcon,
  PlusIcon,
  TrashIcon,
  ArrowCounterClockwiseIcon,
} from "@/ui/icons";
import { InlineRenameInput } from "@/ui/input";
import {
  SidebarFilterField,
  SidebarIconButton,
  SidebarListEditor,
  SidebarListItem,
  SidebarScrollArea,
  SidebarSectionLabel,
  SidebarWorkspace,
} from "@/ui/sidebar";
import { matchesSearchQuery } from "@/utils/search-match";

interface AgentRowContext {
  currentChatId: string | null;
  aiProviderId: string;
  aiModelId: string;
  currentBranch: string | null;
  workspacePath: string | null;
}

function AgentRow({ chat, context }: { chat: Chat; context: AgentRowContext }) {
  const isInAnotherWindow = useAgentWindowStore((state) => Boolean(state.sessions[chat.id]));
  const attention = useChatAttention(chat.id);
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
              : chat.agentId.replace(/[-_]/g, " ")
          }
          modelLabel={
            chat.agentId === "custom"
              ? getModelById(providerId, chat.modelId || context.aiModelId)?.name ||
                chat.modelId ||
                context.aiModelId
              : chat.modelId || "Agent default"
          }
          createdAt={chat.createdAt}
          projectName={getProjectNameFromPath(chat.workspacePath || context.workspacePath || "")}
          workspacePath={chat.workspacePath || context.workspacePath}
          branch={chat.branch || context.currentBranch}
          onOpen={() => openAgentHistoryChat(chat.id)}
          onOpenInNewWindow={() => void openAgentInNewWindow(chat.id)}
          actionsDisabled={isInAnotherWindow}
          onPinChange={(pinned) => setChatPinned(chat.id, pinned)}
          onArchive={() => setChatArchived(chat.id, true)}
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

function ArchivedAgentRow({ chat }: { chat: Chat }) {
  const { deleteChat, setChatArchived } = useAIChatStore((state) => state.actions);

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        <SidebarListItem
          leading={<AgentSessionIcon session={chat} size={16} />}
          onClick={() => openAgentHistoryChat(chat.id)}
        >
          {chat.title}
        </SidebarListItem>
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

/**
 * The agents sidebar: every agent session in the workspace, pinned ones first, with the actions
 * to start, find, rename, archive and delete them. Opened from the activity rail.
 */
export function AgentsSidebar() {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const browseSessionsAgentId = useAIChatStore((state) => {
    const agentId =
      state.chats.find((chat) => chat.id === state.currentChatId)?.agentId ?? state.selectedAgentId;
    const status = selectAcpAgentStatus(
      state,
      agentId,
      useFileSystemStore.getState().rootFolderPath,
    );
    return isAcpAgent(agentId) && canBrowseAgentSessions(status, agentId) ? agentId : null;
  });
  const workspacePath = useFileSystemStore.use.rootFolderPath?.() ?? null;
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const aiModelId = useSettingsStore((state) => state.settings.aiModelId);
  const currentBranch = useGitStore((state) => state.gitStatus?.branch ?? null);
  const handleNewAgent = useNewAgentAction();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const context: AgentRowContext = {
    currentChatId,
    aiProviderId,
    aiModelId,
    currentBranch,
    workspacePath,
  };

  const { pinned, recent, archived } = useMemo(() => {
    const matches = (chat: Chat) => matchesSearchQuery(query, [chat.title]);
    const active = selectAgentSessions(chats, {
      workspacePath,
      keepIds: [currentChatId],
    }).filter(matches);
    return {
      pinned: active.filter((chat) => chat.isPinned),
      recent: active.filter((chat) => !chat.isPinned),
      archived: selectAgentSessions(chats, { workspacePath, includeArchived: "only" }).filter(
        matches,
      ),
    };
  }, [chats, currentChatId, query, workspacePath]);

  const isEmpty = pinned.length === 0 && recent.length === 0 && archived.length === 0;

  return (
    <SidebarWorkspace
      title="Agents"
      data-slot="agents-sidebar"
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
    >
      <div className="shrink-0 px-chrome-inline">
        <SidebarFilterField
          value={query}
          onChange={setQuery}
          placeholder="Filter agents"
          aria-label="Filter agents"
        />
      </div>
      <SidebarScrollArea>
        {isEmpty ? (
          <Empty variant="inline" className="px-2 py-1.5">
            <EmptyDescription>
              {query.trim() ? "No matching agents" : "No agents in this workspace yet"}
            </EmptyDescription>
          </Empty>
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
            {recent.length > 0 ? (
              <section className="flex flex-col gap-0.5" aria-label="Recent agents">
                {pinned.length > 0 ? <SidebarSectionLabel>Recent</SidebarSectionLabel> : null}
                {recent.map((chat) => (
                  <AgentRow key={chat.id} chat={chat} context={context} />
                ))}
              </section>
            ) : null}
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
    </SidebarWorkspace>
  );
}
