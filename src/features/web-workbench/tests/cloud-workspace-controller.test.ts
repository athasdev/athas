import { describe, expect, it, vi } from "vite-plus/test";
import {
  type CloudWorkspaceState,
  createCloudWorkspaceController,
  createWorkspaceTokenSource,
} from "@/features/web-workbench/services/cloud-workspace-controller";
import { createWebsiteApi } from "@/features/web-workbench/services/website-api";
import type {
  WorkspaceConnection,
  WorkspaceConnectionOptions,
} from "@/features/web-workbench/services/workspace-connection";
import type {
  WorkspaceEvent,
  WorkspaceInfo,
} from "@/features/web-workbench/services/workspace-protocol";
import {
  createWebsiteFetch,
  sessionBody,
  WORKSPACE_ID,
  workspaceBody,
} from "@/features/web-workbench/tests/website-fetch";

const last = <T>(items: T[]) => items[items.length - 1];
const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const info: WorkspaceInfo = {
  id: WORKSPACE_ID,
  repo: "athasdev/athas",
  branch: "main",
  root: "/workspace/athas",
  terminals: [],
  stopsAt: 0,
};

function fakeConnection(options: WorkspaceConnectionOptions) {
  const listeners = new Set<(event: WorkspaceEvent) => void>();
  const connection = {
    options,
    ready: Promise.resolve(info),
    renewed: [] as string[],
    closed: false,
    call: vi.fn(),
    onEvent(listener: (event: WorkspaceEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onTerminalOutput: () => () => {},
    renew(token: string) {
      connection.renewed.push(token);
    },
    close() {
      connection.closed = true;
      for (const listener of listeners) listener({ type: "stopped", reason: "closed" });
    },
    emit(event: WorkspaceEvent) {
      for (const listener of listeners) listener(event);
    },
  };
  return connection;
}

/** The website as the controller sees it, with a workspace that starts on the second poll. */
function setup(overrides: Parameters<typeof createWebsiteFetch>[0] = {}) {
  let polls = 0;
  let tokens = 0;
  const site = createWebsiteFetch({
    "POST /api/cloud-workspaces": workspaceBody("starting"),
    [`GET /api/cloud-workspaces/${WORKSPACE_ID}`]: () =>
      workspaceBody(++polls >= 2 ? "running" : "starting"),
    [`POST /api/cloud-workspaces/${WORKSPACE_ID}/token`]: () => sessionBody(`token-${++tokens}`),
    [`POST /api/cloud-workspaces/${WORKSPACE_ID}/stop`]: workspaceBody("stopped", {
      stopReason: "user",
    }),
    "GET /api/cloud-workspaces": { body: { workspaces: [] } },
    ...overrides,
  });
  const connections: ReturnType<typeof fakeConnection>[] = [];
  const states: CloudWorkspaceState[] = [];
  const renewals: Array<() => void> = [];
  const activate = vi.fn(async () => {});
  const deactivate = vi.fn(async () => {});
  const controller = createCloudWorkspaceController({
    api: createWebsiteApi(site.fetch),
    connect: (options) => {
      const connection = fakeConnection(options);
      connections.push(connection);
      return connection as unknown as WorkspaceConnection;
    },
    activate,
    deactivate,
    onChange: (state) => states.push(state),
    now: () => NOW,
    sleep: async () => {},
    setInterval: (callback) => {
      renewals.push(callback);
      return () => renewals.splice(renewals.indexOf(callback), 1);
    },
  });
  return { site, controller, connections, states, renewals, activate, deactivate };
}

describe("cloud workspace controller", () => {
  it("opens a repository, follows the workspace while it starts and connects with a token", async () => {
    const { site, controller, connections, states, activate } = setup();

    await controller.open("athasdev/athas", "main");

    expect(states.map((state) => state.phase)).toEqual([
      "opening",
      "starting",
      "starting",
      "connecting",
      "connected",
    ]);
    expect(site.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/cloud-workspaces",
      `GET /api/cloud-workspaces/${WORKSPACE_ID}`,
      `GET /api/cloud-workspaces/${WORKSPACE_ID}`,
      `POST /api/cloud-workspaces/${WORKSPACE_ID}/token`,
    ]);
    expect(connections).toHaveLength(1);
    expect(connections[0].options.session.endpoint).toBe("https://realtime.athas.dev");
    expect(await connections[0].options.getToken(false)).toBe("token-1");
    expect(activate).toHaveBeenCalledWith(connections[0], info);
    expect(controller.getState()).toMatchObject({
      phase: "connected",
      workspace: { repo: "athasdev/athas", branch: "main", status: "running" },
      error: null,
    });
  });

  it("fetches a new token when the Worker refused one and hands fresh ones to the socket", async () => {
    const { controller, connections, renewals } = setup();
    await controller.open("athasdev/athas", "main");

    expect(await connections[0].options.getToken(true)).toBe("token-2");
    expect(await connections[0].options.getToken(false)).toBe("token-2");
    renewals[0]();
    await vi.waitFor(() => expect(connections[0].renewed).toEqual(["token-3"]));
  });

  it("stops the workspace and returns to the sample project", async () => {
    const { site, controller, connections, deactivate, renewals, states } = setup();
    await controller.open("athasdev/athas", "main");

    await controller.stop();

    expect(last(site.requests)).toMatchObject({
      method: "POST",
      path: `/api/cloud-workspaces/${WORKSPACE_ID}/stop`,
    });
    expect(connections[0].closed).toBe(true);
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(renewals).toHaveLength(0);
    expect(last(states)).toMatchObject({
      phase: "idle",
      error: null,
      workspace: { status: "stopped" },
    });
  });

  it("goes back to the sample when the workspace stops on its own", async () => {
    const { controller, connections, deactivate } = setup({
      [`GET /api/cloud-workspaces/${WORKSPACE_ID}`]: workspaceBody("running"),
    });
    await controller.open("athasdev/athas", "main");

    connections[0].emit({ type: "stopped", reason: "stopped" });

    await vi.waitFor(() => expect(controller.getState().phase).toBe("idle"));
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it("explains why a workspace never ran and does not connect", async () => {
    const { controller, connections, activate } = setup({
      [`GET /api/cloud-workspaces/${WORKSPACE_ID}`]: workspaceBody("failed", {
        error: "The repository could not be cloned.",
      }),
    });

    await controller.open("athasdev/athas", "main");

    expect(connections).toHaveLength(0);
    expect(activate).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      phase: "idle",
      error: "The repository could not be cloned.",
    });
  });

  it("reports the website's refusal to open a workspace", async () => {
    const { controller } = setup({
      "POST /api/cloud-workspaces": {
        status: 402,
        body: { error: "Cloud workspaces are part of Athas Pro.", code: "pro_required" },
      },
    });
    await controller.open("athasdev/athas", "main");
    expect(controller.getState()).toMatchObject({
      phase: "idle",
      error: "Cloud workspaces are part of Athas Pro.",
    });
  });

  it("picks up a workspace that is already running after a reload", async () => {
    const { controller, activate } = setup({
      "GET /api/cloud-workspaces": {
        body: {
          workspaces: [
            workspaceBody("stopped").body.workspace,
            workspaceBody("running").body.workspace,
          ],
        },
      },
    });
    await controller.resume();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(controller.getState().phase).toBe("connected");
  });

  it("stops a workspace the website started after the user cancelled", async () => {
    let answer!: () => void;
    const opened = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { site, controller } = setup();
    const originalFetch = site.fetch.getMockImplementation()!;
    site.fetch.mockImplementation(async (input, init) => {
      if (init?.method === "POST" && input === "/api/cloud-workspaces") await opened;
      return originalFetch(input, init);
    });

    const opening = controller.open("athasdev/athas", "main");
    await controller.stop();
    answer();
    await opening;

    await vi.waitFor(() =>
      expect(last(site.requests)?.path).toBe(`/api/cloud-workspaces/${WORKSPACE_ID}/stop`),
    );
    expect(controller.getState().phase).toBe("idle");
  });
});

describe("workspace token source", () => {
  it("reuses a token until it is about to expire", async () => {
    let count = 0;
    const api = {
      createWorkspaceSession: vi.fn(async () => ({
        ...sessionBody(
          `token-${++count}`,
          count === 1 ? "2026-10-12T12:00:20.000Z" : "2026-10-12T12:10:00.000Z",
        ).body.session,
      })),
    };
    const tokens = createWorkspaceTokenSource(api, WORKSPACE_ID, () => NOW);

    expect(await tokens.getToken(false)).toBe("token-1");
    expect(await tokens.getToken(false)).toBe("token-2");
    expect(await tokens.getToken(false)).toBe("token-2");
    expect(api.createWorkspaceSession).toHaveBeenCalledTimes(2);
  });
});
