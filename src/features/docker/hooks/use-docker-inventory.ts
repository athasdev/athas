import { useCallback, useMemo, useReducer } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { refetchAfterMutation } from "@/utils/query-client";
import { dockerInventoryQuery, dockerKeys } from "../services/docker-queries";
import type { DockerContainer, DockerInventory } from "../types/docker.types";
import { getDockerErrorMessage, isDockerConnectionError } from "../utils/docker-sidebar-utils";

const emptyDockerInventory: DockerInventory = {
  containers: [],
  images: [],
  volumes: [],
  networks: [],
};

export interface DockerInventoryState {
  selectedContainerId: string | null;
  /** A Docker action reported the daemon unreachable; holds until a newer inventory loads. */
  unavailable: { message: string; at: number } | null;
  error: string | null;
}

type DockerInventoryAction =
  | { type: "mark-unavailable"; message: string; at: number }
  | { type: "action-failed"; message: string }
  | { type: "clear-error" }
  | { type: "select-container"; containerId: string | null };

export const initialDockerInventoryState: DockerInventoryState = {
  selectedContainerId: null,
  unavailable: null,
  error: null,
};

export function dockerInventoryReducer(
  state: DockerInventoryState,
  action: DockerInventoryAction,
): DockerInventoryState {
  switch (action.type) {
    case "mark-unavailable":
      return { ...state, unavailable: { message: action.message, at: action.at }, error: null };
    case "action-failed":
      return { ...state, error: action.message };
    case "clear-error":
      return { ...state, error: null };
    case "select-container":
      return { ...state, selectedContainerId: action.containerId };
  }
}

/** Keeps a selection that still exists, otherwise falls back to the first container. */
export function resolveSelectedContainerId(
  selectedContainerId: string | null,
  containers: DockerContainer[],
): string | null {
  if (selectedContainerId && containers.some((container) => container.id === selectedContainerId)) {
    return selectedContainerId;
  }
  return containers[0]?.id ?? null;
}

export function useDockerInventory() {
  const queryClient = useQueryClient();
  const query = useQuery(dockerInventoryQuery());
  const [state, dispatch] = useReducer(dockerInventoryReducer, initialDockerInventoryState);

  const unavailableMessage =
    state.unavailable && state.unavailable.at >= query.dataUpdatedAt
      ? state.unavailable.message
      : null;
  const connectionError = query.isError ? getDockerErrorMessage(query.error) : unavailableMessage;
  const inventory = connectionError ? emptyDockerInventory : (query.data ?? emptyDockerInventory);
  const selectedContainerId = resolveSelectedContainerId(
    state.selectedContainerId,
    inventory.containers,
  );

  // Refreshing after a Docker action cancels a load that started before it, so an older
  // response can never land after a newer one.
  const loadInventory = useCallback(
    () => refetchAfterMutation(queryClient, dockerKeys.inventory),
    [queryClient],
  );

  const markDockerUnavailable = useCallback((message: string) => {
    dispatch({ type: "mark-unavailable", message, at: Date.now() });
  }, []);

  const handleDockerFailure = useCallback(
    (failure: unknown) => {
      const message = getDockerErrorMessage(failure);
      if (isDockerConnectionError(message)) {
        markDockerUnavailable(message);
        return;
      }
      dispatch({ type: "action-failed", message });
    },
    [markDockerUnavailable],
  );

  const clearError = useCallback(() => {
    dispatch({ type: "clear-error" });
  }, []);

  const selectContainer = useCallback((containerId: string | null) => {
    dispatch({ type: "select-container", containerId });
  }, []);

  const selectedContainer = useMemo(
    () => inventory.containers.find((container) => container.id === selectedContainerId) ?? null,
    [inventory.containers, selectedContainerId],
  );

  return {
    inventory,
    selectedContainerId,
    selectedContainer,
    isLoading: query.isLoading,
    isRefreshing: query.isFetching,
    connectionError,
    error: state.error,
    loadInventory,
    markDockerUnavailable,
    handleDockerFailure,
    clearError,
    selectContainer,
  };
}
