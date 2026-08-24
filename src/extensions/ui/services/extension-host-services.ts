import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getRemotes } from "@/features/git/api/git-remotes-api";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import { writeClipboardText } from "@/utils/clipboard";
import type {
  ExtensionHttpRequest,
  ExtensionHttpResponse,
  ExtensionWorkspaceContext,
} from "../types/extension-view";
import { isExtensionNetworkRequestAllowed } from "./extension-permissions";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const STORAGE_PREFIX = "athas-extension:";
const MAX_CLIPBOARD_CHARACTERS = 100_000;
const MAX_NOTIFICATION_TITLE_CHARACTERS = 200;
const MAX_NOTIFICATION_DESCRIPTION_CHARACTERS = 1_000;
const MAX_NOTIFICATIONS_PER_WINDOW = 5;
const NOTIFICATION_WINDOW_MS = 10_000;
const notificationTimestamps = new Map<string, number[]>();

function requirePermission(condition: boolean, capability: string): void {
  if (!condition) {
    throw new Error(`Extension does not have ${capability} permission`);
  }
}

function requireString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if (value.length > maximum) throw new Error(`${label} exceeds the ${maximum} character limit`);
  return value;
}

function consumeNotificationQuota(extensionId: string): void {
  const now = Date.now();
  const recent = (notificationTimestamps.get(extensionId) ?? []).filter(
    (timestamp) => now - timestamp < NOTIFICATION_WINDOW_MS,
  );
  if (recent.length >= MAX_NOTIFICATIONS_PER_WINDOW) {
    throw new Error("Extension notification rate limit exceeded");
  }
  recent.push(now);
  notificationTimestamps.set(extensionId, recent);
}

export function clearExtensionHostServiceState(extensionId: string): void {
  notificationTimestamps.delete(extensionId);
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
        maxRedirections: 0,
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
    case "notifications.show": {
      const input = params[0];
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Extension notification must be an object");
      }
      const notification = input as Record<string, unknown>;
      const title = requireString(
        notification.title,
        "Extension notification title",
        MAX_NOTIFICATION_TITLE_CHARACTERS,
      ).trim();
      if (!title) throw new Error("Extension notification title must not be empty");
      const description =
        notification.description == null
          ? undefined
          : requireString(
              notification.description,
              "Extension notification description",
              MAX_NOTIFICATION_DESCRIPTION_CHARACTERS,
            );
      const tone = notification.tone ?? "default";
      if (!["default", "info", "success", "warning", "error"].includes(String(tone))) {
        throw new Error("Extension notification tone is invalid");
      }
      const duration = notification.duration;
      if (
        duration != null &&
        (typeof duration !== "number" ||
          !Number.isFinite(duration) ||
          duration < 2_000 ||
          duration > 10_000)
      ) {
        throw new Error("Extension notification duration must be between 2000 and 10000 ms");
      }
      consumeNotificationQuota(extensionId);
      const options = { description, duration: duration as number | undefined };
      if (tone === "success") toast.success(title, options);
      else if (tone === "warning") toast.warning(title, options);
      else if (tone === "error") toast.error(title, options);
      else if (tone === "info") toast.info(title, options);
      else toast(title, options);
      return undefined;
    }
    case "clipboard.writeText": {
      requirePermission(manifest.permissions?.clipboardWrite === true, "clipboard write");
      const text = requireString(params[0], "Extension clipboard text", MAX_CLIPBOARD_CHARACTERS);
      await writeClipboardText(text);
      return undefined;
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
