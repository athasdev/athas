import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Buffers = { buffers: { path: string }[] };

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const projects: { state: Buffers }[] = [];
  return {
    releaseCliWait: vi.fn(() => Promise.resolve()),
    listeners,
    projects,
    setBuffers(index: number, paths: string[]) {
      projects[index] = { state: { buffers: paths.map((path) => ({ path })) } };
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("@/bindings/commands", () => ({
  commands: { releaseCliWait: mocks.releaseCliWait },
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getAllStores: () => mocks.projects.map((project) => ({ getState: () => project.state })),
    subscribeAll: (listener: () => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
  },
}));

const { trackCliWait } = await import("../services/cli-wait");

describe("CLI --wait tracking", () => {
  beforeEach(() => {
    mocks.releaseCliWait.mockClear();
    mocks.projects.length = 0;
  });

  it("releases the CLI once every file it opened is closed in every project", () => {
    mocks.setBuffers(0, ["/repo/COMMIT_EDITMSG", "/repo/a.ts"]);
    mocks.setBuffers(1, ["/other/b.ts"]);
    trackCliWait("/tmp/athas-cli-wait/1-1", "/repo/COMMIT_EDITMSG");
    trackCliWait("/tmp/athas-cli-wait/1-1", "/other/b.ts");

    mocks.setBuffers(0, ["/repo/a.ts"]);
    expect(mocks.releaseCliWait).not.toHaveBeenCalled();

    mocks.setBuffers(1, []);
    expect(mocks.releaseCliWait).toHaveBeenCalledExactlyOnceWith("/tmp/athas-cli-wait/1-1");
    expect(mocks.listeners.size).toBe(0);
  });

  it("releases right away when the file did not open", () => {
    mocks.setBuffers(0, ["/repo/a.ts"]);
    trackCliWait("/tmp/athas-cli-wait/2-2", "/repo/missing.ts");

    expect(mocks.releaseCliWait).toHaveBeenCalledExactlyOnceWith("/tmp/athas-cli-wait/2-2");
  });
});
