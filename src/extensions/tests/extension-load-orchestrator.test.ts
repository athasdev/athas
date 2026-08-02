import { describe, expect, it, vi } from "vite-plus/test";
import { ExtensionLoadError, runExtensionLoadBatch } from "../loader/extension-load-orchestrator";

const extension = (id: string) => ({
  manifest: {
    id,
    displayName: `Extension ${id}`,
  },
});

describe("extension load orchestrator", () => {
  it("loads every extension and preserves registry order", async () => {
    const extensions = [extension("a"), extension("b"), extension("c")];
    const completionOrder: string[] = [];
    let releaseFirstLoad = () => {};
    const firstLoadGate = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve;
    });

    const batchPromise = runExtensionLoadBatch(
      extensions,
      async (candidate) => {
        if (candidate.manifest.id === "a") {
          await firstLoadGate;
        }
        completionOrder.push(candidate.manifest.id);
      },
      { concurrency: 3 },
    );

    await vi.waitFor(() => expect(completionOrder).toEqual(["b", "c"]));
    releaseFirstLoad();
    const results = await batchPromise;

    expect(completionOrder).toEqual(["b", "c", "a"]);
    expect(results.map((result) => result.extension.manifest.id)).toEqual(["a", "b", "c"]);
    expect(results.every((result) => result.status === "loaded")).toBe(true);
  });

  it("captures a typed failure without preventing other extensions from loading", async () => {
    const extensions = [extension("a"), extension("broken"), extension("c")];
    const loaded: string[] = [];
    const failure = new Error("activation failed");

    const results = await runExtensionLoadBatch(extensions, async (candidate) => {
      if (candidate.manifest.id === "broken") {
        throw failure;
      }
      loaded.push(candidate.manifest.id);
    });

    expect(loaded).toEqual(["a", "c"]);
    expect(results[1]).toMatchObject({
      status: "failed",
      error: {
        _tag: "ExtensionLoadError",
        extensionId: "broken",
        displayName: "Extension broken",
        reason: failure,
      },
    });
    expect(results[1]?.status === "failed" && results[1].error).toBeInstanceOf(ExtensionLoadError);
  });

  it("bounds concurrent extension activation", async () => {
    const extensions = [
      extension("a"),
      extension("b"),
      extension("c"),
      extension("d"),
      extension("e"),
    ];
    let activeLoads = 0;
    let maxActiveLoads = 0;
    let releaseLoads = () => {};
    const loadGate = new Promise<void>((resolve) => {
      releaseLoads = resolve;
    });

    const batchPromise = runExtensionLoadBatch(
      extensions,
      async () => {
        activeLoads += 1;
        maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
        await loadGate;
        activeLoads -= 1;
      },
      { concurrency: 2 },
    );

    await vi.waitFor(() => expect(activeLoads).toBe(2));
    releaseLoads();
    await batchPromise;

    expect(maxActiveLoads).toBe(2);
  });
});
