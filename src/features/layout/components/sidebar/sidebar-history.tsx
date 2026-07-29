import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { AgentSessionSidebarItem } from "@/features/ai/components/agent-session-sidebar-item";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import { getModelById, getProviderById } from "@/features/ai/types/providers.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useGitStore } from "@/features/git/stores/git.store";
import { getProjectNameFromPath } from "@/features/layout/components/sidebar/sidebar-projects";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useTerminalTabsStore } from "@/features/terminal/stores/terminal-tabs.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
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
  TerminalIcon,
  TrashIcon,
} from "@/ui/icons";
import { InlineRenameInput } from "@/ui/input";
import {
  SidebarHeaderIconButton,
  SidebarListEditor,
  SidebarListItem,
  SidebarSectionEmptyState,
  SidebarSectionHeader,
} from "@/ui/sidebar";

const AGENT_HISTORY_INLINE_LIMIT = 5;

export function useNewAgentAction(onCreate?: () => void) {
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const createNewChat = useAIChatStore((state) => state.actions.createNewChat);
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);

  return useCallback(() => {
    const chatId = createNewChat(selectedAgentId, { activate: false });
    onCreate?.();
    openAgentBuffer(chatId);
  }, [createNewChat, onCreate, openAgentBuffer, selectedAgentId]);
}

function useActivityRailSectionCollapse(sectionId: "agents" | "terminals") {
  const collapsedSections = useSettingsStore(
    (state) => state.settings.collapsedActivityRailSections,
  );
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const isCollapsed = collapsedSections.includes(sectionId);

  const toggleCollapsed = useCallback(() => {
    const currentSections = useSettingsStore.getState().settings.collapsedActivityRailSections;
    const nextSections = currentSections.includes(sectionId)
      ? currentSections.filter((currentSectionId) => currentSectionId !== sectionId)
      : [...currentSections, sectionId];

    void updateSetting("collapsedActivityRailSections", nextSections);
  }, [sectionId, updateSetting]);

  return { isCollapsed, toggleCollapsed };
}

function SidebarNewAgentButton({
  onCreate,
  iconOnlyRow = false,
}: {
  onCreate?: () => void;
  iconOnlyRow?: boolean;
}) {
  const handleNewAgent = useNewAgentAction(onCreate);

  return iconOnlyRow ? (
    <SidebarListItem
      leading={<PlusIcon className="size-4" />}
      iconOnly
      onClick={handleNewAgent}
      aria-label="New Agent"
    >
      New Agent
    </SidebarListItem>
  ) : (
    <SidebarHeaderIconButton
      tooltip="New Agent"
      tooltipSide="right"
      aria-label="New Agent"
      onClick={handleNewAgent}
    >
      <PlusIcon />
    </SidebarHeaderIconButton>
  );
}

export function SidebarAgentHistory({
  expanded,
  workspacePath,
}: {
  expanded: boolean;
  workspacePath: string | null;
}) {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const deleteChat = useAIChatStore((state) => state.actions.deleteChat);
  const updateChatTitle = useAIChatStore((state) => state.actions.updateChatTitle);
  const setChatPinned = useAIChatStore((state) => state.actions.setChatPinned);
  const setChatArchived = useAIChatStore((state) => state.actions.setChatArchived);
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const aiModelId = useSettingsStore((state) => state.settings.aiModelId);
  const currentBranch = useGitStore((state) => state.gitStatus?.branch ?? null);
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const { isCollapsed, toggleCollapsed } = useActivityRailSectionCollapse("agents");
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [olderAgentsMenu, setOlderAgentsMenu] = useState({
    isOpen: false,
    position: { x: 0, y: 0 },
  });
  const sortedChats = useMemo(
    () =>
      filterChatsByWorkspace(chats, workspacePath)
        .filter((chat) => !chat.archivedAt)
        .sort((left, right) => {
          if (!!left.isPinned !== !!right.isPinned) return left.isPinned ? -1 : 1;
          return right.lastMessageAt.getTime() - left.lastMessageAt.getTime();
        }),
    [chats, workspacePath],
  );
  const visibleChats = sortedChats.slice(0, AGENT_HISTORY_INLINE_LIMIT);
  const olderChats = sortedChats.slice(AGENT_HISTORY_INLINE_LIMIT);

  const handleOpenChat = useCallback(
    (chatId: string) => {
      openAgentBuffer(chatId);
    },
    [openAgentBuffer],
  );

  const handleShowMoreAgents = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setOlderAgentsMenu({ isOpen: true, position: { x: rect.right + 6, y: rect.top } });
  }, []);

  const startRenamingChat = useCallback((chat: Chat) => {
    setRenamingChatId(chat.id);
    setRenameValue(chat.title);
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

  if (!expanded) return <SidebarNewAgentButton iconOnlyRow />;

  return (
    <div className="mt-3 w-full">
      <div className="relative">
        <SidebarSectionHeader expanded={!isCollapsed} onToggle={toggleCollapsed} className="pr-8">
          Agents
        </SidebarSectionHeader>
        <span className="absolute top-0 right-1 flex h-(--athas-tab-height) items-center">
          <SidebarNewAgentButton />
        </span>
      </div>
      {!isCollapsed ? (
        <>
          {visibleChats.map((chat) =>
            renamingChatId === chat.id ? (
              <SidebarListEditor
                key={chat.id}
                leading={<ProviderIcon providerId={chat.agentId || "custom"} size={16} />}
              >
                <InlineRenameInput
                  value={renameValue}
                  onValueChange={setRenameValue}
                  onSubmit={(nextTitle) => {
                    if (nextTitle !== chat.title) updateChatTitle(chat.id, nextTitle);
                    setRenamingChatId(null);
                  }}
                  onCancel={() => setRenamingChatId(null)}
                  aria-label={`Rename ${chat.title}`}
                />
              </SidebarListEditor>
            ) : (
              <ContextMenu key={chat.id}>
                <ContextMenuTrigger
                  className="block"
                  onContextMenu={(event) => event.stopPropagation()}
                >
                  <AgentSessionSidebarItem
                    title={chat.title}
                    active={chat.id === currentChatId}
                    pinned={chat.isPinned}
                    providerIconId={
                      chat.agentId === "custom"
                        ? chat.providerId || aiProviderId
                        : chat.agentId || "custom"
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
                        ? getModelById(chat.providerId || aiProviderId, chat.modelId || aiModelId)
                            ?.name ||
                          chat.modelId ||
                          aiModelId
                        : chat.modelId || "Agent default"
                    }
                    createdAt={chat.createdAt}
                    projectName={getProjectNameFromPath(chat.workspacePath || workspacePath || "")}
                    workspacePath={chat.workspacePath || workspacePath}
                    branch={chat.branch || currentBranch}
                    onOpen={() => handleOpenChat(chat.id)}
                    onPinChange={(isPinned) => setChatPinned(chat.id, isPinned)}
                    onArchive={() => setChatArchived(chat.id, true)}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => handleOpenChat(chat.id)}>
                    <OpenExternalIcon />
                    Open
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => startRenamingChat(chat)}>
                    <PencilSimpleLineIcon />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setChatPinned(chat.id, !chat.isPinned)}>
                    {chat.isPinned ? <PushPinSlashIcon /> : <PushPinIcon />}
                    {chat.isPinned ? "Unpin" : "Pin"}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setChatArchived(chat.id, true)}>
                    <ArchiveIcon />
                    Archive
                  </ContextMenuItem>
                  <ContextMenuItem variant="destructive" onClick={() => deleteChat(chat.id)}>
                    <TrashIcon />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ),
          )}
          {olderChats.length > 0 ? (
            <SidebarListItem
              leading={<DotsThreeIcon className="size-4" />}
              onClick={handleShowMoreAgents}
            >
              More
            </SidebarListItem>
          ) : null}
          {visibleChats.length === 0 ? (
            <SidebarSectionEmptyState>No history yet</SidebarSectionEmptyState>
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
    </div>
  );
}

export function SidebarTerminalHistory({ expanded }: { expanded: boolean }) {
  const buffers = useBufferStore((state) => state.buffers);
  const activeBufferId = useBufferStore((state) => state.activeBufferId);
  const setActiveBuffer = useBufferStore.use.actions().setActiveBuffer;
  const panelTerminals = useTerminalTabsStore((state) => state.terminals);
  const activePanelTerminalId = useTerminalTabsStore((state) => state.activeTerminalId);
  const dispatchTerminalAction = useTerminalTabsStore((state) => state.dispatch);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const setIsBottomPaneVisible = useUIState((state) => state.setIsBottomPaneVisible);
  const setBottomPaneActiveTab = useUIState((state) => state.setBottomPaneActiveTab);
  const { isCollapsed, toggleCollapsed } = useActivityRailSectionCollapse("terminals");

  const terminalBuffers = useMemo(
    () => buffers.filter((buffer) => buffer.type === "terminal"),
    [buffers],
  );
  const terminalCount = panelTerminals.length + terminalBuffers.length;

  const showTerminalPanel = useCallback(() => {
    setBottomPaneActiveTab("terminal");
    setIsBottomPaneVisible(true);
  }, [setBottomPaneActiveTab, setIsBottomPaneVisible]);

  const handleNewTerminal = useCallback(() => {
    showTerminalPanel();
    window.dispatchEvent(new CustomEvent("terminal-new"));
  }, [showTerminalPanel]);

  const handleOpenPanelTerminal = useCallback(
    (terminalId: string) => {
      dispatchTerminalAction({ type: "SET_ACTIVE_TERMINAL", payload: { id: terminalId } });
      showTerminalPanel();
    },
    [dispatchTerminalAction, showTerminalPanel],
  );

  if (!expanded) {
    return (
      <SidebarListItem
        leading={<TerminalIcon className="size-4" />}
        iconOnly
        onClick={() => {
          if (activePanelTerminalId) handleOpenPanelTerminal(activePanelTerminalId);
          else if (terminalBuffers[0]) setActiveBuffer(terminalBuffers[0].id);
          else handleNewTerminal();
        }}
        aria-label="Terminals"
      >
        Terminals
      </SidebarListItem>
    );
  }

  return (
    <div className="mt-3 w-full">
      <div className="relative">
        <SidebarSectionHeader expanded={!isCollapsed} onToggle={toggleCollapsed} className="pr-8">
          Terminals
        </SidebarSectionHeader>
        <span className="absolute top-0 right-1 flex h-(--athas-tab-height) items-center">
          <SidebarHeaderIconButton
            tooltip="New Terminal"
            tooltipSide="right"
            commandId="terminal.new"
            aria-label="New Terminal"
            onClick={handleNewTerminal}
          >
            <PlusIcon />
          </SidebarHeaderIconButton>
        </span>
      </div>
      {!isCollapsed ? (
        <>
          {panelTerminals.map((terminal) => (
            <SidebarListItem
              key={`panel-${terminal.id}`}
              active={
                isBottomPaneVisible &&
                bottomPaneActiveTab === "terminal" &&
                terminal.id === activePanelTerminalId
              }
              leading={<TerminalIcon className="size-4" />}
              onClick={() => handleOpenPanelTerminal(terminal.id)}
            >
              {terminal.name}
            </SidebarListItem>
          ))}
          {terminalBuffers.map((terminal) => (
            <SidebarListItem
              key={`buffer-${terminal.id}`}
              active={terminal.id === activeBufferId}
              leading={<TerminalIcon className="size-4" />}
              onClick={() => setActiveBuffer(terminal.id)}
            >
              {terminal.name}
            </SidebarListItem>
          ))}
          {terminalCount === 0 ? (
            <SidebarSectionEmptyState>No terminals yet</SidebarSectionEmptyState>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
