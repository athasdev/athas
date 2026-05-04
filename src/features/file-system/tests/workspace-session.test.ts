import { describe, expect, it } from "vite-plus/test";
import {
  buildWorkspaceRestoreBatch,
  buildWorkspaceRestorePlan,
} from "../controllers/workspace-session";

describe("buildWorkspaceRestorePlan", () => {
  it("prioritizes the active buffer and defers the rest in order", () => {
    const plan = buildWorkspaceRestorePlan({
      activeBufferPath: "/next/src/app.ts",
      buffers: [
        { type: "editor", path: "/next/README.md", name: "README.md", isPinned: false },
        { type: "editor", path: "/next/src/app.ts", name: "app.ts", isPinned: true },
        { type: "editor", path: "/next/src/lib.ts", name: "lib.ts", isPinned: false },
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
        { type: "editor", path: "/next/src/first.ts", name: "first.ts", isPinned: false },
        { type: "editor", path: "/next/src/second.ts", name: "second.ts", isPinned: false },
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

  it("keeps terminal tabs restorable with their saved metadata", () => {
    const plan = buildWorkspaceRestorePlan({
      activeBufferPath: "terminal://terminal-tab-1",
      buffers: [
        {
          type: "terminal",
          path: "terminal://terminal-tab-1",
          name: "Claude Code",
          isPinned: false,
          sessionId: "terminal-tab-1",
          workingDirectory: "/next",
          initialCommand: "claude",
        },
        { type: "editor", path: "/next/src/app.ts", name: "app.ts", isPinned: false },
      ],
    });

    expect(plan.initialBuffer).toEqual({
      type: "terminal",
      path: "terminal://terminal-tab-1",
      name: "Claude Code",
      isPinned: false,
      sessionId: "terminal-tab-1",
      workingDirectory: "/next",
      initialCommand: "claude",
    });
    expect(plan.remainingBuffers.map((buffer) => buffer.path)).toEqual(["/next/src/app.ts"]);
  });
});

describe("buildWorkspaceRestoreBatch", () => {
  const buffers = [
    { type: "editor" as const, path: "/next/one.ts", name: "one.ts", isPinned: false },
    { type: "editor" as const, path: "/next/two.ts", name: "two.ts", isPinned: false },
    { type: "editor" as const, path: "/next/three.ts", name: "three.ts", isPinned: false },
  ];

  it("splits immediate and deferred restore buffers by limit", () => {
    expect(buildWorkspaceRestoreBatch(buffers, 2)).toEqual({
      buffersToRestore: buffers.slice(0, 2),
      deferredBuffers: buffers.slice(2),
    });
  });

  it("defers all buffers when restore limit is disabled", () => {
    expect(buildWorkspaceRestoreBatch(buffers, 0)).toEqual({
      buffersToRestore: [],
      deferredBuffers: buffers,
    });
  });
});
