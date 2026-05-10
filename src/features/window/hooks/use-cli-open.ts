import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { enqueueWindowOpenRequest, type WindowOpenRequest } from "../utils/window-open-request";

export interface CliOpenPayload {
  kind: "path" | "web" | "terminal" | "remote";
  path?: string;
  is_directory?: boolean;
  line?: number | null;
  column?: number | null;
  url?: string;
  command?: string | null;
  working_directory?: string | null;
  connection_id?: string;
  name?: string | null;
}

const toPositiveInteger = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

export function mapCliOpenPayloadToWindowOpenRequest(
  payload: CliOpenPayload,
): WindowOpenRequest | null {
  switch (payload.kind) {
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

export function useCliOpen() {
  useEffect(() => {
    let disposed = false;
    const enqueuePayload = (payload: CliOpenPayload) => {
      const request = mapCliOpenPayloadToWindowOpenRequest(payload);
      if (request) {
        void enqueueWindowOpenRequest(request);
      }
    };

    const unlisten = listen<CliOpenPayload>("cli_open_request", (event) => {
      enqueuePayload(event.payload);
    });

    void invoke<CliOpenPayload[]>("take_pending_cli_open_requests")
      .then((payloads) => {
        if (disposed) return;
        for (const payload of payloads) {
          enqueuePayload(payload);
        }
      })
      .catch((error) => {
        console.error("Failed to load pending CLI open requests:", error);
      });

    return () => {
      disposed = true;
      unlisten.then((fn) => fn());
    };
  }, []);
}

export const __test__ = { mapCliOpenPayloadToWindowOpenRequest };
