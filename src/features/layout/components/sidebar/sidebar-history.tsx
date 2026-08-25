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
import { WorktreeItem } from "@/features/layout/components/sidebar/worktree-item";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  CLOSE_TERMINAL_EVENT,
  RENAME_TERMINAL_EVENT,
} from "@/features/terminal/constants/terminal-events";
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
  SparkleIcon,
  TerminalIcon,
  TrashIcon,
  XIcon,
} from "@/ui/icons";
import { InlineRenameInput } from "@/ui/input";
import {
  SidebarIconButton,
  SidebarListActionRow,
  SidebarListEditor,
  SidebarListItem,
  SidebarSectionHeader,
  SidebarSectionLabel,
  SidebarSectionStack,
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

  return (
    <SidebarListItem
      appearance="activity"
      leading={<SparkleIcon className="size-4" />}
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

interface SidebarTerminalHistoryRowProps {
  name: string;
  active: boolean;
  pinned: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onPinChange: () => void;
  onClose: () => void;
}

function SidebarTerminalHistoryRow({
  name,
  active,
  pinned,
  onOpen,
  onRename,
  onPinChange,
  onClose,
}: SidebarTerminalHistoryRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);

  if (isRenaming) {
    return (
      <SidebarListEditor appearance="activity" leading={<TerminalIcon className="size-4" />}>
        <InlineRenameInput
          className="select-text"
          value={renameValue}
          onValueChange={setRenameValue}
          onSubmit={(nextName) => {
            if (nextName !== name) onRename(nextName);
            setIsRenaming(false);
          }}
          onCancel={() => setIsRenaming(false)}
          aria-label={`Rename ${name}`}
        />
      </SidebarListEditor>
    );
  }

  return (
    <SidebarListActionRow
      actions={[
        <SidebarIconButton
          key="rename"
          tooltip="Rename terminal"
          tooltipSide="right"
          onClick={(event) => {
            event.stopPropagation();
            setRenameValue(name);
            setIsRenaming(true);
          }}
        >
          <PencilSimpleLineIcon className="size-3" />
        </SidebarIconButton>,
        <SidebarIconButton
          key="pin"
          active={pinned}
          aria-pressed={pinned}
          tooltip={pinned ? "Unpin terminal" : "Pin terminal"}
          tooltipSide="right"
          onClick={(event) => {
            event.stopPropagation();
            onPinChange();
          }}
        >
          {pinned ? <PushPinSlashIcon className="size-3" /> : <PushPinIcon className="size-3" />}
        </SidebarIconButton>,
        <SidebarIconButton
          key="close"
          className="hover:text-destructive"
          tooltip="Close terminal"
          tooltipSide="right"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <XIcon className="size-3" />
        </SidebarIconButton>,
      ]}
    >
      <SidebarListItem
        active={active}
        appearance="activity"
        leading={<TerminalIcon className="size-4" />}
        onClick={onOpen}
      >
        {name}
      </SidebarListItem>
    </SidebarListActionRow>
  );
}

function closePanelTerminal(terminalId: string) {
  window.dispatchEvent(
    new CustomEvent(CLOSE_TERMINAL_EVENT, {
      detail: { terminalId },
    }),
  );
}

function renameTerminal(terminalId: string, name: string) {
  window.dispatchEvent(
    new CustomEvent(RENAME_TERMINAL_EVENT, {
      detail: { terminalId, name },
    }),
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
    <SidebarSectionStack>
      <SidebarSectionHeader
        expanded={!isCollapsed}
        onToggle={toggleCollapsed}
        action={visibleChats.length > 0 ? <SidebarNewAgentButton compact /> : undefined}
      >
        Agents
      </SidebarSectionHeader>
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
              appearance="activity"
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
    </SidebarSectionStack>
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
  const handleTabClose = useBufferStore.use.actions().handleTabClose;
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
    <SidebarSectionStack>
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
        <SidebarTerminalHistoryRow
          key={`panel-${terminal.id}`}
          name={terminal.name}
          active={
            isBottomPaneVisible &&
            bottomPaneActiveTab === "terminal" &&
            terminal.id === activePanelTerminalId
          }
          pinned
          onOpen={() => handleOpenPanelTerminal(terminal.id)}
          onRename={(name) => renameTerminal(terminal.id, name)}
          onPinChange={() =>
            dispatchTerminalAction({
              type: "PIN_TERMINAL",
              payload: { id: terminal.id, isPinned: false },
            })
          }
          onClose={() => closePanelTerminal(terminal.id)}
        />
      ))}
      {pinnedTerminalBuffers.map((terminal) => (
        <SidebarTerminalHistoryRow
          key={`buffer-${terminal.id}`}
          name={terminal.name}
          active={terminal.id === activeBufferId}
          pinned
          onOpen={() => setActiveBuffer(terminal.id)}
          onRename={(name) => {
            if (terminal.type === "terminal") renameTerminal(terminal.sessionId, name);
          }}
          onPinChange={() => handleTabPin(terminal.id)}
          onClose={() => handleTabClose(terminal.id)}
        />
      ))}
    </SidebarSectionStack>
  );
}

export function SidebarTerminalHistory({ expanded }: { expanded: boolean }) {
  const buffers = useBufferStore((state) => state.buffers);
  const activeBufferId = useBufferStore((state) => state.activeBufferId);
  const setActiveBuffer = useBufferStore.use.actions().setActiveBuffer;
  const handleTabPin = useBufferStore.use.actions().handleTabPin;
  const handleTabClose = useBufferStore.use.actions().handleTabClose;
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
        appearance="activity"
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
    <SidebarSectionStack>
      <SidebarSectionHeader
        expanded={!isCollapsed}
        onToggle={toggleCollapsed}
        action={
          terminalCount > 0 ? (
            <SidebarIconButton
              tooltip="New Terminal"
              tooltipSide="right"
              commandId="terminal.new"
              aria-label="New Terminal"
              onClick={handleNewTerminal}
            >
              <PlusIcon />
            </SidebarIconButton>
          ) : undefined
        }
      >
        Terminals
      </SidebarSectionHeader>
      {!isCollapsed ? (
        <>
          {terminalCount === 0 ? (
            <SidebarListItem
              appearance="activity"
              leading={<TerminalIcon className="size-4" />}
              aria-label="New Terminal"
              onClick={handleNewTerminal}
            >
              New Terminal
            </SidebarListItem>
          ) : null}
          {regularPanelTerminals.map((terminal) => (
            <SidebarTerminalHistoryRow
              key={`panel-${terminal.id}`}
              name={terminal.name}
              active={
                isBottomPaneVisible &&
                bottomPaneActiveTab === "terminal" &&
                terminal.id === activePanelTerminalId
              }
              pinned={false}
              onOpen={() => handleOpenPanelTerminal(terminal.id)}
              onRename={(name) => renameTerminal(terminal.id, name)}
              onPinChange={() =>
                dispatchTerminalAction({
                  type: "PIN_TERMINAL",
                  payload: { id: terminal.id, isPinned: true },
                })
              }
              onClose={() => closePanelTerminal(terminal.id)}
            />
          ))}
          {terminalBuffers.map((terminal) => (
            <SidebarTerminalHistoryRow
              key={`buffer-${terminal.id}`}
              name={terminal.name}
              active={terminal.id === activeBufferId}
              pinned={false}
              onOpen={() => setActiveBuffer(terminal.id)}
              onRename={(name) => {
                if (terminal.type === "terminal") renameTerminal(terminal.sessionId, name);
              }}
              onPinChange={() => handleTabPin(terminal.id)}
              onClose={() => handleTabClose(terminal.id)}
            />
          ))}
        </>
      ) : null}
    </SidebarSectionStack>
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
        appearance="activity"
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
    <SidebarSectionStack>
      <SidebarSectionHeader
        expanded={!isCollapsed}
        onToggle={toggleCollapsed}
        action={
          openableWorktrees.length > 0 ? (
            <SidebarIconButton
              tooltip="New Worktree"
              tooltipSide="right"
              aria-label="New Worktree"
              onClick={onNewWorktree}
            >
              <PlusIcon />
            </SidebarIconButton>
          ) : undefined
        }
      >
        Worktrees
      </SidebarSectionHeader>
      {!isCollapsed ? (
        <>
          {openableWorktrees.length === 0 ? (
            <SidebarListItem
              appearance="activity"
              leading={<NodesIcon className="size-4" />}
              onClick={onNewWorktree}
              aria-label="New Worktree"
            >
              New Worktree
            </SidebarListItem>
          ) : null}
          {repoPath
            ? openableWorktrees.map((worktree) => (
                <WorktreeItem key={worktree.path} repoPath={repoPath} worktree={worktree} />
              ))
            : null}
        </>
      ) : null}
    </SidebarSectionStack>
  );
}
