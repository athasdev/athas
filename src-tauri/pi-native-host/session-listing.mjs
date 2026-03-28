import { SessionManager } from "@mariozechner/pi-coding-agent";

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeSessionInfo(session) {
  return {
    path: session.path,
    id: session.id,
    cwd: session.cwd,
    name: session.name ?? null,
    parentSessionPath: session.parentSessionPath ?? null,
    createdAt: toIsoString(session.created),
    modifiedAt: toIsoString(session.modified),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
  };
}

export function sortAndSerializeSessions(sessions) {
  return [...sessions]
    .sort((left, right) => right.modified.getTime() - left.modified.getTime())
    .map(serializeSessionInfo);
}

export function resolveSessionPathForStart({
  requestedPath,
  bootstrapConversationHistory,
  sessions,
  reuseLatestSession = true,
}) {
  if (requestedPath) {
    return requestedPath;
  }

  if (Array.isArray(bootstrapConversationHistory) && bootstrapConversationHistory.length > 0) {
    return null;
  }

  if (!reuseLatestSession) {
    return null;
  }

  return sessions[0]?.path ?? null;
}

export async function listSessionsForWorkspace(cwd, sessionDir) {
  const sessions = await SessionManager.list(cwd, sessionDir);
  return sortAndSerializeSessions(sessions);
}
