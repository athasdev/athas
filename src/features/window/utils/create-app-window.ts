import { commands } from "@/bindings/commands";
import type { WindowOpenRequest } from "@/features/window/utils/window-open-request";
import { traceWindowOpen } from "./window-open-diagnostics";

type CreateAppWindowRequest = NonNullable<Parameters<typeof commands.createAppWindow>[0]>;

function toCreateAppWindowRequest(request: WindowOpenRequest): CreateAppWindowRequest {
  return {
    detached: request.detached
      ? {
          kind: request.detached.kind,
          channel: request.detached.channel,
          payload: request.detached.payload ?? null,
        }
      : null,
    content: request.content ?? null,
    workbenchContent: request.workbenchContent ?? null,
    workingDirectory: request.workingDirectory ?? null,
    path: request.path ?? null,
    isDirectory: request.isDirectory ?? null,
    line: request.line ?? null,
    remoteConnectionId: request.remoteConnectionId ?? null,
    remoteConnectionName: request.remoteConnectionName ?? null,
  };
}

export async function createAppWindow(request?: WindowOpenRequest | null) {
  const startedAt = performance.now();
  const requestKind =
    request?.content?.type ??
    request?.detached?.kind ??
    (request?.remoteConnectionId
      ? "remote"
      : request?.path
        ? request.isDirectory
          ? "directory"
          : "file"
        : "empty");

  traceWindowOpen("createAppWindow:invoke:start", { requestKind });

  try {
    const label = await commands.createAppWindow(
      request ? toCreateAppWindowRequest(request) : null,
    );

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
