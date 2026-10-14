import { WELCOME_WORKSPACE_ID } from "@/features/workspace/types/workspace-runtime.types";

const MAX_CACHED_WORKSPACES = 3;

/** The most recently used workspaces that stay mounted, newest first, up to the cache limit. */
export function selectRecentWorkspaceIds(
  candidateIds: readonly string[],
  eligibleWorkspaceIds: readonly string[],
): string[] {
  return candidateIds
    .filter(
      (workspaceId, index, workspaceIds) =>
        workspaceId !== WELCOME_WORKSPACE_ID &&
        eligibleWorkspaceIds.includes(workspaceId) &&
        workspaceIds.indexOf(workspaceId) === index,
    )
    .slice(0, MAX_CACHED_WORKSPACES);
}

/**
 * The workspaces whose views stay mounted: the recent ones up to the cache limit, plus any the
 * caller must keep alive past it. Unmounting a workspace drops its live views, so one with an
 * agent mid-turn would come back without the timeline it was showing.
 */
export function selectMountedWorkspaceIds({
  activeWorkspaceId,
  recentWorkspaceIds,
  eligibleWorkspaceIds,
  keepMountedWorkspaceIds,
}: {
  activeWorkspaceId: string;
  recentWorkspaceIds: readonly string[];
  eligibleWorkspaceIds: readonly string[];
  keepMountedWorkspaceIds: readonly string[];
}): string[] {
  const recent = selectRecentWorkspaceIds(
    [activeWorkspaceId, ...recentWorkspaceIds, ...eligibleWorkspaceIds],
    eligibleWorkspaceIds,
  );
  const kept = keepMountedWorkspaceIds.filter(
    (workspaceId) =>
      workspaceId !== WELCOME_WORKSPACE_ID &&
      eligibleWorkspaceIds.includes(workspaceId) &&
      !recent.includes(workspaceId),
  );
  return [...recent, ...kept];
}
