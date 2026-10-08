import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getQueryErrorMessage, refetchAfterMutation } from "@/utils/query-client";
import {
  dockerComposeProjectQuery,
  dockerKeys,
  dockerProjectConfigQuery,
} from "../services/docker-queries";
import type { DockerComposeProject, DockerProjectConfig } from "../types/docker.types";

const emptyComposeProject: DockerComposeProject = {
  workspacePath: null,
  files: [],
  services: [],
};
const emptyProjectConfig: DockerProjectConfig = {
  workspacePath: null,
  buildPresets: [],
  runPresets: [],
  composePresets: [],
  debugPresets: [],
  workspaceDebugPresets: [],
  envFiles: [],
  devContainers: [],
};

interface WorkspaceError {
  workspacePath: string | null;
  message: string;
}

/**
 * Compose services and Docker presets of the open workspace. Data and action errors are kept per
 * workspace, so after a switch nothing from the previous workspace is shown or overwritten by a
 * response that arrives late.
 */
export function useDockerWorkspaceProject(workspacePath: string | null) {
  const queryClient = useQueryClient();
  const composeQuery = useQuery(dockerComposeProjectQuery(workspacePath));
  const projectConfigQuery = useQuery(dockerProjectConfigQuery(workspacePath));
  const [composeActionError, setComposeActionError] = useState<WorkspaceError | null>(null);
  const [projectConfigActionError, setProjectConfigActionError] = useState<WorkspaceError | null>(
    null,
  );

  const forWorkspace = (error: WorkspaceError | null) =>
    error && error.workspacePath === workspacePath ? error.message : null;

  const loadComposeProject = useCallback(
    () => refetchAfterMutation(queryClient, dockerKeys.compose(workspacePath)),
    [queryClient, workspacePath],
  );
  const loadProjectConfig = useCallback(
    () => refetchAfterMutation(queryClient, dockerKeys.projectConfig(workspacePath)),
    [queryClient, workspacePath],
  );
  const storeProjectConfig = useCallback(
    (savedWorkspacePath: string, config: DockerProjectConfig) => {
      queryClient.setQueryData(dockerKeys.projectConfig(savedWorkspacePath), config);
    },
    [queryClient],
  );
  const setComposeError = useCallback(
    (message: string | null) =>
      setComposeActionError(message === null ? null : { workspacePath, message }),
    [workspacePath],
  );
  const setProjectConfigError = useCallback(
    (message: string | null) =>
      setProjectConfigActionError(message === null ? null : { workspacePath, message }),
    [workspacePath],
  );

  return {
    composeProject: composeQuery.data ?? emptyComposeProject,
    projectConfig: projectConfigQuery.data ?? emptyProjectConfig,
    isComposeLoading: composeQuery.isLoading,
    isComposeRefreshing: composeQuery.isFetching,
    isProjectConfigLoading: projectConfigQuery.isLoading,
    isProjectConfigRefreshing: projectConfigQuery.isFetching,
    composeError: forWorkspace(composeActionError) ?? getQueryErrorMessage(composeQuery.error),
    projectConfigError:
      forWorkspace(projectConfigActionError) ?? getQueryErrorMessage(projectConfigQuery.error),
    loadComposeProject,
    loadProjectConfig,
    storeProjectConfig,
    setComposeError,
    setProjectConfigError,
  };
}
