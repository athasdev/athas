import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getRemotes } from "@/features/git/api/git-remotes-api";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import type {
  ExtensionHttpRequest,
  ExtensionHttpResponse,
  ExtensionWorkspaceContext,
} from "../types/extension-view";
import { isExtensionNetworkRequestAllowed } from "./extension-permissions";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const STORAGE_PREFIX = "athas-extension:";

function requirePermission(condition: boolean, capability: string): void {
  if (!condition) {
    throw new Error(`Extension does not have ${capability} permission`);
  }
}

function activeFilePath(): string | null {
  const state = useBufferStore.getState();
  return state.buffers.find((buffer) => buffer.id === state.activeBufferId)?.path ?? null;
}

async function readLimitedResponseBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Extension response exceeded the 5 MB limit");
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Extension response exceeded the 5 MB limit");
    }
    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}

export async function callExtensionHostService(
  extensionId: string,
  manifest: ExtensionManifest,
  method: string,
  params: unknown[],
): Promise<unknown> {
  switch (method) {
    case "http.request": {
      const request = params[0] as ExtensionHttpRequest;
      const allowedOrigins = manifest.permissions?.network ?? [];
      requirePermission(isExtensionNetworkRequestAllowed(request.url, allowedOrigins), "network");
      const response = await tauriFetch(request.url, {
        method: request.method ?? "GET",
        headers: request.headers,
        body: request.body,
      });
      const body = await readLimitedResponseBody(response);
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      } satisfies ExtensionHttpResponse;
    }
    case "secrets.get":
      requirePermission(manifest.permissions?.secrets === true, "secrets");
      return invoke<string | null>("get_extension_secret", {
        extensionId,
        key: String(params[0]),
      });
    case "secrets.set":
      requirePermission(manifest.permissions?.secrets === true, "secrets");
      return invoke("set_extension_secret", {
        extensionId,
        key: String(params[0]),
        value: String(params[1]),
      });
    case "secrets.delete":
      requirePermission(manifest.permissions?.secrets === true, "secrets");
      return invoke("delete_extension_secret", {
        extensionId,
        key: String(params[0]),
      });
    case "storage.get": {
      const value = localStorage.getItem(`${STORAGE_PREFIX}${extensionId}:${String(params[0])}`);
      return value === null ? undefined : JSON.parse(value);
    }
    case "storage.set":
      localStorage.setItem(
        `${STORAGE_PREFIX}${extensionId}:${String(params[0])}`,
        JSON.stringify(params[1]),
      );
      return undefined;
    case "storage.delete":
      localStorage.removeItem(`${STORAGE_PREFIX}${extensionId}:${String(params[0])}`);
      return undefined;
    case "workspace.getCurrent": {
      requirePermission(manifest.permissions?.workspace === "read", "workspace read");
      const rootPath = useProjectStore.getState().rootFolderPath ?? null;
      const repoPath = useRepositoryStore.getState().activeRepoPath ?? rootPath;
      const remotes = repoPath ? await getRemotes(repoPath) : [];
      return {
        rootPath,
        repoPath,
        activeFilePath: activeFilePath(),
        remotes,
      } satisfies ExtensionWorkspaceContext;
    }
    case "opener.openExternal": {
      requirePermission(manifest.permissions?.openExternal === true, "external link");
      const url = new URL(String(params[0]));
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Extensions can only open HTTP or HTTPS links");
      }
      await openUrl(url.toString());
      return undefined;
    }
    default:
      throw new Error(`Unknown extension host method: ${method}`);
  }
}
