import { describe, expect, it } from "vite-plus/test";
import { createTimedResourceCache } from "./github-resource-cache";

describe("createTimedResourceCache", () => {
  it("reuses in-flight requests for the same key", async () => {
    const cache = createTimedResourceCache<number>();
    let calls = 0;

    const [first, second] = await Promise.all([
      cache.load("a", async () => {
        calls += 1;
        await Promise.resolve();
        return 42;
      }),
      cache.load("a", async () => {
        calls += 1;
        return 0;
      }),
    ]);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(calls).toBe(1);
  });

  it("returns fresh cached values without reloading", async () => {
    const cache = createTimedResourceCache<number>();
    cache.set("a", 7);

    const value = await cache.load(
      "a",
      async () => {
        throw new Error("should not reload");
      },
      { ttlMs: 60_000 },
    );

    expect(value).toBe(7);
  });

  it("exposes stale snapshots even when ttl has expired", async () => {
    const cache = createTimedResourceCache<number>();
    cache.set("a", 9);

    expect(cache.getSnapshot("a")?.value).toBe(9);
    expect(cache.getFreshValue("a", -1)).toBeNull();
  });
});
