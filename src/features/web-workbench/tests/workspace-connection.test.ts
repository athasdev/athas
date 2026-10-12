import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { connectWorkspace } from "@/features/web-workbench/services/workspace-connection";
import type { WorkspaceEvent } from "@/features/web-workbench/services/workspace-protocol";

const session = {
  workspaceId: "0b6f7c1e-2f43-4a8e-9a51-3c2d1e0f9a87",
  endpoint: "https://cloud.athas.dev",
  token: "token-1",
  expiresAt: "2026-10-12T12:10:00.000Z",
  repo: "athasdev/athas",
  branch: "main",
};
const workspace = {
  id: session.workspaceId,
  repo: "athasdev/athas",
  branch: "main",
  root: "/workspace/athas",
  terminals: [],
  stopsAt: 0,
};

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType: BinaryType = "blob";
  sent: Array<Record<string, any>> = [];
  closed: { code: number } | null = null;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  receive(data: unknown) {
    this.onmessage?.({
      data: typeof data === "string" || data instanceof ArrayBuffer ? data : JSON.stringify(data),
    } as MessageEvent);
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
  close(code: number) {
    this.closed = { code };
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function connect(getToken = vi.fn(async (refresh: boolean) => (refresh ? "token-2" : "token-1"))) {
  const connection = connectWorkspace({
    session,
    getToken,
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    retryDelaysMs: [0],
    pingIntervalMs: 60_000,
  });
  return { connection, getToken };
}

beforeEach(() => {
  FakeSocket.all = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("workspace connection", () => {
  it("authenticates with its first message, never in the URL, and queues calls until ready", async () => {
    const { connection } = connect();
    await flush();
    const socket = FakeSocket.all[0];
    expect(socket.url).toBe(`wss://cloud.athas.dev/workspaces/${session.workspaceId}/socket`);
    expect(socket.url).not.toContain("token");
    const status = connection.call("git.status");
    socket.open();
    expect(socket.sent).toEqual([{ type: "auth", token: "token-1" }]);
    socket.receive({ type: "ready", workspace });
    expect(await connection.ready).toEqual(workspace);
    expect(socket.sent[1]).toEqual({ type: "call", id: 1, method: "git.status", params: {} });
    socket.receive({ type: "result", id: 1, ok: true, value: { branch: "main" } });
    expect(await status).toEqual({ branch: "main" });

    const failing = connection.call("fs.read", { path: "x" });
    socket.receive({
      type: "result",
      id: 2,
      ok: false,
      error: { code: "not_found", message: "x does not exist." },
    });
    await expect(failing).rejects.toMatchObject({
      code: "not_found",
      message: "x does not exist.",
    });

    connection.renew("token-3");
    expect(socket.sent[socket.sent.length - 1]).toEqual({ type: "renew", token: "token-3" });
  });

  it("delivers terminal frames and workspace events", async () => {
    const { connection } = connect();
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    socket.receive({ type: "ready", workspace });
    const output: Array<[string, string]> = [];
    const events: WorkspaceEvent[] = [];
    connection.onTerminalOutput((id, data) => output.push([id, new TextDecoder().decode(data)]));
    connection.onEvent((event) => events.push(event));
    const frame = new Uint8Array([1, 2, ...new TextEncoder().encode("t1hi")]);
    socket.receive(frame.buffer);
    socket.receive({ type: "fs.changes", changes: [], gitChanged: true, rescan: false });
    expect(output).toEqual([["t1", "hi"]]);
    expect(events).toEqual([{ type: "fs.changes", changes: [], gitChanged: true, rescan: false }]);
  });

  it("reconnects with a fresh token after the Worker refuses the old one", async () => {
    const { connection, getToken } = connect();
    await flush();
    FakeSocket.all[0].open();
    FakeSocket.all[0].receive({ type: "ready", workspace });
    const events: WorkspaceEvent[] = [];
    connection.onEvent((event) => events.push(event));
    const inFlight = connection.call("git.status");
    FakeSocket.all[0].drop(4001);
    await expect(inFlight).rejects.toMatchObject({ code: "disconnected" });
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(2));
    expect(getToken).toHaveBeenLastCalledWith(true);
    FakeSocket.all[1].open();
    expect(FakeSocket.all[1].sent[0]).toEqual({ type: "auth", token: "token-2" });
    FakeSocket.all[1].receive({ type: "ready", workspace: { ...workspace, terminals: ["t1"] } });
    expect(events).toEqual([
      { type: "reconnected", workspace: { ...workspace, terminals: ["t1"] } },
    ]);
  });

  it("reports the end of the workspace and refuses further calls", async () => {
    const { connection } = connect();
    await flush();
    FakeSocket.all[0].open();
    FakeSocket.all[0].receive({ type: "ready", workspace });
    const events: WorkspaceEvent[] = [];
    connection.onEvent((event) => events.push(event));
    FakeSocket.all[0].receive({ type: "stopped", reason: "idle" });
    expect(events).toEqual([{ type: "stopped", reason: "idle" }]);
    await expect(connection.call("git.status")).rejects.toMatchObject({ code: "stopped" });
    FakeSocket.all[0].drop(4003);
    await flush();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("gives up when the dashboard cannot provide a token", async () => {
    const { connection } = connect(
      vi.fn(async () => {
        throw new Error("no session");
      }),
    );
    await expect(connection.ready).rejects.toMatchObject({ code: "stopped" });
  });
});
