import { describe, expect, it } from "vite-plus/test";
import { takeSubtreePreloadBatch } from "../services/subtree-preload-queue";

describe("takeSubtreePreloadBatch", () => {
  it("never reserves more directories than the remaining budget", () => {
    const queue = Array.from({ length: 12 }, (_, index) => ({
      path: `/repo/dir-${index}`,
      depth: 1,
    }));

    const batch = takeSubtreePreloadBatch(queue, new Set(), 2, 3);

    expect(batch.map((item) => item.path)).toEqual([
      "/repo/dir-0",
      "/repo/dir-1",
      "/repo/dir-2",
    ]);
    expect(queue).toHaveLength(9);
  });

  it("skips duplicate and out-of-depth work without spending the budget", () => {
    const queue = [
      { path: "/repo/already", depth: 1 },
      { path: "/repo/too-deep", depth: 2 },
      { path: "/repo/next", depth: 1 },
    ];
    const visited = new Set(["/repo/already"]);

    expect(takeSubtreePreloadBatch(queue, visited, 2, 1)).toEqual([
      { path: "/repo/next", depth: 1 },
    ]);
    expect(visited).toEqual(new Set(["/repo/already", "/repo/next"]));
  });
});
