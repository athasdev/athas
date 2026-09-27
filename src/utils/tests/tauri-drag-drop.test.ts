import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Handler = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: mocks.listen }),
}));

import { disposeListener, listenToNativeDragDrop, safeUnlisten } from "@/utils/tauri-drag-drop";

const HANDLER_ID_ERROR = new TypeError(
  "undefined is not an object (evaluating 'listeners[eventId].handlerId')",
);

describe("listenToNativeDragDrop", () => {
  const unhandled = vi.fn();

  beforeEach(() => {
    mocks.handlers.clear();
    mocks.unlisten.mockReset();
    mocks.listen.mockReset();
    mocks.listen.mockImplementation(async (event: string, handler: Handler) => {
      mocks.handlers.set(event, handler);
      return () => mocks.unlisten(event);
    });
    process.on("unhandledRejection", unhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandled);
    unhandled.mockReset();
  });

  it("maps every native drag event onto one handler", async () => {
    const handler = vi.fn();
    await listenToNativeDragDrop(handler);

    mocks.handlers.get("tauri://drag-enter")?.({
      payload: { paths: ["/a"], position: { x: 1, y: 2 } },
    });
    mocks.handlers.get("tauri://drag-over")?.({ payload: { position: { x: 3, y: 4 } } });
    mocks.handlers.get("tauri://drag-drop")?.({
      payload: { paths: ["/a", "/b"], position: { x: 5, y: 6 } },
    });
    mocks.handlers.get("tauri://drag-leave")?.({ payload: null });

    expect(handler.mock.calls.map(([payload]) => payload)).toEqual([
      { type: "enter", paths: ["/a"], position: { x: 1, y: 2 } },
      { type: "over", position: { x: 3, y: 4 } },
      { type: "drop", paths: ["/a", "/b"], position: { x: 5, y: 6 } },
      { type: "leave" },
    ]);
  });

  it("keeps Tauri's unlisten race from escaping as an unhandled rejection", async () => {
    mocks.unlisten.mockImplementation(() => Promise.reject(HANDLER_ID_ERROR));
    const dispose = await listenToNativeDragDrop(vi.fn());

    dispose();
    dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.unlisten).toHaveBeenCalledTimes(4);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("removes listeners that were registered before a later one failed", async () => {
    let calls = 0;
    mocks.listen.mockImplementation(async (event: string) => {
      calls += 1;
      if (calls === 3) throw new Error("listen failed");
      return () => mocks.unlisten(event);
    });

    await expect(listenToNativeDragDrop(vi.fn())).rejects.toThrow("listen failed");
    expect(mocks.unlisten.mock.calls.map(([event]) => event)).toEqual([
      "tauri://drag-enter",
      "tauri://drag-over",
    ]);
  });
});

describe("safeUnlisten", () => {
  it("swallows synchronous unlisten errors", () => {
    expect(() =>
      safeUnlisten(() => {
        throw HANDLER_ID_ERROR;
      }),
    ).not.toThrow();
  });
});

describe("disposeListener", () => {
  const unhandled = vi.fn();

  beforeEach(() => {
    process.on("unhandledRejection", unhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandled);
    unhandled.mockReset();
  });

  it("drops a rejected unlisten and a listen that failed", async () => {
    const unlisten = vi.fn(() => Promise.reject(HANDLER_ID_ERROR));
    disposeListener(Promise.resolve(unlisten));
    disposeListener(Promise.reject(new Error("listen failed")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unlisten).toHaveBeenCalledOnce();
    expect(unhandled).not.toHaveBeenCalled();
  });
});
