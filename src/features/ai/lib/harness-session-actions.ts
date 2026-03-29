import { getPreferredHarnessEntryBackend } from "./harness-entry-backend";
import type { HarnessRuntimeBackend } from "./harness-runtime-backend";

export function pickContinueRecentRuntimeSession<T extends { path: string; isCurrent: boolean }>(
  sessions: T[],
): T | null {
  return sessions.find((session) => !session.isCurrent) ?? null;
}

export function createNewHarnessSession(
  createAgentBuffer: (options?: { backend?: HarnessRuntimeBackend }) => void | string,
  preferredPiBackend: HarnessRuntimeBackend = "pi-native",
): void | string {
  return createAgentBuffer({
    backend: getPreferredHarnessEntryBackend(undefined, preferredPiBackend),
  });
}
