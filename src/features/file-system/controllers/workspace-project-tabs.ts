export interface WorkspaceProjectTabCandidate {
  id: string;
}

export interface WorkspaceProjectSwitchActions {
  getProjectTabs: () => WorkspaceProjectTabCandidate[];
  setActiveProjectTab: (projectId: string) => void;
  removeProjectTab: (projectId: string) => void;
  resetWorkspace: () => Promise<void> | void;
  switchToProject: (projectId: string) => Promise<boolean>;
}

export async function switchToNextAvailableProjectAfterClose(
  initialProjectId: string,
  actions: WorkspaceProjectSwitchActions,
) {
  const attemptedProjectIds = new Set<string>();
  let nextProjectId: string | undefined = initialProjectId;

  while (nextProjectId && !attemptedProjectIds.has(nextProjectId)) {
    attemptedProjectIds.add(nextProjectId);

    if (await actions.switchToProject(nextProjectId)) {
      return true;
    }

    nextProjectId = actions
      .getProjectTabs()
      .find((projectTab) => !attemptedProjectIds.has(projectTab.id))?.id;

    if (nextProjectId) {
      actions.setActiveProjectTab(nextProjectId);
    }
  }

  const projectIdsToRemove = actions.getProjectTabs().map((projectTab) => projectTab.id);

  for (const projectTabId of projectIdsToRemove) {
    actions.removeProjectTab(projectTabId);
  }

  await actions.resetWorkspace();
  return false;
}
