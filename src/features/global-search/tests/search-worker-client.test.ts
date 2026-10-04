import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createSearchWorkerSession } from "../services/search-worker-client";
import type { ContentSearchTask, SearchWorkerResponse } from "../workers/search-worker-protocol";

const task: ContentSearchTask = {
  kind: "search",
  filePath: "/w/a.ts",
  content: "foo",
  pattern: "foo",
  flags: "g",
  contextLines: 2,
};
class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<SearchWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    ControlledWorker.instances.push(this);
  }
  reply(id: number, result: SearchWorkerResponse["result"] = null) {
    this.onmessage?.({ data: { id, result } } as MessageEvent<SearchWorkerResponse>);
  }
}
const sessions: ReturnType<typeof createSearchWorkerSession>[] = [];
function session(options?: Parameters<typeof createSearchWorkerSession>[0]) {
  const worker = createSearchWorkerSession(options);
  sessions.push(worker);
  return worker;
}
beforeEach(() => {
  vi.useFakeTimers();
  ControlledWorker.instances = [];
  vi.stubGlobal("Worker", ControlledWorker);
});
afterEach(() => {
  for (const worker of sessions.splice(0)) worker.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("search worker request lifetime", () => {
  it("gives queued files their own deadline and ignores duplicate or unknown replies", async () => {
    const client = session();
    const first = client.run(task);
    const second = client.run({ ...task, filePath: "/w/b.ts" });
    const worker = ControlledWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4_000);
    worker.reply(99);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.reply(0);
    await expect(first).resolves.toBeNull();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    worker.reply(0);
    vi.advanceTimersByTime(4_000);
    worker.reply(1);
    await expect(second).resolves.toBeNull();
    expect(worker.terminate).not.toHaveBeenCalled();
  });
  it("terminates a timed out request and rejects queued files without dispatching them", async () => {
    const client = session();
    const settled = Promise.allSettled([client.run(task), client.run(task)]);
    const worker = ControlledWorker.instances[0];
    vi.advanceTimersByTime(5_000);
    const results = await settled;
    expect(results).toEqual([
      {
        status: "rejected",
        reason: expect.objectContaining({
          message: expect.stringContaining("took too long in /w/a.ts"),
        }),
      },
      {
        status: "rejected",
        reason: expect.objectContaining({
          message: expect.stringContaining("took too long in /w/a.ts"),
        }),
      },
    ]);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenCalledOnce();
    await expect(client.run(task)).rejects.toThrow("took too long");
  });
  it("aborts active and queued work immediately and ignores a retained late callback", async () => {
    const controller = new AbortController();
    const client = session({ signal: controller.signal });
    const settled = Promise.allSettled([client.run(task), client.run(task)]);
    const worker = ControlledWorker.instances[0];
    const late = worker.onmessage;
    controller.abort();
    late?.({ data: { id: 0, result: null } } as MessageEvent<SearchWorkerResponse>);
    expect((await settled).every((result) => result.status === "rejected")).toBe(true);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("cancels a retired view while matching and checks ownership again on receipt", async () => {
    let cancelled = false;
    const client = session({ isCancelled: () => cancelled });
    const pending = client.run(task);
    const result = expect(pending).rejects.toHaveProperty("name", "AbortError");
    cancelled = true;
    ControlledWorker.instances[0].reply(0);
    await result;
    const another = session({ isCancelled: () => cancelled });
    await expect(another.run(task)).rejects.toHaveProperty("name", "AbortError");
    expect(ControlledWorker.instances).toHaveLength(1);
  });
  it("polls ownership even when the worker never answers", async () => {
    let cancelled = false;
    const pending = session({ isCancelled: () => cancelled }).run(task);
    const result = expect(pending).rejects.toHaveProperty("name", "AbortError");
    cancelled = true;
    vi.advanceTimersByTime(50);
    await result;
    expect(ControlledWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it.each(["error", "messageerror", "post", "startup"])(
    "fails visibly on %s and permits a fresh session",
    async (failure) => {
      if (failure === "startup")
        vi.stubGlobal(
          "Worker",
          class {
            constructor() {
              throw new Error("blocked");
            }
          },
        );
      const client = session();
      if (failure === "post") {
        const first = client.run(task);
        ControlledWorker.instances[0].reply(0);
        await first;
        ControlledWorker.instances[0].postMessage.mockImplementation(() => {
          throw new Error("clone");
        });
      }
      const pending = client.run(task);
      const result = expect(pending).rejects.toThrow(/search worker/i);
      if (failure === "error")
        ControlledWorker.instances[0].onerror?.({ preventDefault: () => {} } as ErrorEvent);
      if (failure === "messageerror") ControlledWorker.instances[0].onmessageerror?.();
      await result;
      vi.stubGlobal("Worker", ControlledWorker);
      const next = session().run(task);
      ControlledWorker.instances[ControlledWorker.instances.length - 1].reply(0);
      await expect(next).resolves.toBeNull();
    },
  );
});
