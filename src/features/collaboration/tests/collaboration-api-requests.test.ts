// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AuthApiError } from "@/features/auth/services/auth-api";
import {
  appendCollaborationDocumentUpdate,
  appendCollaborationPrivateChatMessage,
  createCollaborationChannel,
  fetchCollaborationMediaSignals,
  getCollaborationClientId,
  getNextCollaborationClientSeq,
  postCollaborationMediaSignal,
  registerCollaborationDocument,
  streamCollaborationDocumentUpdates,
  updateCollaborationChannelNote,
  updateCollaborationPresence,
} from "../services/collaboration-api";

const http = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; init?: RequestInit }>,
  next: [] as Response[],
}));

vi.mock("@/features/auth/services/auth-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/services/auth-api")>()),
  authenticatedFetch: async (path: string, init?: RequestInit) => {
    http.requests.push({ path, init });
    const response = http.next.shift();
    if (!response) throw new Error(`Unexpected request to ${path}`);
    return response;
  },
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function sse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

const lastBody = () => JSON.parse(String(http.requests[http.requests.length - 1]?.init?.body));

beforeEach(() => {
  http.requests = [];
  http.next = [];
});

describe("collaboration identity", () => {
  it("keeps one device id per installation", () => {
    const first = getCollaborationClientId();

    expect(getCollaborationClientId()).toBe(first);
    expect(localStorage.getItem("athas_collaboration_device_id")).toBe(first);
  });

  it("numbers client updates monotonically and recovers from a corrupt counter", () => {
    localStorage.setItem("athas_collaboration_client_seq", "41");
    expect(getNextCollaborationClientSeq()).toBe(42);
    expect(getNextCollaborationClientSeq()).toBe(43);

    localStorage.setItem("athas_collaboration_client_seq", "not-a-number");
    expect(getNextCollaborationClientSeq()).toBe(1);
    localStorage.setItem("athas_collaboration_client_seq", "-5");
    expect(getNextCollaborationClientSeq()).toBe(1);
  });
});

describe("collaboration requests", () => {
  it("posts presence with defaults filled in and returns the new snapshot", async () => {
    http.next.push(json({ collaboration: { enabled: true } }));

    const snapshot = await updateCollaborationPresence({ activeFilePath: "/repo/a.ts" });

    expect(snapshot).toEqual({ enabled: true });
    expect(http.requests[0].path).toBe("/api/collaboration/presence");
    expect(http.requests[0].init?.method).toBe("POST");
    expect(lastBody()).toEqual({
      deviceId: getCollaborationClientId(),
      status: "online",
      channelId: null,
      followingUserId: null,
      activeFilePath: "/repo/a.ts",
      cursorLabel: null,
    });
  });

  it("sends channel, chat and document mutations to their endpoints", async () => {
    http.next.push(json({}), json({}), json({}), json({}), json({}));

    await updateCollaborationChannelNote({ channelId: 3, contentMarkdown: "# Notes" });
    await createCollaborationChannel({ name: "design" });
    await appendCollaborationPrivateChatMessage({ memberId: 9, body: "hi" });
    await registerCollaborationDocument({ path: "/repo/a.ts" });
    await appendCollaborationDocumentUpdate({ documentId: 7, clientId: "c", clientSeq: 2 });

    expect(http.requests.map(({ path, init }) => [init?.method, path])).toEqual([
      ["PATCH", "/api/collaboration/channels/3/notes"],
      ["POST", "/api/collaboration/channels"],
      ["POST", "/api/collaboration/private-chats/9/messages"],
      ["POST", "/api/collaboration/documents"],
      ["POST", "/api/collaboration/documents/7/updates"],
    ]);
    expect(http.requests.map(({ init }) => JSON.parse(String(init?.body)))).toEqual([
      { contentMarkdown: "# Notes" },
      { name: "design", visibility: "workspace" },
      { body: "hi" },
      { path: "/repo/a.ts", baseVersion: 0, stateVector: {} },
      { clientId: "c", clientSeq: 2, updateType: "metadata", operation: {} },
    ]);
  });

  it("returns null when a mutation answers without a snapshot", async () => {
    http.next.push(new Response("not json", { status: 200 }));

    expect(await registerCollaborationDocument({ path: "/repo/a.ts" })).toBeNull();
  });

  it("surfaces the server's error message with the HTTP status", async () => {
    http.next.push(json({ error: "Channel limit reached" }, 403));

    const error = await createCollaborationChannel({ name: "x" }).catch((reason) => reason);

    expect(error).toBeInstanceOf(AuthApiError);
    expect(error).toMatchObject({ message: "Channel limit reached", status: 403 });
  });

  it("falls back to a descriptive error when the server gives none", async () => {
    const failures: Array<[() => Promise<unknown>, string]> = [
      [() => updateCollaborationPresence({}), "Failed to update collaboration presence: 500"],
      [
        () => updateCollaborationChannelNote({ channelId: 1, contentMarkdown: "" }),
        "Failed to update collaboration channel note: 500",
      ],
      [
        () => appendCollaborationPrivateChatMessage({ memberId: 1, body: "" }),
        "Failed to send private chat message: 500",
      ],
      [
        () => fetchCollaborationMediaSignals({ channelId: 1, deviceId: "d" }),
        "Failed to fetch collaboration media signals: 500",
      ],
      [
        () =>
          postCollaborationMediaSignal({
            channelId: 1,
            senderDeviceId: "d",
            kind: "offer",
            payload: {},
          }),
        "Failed to post collaboration media signal: 500",
      ],
      [
        () => registerCollaborationDocument({ path: "/a" }),
        "Failed to register collaboration document: 500",
      ],
      [
        () => appendCollaborationDocumentUpdate({ documentId: 1, clientId: "c", clientSeq: 1 }),
        "Failed to append collaboration document update: 500",
      ],
      [
        () => streamCollaborationDocumentUpdates({ documentId: 1, onEvent: () => undefined }),
        "Failed to stream collaboration document updates: 500",
      ],
    ];

    for (const [request, message] of failures) {
      http.next.push(new Response("oops", { status: 500 }));
      await expect(request()).rejects.toThrow(message);
    }
  });

  it("polls media signals after the last seen id for this device", async () => {
    http.next.push(json({ signals: [{ id: 5 }] }), json({}));

    expect(
      await fetchCollaborationMediaSignals({ channelId: 2, afterId: 4, deviceId: "dev 1" }),
    ).toEqual([{ id: 5 }]);
    expect(await fetchCollaborationMediaSignals({ channelId: 2, deviceId: "dev" })).toEqual([]);
    expect(http.requests.map(({ path }) => path)).toEqual([
      "/api/collaboration/channels/2/media/signals?afterId=4&deviceId=dev+1",
      "/api/collaboration/channels/2/media/signals?afterId=0&deviceId=dev",
    ]);
  });

  it("posts media signals to a recipient or the whole channel", async () => {
    http.next.push(json({ signal: { id: 8 } }), json({}));

    expect(
      await postCollaborationMediaSignal({
        channelId: 2,
        senderDeviceId: "me",
        recipientDeviceId: "you",
        kind: "answer",
        payload: { sdp: "x" },
      }),
    ).toEqual({ id: 8 });
    expect(lastBody()).toEqual({
      senderDeviceId: "me",
      recipientDeviceId: "you",
      kind: "answer",
      payload: { sdp: "x" },
    });

    expect(
      await postCollaborationMediaSignal({
        channelId: 2,
        senderDeviceId: "me",
        kind: "leave",
        payload: {},
      }),
    ).toBeNull();
    expect(lastBody().recipientDeviceId).toBeNull();
  });
});

describe("collaboration document event stream", () => {
  const document = { id: 7, path: "/a", baseVersion: 1, stateVector: {}, updatedAt: null };

  it("parses events split across network chunks, including a trailing event", async () => {
    const ready = `event: ready\ndata: ${JSON.stringify({ document, afterServerVersion: 1 })}\n\n`;
    const heartbeat = `event: heartbeat\ndata: ${JSON.stringify({ document, afterServerVersion: 4 })}`;
    http.next.push(
      sse([
        ready.slice(0, 10),
        ready.slice(10),
        ": comment\n\n",
        heartbeat.slice(0, 20),
        heartbeat.slice(20),
      ]),
    );
    const events: unknown[] = [];

    await streamCollaborationDocumentUpdates({
      documentId: 7,
      afterVersion: 1,
      maxPolls: 3,
      pollIntervalMs: 500,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(http.requests[0].path).toBe(
      "/api/collaboration/documents/7/events?afterVersion=1&limit=100&maxPolls=3&pollIntervalMs=500",
    );
    expect(http.requests[0].init?.headers).toEqual({ Accept: "text/event-stream" });
    expect(events).toEqual([
      { type: "ready", document, afterServerVersion: 1, pollIntervalMs: 2000 },
      { type: "heartbeat", document, afterServerVersion: 4 },
    ]);
  });

  it("reports a stream response without a body", async () => {
    http.next.push(new Response(null, { status: 200 }));

    await expect(
      streamCollaborationDocumentUpdates({ documentId: 7, onEvent: () => undefined }),
    ).rejects.toMatchObject({
      message: "Collaboration document update stream is unavailable.",
      status: 502,
    });
  });

  it("uses the server error for a rejected stream", async () => {
    http.next.push(json({ error: "Document not found" }, 404));

    await expect(
      streamCollaborationDocumentUpdates({ documentId: 7, onEvent: () => undefined }),
    ).rejects.toMatchObject({ message: "Document not found", status: 404 });
  });
});
