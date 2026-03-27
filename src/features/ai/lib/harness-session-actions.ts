export function pickContinueRecentRuntimeSession<T extends { path: string; isCurrent: boolean }>(
  sessions: T[],
): T | null {
  return sessions.find((session) => !session.isCurrent) ?? null;
}
