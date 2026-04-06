export interface WindowOpenRequest {
  path?: string;
  isDirectory?: boolean;
  line?: number;
  remoteConnectionId?: string;
  remoteConnectionName?: string;
}

export function parseWindowOpenUrl(url: URL): WindowOpenRequest | null {
  const target = url.searchParams.get("target");
  if (target !== "open" && url.host !== "open") return null;

  const type = url.searchParams.get("type");
  if (type === "remote") {
    const remoteConnectionId = url.searchParams.get("connectionId");
    if (!remoteConnectionId) return null;

    return {
      remoteConnectionId,
      remoteConnectionName: url.searchParams.get("name") ?? undefined,
    };
  }

  const path = url.searchParams.get("path");
  if (!path) return null;

  const lineParam = url.searchParams.get("line");
  const line = lineParam ? Number.parseInt(lineParam, 10) : undefined;

  return {
    path,
    isDirectory: type === "directory",
    line: line && line > 0 ? line : undefined,
  };
}

export async function handleWindowOpenRequest(request: WindowOpenRequest) {
  const { useFileSystemStore } = await import("@/features/file-system/controllers/store");
  const { handleFileSelect, handleOpenFolderByPath, handleOpenRemoteProject } =
    useFileSystemStore.getState();

  if (request.remoteConnectionId) {
    await handleOpenRemoteProject(
      request.remoteConnectionId,
      request.remoteConnectionName ?? "Remote",
    );
    return;
  }

  if (!request.path) return;

  if (request.isDirectory) {
    await handleOpenFolderByPath(request.path);
  } else {
    await handleFileSelect(request.path, false, request.line);
  }
}

export const __test__ = { parseWindowOpenUrl };
