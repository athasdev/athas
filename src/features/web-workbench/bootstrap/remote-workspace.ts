import { createRemoteBackend } from "@/features/web-workbench/services/remote-backend";
import type { WebBackend } from "@/features/web-workbench/services/web-backend";
import type { WorkspaceConnection } from "@/features/web-workbench/services/workspace-connection";
import type { WorkspaceInfo } from "@/features/web-workbench/services/workspace-protocol";

export interface SwitchableBackend extends WebBackend {
  use(backend: WebBackend): void;
}

/** The backend the Tauri mocks answer from, swapped when a cloud workspace connects or ends. */
export function createSwitchableBackend(initial: WebBackend): SwitchableBackend {
  let current = initial;
  return {
    handle: (command, args) => current.handle(command, args),
    seedStore: (path, values) => current.seedStore(path, values),
    use(backend) {
      current = backend;
    },
  };
}

export interface WorkspaceSwitcherOptions {
  backend: SwitchableBackend;
  /** The in-memory backend of the sample project; settings and app state stay with it. */
  sample: WebBackend;
  sampleRoot: string;
  openFolder: (path: string) => Promise<unknown>;
  closeFolder: (path: string) => Promise<unknown>;
  emit: (event: string, payload: unknown) => unknown;
}

/**
 * Moves the workbench onto a connected cloud workspace and back. Paths under the workspace's
 * root go to the workspace; everything else (settings, app data, the sample project) stays with
 * the in-memory backend, so the sample stays open beside the repository.
 */
export function createWorkspaceSwitcher(options: WorkspaceSwitcherOptions) {
  let root: string | null = null;
  return {
    async activate(connection: WorkspaceConnection, workspace: WorkspaceInfo) {
      root = workspace.root;
      options.backend.use(
        createRemoteBackend({
          base: options.sample,
          transport: connection,
          root: workspace.root,
          emit: options.emit,
        }),
      );
      await options.openFolder(workspace.root);
    },
    async deactivate() {
      const previous = root;
      root = null;
      if (previous) await options.closeFolder(previous).catch(() => {});
      options.backend.use(options.sample);
      await options.openFolder(options.sampleRoot);
    },
  };
}
