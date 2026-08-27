import { describe, expect, it, vi } from "vite-plus/test";
import type { BufferSession } from "@/features/workspace/types/workspace-session.types";
import { drainDeferredWorkspaceSessionBuffers } from "../services/workspace-deferred-session-restore";

function editorBuffer(path: string): BufferSession {
  return {
    type: "editor",
    path,
    name: path.split("/").pop() ?? path,
    isPinned: false,
  };
}

function createRestoreHarness(pendingBuffers: BufferSession[]) {
  const events: string[] = [];

  return {
    events,
    pendingBuffers,
    options: {
      pendingBuffers,
      waitForIdle: async () => {
        events.push("idle");
      },
      shouldContinue: () => true,
      restoreBuffer: async (buffer: BufferSession) => {
        events.push(`restore:${buffer.path}`);
      },
      onBufferError: (buffer: BufferSession) => events.push(`error:${buffer.path}`),
      afterBufferRestored: (buffer: BufferSession) => events.push(`after:${buffer.path}`),
    },
  };
}

describe("deferred workspace session restore", () => {
  it("restores queued buffers sequentially after an idle boundary", async () => {
    const harness = createRestoreHarness([editorBuffer("/a.ts"), editorBuffer("/b.ts")]);

    await expect(drainDeferredWorkspaceSessionBuffers(harness.options)).resolves.toEqual({
      completed: true,
      restoredBufferCount: 2,
    });
    expect(harness.pendingBuffers).toEqual([]);
    expect(harness.events).toEqual([
      "idle",
      "restore:/a.ts",
      "after:/a.ts",
      "idle",
      "restore:/b.ts",
      "after:/b.ts",
    ]);
  });

  it("pauses before consuming the next buffer when the workspace is no longer active", async () => {
    const buffers = [editorBuffer("/a.ts"), editorBuffer("/b.ts")];
    const harness = createRestoreHarness(buffers);
    harness.options.shouldContinue = () => false;

    await expect(drainDeferredWorkspaceSessionBuffers(harness.options)).resolves.toEqual({
      completed: false,
      restoredBufferCount: 0,
    });
    expect(harness.pendingBuffers).toEqual(buffers);
    expect(harness.events).toEqual(["idle"]);
  });

  it("reports a failed buffer and continues draining the queue", async () => {
    const harness = createRestoreHarness([editorBuffer("/a.ts"), editorBuffer("/b.ts")]);
    harness.options.restoreBuffer = vi.fn(async (buffer: BufferSession) => {
      harness.events.push(`restore:${buffer.path}`);
      if (buffer.path === "/a.ts") {
        throw new Error("missing");
      }
    });

    await expect(drainDeferredWorkspaceSessionBuffers(harness.options)).resolves.toEqual({
      completed: true,
      restoredBufferCount: 2,
    });
    expect(harness.pendingBuffers).toEqual([]);
    expect(harness.events).toEqual([
      "idle",
      "restore:/a.ts",
      "error:/a.ts",
      "after:/a.ts",
      "idle",
      "restore:/b.ts",
      "after:/b.ts",
    ]);
  });

  it("leaves the queue untouched when waiting for idle fails", async () => {
    const buffer = editorBuffer("/a.ts");
    const harness = createRestoreHarness([buffer]);
    harness.options.waitForIdle = async () => {
      throw new Error("scheduler unavailable");
    };

    await expect(drainDeferredWorkspaceSessionBuffers(harness.options)).rejects.toThrow(
      "scheduler unavailable",
    );
    expect(harness.pendingBuffers).toEqual([buffer]);
  });
});
