import { useCallback, useMemo } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { AgentSelector } from "@/features/ai/components/selectors/agent-selector";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AcpAgentStatus } from "@/features/ai/types/acp";
import { AGENT_OPTIONS, type AgentType, type Chat } from "@/features/ai/types/ai-chat";
import { ContextMenu, type ContextMenuItem, useContextMenu } from "@/ui/context-menu";
import { Tabs } from "@/ui/tabs";
import { cn } from "@/utils/cn";

interface ActiveAgent {
  agentId: AgentType;
  chatId: string;
  title: string;
  running: boolean;
}

function isRunningChat(chat: Chat, status: AcpAgentStatus | null) {
  if (!status?.running || status.agentId !== chat.agentId) return false;
  if (status.sessionId && chat.acpSessionId) return status.sessionId === chat.acpSessionId;
  return useAIChatStore.getState().currentChatId === chat.id;
}

function getDisplayTitle(title: string) {
  return title && title !== "New Chat" ? title : "New chat";
}

function formatActiveTitle(title: string) {
  const value = getDisplayTitle(title);
  return value.length > 10 ? `${value.slice(0, 10)}...` : value;
}

export function MultiAgentPanel({ openSignal }: { openSignal?: number }) {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const activeAgentChatIds = useAIChatStore((state) => state.activeAgentChatIds);
  const acpStatus = useAIChatStore((state) => state.acpStatus);
  const setSelectedAgentId = useAIChatStore((state) => state.setSelectedAgentId);
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const registerActiveAgentChat = useAIChatStore((state) => state.registerActiveAgentChat);
  const setActiveAgentChatOrder = useAIChatStore((state) => state.setActiveAgentChatOrder);
  const switchToChat = useAIChatStore((state) => state.switchToChat);
  const deleteChat = useAIChatStore((state) => state.deleteChat);
  const updateChatTitle = useAIChatStore((state) => state.updateChatTitle);
  const agentContextMenu = useContextMenu<ActiveAgent>();

  const activeAgents = useMemo<ActiveAgent[]>(() => {
    const agents: ActiveAgent[] = [];

    const addChat = (chat: Chat) => {
      if (agents.some((agent) => agent.chatId === chat.id)) return;
      agents.push({
        agentId: chat.agentId,
        chatId: chat.id,
        title: chat.title,
        running: isRunningChat(chat, acpStatus),
      });
    };

    for (const chatId of activeAgentChatIds) {
      const chat = chats.find((item) => item.id === chatId);
      if (chat) {
        addChat(chat);
      }
    }

    const currentChat = chats.find((chat) => chat.id === currentChatId);
    if (currentChat) {
      addChat(currentChat);
    }

    return agents;
  }, [acpStatus, activeAgentChatIds, chats, currentChatId]);

  const createAgentChat = useCallback(
    (agentId: AgentType) => {
      setSelectedAgentId(agentId);
      const chatId = createNewChat(agentId);
      registerActiveAgentChat(chatId);

      const agentInfo = AGENT_OPTIONS.find((agent) => agent.id === agentId);
      if (agentInfo?.isAcp) {
        void AcpStreamHandler.warmup(agentId, chatId).catch((error) => {
          console.error(`Failed to prepare ${agentId} session:`, error);
        });
      }
    },
    [createNewChat, registerActiveAgentChat, setSelectedAgentId],
  );

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const agent = agentContextMenu.data;
    if (!agent) return [];

    const agentInfo = AGENT_OPTIONS.find((item) => item.id === agent.agentId);
    const selected = currentChatId === agent.chatId;
    const isUntitled = !agent.title || agent.title === "New Chat";

    return [
      {
        id: "switch",
        label: "Switch to Chat",
        disabled: selected,
        onClick: () => switchToChat(agent.chatId),
      },
      {
        id: "new-chat",
        label: `New ${agentInfo?.name ?? "Agent"} Chat`,
        onClick: () => createAgentChat(agent.agentId),
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
        label: "Close Chat",
        className: "text-error hover:!bg-error/10 hover:!text-error",
        onClick: () => deleteChat(agent.chatId),
      },
    ];
  }, [
    agentContextMenu.data,
    currentChatId,
    deleteChat,
    createAgentChat,
    switchToChat,
    updateChatTitle,
  ]);

  return (
    <div className="-mt-0.5 flex h-7 shrink-0 items-center justify-center bg-transparent px-2">
      <Tabs
        variant="pill"
        size="sm"
        reorderable
        onReorder={setActiveAgentChatOrder}
        className="max-w-full overflow-x-auto border-0 bg-transparent p-0"
        items={activeAgents.map((agent) => {
          const agentInfo = AGENT_OPTIONS.find((item) => item.id === agent.agentId);
          const selected = currentChatId === agent.chatId;
          const label = `${getDisplayTitle(agent.title)} - ${agentInfo?.name ?? agent.agentId}`;
          const activeTitle = formatActiveTitle(agent.title);

          return {
            id: agent.chatId,
            isActive: selected,
            onClick: () => switchToChat(agent.chatId),
            onContextMenu: (event) => agentContextMenu.open(event, agent),
            ariaLabel: `Switch to ${label}`,
            icon: (
              <ProviderIcon
                providerId={agent.agentId}
                size={16}
                className={cn(agent.running ? "text-success" : "text-text-lighter")}
              />
            ),
            label: selected ? (
              <span className="max-w-[78px] truncate text-xs text-text">{activeTitle}</span>
            ) : null,
            tooltip: {
              content: agent.running ? `${label} running` : label,
              side: "top" as const,
            },
            className: cn(
              "h-6 min-w-6 rounded-full px-1.5",
              selected && "gap-1.5 bg-hover/80 px-2 ring-1 ring-border/70",
              agent.running && !selected && "text-success hover:text-success",
              agent.running && selected && "text-success",
            ),
          };
        })}
      />

      <AgentSelector
        variant="header"
        onSelectAgent={createAgentChat}
        triggerTooltip="New agent"
        triggerClassName="border border-border/80 border-dashed bg-transparent hover:border-border hover:bg-hover"
        openSignal={openSignal}
      />

      <ContextMenu
        isOpen={agentContextMenu.isOpen}
        position={agentContextMenu.position}
        items={contextMenuItems}
        onClose={agentContextMenu.close}
      />
    </div>
  );
}
