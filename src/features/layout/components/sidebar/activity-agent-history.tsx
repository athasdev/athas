import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { AgentSessionSidebarItem } from "@/features/ai/components/agent-session-sidebar-item";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import { getModelById, getProviderById } from "@/features/ai/types/providers.types";
import { useGitStore } from "@/features/git/stores/git.store";
import { getProjectNameFromPath } from "@/features/layout/components/sidebar/sidebar-projects";
import { useActivitySidebarSection } from "@/features/layout/hooks/use-activity-sidebar-section";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import {
  ArchiveIcon,
  DotsThreeIcon,
  OpenExternalIcon,
  PencilSimpleLineIcon,
  PlusIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SparkleIcon,
  TrashIcon,
} from "@/ui/icons";
import { InlineRenameInput } from "@/ui/input";
import {
  SidebarIconButton,
  SidebarListEditor,
  SidebarListItem,
  SidebarSectionHeader,
  SidebarSectionStack,
} from "@/ui/sidebar";

const AGENT_HISTORY_INLINE_LIMIT = 5;

function NewAgentIconButton() {
  const handleNewAgent = useNewAgentAction();

  return (
    <SidebarIconButton
      tooltip="New Agent"
      tooltipSide="right"
      aria-label="New Agent"
      onClick={handleNewAgent}
    >
      <PlusIcon />
    </SidebarIconButton>
  );
}

function NewAgentRow() {
  const handleNewAgent = useNewAgentAction();

  return (
    <SidebarListItem
      appearance="activity"
      leading={<SparkleIcon />}
      onClick={handleNewAgent}
      aria-label="New Agent"
    >
      New Agent
    </SidebarListItem>
  );
}

interface ActivityAgentRowProps {
  chat: Chat;
  active: boolean;
  aiProviderId: string;
  aiModelId: string;
  currentBranch: string | null;
  workspacePath: string | null;
  onOpen: (chatId: string) => void;
  onUpdateTitle: (chatId: string, title: string) => void;
  onPinChange: (chatId: string, pinned: boolean) => void;
  onArchive: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}

export function ActivityAgentRow({
  chat,
  active,
  aiProviderId,
  aiModelId,
  currentBranch,
  workspacePath,
  onOpen,
  onUpdateTitle,
  onPinChange,
  onArchive,
  onDelete,
}: ActivityAgentRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(chat.title);

  if (isRenaming) {
    return (
      <SidebarListEditor
        appearance="activity"
        leading={<ProviderIcon providerId={chat.agentId || "custom"} size={16} />}
      >
        <InlineRenameInput
          className="select-text"
          value={renameValue}
          onValueChange={setRenameValue}
          onSubmit={(nextTitle) => {
            if (nextTitle !== chat.title) onUpdateTitle(chat.id, nextTitle);
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
      <ContextMenuTrigger className="block" onContextMenu={(event) => event.stopPropagation()}>
        <AgentSessionSidebarItem
          title={chat.title}
          active={active}
          pinned={chat.isPinned}
          providerIconId={
            chat.agentId === "custom" ? chat.providerId || aiProviderId : chat.agentId || "custom"
          }
          agentLabel={
            chat.agentId === "custom"
              ? getProviderById(chat.providerId || aiProviderId)?.name ||
                chat.providerId ||
                aiProviderId
              : chat.agentId.replace(/[-_]/g, " ")
          }
          modelLabel={
            chat.agentId === "custom"
              ? getModelById(chat.providerId || aiProviderId, chat.modelId || aiModelId)?.name ||
                chat.modelId ||
                aiModelId
              : chat.modelId || "Agent default"
          }
          createdAt={chat.createdAt}
          projectName={getProjectNameFromPath(chat.workspacePath || workspacePath || "")}
          workspacePath={chat.workspacePath || workspacePath}
          branch={chat.branch || currentBranch}
          onOpen={() => onOpen(chat.id)}
          onPinChange={(pinned) => onPinChange(chat.id, pinned)}
          onArchive={() => onArchive(chat.id)}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onOpen(chat.id)}>
          <OpenExternalIcon />
          Open
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            setRenameValue(chat.title);
            setIsRenaming(true);
          }}
        >
          <PencilSimpleLineIcon />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onPinChange(chat.id, !chat.isPinned)}>
          {chat.isPinned ? <PushPinSlashIcon /> : <PushPinIcon />}
          {chat.isPinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onArchive(chat.id)}>
          <ArchiveIcon />
          Archive
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => onDelete(chat.id)}>
          <TrashIcon />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ActivityAgentHistory({ workspacePath }: { workspacePath: string | null }) {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const deleteChat = useAIChatStore((state) => state.actions.deleteChat);
  const updateChatTitle = useAIChatStore((state) => state.actions.updateChatTitle);
  const setChatPinned = useAIChatStore((state) => state.actions.setChatPinned);
  const setChatArchived = useAIChatStore((state) => state.actions.setChatArchived);
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const aiModelId = useSettingsStore((state) => state.settings.aiModelId);
  const currentBranch = useGitStore((state) => state.gitStatus?.branch ?? null);
  const { isCollapsed, toggleCollapsed } = useActivitySidebarSection("agents");
  const [olderAgentsMenu, setOlderAgentsMenu] = useState({
    isOpen: false,
    position: { x: 0, y: 0 },
  });
  const sortedChats = useMemo(
    () =>
      filterChatsByWorkspace(chats, workspacePath)
        .filter((chat) => !chat.archivedAt && !chat.isPinned)
        .sort((left, right) => right.lastMessageAt.getTime() - left.lastMessageAt.getTime()),
    [chats, workspacePath],
  );
  const visibleChats = sortedChats.slice(0, AGENT_HISTORY_INLINE_LIMIT);
  const olderChats = sortedChats.slice(AGENT_HISTORY_INLINE_LIMIT);

  const handleOpenChat = useCallback((chatId: string) => {
    openAgentHistoryChat(chatId);
  }, []);

  const handleShowMoreAgents = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setOlderAgentsMenu({ isOpen: true, position: { x: rect.right + 6, y: rect.top } });
  }, []);

  const olderAgentMenuItems = useMemo<MenuItem[]>(
    () =>
      olderChats.map((chat) => ({
        id: chat.id,
        label: chat.title,
        icon: <ProviderIcon providerId={chat.agentId || "custom"} size={16} />,
        onClick: () => handleOpenChat(chat.id),
      })),
    [handleOpenChat, olderChats],
  );

  return (
    <SidebarSectionStack>
      <SidebarSectionHeader
        expanded={!isCollapsed}
        onToggle={toggleCollapsed}
        action={visibleChats.length > 0 ? <NewAgentIconButton /> : undefined}
      >
        Agents
      </SidebarSectionHeader>
      {!isCollapsed ? (
        <>
          {visibleChats.length === 0 ? <NewAgentRow /> : null}
          {visibleChats.map((chat) => (
            <ActivityAgentRow
              key={chat.id}
              chat={chat}
              active={chat.id === currentChatId}
              aiProviderId={aiProviderId}
              aiModelId={aiModelId}
              currentBranch={currentBranch}
              workspacePath={workspacePath}
              onOpen={handleOpenChat}
              onUpdateTitle={updateChatTitle}
              onPinChange={setChatPinned}
              onArchive={(chatId) => setChatArchived(chatId, true)}
              onDelete={deleteChat}
            />
          ))}
          {olderChats.length > 0 ? (
            <SidebarListItem
              appearance="activity"
              leading={<DotsThreeIcon />}
              onClick={handleShowMoreAgents}
            >
              More
            </SidebarListItem>
          ) : null}
          <Dropdown
            isOpen={olderAgentsMenu.isOpen}
            point={olderAgentsMenu.position}
            items={olderAgentMenuItems}
            onClose={() => setOlderAgentsMenu((current) => ({ ...current, isOpen: false }))}
            style={{ maxHeight: 320, width: 240 }}
          />
        </>
      ) : null}
    </SidebarSectionStack>
  );
}
