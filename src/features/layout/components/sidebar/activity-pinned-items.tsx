import { useMemo } from "react";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useGitStore } from "@/features/git/stores/git.store";
import { ActivityAgentRow } from "@/features/layout/components/sidebar/activity-agent-history";
import { ActivityTerminalRow } from "@/features/layout/components/sidebar/activity-terminal-history";
import { useActivityTerminalItems } from "@/features/layout/hooks/use-activity-terminal-items";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { SidebarSectionLabel, SidebarSectionStack } from "@/ui/sidebar";

export function ActivityPinnedItems({
  workspacePath,
  showAgents,
  showTerminals,
}: {
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
  const pinnedTerminals = useActivityTerminalItems({
    pinned: true,
    enabled: showTerminals,
  });

  const pinnedChats = useMemo(
    () =>
      showAgents
        ? filterChatsByWorkspace(chats, workspacePath)
            .filter((chat) => !chat.archivedAt && chat.isPinned)
            .sort((left, right) => right.lastMessageAt.getTime() - left.lastMessageAt.getTime())
        : [],
    [chats, showAgents, workspacePath],
  );
  if (pinnedChats.length === 0 && pinnedTerminals.length === 0) {
    return null;
  }

  return (
    <SidebarSectionStack>
      <SidebarSectionLabel>Pinned</SidebarSectionLabel>
      {pinnedChats.map((chat) => (
        <ActivityAgentRow
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
      {pinnedTerminals.map((terminal) => (
        <ActivityTerminalRow key={terminal.id} {...terminal} />
      ))}
    </SidebarSectionStack>
  );
}
