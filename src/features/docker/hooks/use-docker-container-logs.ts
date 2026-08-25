import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useReducer } from "react";
import {
  startDockerContainerLogStream,
  stopDockerContainerLogStream,
} from "../services/docker-api";
import type { DockerLogEvent, DockerLogExitEvent } from "../types/docker.types";
import { getDockerErrorMessage, isDockerErrorLogLine } from "../utils/docker-sidebar-utils";

export type DockerLogFilter = "all" | "stdout" | "stderr" | "errors";
export type DockerLogLine = DockerLogEvent & { id: number };

export interface DockerContainerLogsState {
  lines: DockerLogLine[];
  query: string;
  filter: DockerLogFilter;
  streamId: string | null;
  error: string | null;
}

export type DockerContainerLogsAction =
  | { type: "container-changed" }
  | { type: "stream-started"; streamId: string }
  | { type: "line-received"; line: DockerLogLine }
  | { type: "stream-exited"; error: string | null }
  | { type: "stream-failed"; error: string }
  | { type: "clear-lines" }
  | { type: "set-query"; query: string }
  | { type: "set-filter"; filter: DockerLogFilter };

export const maxDockerLogLines = 1_000;

export const initialDockerContainerLogsState: DockerContainerLogsState = {
  lines: [],
  query: "",
  filter: "all",
  streamId: null,
  error: null,
};

export function dockerContainerLogsReducer(
  state: DockerContainerLogsState,
  action: DockerContainerLogsAction,
): DockerContainerLogsState {
  switch (action.type) {
    case "container-changed":
      return { ...state, lines: [], streamId: null, error: null };
    case "stream-started":
      return { ...state, streamId: action.streamId };
    case "line-received":
      return { ...state, lines: state.lines.concat(action.line).slice(-maxDockerLogLines) };
    case "stream-exited":
      return { ...state, streamId: null, error: action.error ?? state.error };
    case "stream-failed":
      return { ...state, streamId: null, error: action.error };
    case "clear-lines":
      return { ...state, lines: [] };
    case "set-query":
      return { ...state, query: action.query };
    case "set-filter":
      return { ...state, filter: action.filter };
  }
}

export function getDockerLogExitError(event: DockerLogExitEvent) {
  if (event.error) return event.error;
  if (event.code && event.code !== 0) {
    return `Docker log stream exited with code ${event.code}.`;
  }
  return null;
}

function matchesDockerLogStream(
  event: DockerLogEvent | DockerLogExitEvent,
  containerId: string,
  streamId: string | null,
) {
  return streamId ? event.streamId === streamId : event.containerId === containerId;
}

export function useDockerContainerLogs(containerId: string | null) {
  const [state, dispatch] = useReducer(dockerContainerLogsReducer, initialDockerContainerLogsState);

  useEffect(() => {
    dispatch({ type: "container-changed" });
    if (!containerId) return;

    let cancelled = false;
    let activeStreamId: string | null = null;
    let removeLogListener: (() => void) | null = null;
    let removeExitListener: (() => void) | null = null;
    let nextLogId = 0;

    const startLogStream = async () => {
      try {
        const removeLogs = await listen<DockerLogEvent>("docker-container-log", (event) => {
          if (cancelled || !matchesDockerLogStream(event.payload, containerId, activeStreamId)) {
            return;
          }
          dispatch({
            type: "line-received",
            line: { ...event.payload, id: nextLogId++ },
          });
        });
        if (cancelled) {
          removeLogs();
          return;
        }
        removeLogListener = removeLogs;

        const removeExit = await listen<DockerLogExitEvent>(
          "docker-container-log-exit",
          (event) => {
            if (cancelled || !matchesDockerLogStream(event.payload, containerId, activeStreamId)) {
              return;
            }
            dispatch({ type: "stream-exited", error: getDockerLogExitError(event.payload) });
          },
        );
        if (cancelled) {
          removeExit();
          return;
        }
        removeExitListener = removeExit;

        const nextStreamId = await startDockerContainerLogStream(containerId, 300);
        if (cancelled) {
          void stopDockerContainerLogStream(nextStreamId);
          return;
        }
        activeStreamId = nextStreamId;
        dispatch({ type: "stream-started", streamId: nextStreamId });
      } catch (error) {
        removeLogListener?.();
        removeExitListener?.();
        removeLogListener = null;
        removeExitListener = null;
        if (!cancelled) {
          dispatch({ type: "stream-failed", error: getDockerErrorMessage(error) });
        }
      }
    };

    void startLogStream();

    return () => {
      cancelled = true;
      removeLogListener?.();
      removeExitListener?.();
      if (activeStreamId) {
        void stopDockerContainerLogStream(activeStreamId);
      }
    };
  }, [containerId]);

  const filteredLines = useMemo(() => {
    const normalizedQuery = state.query.trim().toLowerCase();
    return state.lines.filter((entry) => {
      if (state.filter === "stdout" && entry.stream !== "stdout") return false;
      if (state.filter === "stderr" && entry.stream !== "stderr") return false;
      if (state.filter === "errors" && !isDockerErrorLogLine(entry.line)) return false;
      return !normalizedQuery || entry.line.toLowerCase().includes(normalizedQuery);
    });
  }, [state.filter, state.lines, state.query]);

  return {
    lines: state.lines,
    query: state.query,
    filter: state.filter,
    streamId: state.streamId,
    error: state.error,
    filteredLines,
    clearLines: () => dispatch({ type: "clear-lines" }),
    setQuery: (query: string) => dispatch({ type: "set-query", query }),
    setFilter: (filter: DockerLogFilter) => dispatch({ type: "set-filter", filter }),
  };
}
