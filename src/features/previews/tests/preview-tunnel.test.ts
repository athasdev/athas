import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { encodeFrame, type ServerFrame } from "../services/preview-protocol";
import type { ProxyFetch } from "../services/preview-proxy";
import {
  connectPreviewTunnel,
  PreviewEndedError,
  type PreviewTunnelSocket,
} from "../services/preview-tunnel";
import type { PreviewTunnelStatus } from "../types/previews.types";

const T0 = Date.parse("2026-10-09T12:00:00.000Z");

class FakeSocket implements PreviewTunnelSocket {
  readyState = 0;
  binaryType: BinaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: Array<string | Uint8Array> = [];
  constructor(readonly url: string) {}
  send(data: string | ArrayBufferLike | ArrayBufferView) {
    this.sent.push(typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  receive(frame: ServerFrame, payload?: Uint8Array) {
    this.onmessage?.({ data: encodeFrame(frame, payload).buffer } as MessageEvent);
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
  frames() {
    return this.sent
      .filter((data): data is Uint8Array => typeof data !== "string")
      .map((data) => {
        const length = new DataView(data.buffer, data.byteOffset).getUint32(0);
        return JSON.parse(new TextDecoder().decode(data.subarray(4, 4 + length)));
      });
  }
}

const ticket = (expiresAt: number, token = "t1") => ({
  url: `wss://realtime.athas.test/previews/abc/connect?token=${token}`,
  expiresAt: new Date(expiresAt).toISOString(),
});

let sockets: FakeSocket[];
let statuses: PreviewTunnelStatus[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  sockets = [];
  statuses = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function start(
  options: { requestTicket?: () => Promise<ReturnType<typeof ticket>>; fetch?: ProxyFetch } = {},
) {
  const onRequest = vi.fn();
  const connection = connectPreviewTunnel({
    port: 5173,
    ticket: ticket(T0 + 10 * 60_000),
    requestTicket: options.requestTicket ?? (async () => ticket(Date.now() + 10 * 60_000, "t2")),
    fetch: options.fetch ?? (async () => new Response("ok")),
    onStatus: (status) => statuses.push(status),
    onRequest,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  return { connection, onRequest };
}

describe("preview tunnel", () => {
  it("opens with the ticket, answers requests and counts them", async () => {
    const { onRequest } = start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sockets[0]!;
    expect(socket.binaryType).toBe("arraybuffer");
    socket.open();
    socket.receive({ type: "welcome", preview: "abc", expiresAt: new Date(T0).toISOString() });
    expect(statuses).toEqual(["connecting", "open"]);

    socket.receive({ type: "request", id: "r1", method: "GET", path: "/", headers: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.frames().map((frame) => frame.type)).toEqual(["response", "body", "end"]);
    expect(onRequest).toHaveBeenCalledWith({ method: "GET", path: "/", status: 200 });
  });

  it("renews its token over the socket before it expires", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    await vi.advanceTimersByTimeAsync(9 * 60_000 + 1);
    expect(sockets[0]!.frames()).toContainEqual({ type: "renew", token: "t2" });
  });

  it("reconnects after a dropped connection and with a new token after 4001", async () => {
    const requestTicket = vi.fn(async () => ticket(Date.now() + 10 * 60_000, "t2"));
    start({ requestTicket });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    sockets[0]!.receive({ type: "welcome", preview: "abc", expiresAt: new Date(T0).toISOString() });
    sockets[0]!.serverClose(1006);
    expect(statuses[statuses.length - 1]).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.url).toContain("token=t1");
    expect(requestTicket).not.toHaveBeenCalled();

    sockets[1]!.open();
    sockets[1]!.receive({ type: "welcome", preview: "abc", expiresAt: new Date(T0).toISOString() });
    sockets[1]!.serverClose(4001);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(requestTicket).toHaveBeenCalledTimes(1);
    expect(sockets[2]!.url).toContain("token=t2");
  });

  it("stops for good when the preview ends", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    sockets[0]!.serverClose(4003);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(statuses[statuses.length - 1]).toBe("ended");
    expect(sockets).toHaveLength(1);
  });

  it("asks the account service after a refused connection and ends when it says so", async () => {
    const requestTicket = vi.fn(async () => {
      throw new PreviewEndedError("This preview has ended.");
    });
    start({ requestTicket });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.serverClose(1006);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(requestTicket).toHaveBeenCalledTimes(1);
    expect(statuses[statuses.length - 1]).toBe("ended");
    expect(sockets).toHaveLength(1);
  });

  it("cancels a request the Worker gave up on", async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn<ProxyFetch>(async (_url, init) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const { onRequest } = start({ fetch });
    await vi.advanceTimersByTimeAsync(0);
    const socket = sockets[0]!;
    socket.open();
    socket.receive({ type: "request", id: "r1", method: "GET", path: "/slow", headers: [] });
    await vi.advanceTimersByTimeAsync(0);
    socket.receive({ type: "cancel", id: "r1" });
    expect(signal?.aborted).toBe(true);
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("closes the socket when stopped", async () => {
    const { connection } = start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    connection.close();
    expect(sockets[0]!.readyState).toBe(3);
    expect(connection.status()).toBe("ended");
  });
});
