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
  /** Sessions started in the project, pinned first, then most recent. */
  chats: ChatSession[];
  /** Cloud runs on the project's repository that have no session here yet. */
  cloudRuns: CloudAgentRun[];
}

export interface SidebarSessions {
  byProject: Record<string, SidebarProjectSessions>;
  /** Cloud sessions and runs that belong to no open project. */
  otherChats: ChatSession[];
  otherRuns: CloudAgentRun[];
  archived: ChatSession[];
}

const EMPTY_RUNS: CloudAgentRun[] = [];

/**
 * Every open project's agent sessions for the workbench sidebar, grouped by project in the order
 * the projects are open, with the cloud runs that have no session yet.
 */
export function useSidebarSessions(): SidebarSessions {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const aiEnabled = useSettingsStore((state) => state.settings.coreFeatures.aiChat);
  const cloud = useCloudSidebarEntries(chats, projectTabs);

  return useMemo(() => {
    if (!aiEnabled) return { byProject: {}, otherChats: [], otherRuns: [], archived: [] };
    const active = selectAgentSessions(chats, { anyWorkspace: true, keepIds: [currentChatId] });
    const groups = groupAgentSessionsByProject(active, projectTabs);
    return {
      byProject: Object.fromEntries(
        groups.map((group) => [
          group.project.id,
          {
            projectId: group.project.id,
            chats: group.chats,
            cloudRuns: cloud.runsByProject[group.project.id] ?? EMPTY_RUNS,
          },
        ]),
      ),
      otherChats: cloud.otherChats,
      otherRuns: cloud.otherRuns,
      archived: selectAgentSessions(chats, { anyWorkspace: true, includeArchived: "only" }),
    };
  }, [aiEnabled, chats, cloud, currentChatId, projectTabs]);
}
