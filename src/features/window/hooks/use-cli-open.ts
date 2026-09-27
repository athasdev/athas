import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { enqueueWindowOpenRequest, type WindowOpenRequest } from "../utils/window-open-request";
import { createPendingQueueDrain } from "../utils/pending-queue-drain";
import { disposeListener } from "@/utils/tauri-drag-drop";

export interface CliOpenPayload {
  kind: "path" | "web" | "terminal" | "remote" | "surface" | "empty";
  path?: string;
  is_directory?: boolean;
  line?: number | null;
  column?: number | null;
  url?: string;
  command?: string | null;
  working_directory?: string | null;
  connection_id?: string;
  name?: string | null;
  resource_id?: number;
}

const toPositiveInteger = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

function mapCliOpenPayloadToWindowOpenRequest(payload: CliOpenPayload): WindowOpenRequest | null {
  switch (payload.kind) {
    case "surface": {
      const repoPath = payload.working_directory ?? undefined;
      const content =
        payload.name === "pr"
          ? { type: "pullRequest" as const, prNumber: payload.resource_id!, repoPath }
          : payload.name === "issue"
            ? { type: "githubIssue" as const, issueNumber: payload.resource_id!, repoPath }
            : payload.name === "action"
              ? { type: "githubAction" as const, runId: payload.resource_id!, repoPath }
              : payload.name === "settings"
                ? { type: "settings" as const }
                : payload.name === "extensions"
                  ? { type: "extensions" as const }
                  : null;
      return content ? { source: "cli", content } : null;
    }
    case "empty":
      return null;
    case "web":
      if (!payload.url) return null;
      return {
        type: "web",
        source: "cli",
        url: payload.url,
      };
    case "terminal":
      return {
        type: "terminal",
        source: "cli",
        command: payload.command ?? undefined,
        workingDirectory: payload.working_directory ?? undefined,
      };
    case "remote":
      if (!payload.connection_id) return null;
      return {
        type: "remote",
        source: "cli",
        remoteConnectionId: payload.connection_id,
        remoteConnectionName: payload.name ?? undefined,
      };
    case "path":
    default: {
      if (!payload.path) return null;
      const line = toPositiveInteger(payload.line);
      return {
        type: "path",
        source: "cli",
        path: payload.path,
        isDirectory: payload.is_directory ?? false,
        line,
        column: line ? toPositiveInteger(payload.column) : undefined,
      };
    }
  }
}

function enqueuePayload(payload: CliOpenPayload) {
  const request = mapCliOpenPayloadToWindowOpenRequest(payload);
  if (request) {
    void enqueueWindowOpenRequest(request);
  }
}

const drainPendingRequests = createPendingQueueDrain({
  take: () => invoke<CliOpenPayload[]>("take_pending_cli_open_requests"),
  handle: enqueuePayload,
  onError: (error) => console.error("Failed to load pending CLI open requests:", error),
});

export function useCliOpen() {
  useEffect(() => {
    let disposed = false;
    const drain = () => void drainPendingRequests();

    const unlisten = listen<CliOpenPayload>("cli_open_request", (event) => {
      enqueuePayload(event.payload);
    });

    const unlistenPending = listen<void>("cli_open_requests_pending", drain);
    Promise.all([unlisten, unlistenPending]).then(
      () => {
        if (!disposed) drain();
      },
      (error: unknown) => console.error("Failed to listen for CLI open requests:", error),
    );

    return () => {
      disposed = true;
      disposeListener(unlisten);
      disposeListener(unlistenPending);
    };
  }, []);
}

export const __test__ = { mapCliOpenPayloadToWindowOpenRequest };
