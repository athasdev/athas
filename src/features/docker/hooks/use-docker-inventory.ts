import { useCallback, useEffect, useMemo, useReducer } from "react";
import { getDockerInventory } from "../services/docker-api";
import type { DockerInventory } from "../types/docker.types";
import { getDockerErrorMessage, isDockerConnectionError } from "../utils/docker-sidebar-utils";

const emptyDockerInventory: DockerInventory = {
  containers: [],
  images: [],
  volumes: [],
  networks: [],
};

export interface DockerInventoryState {
  inventory: DockerInventory;
  selectedContainerId: string | null;
  isLoading: boolean;
  connectionError: string | null;
  error: string | null;
}

type DockerInventoryAction =
  | { type: "load-started" }
  | { type: "load-succeeded"; inventory: DockerInventory }
  | { type: "load-failed"; message: string }
  | { type: "mark-unavailable"; message: string }
  | { type: "action-failed"; message: string }
  | { type: "clear-error" }
  | { type: "select-container"; containerId: string | null };

export const initialDockerInventoryState: DockerInventoryState = {
  inventory: emptyDockerInventory,
  selectedContainerId: null,
  isLoading: true,
  connectionError: null,
  error: null,
};

export function dockerInventoryReducer(
  state: DockerInventoryState,
  action: DockerInventoryAction,
): DockerInventoryState {
  switch (action.type) {
    case "load-started":
      return { ...state, isLoading: true, error: null };
    case "load-succeeded": {
      const selectedContainerId =
        state.selectedContainerId &&
        action.inventory.containers.some((container) => container.id === state.selectedContainerId)
          ? state.selectedContainerId
          : (action.inventory.containers[0]?.id ?? null);
      return {
        ...state,
        inventory: action.inventory,
        selectedContainerId,
        isLoading: false,
        connectionError: null,
      };
    }
    case "load-failed":
      return {
        ...state,
        inventory: emptyDockerInventory,
        selectedContainerId: null,
        isLoading: false,
        connectionError: action.message,
      };
    case "mark-unavailable":
      return {
        ...state,
        inventory: emptyDockerInventory,
        selectedContainerId: null,
        connectionError: action.message,
        error: null,
      };
    case "action-failed":
      return { ...state, error: action.message };
    case "clear-error":
      return { ...state, error: null };
    case "select-container":
      return { ...state, selectedContainerId: action.containerId };
  }
}

export function useDockerInventory() {
  const [state, dispatch] = useReducer(dockerInventoryReducer, initialDockerInventoryState);

  const loadInventory = useCallback(async () => {
    dispatch({ type: "load-started" });
    try {
      dispatch({ type: "load-succeeded", inventory: await getDockerInventory() });
    } catch (loadError) {
      dispatch({ type: "load-failed", message: getDockerErrorMessage(loadError) });
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const markDockerUnavailable = useCallback((message: string) => {
    dispatch({ type: "mark-unavailable", message });
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
    () =>
      state.inventory.containers.find((container) => container.id === state.selectedContainerId) ??
      null,
    [state.inventory.containers, state.selectedContainerId],
  );

  return {
    ...state,
    selectedContainer,
    loadInventory,
    markDockerUnavailable,
    handleDockerFailure,
    clearError,
    selectContainer,
  };
}
