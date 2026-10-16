import { normalizeProjectTabPath } from "@/features/workspace/services/project-tab-path";
import type { DockOwner } from "../types/dock.types";

interface DockOwnerInput {
  /** The session of the buffer in front, when it is an agent session. */
  activeSessionId: string | null;
  /** Sessions with a tab open in the project. */
  openSessionIds: readonly string[];
  /** The session the project's dock followed last, or null once the project's view was chosen. */
  stickySessionId: string | null | undefined;
  projectPath: string | null | undefined;
}

/**
 * Whose tools the dock shows. The session in front owns it; a session the user left for a file
 * keeps it while its tab stays open, so a file opened from the session's tools does not swap the
 * dock away. Otherwise the project owns it, and without a project there is no dock.
 */
export function resolveDockOwner({
  activeSessionId,
  openSessionIds,
  stickySessionId,
  projectPath,
}: DockOwnerInput): DockOwner | null {
  if (activeSessionId) return { kind: "session", id: activeSessionId };
  if (stickySessionId && openSessionIds.includes(stickySessionId)) {
    return { kind: "session", id: stickySessionId };
  }
  return projectPath ? { kind: "project", id: normalizeProjectTabPath(projectPath) } : null;
}
