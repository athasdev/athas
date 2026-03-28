import { describe, expect, it } from "vite-plus/test";
import { buildWorkspaceRestorePlan } from "./workspace-session";

describe("buildWorkspaceRestorePlan", () => {
  it("prioritizes the active buffer and defers the rest in order", () => {
    const plan = buildWorkspaceRestorePlan({
      activeBufferPath: "/next/src/app.ts",
      buffers: [
        { path: "/next/README.md", name: "README.md", isPinned: false },
        { path: "/next/src/app.ts", name: "app.ts", isPinned: true },
        { path: "/next/src/lib.ts", name: "lib.ts", isPinned: false },
      ],
    });

    expect(plan.initialBuffer?.path).toBe("/next/src/app.ts");
    expect(plan.remainingBuffers.map((buffer) => buffer.path)).toEqual([
      "/next/README.md",
      "/next/src/lib.ts",
    ]);
  });

  it("falls back to the first buffer when the saved active buffer is missing", () => {
    const plan = buildWorkspaceRestorePlan({
      activeBufferPath: "/next/src/missing.ts",
      buffers: [
        { path: "/next/src/first.ts", name: "first.ts", isPinned: false },
        { path: "/next/src/second.ts", name: "second.ts", isPinned: false },
      ],
    });

    expect(plan.initialBuffer?.path).toBe("/next/src/first.ts");
    expect(plan.remainingBuffers.map((buffer) => buffer.path)).toEqual(["/next/src/second.ts"]);
  });

  it("returns an empty plan when there is no session", () => {
    expect(buildWorkspaceRestorePlan(null)).toEqual({
      activeBufferPath: null,
      initialBuffer: null,
      remainingBuffers: [],
    });
  });
});
