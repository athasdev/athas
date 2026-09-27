import { describe, expect, it, vi } from "vite-plus/test";
import { createPendingQueueDrain } from "../utils/pending-queue-drain";

describe("pending queue drain", () => {
  it("handles what it took even when the caller has gone, and never overlaps", async () => {
    const queue = ["athas://open?path=/a"];
    const takes: Array<ReturnType<typeof Promise.withResolvers<string[]>>> = [];
    const handle = vi.fn();
    const drain = createPendingQueueDrain({
      take: () => {
        const taken = Promise.withResolvers<string[]>();
        takes.push(taken);
        return taken.promise;
      },
      handle,
      onError: vi.fn(),
    });

    // The first mount starts a drain, then unmounts; the remount asks again while it runs.
    const first = drain();
    const second = drain();
    expect(second).toBe(first);
    expect(takes).toHaveLength(1);
    takes[0].resolve(queue.splice(0));
    await vi.waitFor(() => expect(takes).toHaveLength(2));
    queue.push("athas://settings");
    takes[1].resolve(queue.splice(0));
    await first;

    expect(handle.mock.calls.map(([url]) => url)).toEqual([
      "athas://open?path=/a",
      "athas://settings",
    ]);
  });

  it("reports a failed take and drains again next time", async () => {
    const onError = vi.fn();
    const handle = vi.fn();
    const take = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(["one"]);
    const drain = createPendingQueueDrain({ take, handle, onError });
    await drain();
    expect(onError).toHaveBeenCalledOnce();
    await drain();
    expect(handle).toHaveBeenCalledWith("one");
  });
});
