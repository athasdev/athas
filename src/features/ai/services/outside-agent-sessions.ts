import { commands } from "@/bindings/commands";
import { startCodexIntegration } from "@/features/ai/integrations/codex/codex-account-api";
import { normalizeCodexThreads } from "@/features/ai/integrations/codex/codex-composer-catalog";
import { codexThreadToMessages } from "@/features/ai/integrations/codex/codex-thread-history";
import { CLAUDE_ACP_AGENT_ID } from "@/features/ai/lib/claude-code";
import { importAgentSession } from "@/features/ai/lib/import-agent-session";
import { migrateLegacyAgentId } from "@/features/ai/services/agent-clis";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { openAgentHistoryChat } from "@/features/ai/services/open-agent-history";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentType, ChatSession } from "@/features/ai/types/ai-chat.types";

const CODEX_AGENT_ID = "codex";
const CODEX_THREAD_LIMIT = 50;

/** A conversation an agent keeps for a project that no Athas chat holds, such as a CLI run. */
export interface OutsideAgentSession {
  agentId: AgentType;
  sessionId: string;
  title: string;
  updatedAt: Date;
}

function validDate(value: Date): Date | null {
  return Number.isNaN(value.getTime()) ? null : value;
}

async function listClaudeSessions(projectPath: string): Promise<OutsideAgentSession[]> {
  const agents = await AcpStreamHandler.getAvailableAgents();
  if (!agents.some((agent) => agent.id === CLAUDE_ACP_AGENT_ID && agent.installed)) return [];
  await AcpStreamHandler.startAgent(CLAUDE_ACP_AGENT_ID, projectPath);
  const page = await AcpStreamHandler.listSessions({
    agentId: CLAUDE_ACP_AGENT_ID,
    workspacePath: projectPath,
    cwd: projectPath,
  });
  return page.sessions.flatMap((session) => {
    const updatedAt = validDate(new Date(session.updatedAt ?? ""));
    if (!updatedAt) return [];
    return [
      {
        agentId: CLAUDE_ACP_AGENT_ID,
        sessionId: session.sessionId,
        title: session.title?.trim() || "Claude session",
        updatedAt,
      },
    ];
  });
}

async function listCodexSessions(projectPath: string): Promise<OutsideAgentSession[]> {
  const status = await commands.getCodexStatus();
  if (!status.installed) return [];
  await startCodexIntegration(projectPath);
  const threads = normalizeCodexThreads(
    await commands.listCodexThreads(projectPath, null, CODEX_THREAD_LIMIT),
  );
  return threads.flatMap((thread) => {
    const updatedAt = thread.updatedAt ? validDate(new Date(thread.updatedAt * 1000)) : null;
    if (!updatedAt) return [];
    return [
      {
        agentId: CODEX_AGENT_ID,
        sessionId: thread.id,
        title: thread.name?.trim() || thread.preview.trim().split("\n")[0] || "Codex thread",
        updatedAt,
      },
    ];
  });
}

/**
 * The Claude and Codex conversations kept for `projectPath`, newest first. An agent that is not
 * installed or cannot list its sessions adds nothing instead of failing the rest.
 */
export async function listOutsideAgentSessions(
  projectPath: string,
): Promise<OutsideAgentSession[]> {
  const results = await Promise.allSettled([
    listClaudeSessions(projectPath),
    listCodexSessions(projectPath),
  ]);
  const sessions: OutsideAgentSession[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") sessions.push(...result.value);
    else console.warn("Could not list agent sessions for", projectPath, result.reason);
  }
  return sessions.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

/** Leaves out the sessions an Athas chat already holds. */
export function withoutHeldSessions(
  sessions: readonly OutsideAgentSession[],
  chats: readonly Pick<ChatSession, "agentId" | "acpSessionId">[],
): OutsideAgentSession[] {
  const held = new Set(
    chats.flatMap((chat) =>
      chat.acpSessionId ? [`${migrateLegacyAgentId(chat.agentId)}:${chat.acpSessionId}`] : [],
    ),
  );
  return sessions.filter((session) => !held.has(`${session.agentId}:${session.sessionId}`));
}

async function importCodexThread(session: OutsideAgentSession, projectPath: string) {
  const { chats, actions } = useAIChatStore.getState();
  const existing = chats.find(
    (chat) => chat.agentId === CODEX_AGENT_ID && chat.acpSessionId === session.sessionId,
  );
  if (existing) return openAgentHistoryChat(existing.id);

  await startCodexIntegration(projectPath);
  const messages = codexThreadToMessages(await commands.readCodexThread(session.sessionId));
  const chatId = actions.createNewChat(CODEX_AGENT_ID, { activate: false });
  actions.setChatAcpSessionId(chatId, session.sessionId);
  actions.updateChatTitle(chatId, session.title);
  actions.replaceChatMessages(chatId, messages);
  return openAgentHistoryChat(chatId);
}

/**
 * Brings an outside session into Athas as a chat of the active project, with its history, and
 * opens it. A session a chat already holds opens that chat instead.
 */
export async function importOutsideAgentSession(
  session: OutsideAgentSession,
  projectPath: string,
): Promise<string> {
  if (session.agentId === CODEX_AGENT_ID) return importCodexThread(session, projectPath);
  return importAgentSession(session.agentId, {
    sessionId: session.sessionId,
    title: session.title,
    updatedAt: session.updatedAt.toISOString(),
  });
}
