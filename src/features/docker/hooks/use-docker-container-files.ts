import { useCallback, useEffect, useReducer, useRef } from "react";
import { listDockerContainerFiles } from "../services/docker-api";
import type { DockerContainerFileEntry } from "../types/docker.types";
import { getDockerErrorMessage } from "../utils/docker-sidebar-utils";

export interface DockerContainerFilesState {
  containerId: string | null;
  path: string;
  files: DockerContainerFileEntry[];
  isLoading: boolean;
  error: string | null;
}

export type DockerContainerFilesAction =
  | { type: "container-changed"; containerId: string | null }
  | { type: "path-changed"; path: string }
  | { type: "load-started" }
  | { type: "load-succeeded"; files: DockerContainerFileEntry[] }
  | { type: "load-failed"; error: string }
  | { type: "clear-error" }
  | { type: "operation-failed"; error: string };

export const initialDockerContainerFilesState: DockerContainerFilesState = {
  containerId: null,
  path: "/",
  files: [],
  isLoading: false,
  error: null,
};

export function dockerContainerFilesReducer(
  state: DockerContainerFilesState,
  action: DockerContainerFilesAction,
): DockerContainerFilesState {
  switch (action.type) {
    case "container-changed":
      return { ...initialDockerContainerFilesState, containerId: action.containerId };
    case "path-changed":
      return { ...state, path: action.path };
    case "load-started":
      return { ...state, isLoading: true, error: null };
    case "load-succeeded":
      return { ...state, files: action.files, isLoading: false };
    case "load-failed":
      return { ...state, files: [], isLoading: false, error: action.error };
    case "clear-error":
      return { ...state, error: null };
    case "operation-failed":
      return { ...state, error: action.error };
  }
}

export function useDockerContainerFiles(containerId: string | null, enabled: boolean) {
  const [state, dispatch] = useReducer(
    dockerContainerFilesReducer,
    initialDockerContainerFilesState,
  );
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    dispatch({ type: "container-changed", containerId });
  }, [containerId]);

  const loadFiles = useCallback(async () => {
    if (!containerId || state.containerId !== containerId) return;

    const requestId = ++requestIdRef.current;
    const requestedContainerId = containerId;
    dispatch({ type: "load-started" });
    try {
      const files = await listDockerContainerFiles(requestedContainerId, state.path);
      if (requestId !== requestIdRef.current) {
        return;
      }
      dispatch({ type: "load-succeeded", files });
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      dispatch({ type: "load-failed", error: getDockerErrorMessage(error) });
    }
  }, [containerId, state.containerId, state.path]);

  useEffect(() => {
    if (!enabled || !containerId || state.containerId !== containerId) return;
    void loadFiles();
  }, [containerId, enabled, loadFiles, state.containerId]);

  const setPath = useCallback((path: string) => {
    requestIdRef.current += 1;
    dispatch({ type: "path-changed", path });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "clear-error" });
  }, []);

  const reportError = useCallback((error: unknown) => {
    dispatch({ type: "operation-failed", error: getDockerErrorMessage(error) });
  }, []);

  return {
    ...state,
    loadFiles,
    setPath,
    clearError,
    reportError,
  };
}
