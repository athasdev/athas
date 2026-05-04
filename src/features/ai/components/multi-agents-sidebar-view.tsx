import {
  CaretRight,
  DotsThreeVertical,
  MagnifyingGlass as Search,
  PushPin,
} from "@phosphor-icons/react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { AgentSelector } from "@/features/ai/components/selectors/agent-selector";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AcpAgentStatus, AcpSessionInfo } from "@/features/ai/types/acp";
import { AGENT_OPTIONS, type AgentType, type Chat } from "@/features/ai/types/ai-chat";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useProjectStore } from "@/features/window/stores/project-store";
import { Button } from "@/ui/button";
import { ContextMenu, type ContextMenuItem, useContextMenu } from "@/ui/context-menu";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";

const PINNED_AGENT_CHATS_KEY = "athas:multi-agents-sidebar:pinned-chats";

interface SidebarAgentChat {
  agentId: AgentType;
  chatId: string;
  title: string;
  lastMessageAt: Date;
  running: boolean;
  remoteSessionId?: string;
  remoteOnly?: boolean;
}

interface ChatGroup {
  key: string;
  label: string;
  chats: SidebarAgentChat[];
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

function getDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getDayLabel(date: Date) {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayStart.getTime() - dateStart.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: today.getFullYear() === date.getFullYear() ? undefined : "numeric",
  }).format(date);
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

function groupChatsByDay(chats: SidebarAgentChat[]): ChatGroup[] {
  const groups = new Map<string, ChatGroup>();

  for (const chat of chats) {
    const key = getDayKey(chat.lastMessageAt);
    const existing = groups.get(key);
    if (existing) {
      existing.chats.push(chat);
    } else {
      groups.set(key, {
        key,
        label: getDayLabel(chat.lastMessageAt),
        chats: [chat],
      });
    }
  }

  return Array.from(groups.values());
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
  const agentContextMenu = useContextMenu<SidebarAgentChat>();
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(() => readPinnedChatIds());
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [remoteSessions, setRemoteSessions] = useState<AcpSessionInfo[]>([]);

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
      const agentInfo = AGENT_OPTIONS.find((agent) => agent.id === chat.agentId);
      return (
        getDisplayTitle(chat.title).toLowerCase().includes(query) ||
        chat.agentId.toLowerCase().includes(query) ||
        agentInfo?.name.toLowerCase().includes(query)
      );
    });
  }, [deferredSearchQuery, sidebarChats]);

  const pinnedChats = useMemo(
    () => filteredChats.filter((chat) => pinnedChatIds.has(chat.chatId)),
    [filteredChats, pinnedChatIds],
  );

  const groupedHistory = useMemo(
    () => groupChatsByDay(filteredChats.filter((chat) => !pinnedChatIds.has(chat.chatId))),
    [filteredChats, pinnedChatIds],
  );

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

      const agentInfo = AGENT_OPTIONS.find((agent) => agent.id === agentId);
      if (agentInfo?.isAcp) {
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

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const agent = agentContextMenu.data;
    if (!agent) return [];

    const agentInfo = AGENT_OPTIONS.find((item) => item.id === agent.agentId);
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
        label: `New ${agentInfo?.name ?? "Agent"} Chat`,
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
          size="icon-xs"
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
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 opacity-0 group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            agentContextMenu.open(event, agent);
          }}
          tooltip="Agent actions"
          aria-label="Agent actions"
        >
          <DotsThreeVertical className="size-3.5" weight="bold" />
        </Button>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <div className="flex h-8 shrink-0 items-center gap-1.5 px-1.5 pt-1">
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          leftIcon={Search}
          variant="ghost"
          size="xs"
          placeholder="Search"
          className="h-6 rounded-md border-transparent bg-transparent text-xs"
          containerClassName="min-w-0 flex-1"
        />
        <AgentSelector
          variant="header"
          onSelectAgent={createAgentChat}
          triggerTooltip="New agent"
          triggerClassName="border border-border/80 border-dashed bg-transparent hover:border-border hover:bg-hover"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {filteredChats.length === 0 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 px-4 text-center">
            <div>
              <div className="font-medium text-sm text-text">
                {searchQuery ? "No matching agents" : "No agent history"}
              </div>
              <div className="mt-1 text-text-lighter text-xs">
                {searchQuery ? "Try another search." : "Start a new agent chat."}
              </div>
            </div>
            {!searchQuery ? (
              <AgentSelector
                variant="header"
                onSelectAgent={createAgentChat}
                triggerTooltip="New agent"
                triggerClassName="border border-border/80 border-dashed bg-transparent hover:border-border hover:bg-hover"
              />
            ) : null}
          </div>
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

            {groupedHistory.map((group, index) => {
              const isOpen = searchQuery.trim() ? true : (openGroups[group.key] ?? index < 2);

              return (
                <section key={group.key} className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex h-6 items-center gap-1 rounded-md px-1.5 text-left text-text-lighter text-xs hover:bg-hover/50 hover:text-text"
                  >
                    <CaretRight
                      className={cn("size-3 shrink-0 transition-transform", isOpen && "rotate-90")}
                      weight="bold"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
                    <span className="shrink-0 text-[10px] tabular-nums">{group.chats.length}</span>
                  </button>
                  {isOpen ? (
                    <div className="flex flex-col gap-1">{group.chats.map(renderChatRow)}</div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <ContextMenu
        isOpen={agentContextMenu.isOpen}
        position={agentContextMenu.position}
        items={contextMenuItems}
        onClose={agentContextMenu.close}
      />
    </div>
  );
}
