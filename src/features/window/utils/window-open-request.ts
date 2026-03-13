export interface WindowOpenRequest {
  path: string;
  isDirectory: boolean;
  line?: number;
}

export function parseWindowOpenUrl(url: URL): WindowOpenRequest | null {
  if (url.host !== "open") return null;

  const path = url.searchParams.get("path");
  if (!path) return null;

  const lineParam = url.searchParams.get("line");
  const line = lineParam ? Number.parseInt(lineParam, 10) : undefined;
  const isDirectory = url.searchParams.get("type") === "directory";

  return {
    path,
    isDirectory,
    line: line && line > 0 ? line : undefined,
  };
}

export async function handleWindowOpenRequest(request: WindowOpenRequest) {
  const { useFileSystemStore } = await import("@/features/file-system/controllers/store");
  const { handleOpenFolderByPath, handleFileSelect } = useFileSystemStore.getState();

  if (request.isDirectory) {
    await handleOpenFolderByPath(request.path);
  } else {
    await handleFileSelect(request.path, false, request.line);
  }
}

export const __test__ = { parseWindowOpenUrl };
