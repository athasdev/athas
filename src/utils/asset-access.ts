import { convertFileSrc } from "@tauri-apps/api/core";
import { commands } from "@/bindings/commands";

/**
 * The asset protocol only serves app-owned directories by default. Paths
 * outside of them (workspaces, user-picked images) must be allowed by the
 * native side before their `asset:` URLs are loaded.
 */
const accessRequests = new Map<string, Promise<boolean>>();
const settledPaths = new Set<string>();

export function hasSettledAssetAccess(path: string): boolean {
  return settledPaths.has(path);
}

export function ensureAssetAccess(path: string): Promise<boolean> {
  const existing = accessRequests.get(path);
  if (existing) return existing;

  const request = Promise.resolve()
    .then(() => commands.allowAssetPath(path))
    .then(
      () => {
        settledPaths.add(path);
        return true;
      },
      (error: unknown) => {
        console.warn(`Failed to allow asset access for ${path}:`, error);
        accessRequests.delete(path);
        return false;
      },
    );
  accessRequests.set(path, request);
  return request;
}

export async function resolveAssetUrl(path: string): Promise<string> {
  await ensureAssetAccess(path);
  return convertFileSrc(path);
}
