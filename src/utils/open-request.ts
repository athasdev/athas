export interface OpenRequest {
  path: string;
  isDirectory: boolean;
  line?: number;
}

export function parseOpenUrl(url: URL): OpenRequest | null {
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

export async function handleOpenRequest(req: OpenRequest) {
  const { useFileSystemStore } = await import("@/features/file-system/controllers/store");
  const { handleOpenFolderByPath, handleFileSelect } = useFileSystemStore.getState();

  if (req.isDirectory) {
    await handleOpenFolderByPath(req.path);
  } else {
    await handleFileSelect(req.path, false, req.line);
  }
}

export const __test__ = { parseOpenUrl };
