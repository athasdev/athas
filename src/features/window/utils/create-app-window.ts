import { invoke } from "@tauri-apps/api/core";
import type { WindowOpenRequest } from "@/features/window/utils/window-open-request";
import { traceWindowOpen } from "./window-open-diagnostics";

interface CreateAppWindowPayload {
  request?: WindowOpenRequest | null;
}

export async function createAppWindow(request?: WindowOpenRequest | null) {
  const startedAt = performance.now();
  const requestKind = request?.remoteConnectionId
    ? "remote"
    : request?.path
      ? request.isDirectory
        ? "directory"
        : "file"
      : "empty";

  traceWindowOpen("createAppWindow:invoke:start", { requestKind });

  try {
    const label = await invoke<string>("create_app_window", {
      request: request ?? null,
    } satisfies CreateAppWindowPayload);

    traceWindowOpen("createAppWindow:invoke:end", {
      requestKind,
      label,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });

    return label;
  } catch (error) {
    traceWindowOpen("createAppWindow:invoke:error", {
      requestKind,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
