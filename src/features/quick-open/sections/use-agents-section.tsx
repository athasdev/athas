import { useEffect, useMemo } from "react";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAgentDisplayNames } from "@/features/ai/hooks/use-agent-display-names";
import { resolveAgentSessionIconId } from "@/features/ai/lib/agent-session-icon";
import { selectAgentSessions } from "@/features/ai/lib/agent-session-list";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";
import { openNewAgentChat } from "@/features/ai/lib/open-new-agent-chat";
import { useAgentCatalogStore } from "@/features/ai/stores/agent-catalog.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { CommandEmpty, CommandItemBadge } from "@/ui/command";
import { PinIcon } from "@/ui/icons";
import { formatCompactRelativeDate } from "@/utils/date";
import { matchesSearchQuery } from "@/utils/search-match";
import type {
  QuickOpenItem,
  QuickOpenSectionInput,
  QuickOpenSectionResult,
} from "../types/quick-open.types";

const CHAT_LIMIT = 100;

/** Agent chats of this workspace, and the installed agents to start a new one with. */
export function useAgentsSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const chats = useAIChatStore((state) => (isActive ? state.chats : null));
  const { options: agentOptions, getName, getIcon } = useAgentDisplayNames();

  useEffect(() => {
    if (isActive) void useAgentCatalogStore.getState().actions.refresh();
  }, [isActive]);

  const items = useMemo((): QuickOpenItem[] => {
    if (!chats) return [];

    const sessions = selectAgentSessions(chats, { workspacePath: rootFolderPath ?? undefined })
      .filter((chat) => matchesSearchQuery(query, [chat.title, getName(chat.agentId), chat.branch]))
      .slice(0, CHAT_LIMIT)
      .map((chat): QuickOpenItem => ({
        key: `chat:${chat.id}`,
        group: "Chats",
        icon: (
          <ProviderIcon
            providerId={resolveAgentSessionIconId(chat)}
            iconUrl={getIcon(chat.agentId)}
          />
        ),
        title: <SearchMatchHighlight text={chat.title || "New Session"} query={query} />,
        description: [
          getName(chat.agentId),
          chat.branch,
          formatCompactRelativeDate(chat.lastMessageAt),
        ]
          .filter(Boolean)
          .join(" · "),
        accessory: chat.isPinned ? <PinIcon className="text-muted-foreground" /> : undefined,
        select: () => {
          close();
          openAgentHistoryChat(chat.id);
        },
      }));

    const newChats = agentOptions
      .filter((option) => option.isInstalled && !option.needsSetup)
      .filter((option) => matchesSearchQuery(query, [option.name, "new", "start", "chat"]))
      .map((option): QuickOpenItem => ({
        key: `new:${option.id}`,
        group: "Start a chat",
        icon: <ProviderIcon providerId={option.id} iconUrl={option.icon} />,
        title: (
          <>
            New chat with <SearchMatchHighlight text={option.name} query={query} />
          </>
        ),
        description: option.description,
        accessory: option.isCurrent ? <CommandItemBadge>Current</CommandItemBadge> : undefined,
        select: () => {
          close();
          openNewAgentChat(option.id);
        },
      }));

    // With a query the matching chats matter most; without one, starting a chat is a key away.
    return query.trim() ? [...sessions, ...newChats] : [...newChats, ...sessions];
  }, [agentOptions, chats, close, getIcon, getName, query, rootFolderPath]);

  const chatCount = items.filter((item) => item.group === "Chats").length;

  return {
    items,
    isLoading: false,
    summary: `${chatCount} ${chatCount === 1 ? "chat" : "chats"}`,
    empty: (
      <CommandEmpty>{query ? "No matching chats or agents" : "No agent chats yet"}</CommandEmpty>
    ),
  };
}
