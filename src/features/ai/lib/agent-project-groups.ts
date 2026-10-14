import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import { areProjectTabPathsEqual } from "@/features/workspace/services/project-tab-path";

interface AgentProject {
  id: string;
  path: string;
}

export interface AgentProjectGroup<P extends AgentProject, T extends ChatSession> {
  project: P;
  chats: T[];
}

/** The open project a session was started in, if that project is still open. */
export function findAgentSessionProject<P extends AgentProject>(
  chat: Pick<ChatSession, "workspacePath">,
  projects: readonly P[],
): P | null {
  const path = chat.workspacePath;
  if (!path) return null;
  return projects.find((project) => areProjectTabPathsEqual(project.path, path)) ?? null;
}

/**
 * Splits sessions, already in display order, by the open project they belong to, in the order the
 * projects are open. Every open project gets a group, so each can start its first session; sessions
 * of projects that are no longer open are left out.
 */
export function groupAgentSessionsByProject<P extends AgentProject, T extends ChatSession>(
  chats: readonly T[],
  projects: readonly P[],
): AgentProjectGroup<P, T>[] {
  const groups = projects.map((project) => ({ project, chats: [] as T[] }));
  for (const chat of chats) {
    const project = findAgentSessionProject(chat, projects);
    if (!project) continue;
    groups.find((group) => group.project.id === project.id)?.chats.push(chat);
  }
  return groups;
}

/** Open projects with an agent turn in flight, which must stay mounted while they run. */
export function selectProjectsWithRunningAgents<P extends AgentProject>(
  projects: readonly P[],
  chats: readonly Pick<ChatSession, "id" | "workspacePath">[],
  runningChatIds: Iterable<string>,
): string[] {
  const running = new Set(runningChatIds);
  const ids = new Set<string>();
  for (const chat of chats) {
    if (!running.has(chat.id)) continue;
    const project = findAgentSessionProject(chat, projects);
    if (project) ids.add(project.id);
  }
  return projects.filter((project) => ids.has(project.id)).map((project) => project.id);
}
