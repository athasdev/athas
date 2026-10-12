import type {
  WorkspaceConnection,
  WorkspaceConnectionOptions,
} from "@/features/web-workbench/services/workspace-connection";
import type {
  WorkspaceInfo,
  WorkspaceSession,
} from "@/features/web-workbench/services/workspace-protocol";
import {
  type CloudWorkspace,
  isOpenWorkspace,
  type WebsiteApi,
} from "@/features/web-workbench/services/website-api";

/** A token this close to expiring is replaced before it is used to connect. */
const TOKEN_MARGIN_MS = 30_000;
/** Tokens last ten minutes; the socket gets a fresh one well before that. */
const TOKEN_RENEW_MS = 4 * 60_000;
const STARTING_POLL_MS = 2000;
const CONNECT_TIMEOUT_MS = 60_000;

export type CloudWorkspacePhase =
  | "idle"
  | "opening"
  | "starting"
  | "connecting"
  | "connected"
  | "stopping";

export interface CloudWorkspaceState {
  phase: CloudWorkspacePhase;
  /** The workspace being opened or in use, as the website last reported it. */
  workspace: CloudWorkspace | null;
  /** Why the last open failed or the workspace ended, in words for the user. */
  error: string | null;
}

export interface CloudWorkspaceControllerOptions {
  api: Pick<
    WebsiteApi,
    "openWorkspace" | "getWorkspace" | "stopWorkspace" | "listWorkspaces" | "createWorkspaceSession"
  >;
  connect: (options: WorkspaceConnectionOptions) => WorkspaceConnection;
  /** Switches the workbench to the connected workspace and opens its repository. */
  activate: (connection: WorkspaceConnection, workspace: WorkspaceInfo) => Promise<void>;
  /** Switches the workbench back to the sample project. */
  deactivate: () => Promise<void>;
  onChange?: (state: CloudWorkspaceState) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  setInterval?: (callback: () => void, ms: number) => () => void;
  pollMs?: number;
  renewMs?: number;
  connectTimeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultSetInterval = (callback: () => void, ms: number) => {
  const timer = setInterval(callback, ms);
  return () => clearInterval(timer);
};

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function endedMessage(workspace: CloudWorkspace) {
  if (workspace.status === "failed")
    return workspace.error ?? "The cloud workspace could not be started.";
  if (workspace.stopReason === "idle") return "The cloud workspace stopped after 30 idle minutes.";
  if (workspace.stopReason === "limit") return "The cloud workspace reached its time limit.";
  return "The cloud workspace stopped.";
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The cloud workspace did not answer.")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Hands out workspace tokens from the website's token endpoint: the cached one while it is
 * still good, a new one when it is about to expire or the Worker refused it.
 */
export function createWorkspaceTokenSource(
  api: Pick<WebsiteApi, "createWorkspaceSession">,
  workspaceId: string,
  now: () => number = Date.now,
) {
  let latest: WorkspaceSession | null = null;
  let pending: Promise<WorkspaceSession> | null = null;

  function refresh(): Promise<WorkspaceSession> {
    pending ??= api
      .createWorkspaceSession(workspaceId)
      .then((session) => {
        latest = session;
        return session;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  return {
    session: (): Promise<WorkspaceSession> => (latest ? Promise.resolve(latest) : refresh()),
    refresh,
    async getToken(force: boolean) {
      if (latest && !force && Date.parse(latest.expiresAt) - now() > TOKEN_MARGIN_MS)
        return latest.token;
      return (await refresh()).token;
    },
  };
}

/**
 * Opens one of the user's GitHub repositories in a cloud workspace from the web app: asks the
 * website to start (or reuse) a workspace, follows it while it starts, connects the workbench to
 * it with tokens from the website and keeps them fresh, and stops it again. One workspace is in
 * use at a time.
 */
export function createCloudWorkspaceController(options: CloudWorkspaceControllerOptions) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const every = options.setInterval ?? defaultSetInterval;
  let state: CloudWorkspaceState = { phase: "idle", workspace: null, error: null };
  let generation = 0;
  let connection: WorkspaceConnection | null = null;
  let stopRenewing: (() => void) | null = null;
  let active = false;

  function update(patch: Partial<CloudWorkspaceState>) {
    state = { ...state, ...patch };
    options.onChange?.(state);
  }

  async function teardown() {
    stopRenewing?.();
    stopRenewing = null;
    const current = connection;
    connection = null;
    current?.close();
    if (active) {
      active = false;
      await options.deactivate();
    }
  }

  async function connectTo(workspace: CloudWorkspace, run: number) {
    update({ phase: "connecting", workspace });
    const tokens = createWorkspaceTokenSource(options.api, workspace.id, now);
    const session = await tokens.session();
    if (run !== generation) return;
    const next = options.connect({ session, getToken: (refresh) => tokens.getToken(refresh) });
    connection = next;
    next.onEvent((event) => {
      if (event.type !== "stopped" || connection !== next) return;
      void (async () => {
        generation++;
        const latest = await options.api.getWorkspace(workspace.id).catch(() => null);
        await teardown();
        update({
          phase: "idle",
          workspace: latest ?? state.workspace,
          error: latest
            ? endedMessage(latest)
            : (event.error ?? "The connection to the cloud workspace ended."),
        });
      })();
    });
    const info = await withTimeout(next.ready, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
    if (run !== generation) return;
    active = true;
    await options.activate(next, info);
    if (run !== generation) return;
    stopRenewing = every(() => {
      void tokens
        .refresh()
        .then((fresh) => next.renew(fresh.token))
        .catch(() => {});
    }, options.renewMs ?? TOKEN_RENEW_MS);
    update({ phase: "connected" });
  }

  /** Waits while the workspace starts, then connects; reports why when it never runs. */
  async function follow(initial: CloudWorkspace, run: number) {
    let workspace = initial;
    while (workspace.status === "starting") {
      update({ phase: "starting", workspace });
      await sleep(options.pollMs ?? STARTING_POLL_MS);
      if (run !== generation) return;
      workspace = await options.api.getWorkspace(workspace.id);
      if (run !== generation) return;
    }
    if (workspace.status !== "running") {
      update({ phase: "idle", workspace, error: endedMessage(workspace) });
      return;
    }
    await connectTo(workspace, run);
  }

  async function run(task: (run: number) => Promise<void>, fallback: string) {
    const current = ++generation;
    try {
      await task(current);
    } catch (error) {
      if (current !== generation) return;
      await teardown();
      update({ phase: "idle", error: message(error, fallback) });
    }
  }

  return {
    getState: () => state,

    /** Opens the repository and branch, unless a workspace is already in use. */
    async open(repo: string, branch: string) {
      if (state.phase !== "idle") return;
      update({ phase: "opening", workspace: null, error: null });
      await run(async (current) => {
        const workspace = await options.api.openWorkspace(repo, branch);
        if (current !== generation) {
          // Stopped while the website was still starting it.
          void options.api.stopWorkspace(workspace.id).catch(() => {});
          return;
        }
        await follow(workspace, current);
      }, "The cloud workspace could not be opened.");
    },

    /** Picks up a workspace that is already starting or running, after a reload. */
    async resume() {
      if (state.phase !== "idle") return;
      const workspace = (await options.api.listWorkspaces().catch(() => [])).find(isOpenWorkspace);
      if (!workspace || state.phase !== "idle") return;
      update({ workspace, error: null });
      await run(
        (current) => follow(workspace, current),
        "The cloud workspace could not be reached.",
      );
    },

    /** Stops the workspace in use (and its billing) and returns to the sample project. */
    async stop() {
      if (state.phase === "idle" || state.phase === "stopping") return;
      const workspace = state.workspace;
      generation++;
      if (!workspace) {
        update({ phase: "idle", error: null });
        return;
      }
      update({ phase: "stopping", error: null });
      let stopped: CloudWorkspace | null = null;
      let error: string | null = null;
      try {
        stopped = await options.api.stopWorkspace(workspace.id);
      } catch (stopError) {
        error = message(stopError, "The cloud workspace could not be stopped.");
      }
      await teardown();
      update({ phase: "idle", workspace: stopped ?? workspace, error });
    },
  };
}

export type CloudWorkspaceController = ReturnType<typeof createCloudWorkspaceController>;
