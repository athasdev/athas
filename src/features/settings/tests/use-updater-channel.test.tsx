// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => ({
  check: vi.fn(),
  updateChannel: "stable" as "stable" | "beta",
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: io.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@/bindings/commands", () => ({
  commands: { appUpdateMode: vi.fn().mockResolvedValue("self") },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ buffers: [] }) },
}));
vi.mock("@/features/file-system/services/workspace-project-transition", () => ({
  prepareProjectTransitionWithUnsavedBuffers: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordUpdateCheckTelemetry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../stores/whats-new.store", () => ({
  useWhatsNewStore: { getState: () => ({ actions: {} }) },
}));
vi.mock("../stores/settings.store", () => ({
  useSettingsStore: { getState: () => ({ settings: { updateChannel: io.updateChannel } }) },
}));

const { useUpdater } = await import("../hooks/use-updater");

type CheckForUpdates = ReturnType<typeof useUpdater>["checkForUpdates"];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderUpdater() {
  let checkForUpdates: CheckForUpdates | null = null;
  const Probe = () => {
    checkForUpdates = useUpdater(false).checkForUpdates;
    return null;
  };

  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => {
    root?.render(<Probe />);
  });

  return checkForUpdates as unknown as CheckForUpdates;
}

describe("updater channel", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    io.check.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container = null;
  });

  it.each(["stable", "beta"] as const)(
    "sends the %s channel with the update check",
    async (channel) => {
      io.updateChannel = channel;
      const checkForUpdates = await renderUpdater();

      await act(async () => {
        await checkForUpdates();
      });

      expect(io.check).toHaveBeenCalledWith({
        headers: { "X-Athas-Update-Channel": channel },
      });
    },
  );
});
