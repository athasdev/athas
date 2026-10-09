import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/features/auth/services/auth-api", () => ({
  authenticatedFetch: vi.fn(),
  AuthApiError: Error,
}));

import { createMediaSignalTransport } from "../services/collaboration-media-signaling";
import type {
  CollaborationRoomClientMessage,
  CollaborationRoomServerMessage,
  CollaborationRoomStatus,
  connectCollaborationRoom,
} from "../services/collaboration-realtime";

type RoomOptions = Parameters<typeof connectCollaborationRoom>[0];

function fakeRoom() {
  const state = {
    options: null as RoomOptions | null,
    sent: [] as CollaborationRoomClientMessage[],
    closed: false,
    connects: 0,
  };
  const connectRoom = vi.fn((options: RoomOptions) => {
    state.options = options;
    state.connects += 1;
    return {
      isOpen: () => true,
      send: (message: CollaborationRoomClientMessage) => {
        state.sent.push(message);
        return true;
      },
      close: () => {
        state.closed = true;
      },
    };
  });
  return {
    state,
    connectRoom,
    status: (status: CollaborationRoomStatus) => state.options?.onStatus?.(status),
    receive: (message: CollaborationRoomServerMessage) => state.options?.onMessage(message),
  };
}

const from = { connectionId: "c-2", userId: 2, deviceId: "device-2" };

function setup() {
  const room = fakeRoom();
  const onSignal = vi.fn();
  const onDeviceJoined = vi.fn();
  const fetchSignals = vi.fn(async () => [] as never[]);
  const postSignal = vi.fn(async () => null);
  const transport = createMediaSignalTransport({
    channelId: 3,
    deviceId: "device-1",
    onSignal,
    onDeviceJoined,
    connectRoom: room.connectRoom as unknown as typeof connectCollaborationRoom,
    fetchSignals,
    postSignal,
  });
  return { room, onSignal, onDeviceJoined, fetchSignals, postSignal, transport };
}

describe("media signal transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("relays signals over the channel room once it opens", async () => {
    const { room, onSignal, fetchSignals, postSignal, transport } = setup();
    transport.setActive(true);
    expect(room.connectRoom).toHaveBeenCalledWith(
      expect.objectContaining({ target: { channelId: 3 }, deviceId: "device-1" }),
    );

    await transport.send("device-2", "offer", { type: "offer", sdp: "v=0" });
    expect(room.state.sent).toEqual([]);

    room.status("open");
    expect(transport.mode()).toBe("realtime");
    expect(room.state.sent).toEqual([
      { type: "signal", kind: "offer", to: "device-2", payload: { type: "offer", sdp: "v=0" } },
    ]);

    await transport.send(null, "leave", {});
    expect(room.state.sent[room.state.sent.length - 1]).toEqual({
      type: "signal",
      kind: "leave",
      payload: {},
    });

    room.receive({ type: "signal", from, kind: "answer", to: "device-1", payload: { a: 1 } });
    room.receive({ type: "signal", from, kind: "ice", to: "device-9", payload: {} });
    room.receive({
      type: "signal",
      from: { ...from, deviceId: "device-1" },
      kind: "ice",
      payload: {},
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 3,
        senderDeviceId: "device-2",
        recipientDeviceId: "device-1",
        kind: "answer",
        payload: { a: 1 },
      }),
    );
    expect(fetchSignals).not.toHaveBeenCalled();
    expect(postSignal).not.toHaveBeenCalled();

    transport.close();
    expect(room.state.closed).toBe(true);
  });

  it("falls back to posting and polling when the room is unavailable", async () => {
    const { room, onSignal, fetchSignals, postSignal, transport } = setup();
    const signal = {
      id: 5,
      channelId: 3,
      senderDeviceId: "device-2",
      recipientDeviceId: "device-1",
      kind: "offer",
      payload: {},
      createdAt: null,
    };
    fetchSignals.mockResolvedValueOnce([signal] as never[]);

    transport.setActive(true);
    await transport.send("device-2", "offer", { sdp: "v=0" });
    room.status("unavailable");
    expect(transport.mode()).toBe("polling");
    expect(postSignal).toHaveBeenCalledWith({
      channelId: 3,
      senderDeviceId: "device-1",
      recipientDeviceId: "device-2",
      kind: "offer",
      payload: { sdp: "v=0" },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onSignal).toHaveBeenCalledWith(signal);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSignals).toHaveBeenLastCalledWith({
      channelId: 3,
      afterId: 5,
      deviceId: "device-1",
    });

    await transport.send(null, "ice", { candidate: "c" });
    expect(postSignal).toHaveBeenCalledTimes(2);

    transport.setActive(false);
    const polls = fetchSignals.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchSignals).toHaveBeenCalledTimes(polls);
  });

  it("joins the room right away and reports devices that join", () => {
    const { room, onDeviceJoined, fetchSignals } = setup();
    expect(room.connectRoom).toHaveBeenCalledTimes(1);

    room.receive({ type: "join", member: from });
    room.receive({ type: "join", member: { ...from, deviceId: "device-1" } });
    room.receive({ type: "join", member: { connectionId: "c-3", userId: 3 } });
    expect(onDeviceJoined).toHaveBeenCalledTimes(1);
    expect(onDeviceJoined).toHaveBeenCalledWith("device-2");

    room.status("unavailable");
    expect(fetchSignals).not.toHaveBeenCalled();
  });
});
