import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AgentSessionSidebarItem } from "@/features/ai/components/agent-session-sidebar-item";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import { getModelById, getProviderById } from "@/features/ai/types/providers.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import { getWorktrees } from "@/features/git/api/git-worktrees-api";
import { isGitChangeRelevant, subscribeToGitChanges } from "@/features/git/events/git-events";
import { useGitStore } from "@/features/git/stores/git.store";
import type { GitWorktree } from "@/features/git/types/git.types";
import { isOpenableGitWorktree } from "@/features/git/utils/git-worktree-open";
import { getProjectNameFromPath } from "@/features/layout/components/sidebar/sidebar-projects";
import { SidebarWorktreeHistoryRow } from "@/features/layout/components/sidebar/sidebar-worktree-history-row";
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
  NodesIcon,
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
  SidebarSectionHeader,
  SidebarSectionLabel,
} from "@/ui/sidebar";

const AGENT_HISTORY_INLINE_LIMIT = 5;

function useActivityRailSectionCollapse(sectionId: "agents" | "terminals" | "worktrees") {
  const collapsedSections = useSettingsStore(
    (state) => state.settings.collapsedActivityRailSections,
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
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
  iconOnly = false,
  compact = false,
}: {
  onCreate?: () => void;
  iconOnly?: boolean;
  compact?: boolean;
}) {
  const handleNewAgent = useNewAgentAction({ onOpen: onCreate });

  if (compact) {
    return (
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

  return (
    <SidebarListItem
      leading={<PlusIcon className="size-4" />}
      iconOnly={iconOnly}
      onClick={handleNewAgent}
      aria-label="New Agent"
    >
      New Agent
    </SidebarListItem>
  );
}

interface SidebarAgentHistoryRowProps {
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

function SidebarAgentHistoryRow({
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
}: SidebarAgentHistoryRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(chat.title);

  if (isRenaming) {
    return (
      <SidebarListEditor leading={<ProviderIcon providerId={chat.agentId || "custom"} size={16} />}>
        <InlineRenameInput
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
  const { isCollapsed, toggleCollapsed } = useActivityRailSectionCollapse("agents");
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

  if (!expanded) return <SidebarNewAgentButton iconOnly />;

  return (
    <div className="mt-3 w-full">
      <div className="relative">
        <SidebarSectionHeader
          expanded={!isCollapsed}
          onToggle={toggleCollapsed}
          className={visibleChats.length > 0 ? "pr-8" : undefined}
        >
          Agents
        </SidebarSectionHeader>
        {visibleChats.length > 0 ? (
          <span className="absolute top-0 right-1 flex h-(--athas-tab-height) items-center">
            <SidebarNewAgentButton compact />
          </span>
        ) : null}
      </div>
      {!isCollapsed ? (
        <>
          {visibleChats.length === 0 ? <SidebarNewAgentButton /> : null}
          {visibleChats.map((chat) => (
            <SidebarAgentHistoryRow
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
              leading={<DotsThreeIcon className="size-4" />}
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
    </div>
  );
}

export function SidebarPinnedItems({
  expanded,
  workspacePath,
  showAgents,
  showTerminals,
}: {
  expanded: boolean;
  workspacePath: string | null;
  showAgents: boolean;
  showTerminals: boolean;
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
  const buffers = useBufferStore((state) => state.buffers);
  const activeBufferId = useBufferStore((state) => state.activeBufferId);
  const setActiveBuffer = useBufferStore.use.actions().setActiveBuffer;
  const handleTabPin = useBufferStore.use.actions().handleTabPin;
  const panelTerminals = useTerminalTabsStore((state) => state.terminals);
  const activePanelTerminalId = useTerminalTabsStore((state) => state.activeTerminalId);
  const dispatchTerminalAction = useTerminalTabsStore((state) => state.actions.dispatch);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const setIsBottomPaneVisible = useUIState((state) => state.setIsBottomPaneVisible);
  const setBottomPaneActiveTab = useUIState((state) => state.setBottomPaneActiveTab);

  const pinnedChats = useMemo(
    () =>
      showAgents
        ? filterChatsByWorkspace(chats, workspacePath)
            .filter((chat) => !chat.archivedAt && chat.isPinned)
            .sort((left, right) => right.lastMessageAt.getTime() - left.lastMessageAt.getTime())
        : [],
    [chats, showAgents, workspacePath],
  );
  const pinnedPanelTerminals = useMemo(
    () => (showTerminals ? panelTerminals.filter((terminal) => terminal.isPinned) : []),
    [panelTerminals, showTerminals],
  );
  const pinnedTerminalBuffers = useMemo(
    () =>
      showTerminals
        ? buffers.filter((buffer) => buffer.type === "terminal" && buffer.isPinned)
        : [],
    [buffers, showTerminals],
  );

  const handleOpenPanelTerminal = useCallback(
    (terminalId: string) => {
      dispatchTerminalAction({ type: "SET_ACTIVE_TERMINAL", payload: { id: terminalId } });
      setBottomPaneActiveTab("terminal");
      setIsBottomPaneVisible(true);
    },
    [dispatchTerminalAction, setBottomPaneActiveTab, setIsBottomPaneVisible],
  );

  if (
    !expanded ||
    (pinnedChats.length === 0 &&
      pinnedPanelTerminals.length === 0 &&
      pinnedTerminalBuffers.length === 0)
  ) {
    return null;
  }

  return (
    <div className="mt-3 w-full">
      <SidebarSectionLabel>Pinned</SidebarSectionLabel>
      {pinnedChats.map((chat) => (
        <SidebarAgentHistoryRow
          key={`agent-${chat.id}`}
          chat={chat}
          active={chat.id === currentChatId}
          aiProviderId={aiProviderId}
          aiModelId={aiModelId}
          currentBranch={currentBranch}
          workspacePath={workspacePath}
          onOpen={openAgentHistoryChat}
          onUpdateTitle={updateChatTitle}
          onPinChange={setChatPinned}
          onArchive={(chatId) => setChatArchived(chatId, true)}
          onDelete={deleteChat}
        />
      ))}
      {pinnedPanelTerminals.map((terminal) => (
        <ContextMenu key={`panel-${terminal.id}`}>
          <ContextMenuTrigger className="block" onContextMenu={(event) => event.stopPropagation()}>
            <SidebarListItem
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
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => handleOpenPanelTerminal(terminal.id)}>
              <OpenExternalIcon />
              Open
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                dispatchTerminalAction({
                  type: "PIN_TERMINAL",
                  payload: { id: terminal.id, isPinned: false },
                })
              }
            >
              <PushPinSlashIcon />
              Unpin
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
      {pinnedTerminalBuffers.map((terminal) => (
        <ContextMenu key={`buffer-${terminal.id}`}>
          <ContextMenuTrigger className="block" onContextMenu={(event) => event.stopPropagation()}>
            <SidebarListItem
              active={terminal.id === activeBufferId}
              leading={<TerminalIcon className="size-4" />}
              onClick={() => setActiveBuffer(terminal.id)}
            >
              {terminal.name}
            </SidebarListItem>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => setActiveBuffer(terminal.id)}>
              <OpenExternalIcon />
              Open
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleTabPin(terminal.id)}>
              <PushPinSlashIcon />
              Unpin
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
}

export function SidebarTerminalHistory({ expanded }: { expanded: boolean }) {
  const buffers = useBufferStore((state) => state.buffers);
  const activeBufferId = useBufferStore((state) => state.activeBufferId);
  const setActiveBuffer = useBufferStore.use.actions().setActiveBuffer;
  const panelTerminals = useTerminalTabsStore((state) => state.terminals);
  const activePanelTerminalId = useTerminalTabsStore((state) => state.activeTerminalId);
  const dispatchTerminalAction = useTerminalTabsStore((state) => state.actions.dispatch);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const setIsBottomPaneVisible = useUIState((state) => state.setIsBottomPaneVisible);
  const setBottomPaneActiveTab = useUIState((state) => state.setBottomPaneActiveTab);
  const { isCollapsed, toggleCollapsed } = useActivityRailSectionCollapse("terminals");

  const terminalBuffers = useMemo(
    () => buffers.filter((buffer) => buffer.type === "terminal" && !buffer.isPinned),
    [buffers],
  );
  const regularPanelTerminals = useMemo(
    () => panelTerminals.filter((terminal) => !terminal.isPinned),
    [panelTerminals],
  );
  const terminalCount = regularPanelTerminals.length + terminalBuffers.length;
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
        <SidebarSectionHeader
          expanded={!isCollapsed}
          onToggle={toggleCollapsed}
          className={terminalCount > 0 ? "pr-8" : undefined}
        >
          Terminals
        </SidebarSectionHeader>
        {terminalCount > 0 ? (
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
        ) : null}
      </div>
      {!isCollapsed ? (
        <>
          {terminalCount === 0 ? (
            <SidebarListItem
              leading={<PlusIcon className="size-4" />}
              aria-label="New Terminal"
              onClick={handleNewTerminal}
            >
              New Terminal
            </SidebarListItem>
          ) : null}
          {regularPanelTerminals.map((terminal) => (
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
        </>
      ) : null}
    </div>
  );
}

export function SidebarWorktreeHistory({
  expanded,
  repoPath,
  onNewWorktree,
}: {
  expanded: boolean;
  repoPath: string | null;
  onNewWorktree: () => void;
}) {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const { isCollapsed, toggleCollapsed } = useActivityRailSectionCollapse("worktrees");
  const openableWorktrees = useMemo(() => worktrees.filter(isOpenableGitWorktree), [worktrees]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!repoPath) {
        if (!cancelled) setWorktrees([]);
        return;
      }

      const nextWorktrees = await getWorktrees(repoPath);
      if (!cancelled) setWorktrees(nextWorktrees);
    };

    void load();
    const unsubscribe = subscribeToGitChanges((change) => {
      if (isGitChangeRelevant(change, repoPath)) void load();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repoPath]);

  if (!expanded) {
    return (
      <SidebarListItem
        leading={<NodesIcon className="size-4" />}
        iconOnly
        onClick={onNewWorktree}
        aria-label="Worktrees"
      >
        Worktrees
      </SidebarListItem>
    );
  }

  return (
    <div className="mt-3 w-full">
      <div className="relative">
        <SidebarSectionHeader
          expanded={!isCollapsed}
          onToggle={toggleCollapsed}
          className={openableWorktrees.length > 0 ? "pr-8" : undefined}
        >
          Worktrees
        </SidebarSectionHeader>
        {openableWorktrees.length > 0 ? (
          <span className="absolute top-0 right-1 flex h-(--athas-tab-height) items-center">
            <SidebarHeaderIconButton
              tooltip="New Worktree"
              tooltipSide="right"
              aria-label="New Worktree"
              onClick={onNewWorktree}
            >
              <PlusIcon />
            </SidebarHeaderIconButton>
          </span>
        ) : null}
      </div>
      {!isCollapsed ? (
        <>
          {openableWorktrees.length === 0 ? (
            <SidebarListItem
              leading={<PlusIcon className="size-4" />}
              onClick={onNewWorktree}
              aria-label="New Worktree"
            >
              New Worktree
            </SidebarListItem>
          ) : null}
          {repoPath
            ? openableWorktrees.map((worktree) => (
                <SidebarWorktreeHistoryRow
                  key={worktree.path}
                  repoPath={repoPath}
                  worktree={worktree}
                />
              ))
            : null}
        </>
      ) : null}
    </div>
  );
}
