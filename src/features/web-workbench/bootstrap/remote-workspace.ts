import { emit } from "@tauri-apps/api/event";
import {
  createSessionBridge,
  parseParentOrigins,
} from "@/features/web-workbench/bootstrap/workspace-session";
import { MemoryFileSystem } from "@/features/web-workbench/services/memory-file-system";
import { MemoryGitRepository } from "@/features/web-workbench/services/memory-git";
import { createRemoteBackend } from "@/features/web-workbench/services/remote-backend";
import { createWebBackend } from "@/features/web-workbench/services/web-backend";
import { connectWorkspace } from "@/features/web-workbench/services/workspace-connection";
import type { WorkspaceInfo } from "@/features/web-workbench/services/workspace-protocol";

const REMOTE_HOME = "/root";
const CONNECT_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out")), ms)),
  ]);
}

/**
 * Connects the editor to the cloud workspace the dashboard hands it. Returns null when no
 * session arrives or the workspace cannot be reached, and the editor opens the sample instead.
 */
export async function startRemoteWorkspace(appVersion: string) {
  const bridge = createSessionBridge({
    parentOrigins: parseParentOrigins(import.meta.env.VITE_WEB_EDITOR_PARENT_ORIGINS),
    parent: window.parent,
    messages: window,
  });
  const session = await bridge.waitForSession();
  if (!session) {
    bridge.dispose();
    return null;
  }

  const connection = connectWorkspace({ session, getToken: (refresh) => bridge.getToken(refresh) });
  let workspace: WorkspaceInfo;
  try {
    workspace = await withTimeout(connection.ready, CONNECT_TIMEOUT_MS);
  } catch (error) {
    console.error("[web-workbench] Could not open the cloud workspace", error);
    connection.close();
    bridge.notifyEnded();
    bridge.dispose();
    return null;
  }

  bridge.onSession((next) => connection.renew(next.token));
  connection.onEvent((event) => {
    if (event.type === "stopped") bridge.notifyEnded();
  });

  // Settings, sessions and other app state stay in memory, as in the sample.
  const fs = new MemoryFileSystem(REMOTE_HOME, {});
  const base = createWebBackend({
    home: REMOTE_HOME,
    fs,
    git: new MemoryGitRepository(fs, REMOTE_HOME, { branch: workspace.branch, head: {} }),
    appVersion,
  });
  const backend = createRemoteBackend({
    base,
    transport: connection,
    root: workspace.root,
    emit: (event, payload) => emit(event, payload),
  });
  return { backend, workspace, connection };
}
