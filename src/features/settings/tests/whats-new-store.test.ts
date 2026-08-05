import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  openOnboardingBuffer: vi.fn(),
  storeCurrentWhatsNew: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "1.2.0"),
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      actions: {
        openOnboardingBuffer: mocks.openOnboardingBuffer,
      },
    }),
  },
}));

vi.mock("../lib/whats-new", () => ({
  hydrateWhatsNew: () => ({ version: "1.2.0", previousVersion: "1.1.0" }),
  queuePendingWhatsNew: vi.fn(),
  resolveWhatsNewInfo: vi.fn(async (info) => ({ ...info, body: "Release notes" })),
  storeCurrentWhatsNew: mocks.storeCurrentWhatsNew,
}));

import { useWhatsNewStore } from "../stores/whats-new.store";

describe("What's New store", () => {
  beforeEach(() => {
    mocks.openOnboardingBuffer.mockClear();
    mocks.storeCurrentWhatsNew.mockClear();
    useWhatsNewStore.setState({ initialized: false, info: null });
  });

  it("hydrates silently and opens the unified release surface only when requested", async () => {
    await useWhatsNewStore.getState().actions.initialize();

    expect(mocks.openOnboardingBuffer).not.toHaveBeenCalled();
    expect(useWhatsNewStore.getState().info).toMatchObject({
      version: "1.2.0",
      body: "Release notes",
    });

    await useWhatsNewStore.getState().actions.open();

    expect(mocks.openOnboardingBuffer).toHaveBeenCalledOnce();
    expect(mocks.openOnboardingBuffer).toHaveBeenCalledWith({
      mode: "release-notes",
      currentVersion: "1.2.0",
      previousVersion: "1.1.0",
    });
  });
});
