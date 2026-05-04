import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { enqueueWindowOpenRequest } from "../utils/window-open-request";

interface CliOpenPayload {
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

export function useCliOpen() {
  useEffect(() => {
    const unlisten = listen<CliOpenPayload>("cli_open_request", (event) => {
      const payload = event.payload;

      switch (payload.kind) {
        case "web":
          if (!payload.url) return;
          void enqueueWindowOpenRequest({
            type: "web",
            source: "cli",
            url: payload.url,
          });
          break;
        case "terminal":
          void enqueueWindowOpenRequest({
            type: "terminal",
            source: "cli",
            command: payload.command ?? undefined,
            workingDirectory: payload.working_directory ?? undefined,
          });
          break;
        case "remote":
          if (!payload.connection_id) return;
          void enqueueWindowOpenRequest({
            type: "remote",
            source: "cli",
            remoteConnectionId: payload.connection_id,
            remoteConnectionName: payload.name ?? undefined,
          });
          break;
        case "path":
        default:
          if (!payload.path) return;
          void enqueueWindowOpenRequest({
            type: "path",
            source: "cli",
            path: payload.path,
            isDirectory: payload.is_directory ?? false,
            line: toPositiveInteger(payload.line),
            column: toPositiveInteger(payload.column),
          });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
