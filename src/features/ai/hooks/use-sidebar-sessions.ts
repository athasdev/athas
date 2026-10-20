import { useMemo } from "react";
import { groupAgentSessionsByProject } from "@/features/ai/lib/agent-project-groups";
import { selectAgentSessions } from "@/features/ai/services/agent-session-list";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import { useCloudSidebarEntries } from "@/features/ai/cloud-agents/hooks/use-cloud-sidebar-entries";
import type { CloudAgentRun } from "@/features/ai/cloud-agents/services/cloud-agents-api";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";

export interface SidebarProjectSessions {
  projectId: string;
  /** Sessions started in the project and not pinned, most recent first. */
  chats: ChatSession[];
  /** Cloud runs on the project's repository that have no session here yet. */
  cloudRuns: CloudAgentRun[];
}

export interface SidebarSessions {
  /** Pinned sessions of every project, open or not, most recent first. */
  pinned: ChatSession[];
  byProject: Record<string, SidebarProjectSessions>;
  /** Local sessions of no project or of a project that is not open, most recent first. */
  chats: ChatSession[];
  /** Cloud sessions and runs that belong to no open project. */
  otherChats: ChatSession[];
  otherRuns: CloudAgentRun[];
  archived: ChatSession[];
}

const EMPTY_RUNS: CloudAgentRun[] = [];

const isUnpinned = (chat: ChatSession) => !chat.isPinned;

/**
 * Every agent session for the workbench sidebar: grouped by open project in the order the projects
 * are open, with the cloud runs that have no session yet, and the rest under Chats. Pinned
 * sessions leave their project for a list of their own.
 */
export function useSidebarSessions(): SidebarSessions {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const aiEnabled = useSettingsStore((state) => state.settings.coreFeatures.aiChat);
  const cloud = useCloudSidebarEntries(chats, projectTabs);

  return useMemo(() => {
    if (!aiEnabled) {
      return { pinned: [], byProject: {}, chats: [], otherChats: [], otherRuns: [], archived: [] };
    }
    const active = selectAgentSessions(chats, { anyWorkspace: true, keepIds: [currentChatId] });
    const groups = groupAgentSessionsByProject(active, projectTabs);
    const listed = new Set([...groups.flatMap((group) => group.chats), ...cloud.otherChats]);
    return {
      pinned: active.filter((chat) => chat.isPinned),
      byProject: Object.fromEntries(
        groups.map((group) => [
          group.project.id,
          {
            projectId: group.project.id,
            chats: group.chats.filter(isUnpinned),
            cloudRuns: cloud.runsByProject[group.project.id] ?? EMPTY_RUNS,
          },
        ]),
      ),
      chats: active.filter((chat) => isUnpinned(chat) && !listed.has(chat)),
      otherChats: cloud.otherChats.filter(isUnpinned),
      otherRuns: cloud.otherRuns,
      archived: selectAgentSessions(chats, { anyWorkspace: true, includeArchived: "only" }),
    };
  }, [aiEnabled, chats, cloud, currentChatId, projectTabs]);
}
