// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { create } from "zustand";
import {
  describeAcpTerminalAuthFailure,
  runAcpTerminalAuth,
} from "@/features/ai/lib/acp-terminal-auth";
import { TERMINAL_PROCESS_EXIT_EVENT } from "@/features/terminal/constants/terminal-events";

interface FakeBuffer {
  type: "terminal";
  sessionId: string;
}

const buffers = vi.hoisted(() => ({
  store: null as unknown as ReturnType<typeof createBufferStore>,
}));

function createBufferStore() {
  return create<{
    buffers: FakeBuffer[];
    actions: { openTerminalBuffer: (options: { sessionId: string }) => string };
  }>()((set) => ({
    buffers: [],
    actions: {
      openTerminalBuffer: ({ sessionId }) => {
        set((state) => ({ buffers: [...state.buffers, { type: "terminal", sessionId }] }));
        return sessionId;
      },
    },
  }));
}

vi.mock("@/features/editor/stores/buffer.store", () => ({
  get useBufferStore() {
    return buffers.store;
  },
}));

vi.mock("@/features/terminal/stores/terminal.store", () => ({
  useTerminalStore: { getState: () => ({ actions: { updateSession: () => undefined } }) },
}));

const launch = { label: "Sign in", command: "agent", args: ["login"], env: {} };

describe("runAcpTerminalAuth", () => {
  beforeEach(() => {
    buffers.store = createBufferStore();
  });

  it("resolves with the command's exit", async () => {
    const result = runAcpTerminalAuth(launch);
    const { sessionId } = buffers.store.getState().buffers[0];
    window.dispatchEvent(
      new CustomEvent(TERMINAL_PROCESS_EXIT_EVENT, {
        detail: { sessionId, exitCode: 0, signal: null },
      }),
    );
    await expect(result).resolves.toEqual({ exitCode: 0, signal: null });
  });

  it("stops waiting when the sign-in tab is closed first", async () => {
    const result = runAcpTerminalAuth(launch);
    buffers.store.setState({ buffers: [] });
    const exit = await result;
    expect(exit).toEqual({ exitCode: null, signal: null, tabClosed: true });
    expect(describeAcpTerminalAuthFailure(exit!)).toMatch(/tab was closed/);
  });
});
