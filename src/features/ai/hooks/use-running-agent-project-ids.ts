import { useShallow } from "zustand/react/shallow";
import { selectProjectsWithRunningAgents } from "@/features/ai/lib/agent-project-groups";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";

/** Ids of the open projects where an agent is mid-turn. */
export function useRunningAgentProjectIds(): string[] {
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  return useAIChatStore(
    useShallow((state) =>
      selectProjectsWithRunningAgents(projectTabs, state.chats, Object.keys(state.agentRuns)),
    ),
  );
}
