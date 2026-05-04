export interface WindowOpenRequest {
  type?: "path" | "remote" | "web" | "terminal";
  source?: "app" | "cli" | "deepLink";
  path?: string;
  isDirectory?: boolean;
  line?: number;
  column?: number;
  remoteConnectionId?: string;
  remoteConnectionName?: string;
  url?: string;
  command?: string;
  workingDirectory?: string;
}

type WindowOpenRequestHandler = (request: WindowOpenRequest) => Promise<void>;

interface PathInfo {
  is_dir: boolean;
}

function shouldConfirmTerminalCommand(request: WindowOpenRequest) {
  return request.type === "terminal" && request.source === "deepLink" && !!request.command;
}

function getTerminalCommandConfirmationMessage(request: WindowOpenRequest) {
  const lines = ["Open a terminal and run this command?", "", request.command ?? ""];

  if (request.workingDirectory) {
    lines.push("", `Working directory: ${request.workingDirectory}`);
  }

  return lines.join("\n");
}

const parsePositiveInteger = (value: string | null | undefined) => {
  if (!value) return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

function parseOpenPosition(searchParams: URLSearchParams) {
  const lineParam = searchParams.get("line");
  const [linePart, columnFromLinePart] = lineParam?.split(":") ?? [];
  const line = parsePositiveInteger(linePart);
  const column =
    parsePositiveInteger(searchParams.get("column")) ?? parsePositiveInteger(columnFromLinePart);

  return {
    line,
    column: line ? column : undefined,
  };
}

function resolveWindowOpenPathTarget(isDirectoryRequest: boolean | undefined, pathInfo: PathInfo) {
  if (isDirectoryRequest && !pathInfo.is_dir) {
    return {
      type: "invalid" as const,
      message: "Path is not a folder.",
    };
  }

  return {
    type: pathInfo.is_dir ? ("directory" as const) : ("file" as const),
  };
}

export function parseWindowOpenUrl(url: URL): WindowOpenRequest | null {
  const target = url.searchParams.get("target");
  if (target !== "open" && url.host !== "open") return null;

  const type = url.searchParams.get("type");
  if (type === "remote") {
    const remoteConnectionId = url.searchParams.get("connectionId");
    if (!remoteConnectionId) return null;

    return {
      type: "remote",
      remoteConnectionId,
      remoteConnectionName: url.searchParams.get("name") ?? undefined,
    };
  }

  if (type === "web") {
    const webUrl = url.searchParams.get("url");
    if (!webUrl) return null;

    return {
      type: "web",
      url: webUrl,
    };
  }

  if (type === "terminal") {
    return {
      type: "terminal",
      command: url.searchParams.get("command") ?? undefined,
      workingDirectory: url.searchParams.get("cwd") ?? undefined,
    };
  }

  const path = url.searchParams.get("path");
  if (!path) return null;

  const position = parseOpenPosition(url.searchParams);

  return {
    type: "path",
    path,
    isDirectory: type === "directory",
    ...position,
  };
}

export async function handleWindowOpenRequest(request: WindowOpenRequest) {
  const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
  const { useFileSystemStore } = await import("@/features/file-system/controllers/store");
  const { handleFileSelect, handleOpenFolderByPath, handleOpenRemoteProject } =
    useFileSystemStore.getState();

  if (request.type === "web" && request.url) {
    useBufferStore.getState().actions.openWebViewerBuffer(request.url);
    return;
  }

  if (request.type === "terminal") {
    if (shouldConfirmTerminalCommand(request)) {
      const { primitiveConfirm } = await import("@/ui/primitive-dialog-service");
      const confirmed = await primitiveConfirm(getTerminalCommandConfirmationMessage(request), {
        title: "Run Terminal Command",
        confirmLabel: "Run Command",
      });
      if (!confirmed) {
        return;
      }
    }

    useBufferStore.getState().actions.openTerminalBuffer({
      command: request.command,
      workingDirectory: request.workingDirectory,
    });
    return;
  }

  if (request.type === "remote" && request.remoteConnectionId) {
    await handleOpenRemoteProject(
      request.remoteConnectionId,
      request.remoteConnectionName ?? "Remote",
    );
    return;
  }

  if (!request.path) return;

  if (request.path.startsWith("remote://")) {
    await handleFileSelect(request.path, false, request.line, request.column);
    return;
  }

  const { getSymlinkInfo } = await import("@/features/file-system/controllers/platform");
  const { toast } = await import("@/ui/toast");

  let pathTarget: ReturnType<typeof resolveWindowOpenPathTarget>;
  try {
    pathTarget = resolveWindowOpenPathTarget(
      request.isDirectory,
      await getSymlinkInfo(request.path),
    );
  } catch (error) {
    console.error("Failed to validate open path:", request.path, error);
    toast.error(`Cannot open "${request.path}". Check that it exists and is accessible.`);
    return;
  }

  if (pathTarget.type === "invalid") {
    toast.error(`${pathTarget.message} ${request.path}`);
    return;
  }

  if (pathTarget.type === "directory") {
    await handleOpenFolderByPath(request.path);
  } else {
    await handleFileSelect(request.path, false, request.line, request.column);
  }
}

export function createWindowOpenRequestQueue(
  handler: WindowOpenRequestHandler,
  onError: (error: unknown) => void = console.error,
) {
  let queue = Promise.resolve();

  return (request: WindowOpenRequest) => {
    const task = queue.then(
      () => handler(request),
      () => handler(request),
    );

    queue = task.catch(onError);
    return task;
  };
}

export const enqueueWindowOpenRequest = createWindowOpenRequestQueue(handleWindowOpenRequest);

export const __test__ = {
  createWindowOpenRequestQueue,
  getTerminalCommandConfirmationMessage,
  parseWindowOpenUrl,
  resolveWindowOpenPathTarget,
  shouldConfirmTerminalCommand,
};
