import { useCallback, useReducer } from "react";
import {
  loginDockerRegistry,
  pullDockerRegistryImage,
  pushDockerRegistryImage,
  searchDockerRegistry,
  tagDockerImage,
} from "../services/docker-api";
import type { DockerRegistrySearchResult } from "../types/docker.types";
import { getDockerErrorMessage, isDockerConnectionError } from "../utils/docker-sidebar-utils";

export interface DockerRegistryDraft {
  registry: string;
  username: string;
  password: string;
  image: string;
  target: string;
}

export interface DockerRegistryState {
  query: string;
  results: DockerRegistrySearchResult[];
  error: string | null;
  output: string | null;
  isBusy: boolean;
  draft: DockerRegistryDraft;
}

export type DockerRegistryAction =
  | { type: "set-query"; query: string }
  | { type: "set-draft-field"; field: keyof DockerRegistryDraft; value: string }
  | { type: "search-started" }
  | { type: "search-succeeded"; results: DockerRegistrySearchResult[] }
  | { type: "search-failed"; error: string }
  | { type: "operation-started" }
  | { type: "operation-succeeded"; output: string; clearPassword?: boolean }
  | { type: "operation-failed"; error: string }
  | { type: "busy-finished" }
  | { type: "dismiss-error" };

export const initialDockerRegistryState: DockerRegistryState = {
  query: "",
  results: [],
  error: null,
  output: null,
  isBusy: false,
  draft: {
    registry: "",
    username: "",
    password: "",
    image: "",
    target: "",
  },
};

export function dockerRegistryReducer(
  state: DockerRegistryState,
  action: DockerRegistryAction,
): DockerRegistryState {
  switch (action.type) {
    case "set-query":
      return { ...state, query: action.query };
    case "set-draft-field":
      return { ...state, draft: { ...state.draft, [action.field]: action.value } };
    case "search-started":
      return { ...state, isBusy: true, error: null };
    case "search-succeeded":
      return { ...state, results: action.results };
    case "search-failed":
      return { ...state, results: [], error: action.error };
    case "operation-started":
      return { ...state, isBusy: true, error: null, output: null };
    case "operation-succeeded":
      return {
        ...state,
        output: action.output,
        draft: action.clearPassword ? { ...state.draft, password: "" } : state.draft,
      };
    case "operation-failed":
      return { ...state, error: action.error };
    case "busy-finished":
      return { ...state, isBusy: false };
    case "dismiss-error":
      return { ...state, error: null };
  }
}

interface UseDockerRegistryOptions {
  onDockerUnavailable: (message: string) => void;
  onInventoryChanged: () => Promise<void>;
}

export function useDockerRegistry({
  onDockerUnavailable,
  onInventoryChanged,
}: UseDockerRegistryOptions) {
  const [state, dispatch] = useReducer(dockerRegistryReducer, initialDockerRegistryState);

  const handleFailure = useCallback(
    (failure: unknown, operation: "search" | "operation") => {
      const error = getDockerErrorMessage(failure);
      if (isDockerConnectionError(error)) onDockerUnavailable(error);
      dispatch({ type: operation === "search" ? "search-failed" : "operation-failed", error });
    },
    [onDockerUnavailable],
  );

  const search = useCallback(async () => {
    const query = state.query.trim();
    if (!query) return;

    dispatch({ type: "search-started" });
    try {
      dispatch({ type: "search-succeeded", results: await searchDockerRegistry(query, 25) });
    } catch (error) {
      handleFailure(error, "search");
    } finally {
      dispatch({ type: "busy-finished" });
    }
  }, [handleFailure, state.query]);

  const login = useCallback(async () => {
    const username = state.draft.username.trim();
    if (!username || !state.draft.password) return;

    dispatch({ type: "operation-started" });
    try {
      const output = await loginDockerRegistry({
        registry: state.draft.registry.trim() || undefined,
        username,
        password: state.draft.password,
      });
      dispatch({
        type: "operation-succeeded",
        output: output.trim() || "Docker registry login completed.",
        clearPassword: true,
      });
    } catch (error) {
      handleFailure(error, "operation");
    } finally {
      dispatch({ type: "busy-finished" });
    }
  }, [handleFailure, state.draft.password, state.draft.registry, state.draft.username]);

  const pull = useCallback(
    async (image: string) => {
      const imageName = image.trim();
      if (!imageName) return;

      dispatch({ type: "operation-started" });
      try {
        const output = await pullDockerRegistryImage(imageName);
        dispatch({
          type: "operation-succeeded",
          output: output.trim() || `Pulled ${imageName}.`,
        });
        await onInventoryChanged();
      } catch (error) {
        handleFailure(error, "operation");
      } finally {
        dispatch({ type: "busy-finished" });
      }
    },
    [handleFailure, onInventoryChanged],
  );

  const push = useCallback(async () => {
    const imageName = state.draft.image.trim();
    if (!imageName) return;

    dispatch({ type: "operation-started" });
    try {
      const output = await pushDockerRegistryImage(imageName);
      dispatch({
        type: "operation-succeeded",
        output: output.trim() || `Pushed ${imageName}.`,
      });
    } catch (error) {
      handleFailure(error, "operation");
    } finally {
      dispatch({ type: "busy-finished" });
    }
  }, [handleFailure, state.draft.image]);

  const tag = useCallback(async () => {
    const source = state.draft.image.trim();
    const target = state.draft.target.trim();
    if (!source || !target) return;

    dispatch({ type: "operation-started" });
    try {
      const output = await tagDockerImage(source, target);
      dispatch({
        type: "operation-succeeded",
        output: output.trim() || `Tagged ${source} as ${target}.`,
      });
      await onInventoryChanged();
    } catch (error) {
      handleFailure(error, "operation");
    } finally {
      dispatch({ type: "busy-finished" });
    }
  }, [handleFailure, onInventoryChanged, state.draft.image, state.draft.target]);

  const setQuery = useCallback((query: string) => {
    dispatch({ type: "set-query", query });
  }, []);

  const setDraftField = useCallback((field: keyof DockerRegistryDraft, value: string) => {
    dispatch({ type: "set-draft-field", field, value });
  }, []);

  const dismissError = useCallback(() => {
    dispatch({ type: "dismiss-error" });
  }, []);

  return {
    ...state,
    search,
    login,
    pull,
    push,
    tag,
    setQuery,
    setDraftField,
    dismissError,
  };
}
