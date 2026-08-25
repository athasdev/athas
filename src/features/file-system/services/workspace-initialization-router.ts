import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { parseWslPath } from "@/features/wsl/utils/wsl-path";

export interface WorkspaceInitializationHandlers {
  initializeLocal(path: string): Promise<boolean>;
  initializeRemote(connectionId: string): Promise<boolean>;
  initializeWsl(distro: string, linuxPath: string): Promise<boolean>;
}

export function initializeWorkspacePath(path: string, handlers: WorkspaceInitializationHandlers) {
  const remote = parseRemotePath(path);
  if (remote) {
    return handlers.initializeRemote(remote.connectionId);
  }

  const wsl = parseWslPath(path);
  if (wsl) {
    return handlers.initializeWsl(wsl.distro, wsl.linuxPath);
  }

  return handlers.initializeLocal(path);
}
