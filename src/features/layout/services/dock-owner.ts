import { normalizeProjectTabPath } from "@/features/workspace/services/project-tab-path";
import type { DockOwner } from "../types/dock.types";

interface DockOwnerInput {
  /**
   * The session in front: the one whose tab set the centre shows (even while one of its files is
   * the tab in front), or the one whose tab is in front.
   */
  activeSessionId: string | null;
  projectPath: string | null | undefined;
}

/**
 * Whose tools the dock shows: the session in front, else the project; without a project there is
 * no dock. A file opened from a session's tools joins the session's tab set, so the dock stays.
 */
export function resolveDockOwner({
  activeSessionId,
  projectPath,
}: DockOwnerInput): DockOwner | null {
  if (activeSessionId) return { kind: "session", id: activeSessionId };
  return projectPath ? { kind: "project", id: normalizeProjectTabPath(projectPath) } : null;
}
