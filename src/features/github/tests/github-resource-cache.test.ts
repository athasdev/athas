import { describe, expect, it } from "vite-plus/test";
import { createTimedResourceCache } from "@/utils/timed-resource-cache";

describe("createTimedResourceCache", () => {
  it("does not let an invalidated request repopulate or release a newer request", async () => {
    const cache = createTimedResourceCache<number>();
    const old = Promise.withResolvers<number>();
    const fresh = Promise.withResolvers<number>();
    const oldLoad = cache.load("repo", () => old.promise);
    cache.clear("repo");
    const newLoad = cache.load("repo", () => fresh.promise);
    old.resolve(1);
    await oldLoad;
    expect(cache.getSnapshot("repo")).toBeUndefined();
    const joinedLoad = cache.load("repo", async () => 3);
    fresh.resolve(2);
    expect(await newLoad).toBe(2);
    expect(await joinedLoad).toBe(2);
    expect(cache.getSnapshot("repo")?.value).toBe(2);
  });

  it("preserves explicit updates against pending loads", async () => {
    const cache = createTimedResourceCache<number>();
    const pending = Promise.withResolvers<number>();
    const load = cache.load("repo", () => pending.promise);
    cache.set("repo", 2);
    pending.resolve(1);
    await load;
    expect(cache.getSnapshot("repo")?.value).toBe(2);
  });

  it("invalidates an empty key without clearing unrelated repositories", () => {
    const cache = createTimedResourceCache<number>();
    cache.set("", 1);
    cache.set("repo", 2);
    cache.clear("");
    expect(cache.getSnapshot("")).toBeUndefined();
    expect(cache.getSnapshot("repo")?.value).toBe(2);
  });

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
