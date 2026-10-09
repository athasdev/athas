import {
  fetchCollaborationMediaSignals,
  postCollaborationMediaSignal,
  type CollaborationMediaSignal,
} from "@/features/collaboration/services/collaboration-api";
import {
  connectCollaborationRoom,
  type CollaborationMediaSignalKind,
  type CollaborationRoomServerMessage,
} from "@/features/collaboration/services/collaboration-realtime";

export type MediaSignalTransportMode = "pending" | "realtime" | "polling";

export interface MediaSignalTransport {
  readonly mode: () => MediaSignalTransportMode;
  send: (
    recipientDeviceId: string | null,
    kind: CollaborationMediaSignalKind,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  /** Signals are only exchanged while a call is active in the channel. */
  setActive: (active: boolean) => void;
  close: () => void;
}

const POLL_INTERVAL_MS = 1_000;

type PendingSignal = {
  recipientDeviceId: string | null;
  kind: CollaborationMediaSignalKind;
  payload: Record<string, unknown>;
};

export function toMediaSignal(
  channelId: number,
  message: Extract<CollaborationRoomServerMessage, { type: "signal" }>,
): CollaborationMediaSignal | null {
  if (!message.from.deviceId) return null;
  return {
    id: 0,
    channelId,
    senderDeviceId: message.from.deviceId,
    recipientDeviceId: message.to ?? null,
    kind: message.kind,
    payload: message.payload,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Exchanges WebRTC signaling for one channel. It joins the channel's realtime room right away, so
 * offers reach teammates who are only looking at the channel (rooms keep nothing for latecomers),
 * and relays signals over its WebSocket. When realtime rooms are off or unreachable it falls back
 * to posting signals to the account service and polling for new ones every second during a call.
 */
export function createMediaSignalTransport(options: {
  channelId: number;
  deviceId: string;
  onSignal: (signal: CollaborationMediaSignal) => void | Promise<void>;
  /** A device joined the room, for example after reconnecting, and may need a new offer. */
  onDeviceJoined?: (deviceId: string) => void;
  connectRoom?: typeof connectCollaborationRoom;
  fetchSignals?: typeof fetchCollaborationMediaSignals;
  postSignal?: typeof postCollaborationMediaSignal;
  pollIntervalMs?: number;
}): MediaSignalTransport {
  const connectRoom = options.connectRoom ?? connectCollaborationRoom;
  const fetchSignals = options.fetchSignals ?? fetchCollaborationMediaSignals;
  const postSignal = options.postSignal ?? postCollaborationMediaSignal;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  let mode: MediaSignalTransportMode = "pending";
  let active = false;
  let closed = false;
  let afterId = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let pending: PendingSignal[] = [];
  let delivery = Promise.resolve();

  const deliver = (signal: CollaborationMediaSignal) => {
    delivery = delivery
      .then(() => (closed ? undefined : options.onSignal(signal)))
      .catch(() => {
        if (import.meta.env.DEV) console.debug("Collaboration media signal handling failed");
      });
  };

  const post = (signal: PendingSignal) =>
    postSignal({
      channelId: options.channelId,
      senderDeviceId: options.deviceId,
      recipientDeviceId: signal.recipientDeviceId,
      kind: signal.kind,
      payload: signal.payload,
    }).then(() => undefined);

  const poll = async () => {
    if (polling || closed) return;
    polling = true;
    try {
      const signals = await fetchSignals({
        channelId: options.channelId,
        afterId,
        deviceId: options.deviceId,
      });
      for (const signal of signals) {
        afterId = Math.max(afterId, signal.id);
        deliver(signal);
      }
    } catch {
      if (import.meta.env.DEV) console.debug("Collaboration media signal poll failed");
    } finally {
      polling = false;
    }
  };

  const syncPolling = () => {
    const shouldPoll = !closed && active && mode === "polling";
    if (shouldPoll && !pollTimer) {
      void poll();
      pollTimer = setInterval(() => void poll(), pollIntervalMs);
    } else if (!shouldPoll && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const sendOverRoom = (signal: PendingSignal) =>
    room.send(
      {
        type: "signal",
        kind: signal.kind,
        ...(signal.recipientDeviceId ? { to: signal.recipientDeviceId } : {}),
        payload: signal.payload,
      },
      { queue: true },
    );

  const fallBackToPolling = () => {
    mode = "polling";
    const queued = pending;
    pending = [];
    for (const signal of queued) void post(signal).catch(() => undefined);
    syncPolling();
  };

  const room = connectRoom({
    target: { channelId: options.channelId },
    deviceId: options.deviceId,
    onStatus: (status) => {
      if (closed) return;
      if (status === "open" && mode === "pending") {
        mode = "realtime";
        const queued = pending;
        pending = [];
        for (const signal of queued) sendOverRoom(signal);
      } else if (status === "unavailable") {
        fallBackToPolling();
      }
    },
    onMessage: (message) => {
      if (closed) return;
      if (message.type === "join") {
        const deviceId = message.member.deviceId;
        if (deviceId && deviceId !== options.deviceId) options.onDeviceJoined?.(deviceId);
        return;
      }
      if (message.type !== "signal" || message.from.deviceId === options.deviceId) return;
      if (message.to && message.to !== options.deviceId) return;
      const signal = toMediaSignal(options.channelId, message);
      if (signal) deliver(signal);
    },
  });

  return {
    mode: () => mode,
    send: async (recipientDeviceId, kind, payload) => {
      if (closed) return;
      const signal = { recipientDeviceId, kind, payload };
      if (mode === "pending") {
        pending.push(signal);
        return;
      }
      if (mode === "realtime" && sendOverRoom(signal)) return;
      await post(signal);
    },
    setActive: (next) => {
      active = next;
      syncPolling();
    },
    close: () => {
      closed = true;
      pending = [];
      room.close();
      syncPolling();
    },
  };
}
