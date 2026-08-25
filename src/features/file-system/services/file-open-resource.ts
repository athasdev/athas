import { isBinaryContent, isKnownTextFile } from "@/features/file-system/controllers/file-utils";
import {
  getWorkspaceResourceProvider,
  type WorkspaceResourceProvider,
} from "@/features/file-system/services/workspace-resource-provider";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { parseWslPath } from "@/features/wsl/utils/wsl-path";

type ResolveWorkspaceResourceProvider = (path: string) => WorkspaceResourceProvider;

export interface FileOpenResource {
  provider: WorkspaceResourceProvider;
  providerPath: string;
  shouldInspectBytes: boolean;
}

export interface FileOpenInspection {
  isBinary: boolean;
  preloadedText: string | null;
}

const textFileDecoder = new TextDecoder("utf-8");
const inFlightFileReads = new Map<string, Promise<unknown>>();

function readFileOnce<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inFlightFileReads.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = loader().finally(() => {
    inFlightFileReads.delete(key);
  });
  inFlightFileReads.set(key, promise);
  return promise;
}

export function createFileOpenResource(
  path: string,
  resolvedPath: string,
  resolveProvider: ResolveWorkspaceResourceProvider = getWorkspaceResourceProvider,
): FileOpenResource {
  const providerPath = parseRemotePath(path) || parseWslPath(path) ? path : resolvedPath;
  const provider = resolveProvider(providerPath);
  const isKnownTextPath = isKnownTextFile(resolvedPath);

  return {
    provider,
    providerPath,
    shouldInspectBytes: provider.kind !== "remote" && !isKnownTextPath,
  };
}

export async function inspectFileOpenResource(
  resource: FileOpenResource,
): Promise<FileOpenInspection> {
  if (!resource.shouldInspectBytes) {
    return { isBinary: false, preloadedText: null };
  }

  const fileData = await readFileOnce(
    `${resource.provider.kind}-bytes:${resource.providerPath}`,
    () => resource.provider.readBytes(resource.providerPath),
  );

  if (fileData && isBinaryContent(fileData)) {
    return { isBinary: true, preloadedText: null };
  }

  return {
    isBinary: false,
    preloadedText: fileData ? textFileDecoder.decode(fileData) : null,
  };
}

export function readFileOpenText(
  resource: FileOpenResource,
  preloadedText: string | null,
): Promise<string> {
  if (preloadedText !== null) {
    return Promise.resolve(preloadedText);
  }

  return readFileOnce(`${resource.provider.kind}-text:${resource.providerPath}`, () =>
    resource.provider.readText(resource.providerPath),
  );
}
