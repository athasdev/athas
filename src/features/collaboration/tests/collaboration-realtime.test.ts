import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const authenticatedFetch = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/services/auth-api", () => ({
  authenticatedFetch,
  AuthApiError: class AuthApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));

import {
  connectCollaborationRoom,
  parseCollaborationRoomMessage,
  publishDocumentPresence,
  requestCollaborationRoomTicket,
  resetCollaborationRealtimeAvailability,
  toRemoteDocumentUpdate,
  type CollaborationRoomConnection,
  type CollaborationRoomSocket,
  type CollaborationRoomStatus,
  type CollaborationRoomTicket,
} from "../services/collaboration-realtime";

class FakeSocket implements CollaborationRoomSocket {
  readyState = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code ?? 1000;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

const member = { connectionId: "c-2", userId: 2, name: "Grace", deviceId: "device-2" };

function setup(tickets: Array<CollaborationRoomTicket | null | Error>) {
  const sockets: FakeSocket[] = [];
  const statuses: CollaborationRoomStatus[] = [];
  const messages: unknown[] = [];
  const requestTicket = vi.fn(async () => {
    const next = tickets.length > 1 ? tickets.shift()! : tickets[0]!;
    if (next instanceof Error) throw next;
    return next;
  });
  const room = connectCollaborationRoom({
    target: { channelId: 3 },
    deviceId: "device-1",
    onMessage: (message) => messages.push(message),
    onStatus: (status) => statuses.push(status),
    requestTicket,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  return { room, sockets, statuses, messages, requestTicket };
}

const ticket = (n: number, expiresAt = Date.now() + 10 * 60_000) => ({
  url: `wss://realtime.athas.dev/rooms/channel-3?token=t${n}`,
  expiresAt,
});

describe("collaboration room tickets", () => {
  beforeEach(() => {
    resetCollaborationRealtimeAvailability();
    authenticatedFetch.mockReset();
  });

  it("returns the room URL from the account service", async () => {
    authenticatedFetch.mockResolvedValue(
      Response.json({ url: ticket(1).url, expiresAt: "2026-10-09T12:10:00.000Z" }),
    );

    await expect(requestCollaborationRoomTicket({ channelId: 3 }, "device-1")).resolves.toEqual({
      url: ticket(1).url,
      expiresAt: Date.parse("2026-10-09T12:10:00.000Z"),
    });
    expect(authenticatedFetch).toHaveBeenCalledWith("/api/collaboration/rooms/token", {
      method: "POST",
      body: JSON.stringify({ channelId: 3, deviceId: "device-1" }),
      timeoutMs: 10_000,
    });
  });

  it("remembers for a while that realtime rooms are off", async () => {
    authenticatedFetch.mockResolvedValue(Response.json({ error: "off" }, { status: 404 }));
    const now = Date.parse("2026-10-09T12:00:00.000Z");

    await expect(requestCollaborationRoomTicket({ documentId: 7 }, "d", now)).resolves.toBeNull();
    await expect(
      requestCollaborationRoomTicket({ documentId: 7 }, "d", now + 60_000),
    ).resolves.toBeNull();
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);

    await requestCollaborationRoomTicket({ documentId: 7 }, "d", now + 6 * 60_000);
    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it("throws on other failures so the room retries", async () => {
    authenticatedFetch.mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 }));
    await expect(requestCollaborationRoomTicket({ channelId: 3 }, "d")).rejects.toThrow(
      "Forbidden",
    );
  });
});

describe("collaboration room messages", () => {
  it("parses relayed messages and ignores keepalive replies and junk", () => {
    expect(
      parseCollaborationRoomMessage(
        JSON.stringify({ type: "signal", from: member, kind: "offer", payload: { sdp: "v=0" } }),
      ),
    ).toEqual({ type: "signal", from: member, kind: "offer", payload: { sdp: "v=0" } });
    expect(parseCollaborationRoomMessage(JSON.stringify({ type: "leave", member }))).toEqual({
      type: "leave",
      member,
    });
    expect(parseCollaborationRoomMessage("pong")).toBeNull();
    expect(parseCollaborationRoomMessage("{")).toBeNull();
    expect(
      parseCollaborationRoomMessage(JSON.stringify({ type: "signal", from: member, kind: "x" })),
    ).toBeNull();
  });

  it("turns relayed presence into remote document updates", () => {
    const update = toRemoteDocumentUpdate(7, {
      type: "presence",
      from: member,
      data: { updateType: "cursor", operation: { cursor: { line: 1, column: 2, offset: 3 } } },
    });
    expect(update).toMatchObject({
      documentId: 7,
      actorUserId: 2,
      clientId: "device-2",
      updateType: "cursor",
      operation: { cursor: { line: 1, column: 2, offset: 3 } },
    });
    expect(
      toRemoteDocumentUpdate(7, {
        type: "presence",
        from: member,
        data: { updateType: "content", operation: {} },
      }),
    ).toBeNull();
  });
});

describe("collaboration room connection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-09T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects, relays messages, and flushes queued messages when open", async () => {
    const { room, sockets, statuses, messages } = setup([ticket(1)]);
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets).toHaveLength(1);
    expect(room.send({ type: "presence", data: {} })).toBe(false);
    expect(room.send({ type: "signal", kind: "offer", payload: {} }, { queue: true })).toBe(true);

    sockets[0]!.open();
    expect(room.isOpen()).toBe(true);
    expect(statuses).toEqual(["connecting", "open"]);
    expect(sockets[0]!.sent).toEqual([
      JSON.stringify({ type: "signal", kind: "offer", payload: {} }),
    ]);

    sockets[0]!.receive({ type: "join", member });
    expect(messages).toEqual([{ type: "join", member }]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(sockets[0]!.sent).toContain("ping");

    room.close();
    expect(sockets[0]!.closedWith).toBe(1000);
    expect(statuses[statuses.length - 1]).toBe("closed");
  });

  it("reports unavailable without opening a socket when realtime rooms are off", async () => {
    const { room, sockets, statuses } = setup([null]);
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets).toHaveLength(0);
    expect(statuses).toEqual(["connecting", "unavailable"]);
    expect(room.send({ type: "signal", kind: "ice", payload: {} }, { queue: true })).toBe(false);
  });

  it("gives up after repeated failures when the room never opened", async () => {
    const { sockets, statuses } = setup([ticket(1)]);
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.drop();
    await vi.advanceTimersByTimeAsync(2_000);
    sockets[1]!.drop();
    await vi.advanceTimersByTimeAsync(4_000);
    sockets[2]!.drop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sockets).toHaveLength(3);
    expect(statuses).toEqual(["connecting", "reconnecting", "unavailable"]);
  });

  it("reconnects with backoff after the connection drops", async () => {
    const { sockets, statuses, requestTicket } = setup([ticket(1)]);
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();

    for (let i = 0; i < 4; i++) {
      sockets[sockets.length - 1]!.drop();
      await vi.advanceTimersByTimeAsync(20_000);
    }
    expect(sockets).toHaveLength(5);
    expect(statuses).toEqual(["connecting", "open", "reconnecting"]);

    sockets[sockets.length - 1]!.open();
    expect(statuses[statuses.length - 1]).toBe("open");
    expect(requestTicket).toHaveBeenCalledTimes(1);
  });

  it("refreshes the room token before it expires and reconnects with the new one", async () => {
    const { sockets, requestTicket } = setup([
      ticket(1, Date.now() + 10 * 60_000),
      ticket(2, Date.now() + 20 * 60_000),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(requestTicket).toHaveBeenCalledTimes(2);

    sockets[0]!.drop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets[1]!.url).toBe(ticket(2).url);
  });

  it("renews the open socket with the refreshed token", async () => {
    const { sockets } = setup([
      ticket(1, Date.now() + 10 * 60_000),
      ticket(2, Date.now() + 20 * 60_000),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(sockets[0]!.sent).toContain(JSON.stringify({ type: "renew", token: "t2" }));
    expect(sockets).toHaveLength(1);
  });

  it("asks for a new token when the room closes the socket because its token expired", async () => {
    const { sockets, statuses, requestTicket } = setup([
      ticket(1, Date.now() + 10 * 60_000),
      ticket(2, Date.now() + 20 * 60_000),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();

    sockets[0]!.drop(4001);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(requestTicket).toHaveBeenCalledTimes(2);
    expect(sockets[1]!.url).toBe(ticket(2).url);
    sockets[1]!.open();
    expect(statuses[statuses.length - 1]).toBe("open");
  });

  it("reconnects when a closing socket never reports its close", async () => {
    const { sockets, statuses } = setup([ticket(1)]);
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();

    sockets[0]!.readyState = 2;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(statuses[statuses.length - 1]).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(2);
    sockets[0]!.drop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets).toHaveLength(2);
  });

  it("retries when the token request fails", async () => {
    const { sockets, requestTicket } = setup([new Error("offline"), ticket(1)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(requestTicket).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
  });
});

describe("document presence transport", () => {
  const operation = { source: "desktop-cursor", cursor: { line: 1, column: 1, offset: 0 } };

  it("uses the room when it is open", () => {
    const send = vi.fn(() => true);
    const sendOverRest = vi.fn();
    const room = { isOpen: () => true, send, close: vi.fn() } as CollaborationRoomConnection;

    expect(publishDocumentPresence({ room, updateType: "cursor", operation, sendOverRest })).toBe(
      "realtime",
    );
    expect(send).toHaveBeenCalledWith({
      type: "presence",
      data: { updateType: "cursor", operation },
    });
    expect(sendOverRest).not.toHaveBeenCalled();
  });

  it("falls back to document updates without an open room", () => {
    const sendOverRest = vi.fn();
    const closedRoom = {
      isOpen: () => false,
      send: vi.fn(),
      close: vi.fn(),
    } as CollaborationRoomConnection;

    expect(
      publishDocumentPresence({ room: null, updateType: "metadata", operation, sendOverRest }),
    ).toBe("rest");
    expect(
      publishDocumentPresence({ room: closedRoom, updateType: "cursor", operation, sendOverRest }),
    ).toBe("rest");
    expect(closedRoom.send).not.toHaveBeenCalled();
    expect(sendOverRest).toHaveBeenCalledTimes(2);
  });
});
