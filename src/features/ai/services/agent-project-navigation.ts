import { findAgentSessionProject } from "@/features/ai/lib/agent-project-groups";
import { openAgentHistoryChat } from "@/features/ai/services/open-agent-history";
import { openNewAgentChat } from "@/features/ai/services/open-new-agent-chat";
import type { OutsideAgentSession } from "@/features/ai/services/outside-agent-sessions";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";

/**
 * Runs `open` with `projectId` as the active project. Agent tabs, their agent process and the
 * files they touch all belong to one project's workspace, so a session from another project is
 * opened by switching to that project, which keeps every project's agents running. Runs at once
 * when the project is already active or unknown; resolves null when the switch fails.
 */
function inProject<T>(projectId: string | null | undefined, open: () => T): T | Promise<T | null> {
  const isOpenProject = useWorkspaceTabsStore
    .getState()
    .projectTabs.some((project) => project.id === projectId);
  if (
    !projectId ||
    !isOpenProject ||
    workspaceRuntimeRegistry.getActiveWorkspaceId() === projectId
  ) {
    return open();
  }
  return useFileSystemStore
    .getState()
    .switchToProject(projectId)
    .then((switched) => (switched ? open() : null));
}

/** Opens an agent session from any open project, switching to its project first. */
export function openAgentSession(chatId: string) {
  const chat = useAIChatStore.getState().chats.find((candidate) => candidate.id === chatId);
  const project = chat
    ? findAgentSessionProject(chat, useWorkspaceTabsStore.getState().projectTabs)
    : null;
  return inProject(project?.id, () => openAgentHistoryChat(chatId));
}

/** Imports an outside agent session into `projectId` and opens it, switching there first. */
export function openOutsideAgentSession(
  projectId: string,
  projectPath: string,
  session: OutsideAgentSession,
) {
  return inProject(projectId, async () => {
    const { importOutsideAgentSession } =
      await import("@/features/ai/services/outside-agent-sessions");
    return importOutsideAgentSession(session, projectPath);
  });
}

/** Opens `projectId`'s dashboard, switching to the project first. */
export function openProjectDashboard(projectId: string) {
  const project = useWorkspaceTabsStore
    .getState()
    .projectTabs.find((candidate) => candidate.id === projectId);
  if (!project) return null;
  return inProject(projectId, async () => {
    const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
    return useBufferStore.getState().actions.openContent({
      type: "projectDashboard",
      projectPath: project.path,
      name: project.name,
    });
  });
}

/** Opens a new agent session that belongs to no project. */
export function startProjectlessChat(agentId?: AgentType) {
  return openNewAgentChat(agentId, { workspacePath: null });
}

/** Opens a new agent session in `projectId`, the active project by default. */
export function startAgentInProject(projectId: string | null | undefined, agentId?: AgentType) {
  return inProject(projectId, () => openNewAgentChat(agentId));
}
