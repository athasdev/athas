// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => ({
  handler: null as null | ((action: { action: string; value?: string | null }) => void),
  showToast: vi.fn(),
  checkForUpdates: vi.fn(async () => false),
  openUrl: vi.fn<(url: string) => Promise<void>>(async () => {}),
  writeClipboardText: vi.fn(async () => {}),
  getVersion: vi.fn(async () => "1.2.3"),
  osPlatform: vi.fn(() => "macos"),
  closeFolder: vi.fn(),
  settings: { syncSystemTheme: false },
  updateSetting: vi.fn(async () => {}),
}));

vi.mock("../services/menu-actions", () => ({
  listenToMenuActions: async (handler: typeof io.handler) => {
    io.handler = handler;
    return () => {};
  },
}));
vi.mock("@/utils/toast", () => ({ useToast: () => ({ showToast: io.showToast }) }));
vi.mock("@/features/settings/hooks/use-updater", () => ({
  useUpdater: () => ({ checkForUpdates: io.checkForUpdates }),
}));
vi.mock("@/features/settings/stores/settings.store", () => {
  const state = { settings: io.settings, actions: { updateSetting: io.updateSetting } };
  return {
    useSettingsStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { use: { closeFolder: () => io.closeFolder } },
}));
vi.mock("@/features/keymaps/services/execute-command-with-feedback", () => ({
  executeCommandWithFeedback: vi.fn(),
}));
vi.mock("@/utils/clipboard", () => ({ writeClipboardText: io.writeClipboardText }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: io.openUrl }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: io.getVersion }));
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: io.osPlatform,
  version: () => "15.0",
}));

import { onAppEvent } from "@/utils/app-events";
import { useMenuEventsWrapper } from "../hooks/use-menu-events-wrapper";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let unmount: (() => void) | null = null;

async function mountMenu() {
  function Harness() {
    useMenuEventsWrapper();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
  unmount = () => act(() => root.unmount());
}

async function dispatch(action: string, value?: string) {
  await act(async () => {
    io.handler?.({ action, value });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  io.settings.syncSystemTheme = false;
  io.checkForUpdates.mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  unmount?.();
  unmount = null;
  vi.restoreAllMocks();
});

describe("help and app menu actions", () => {
  it("applies a theme chosen from the menu", async () => {
    await mountMenu();

    await dispatch("theme_change", "athas-dark");

    expect(io.updateSetting).toHaveBeenCalledExactlyOnceWith("theme", "athas-dark");
  });

  it("stops following the system theme before applying a menu theme", async () => {
    io.settings.syncSystemTheme = true;
    await mountMenu();

    await dispatch("theme_change", "athas-light");
    await vi.waitFor(() => expect(io.updateSetting).toHaveBeenCalledTimes(2));

    expect(io.updateSetting.mock.calls).toEqual([
      ["syncSystemTheme", false],
      ["theme", "athas-light"],
    ]);
  });

  it("closes the folder from the menu", async () => {
    await mountMenu();

    await dispatch("close_folder");

    expect(io.closeFolder).toHaveBeenCalledOnce();
  });

  it("opens documentation, the changelog and the feature request form", async () => {
    await mountMenu();

    await dispatch("documentation");
    await vi.waitFor(() => expect(io.openUrl).toHaveBeenCalledTimes(1));
    await dispatch("changelog");
    await vi.waitFor(() => expect(io.openUrl).toHaveBeenCalledTimes(2));
    await dispatch("request_feature");
    await vi.waitFor(() => expect(io.openUrl).toHaveBeenCalledTimes(3));

    expect(io.openUrl.mock.calls[0][0]).toMatch(/^https?:\/\//);
    expect(io.openUrl.mock.calls[1][0]).toBe("https://github.com/athasdev/athas/releases");
    expect(io.openUrl.mock.calls[2][0]).toBe(
      "https://github.com/athasdev/athas/issues/new?template=02-feature.yml",
    );
  });

  it("copies the environment and opens a bug report", async () => {
    await mountMenu();

    await dispatch("report_bug");
    await vi.waitFor(() => expect(io.openUrl).toHaveBeenCalledOnce());

    const [report] = io.writeClipboardText.mock.calls[0] as unknown as [string];
    expect(report).toContain("- App: Athas 1.2.3");
    expect(report).toContain("- OS: macos 15.0");
    expect(io.openUrl).toHaveBeenCalledWith(
      "https://github.com/athasdev/athas/issues/new?template=01-bug.yml",
    );
  });

  it("falls back to the user agent when the OS plugin is unavailable", async () => {
    io.osPlatform.mockImplementationOnce(() => {
      throw new Error("not in tauri");
    });
    await mountMenu();

    await dispatch("report_bug");
    await vi.waitFor(() => expect(io.openUrl).toHaveBeenCalledOnce());

    const [report] = io.writeClipboardText.mock.calls[0] as unknown as [string];
    expect(report).toContain(`- OS: ${navigator.userAgent}`);
  });

  it("logs when the bug report cannot be prepared", async () => {
    io.getVersion.mockRejectedValueOnce(new Error("no app"));
    await mountMenu();

    await dispatch("report_bug");
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "Failed to prepare bug report:",
        new Error("no app"),
      ),
    );
    expect(io.openUrl).not.toHaveBeenCalled();
  });

  it("confirms an up-to-date version only when no update was found", async () => {
    await mountMenu();

    await dispatch("check_updates");
    await vi.waitFor(() =>
      expect(io.showToast).toHaveBeenCalledWith({
        message: "You're on the latest version",
        type: "success",
      }),
    );
    expect(io.checkForUpdates).toHaveBeenCalledWith({ ignoreSuppression: true });

    io.showToast.mockClear();
    io.checkForUpdates.mockResolvedValueOnce(true);
    await dispatch("check_updates");
    await Promise.resolve();
    expect(io.showToast).not.toHaveBeenCalled();
  });

  it("opens the GitHub notifications panel", async () => {
    const received: unknown[] = [];
    const stop = onAppEvent("notifications:show", (detail) => received.push(detail));
    await mountMenu();

    await dispatch("open_github_notifications");
    stop();

    expect(received).toEqual([{ category: "github" }]);
  });
});
