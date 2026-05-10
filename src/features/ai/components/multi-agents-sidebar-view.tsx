import { CaretRight, MagnifyingGlass as Search, PushPin } from "@phosphor-icons/react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { AgentSelector } from "@/features/ai/components/selectors/agent-selector";
import ChatHistoryDropdown from "@/features/ai/components/history/sidebar";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AcpAgentStatus, AcpSessionInfo } from "@/features/ai/types/acp";
import type { AgentType, Chat } from "@/features/ai/types/ai-chat";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useProjectStore } from "@/features/window/stores/project-store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { Button } from "@/ui/button";
import { ContextMenu, type ContextMenuItem, useContextMenu } from "@/ui/context-menu";
import {
  SidebarEmptyActionState,
  SidebarHeader,
  SidebarHeaderSearch,
  SidebarPanel,
} from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import { getBaseName } from "@/utils/path-helpers";

const PINNED_AGENT_CHATS_KEY = "athas:multi-agents-sidebar:pinned-chats";
const INITIAL_VISIBLE_SESSIONS = 5;
const EXPANDED_VISIBLE_SESSIONS = 30;

interface SidebarAgentChat {
  agentId: AgentType;
  chatId: string;
  title: string;
  lastMessageAt: Date;
  running: boolean;
  remoteSessionId?: string;
  remoteOnly?: boolean;
}

function isRunningChat(chat: Chat, status: AcpAgentStatus | null) {
  if (!status?.running || status.agentId !== chat.agentId) return false;
  if (status.sessionId && chat.acpSessionId) return status.sessionId === chat.acpSessionId;
  return useAIChatStore.getState().currentChatId === chat.id;
}

function getDisplayTitle(title: string) {
  return title && title !== "New Chat" ? title : "New chat";
}

function getRemoteSessionTitle(session: AcpSessionInfo) {
  return session.title?.trim() || `Session ${session.sessionId.slice(0, 8)}`;
}

function getRemoteSessionDate(session: AcpSessionInfo) {
  const timestamp = session.updatedAt ? Date.parse(session.updatedAt) : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
}

function hasSessionListCapability(status: AcpAgentStatus | null) {
  const capabilities = status?.agentCapabilities?.sessionCapabilities;
  return Boolean(
    capabilities &&
    typeof capabilities === "object" &&
    capabilities !== null &&
    "list" in capabilities,
  );
}

function readPinnedChatIds() {
  try {
    const raw = window.localStorage.getItem(PINNED_AGENT_CHATS_KEY);
    if (!raw) return new Set<string>();
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? new Set(value.filter((item): item is string => typeof item === "string"))
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function writePinnedChatIds(chatIds: Set<string>) {
  try {
    window.localStorage.setItem(PINNED_AGENT_CHATS_KEY, JSON.stringify(Array.from(chatIds)));
  } catch {
    // Ignore storage failures.
  }
}

function getWorkspaceLabel(
  rootFolderPath: string | undefined,
  activeProjectName: string | undefined,
) {
  return activeProjectName?.trim() || (rootFolderPath ? getBaseName(rootFolderPath) : "Workspace");
}

export function MultiAgentsSidebarView() {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const acpStatus = useAIChatStore((state) => state.acpStatus);
  const setSelectedAgentId = useAIChatStore((state) => state.setSelectedAgentId);
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const registerActiveAgentChat = useAIChatStore((state) => state.registerActiveAgentChat);
  const switchToChat = useAIChatStore((state) => state.switchToChat);
  const deleteChat = useAIChatStore((state) => state.deleteChat);
  const updateChatTitle = useAIChatStore((state) => state.updateChatTitle);
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const activeProject = projectTabs.find((tab) => tab.isActive);
  const agentContextMenu = useContextMenu<SidebarAgentChat>();
  const chatHistoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(() => readPinnedChatIds());
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [remoteSessions, setRemoteSessions] = useState<AcpSessionInfo[]>([]);
  const [visibleSessionCount, setVisibleSessionCount] = useState(INITIAL_VISIBLE_SESSIONS);
  const [isChatHistoryOpen, setIsChatHistoryOpen] = useState(false);

  const workspaceKey = activeProject?.id ?? rootFolderPath ?? "workspace";
  const workspaceLabel = getWorkspaceLabel(rootFolderPath, activeProject?.name);

  useEffect(() => {
    writePinnedChatIds(pinnedChatIds);
  }, [pinnedChatIds]);

  useEffect(() => {
    let cancelled = false;

    async function loadRemoteSessions() {
      if (!hasSessionListCapability(acpStatus)) {
        setRemoteSessions([]);
        return;
      }

      try {
        const sessions: AcpSessionInfo[] = [];
        let cursor: string | null | undefined;

        do {
          const page = await AcpStreamHandler.listSessions({
            cwd: rootFolderPath ?? undefined,
            cursor,
          });
          sessions.push(...page.sessions);
          cursor = page.nextCursor;
        } while (cursor);

        if (!cancelled) {
          setRemoteSessions(sessions);
        }
      } catch (error) {
        if (!cancelled) {
          setRemoteSessions([]);
          console.error("Failed to load ACP sessions:", error);
        }
      }
    }

    void loadRemoteSessions();

    return () => {
      cancelled = true;
    };
  }, [acpStatus, rootFolderPath]);

  const sidebarChats = useMemo<SidebarAgentChat[]>(() => {
    const localChats = [...chats]
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .map((chat) => ({
        agentId: chat.agentId,
        chatId: chat.id,
        title: chat.title,
        lastMessageAt: chat.lastMessageAt,
        running: isRunningChat(chat, acpStatus),
      }));
    const localSessionIds = new Set(
      localChats
        .map((chat) => chats.find((item) => item.id === chat.chatId)?.acpSessionId)
        .filter(Boolean),
    );
    const currentAgentId = acpStatus?.agentId as AgentType | undefined;
    const remoteChats =
      acpStatus?.running && currentAgentId
        ? remoteSessions
            .filter((session) => !localSessionIds.has(session.sessionId))
            .map((session) => ({
              agentId: currentAgentId,
              chatId: `acp:${currentAgentId}:${session.sessionId}`,
              title: getRemoteSessionTitle(session),
              lastMessageAt: getRemoteSessionDate(session),
              running: acpStatus.sessionId === session.sessionId,
              remoteSessionId: session.sessionId,
              remoteOnly: true,
            }))
        : [];

    return [...localChats, ...remoteChats].sort(
      (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
    );
  }, [acpStatus, chats, remoteSessions]);

  const filteredChats = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    if (!query) return sidebarChats;

    return sidebarChats.filter((chat) => {
      return (
        getDisplayTitle(chat.title).toLowerCase().includes(query) ||
        chat.agentId.toLowerCase().includes(query)
      );
    });
  }, [deferredSearchQuery, sidebarChats]);

  const pinnedChats = useMemo(
    () => filteredChats.filter((chat) => pinnedChatIds.has(chat.chatId)),
    [filteredChats, pinnedChatIds],
  );

  const historyChats = useMemo(
    () => filteredChats.filter((chat) => !pinnedChatIds.has(chat.chatId)),
    [filteredChats, pinnedChatIds],
  );

  const visibleHistoryChats = useMemo(
    () => historyChats.slice(0, visibleSessionCount),
    [historyChats, visibleSessionCount],
  );

  const sortedChatsForHistory = useMemo(
    () => [...chats].sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()),
    [chats],
  );

  useEffect(() => {
    setVisibleSessionCount(INITIAL_VISIBLE_SESSIONS);
  }, [deferredSearchQuery, workspaceKey]);

  const openChat = useCallback(
    (chatId: string) => {
      switchToChat(chatId);
      openAgentBuffer(chatId);
    },
    [openAgentBuffer, switchToChat],
  );

  const resumeRemoteSession = useCallback(
    (agent: SidebarAgentChat) => {
      if (!agent.remoteSessionId) {
        openChat(agent.chatId);
        return;
      }

      setSelectedAgentId(agent.agentId);
      const existing = chats.find((chat) => chat.acpSessionId === agent.remoteSessionId);
      const chatId = existing?.id ?? createNewChat(agent.agentId);
      updateChatTitle(chatId, agent.title);
      useAIChatStore.getState().setChatAcpSessionId(chatId, agent.remoteSessionId);
      openChat(chatId);
      void AcpStreamHandler.warmup(agent.agentId, chatId).catch((error) => {
        console.error(`Failed to resume ${agent.agentId} session:`, error);
      });
    },
    [chats, createNewChat, openChat, setSelectedAgentId, updateChatTitle],
  );

  const createAgentChat = useCallback(
    (agentId: AgentType) => {
      setSelectedAgentId(agentId);
      const chatId = createNewChat(agentId);
      registerActiveAgentChat(chatId);
      openAgentBuffer(chatId);

      if (agentId !== "custom") {
        void AcpStreamHandler.warmup(agentId, chatId).catch((error) => {
          console.error(`Failed to prepare ${agentId} session:`, error);
        });
      }
    },
    [createNewChat, openAgentBuffer, registerActiveAgentChat, setSelectedAgentId],
  );

  const togglePinnedChat = useCallback((chatId: string) => {
    setPinnedChatIds((current) => {
      const next = new Set(current);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((groupKey: string) => {
    setOpenGroups((current) => ({
      ...current,
      [groupKey]: !(current[groupKey] ?? true),
    }));
  }, []);

  const showMoreHistory = useCallback(() => {
    if (visibleSessionCount < EXPANDED_VISIBLE_SESSIONS) {
      setVisibleSessionCount(EXPANDED_VISIBLE_SESSIONS);
      return;
    }

    setIsChatHistoryOpen(true);
  }, [visibleSessionCount]);

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const agent = agentContextMenu.data;
    if (!agent) return [];

    const selected = currentChatId === agent.chatId;
    const isUntitled = agent.remoteOnly || !agent.title || agent.title === "New Chat";
    const pinned = pinnedChatIds.has(agent.chatId);

    return [
      {
        id: "open",
        label: agent.remoteOnly ? "Resume Session" : "Open Chat",
        disabled: selected,
        onClick: () => (agent.remoteOnly ? resumeRemoteSession(agent) : openChat(agent.chatId)),
      },
      {
        id: "new-chat",
        label: "New Agent Chat",
        onClick: () => createAgentChat(agent.agentId),
      },
      {
        id: "pin",
        label: pinned ? "Unpin from Sidebar" : "Pin to Sidebar",
        onClick: () => togglePinnedChat(agent.chatId),
      },
      { id: "sep-title", label: "", separator: true, onClick: () => {} },
      {
        id: "reset-title",
        label: "Reset Title",
        disabled: isUntitled,
        onClick: () => updateChatTitle(agent.chatId, "New Chat"),
      },
      { id: "sep-close", label: "", separator: true, onClick: () => {} },
      {
        id: "close",
        label: agent.remoteOnly ? "Remove from List" : "Close Chat",
        className: "text-error hover:!bg-error/10 hover:!text-error",
        onClick: () => {
          if (agent.remoteOnly) {
            setRemoteSessions((current) =>
              current.filter((session) => session.sessionId !== agent.remoteSessionId),
            );
            return;
          }
          deleteChat(agent.chatId);
        },
      },
    ];
  }, [
    agentContextMenu.data,
    createAgentChat,
    currentChatId,
    deleteChat,
    openChat,
    pinnedChatIds,
    resumeRemoteSession,
    setRemoteSessions,
    togglePinnedChat,
    updateChatTitle,
  ]);

  const renderChatRow = (agent: SidebarAgentChat) => {
    const selected = currentChatId === agent.chatId;
    const pinned = pinnedChatIds.has(agent.chatId);

    return (
      <div
        key={agent.chatId}
        role="button"
        tabIndex={0}
        onClick={() => (agent.remoteOnly ? resumeRemoteSession(agent) : openChat(agent.chatId))}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (agent.remoteOnly) {
              resumeRemoteSession(agent);
            } else {
              openChat(agent.chatId);
            }
          }
        }}
        onContextMenu={(event) => agentContextMenu.open(event, agent)}
        className={cn(
          "group flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 text-left outline-none transition-colors focus-visible:border-border focus-visible:bg-hover/60",
          selected ? "border-border/70 bg-hover/80" : "hover:border-border/50 hover:bg-hover/50",
        )}
      >
        <ProviderIcon
          providerId={agent.agentId}
          size={16}
          className={cn("shrink-0", agent.running ? "text-success" : "text-text-lighter")}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-text text-xs">
          {getDisplayTitle(agent.title)}
        </span>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "shrink-0",
            pinned ? "text-accent opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation();
            togglePinnedChat(agent.chatId);
          }}
          tooltip={pinned ? "Unpin" : "Pin"}
          aria-label={pinned ? "Unpin chat" : "Pin chat"}
        >
          <PushPin className="size-3.5" weight={pinned ? "fill" : "regular"} />
        </Button>
      </div>
    );
  };

  return (
    <SidebarPanel>
      <SidebarHeader>
        <SidebarHeaderSearch
          value={searchQuery}
          onChange={setSearchQuery}
          leftIcon={Search}
          placeholder="Search"
        />
        <AgentSelector
          variant="header"
          onSelectAgent={createAgentChat}
          triggerTooltip="New agent"
          triggerClassName="border border-border/80 border-dashed bg-transparent hover:border-border hover:bg-hover"
        />
      </SidebarHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {filteredChats.length === 0 ? (
          <SidebarEmptyActionState
            className="h-full min-h-[180px]"
            message={
              <>
                <span className="block text-text">
                  {searchQuery ? "No matching agents" : "No agent history"}
                </span>
                <span className="mt-1 block text-xs">
                  {searchQuery ? "Try another search." : "Start a new agent chat."}
                </span>
              </>
            }
          >
            {!searchQuery ? (
              <AgentSelector
                variant="header"
                onSelectAgent={createAgentChat}
                triggerTooltip="New agent"
                triggerClassName="border border-border/80 border-dashed bg-transparent hover:border-border hover:bg-hover"
              />
            ) : null}
          </SidebarEmptyActionState>
        ) : (
          <div className="flex flex-col gap-2">
            {pinnedChats.length > 0 ? (
              <section className="flex flex-col gap-1">
                <div className="px-2 text-[10px] font-medium uppercase tracking-wide text-text-lighter">
                  Pinned
                </div>
                <div className="flex flex-col gap-1">{pinnedChats.map(renderChatRow)}</div>
              </section>
            ) : null}

            {historyChats.length > 0
              ? (() => {
                  const isOpen = searchQuery.trim() ? true : (openGroups[workspaceKey] ?? true);
                  const hasHiddenHistory = historyChats.length > visibleSessionCount;
                  const canShowLess = visibleSessionCount > INITIAL_VISIBLE_SESSIONS;

                  return (
                    <section className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => toggleGroup(workspaceKey)}
                        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-left text-text-lighter text-xs hover:bg-hover/50 hover:text-text"
                      >
                        <CaretRight
                          className={cn(
                            "size-3 shrink-0 transition-transform",
                            isOpen && "rotate-90",
                          )}
                          weight="bold"
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {workspaceLabel}
                        </span>
                      </button>
                      {isOpen ? (
                        <div className="flex flex-col gap-1">
                          {visibleHistoryChats.map(renderChatRow)}
                          {hasHiddenHistory || canShowLess ? (
                            <div className="flex items-center gap-1 px-1.5 pt-0.5">
                              {hasHiddenHistory ? (
                                <Button
                                  ref={chatHistoryTriggerRef}
                                  type="button"
                                  variant="ghost"
                                  onClick={showMoreHistory}
                                  className="h-6 px-1.5 text-[11px] text-text-lighter hover:text-text"
                                  compact
                                >
                                  {visibleSessionCount < EXPANDED_VISIBLE_SESSIONS
                                    ? "Show more"
                                    : "Open chat history"}
                                </Button>
                              ) : null}
                              {canShowLess ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => setVisibleSessionCount(INITIAL_VISIBLE_SESSIONS)}
                                  className="h-6 px-1.5 text-[11px] text-text-lighter hover:text-text"
                                >
                                  Show less
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  );
                })()
              : null}
          </div>
        )}
      </div>

      <ContextMenu
        isOpen={agentContextMenu.isOpen}
        position={agentContextMenu.position}
        items={contextMenuItems}
        onClose={agentContextMenu.close}
      />
      <ChatHistoryDropdown
        isOpen={isChatHistoryOpen}
        onClose={() => setIsChatHistoryOpen(false)}
        chats={sortedChatsForHistory}
        currentChatId={currentChatId}
        onSwitchToChat={openChat}
        onDeleteChat={(chatId, event) => {
          event.stopPropagation();
          deleteChat(chatId);
        }}
        triggerRef={chatHistoryTriggerRef}
      />
    </SidebarPanel>
  );
}
