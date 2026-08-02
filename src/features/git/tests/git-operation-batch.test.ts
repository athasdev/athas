import { describe, expect, it } from "vite-plus/test";
import { runGitFileOperationBatch } from "../utils/git-operation-batch";

describe("git file operation batching", () => {
  it("limits concurrent native operations and deduplicates paths", async () => {
    let active = 0;
    let peak = 0;
    const operation = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return true;
    };

    const results = await runGitFileOperationBatch(
      ["a.ts", "b.ts", "a.ts", "c.ts", "d.ts"],
      operation,
      2,
    );

    expect(peak).toBeLessThanOrEqual(2);
    expect(results.size).toBe(4);
    expect(Array.from(results.values())).toEqual([true, true, true, true]);
  });

  it("records failures without aborting the rest of the batch", async () => {
    const results = await runGitFileOperationBatch(
      ["ok.ts", "fail.ts", "after.ts"],
      async (path) => {
        if (path === "fail.ts") throw new Error("failed");
        return true;
      },
    );

    expect(results).toEqual(
      new Map([
        ["ok.ts", true],
        ["fail.ts", false],
        ["after.ts", true],
      ]),
    );
  });
});
