// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  isMac: true,
  setBadgeCount: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setBadgeCount: mocks.setBadgeCount }),
}));
vi.mock("@/utils/platform", () => ({
  get IS_MAC() {
    return mocks.isMac;
  },
}));

const { useNativeNotificationIntegration } =
  await import("../hooks/use-native-notification-integration");
const { useNotificationsStore } = await import("../stores/notifications.store");

let container: HTMLDivElement;
let root: Root;

function Harness() {
  useNativeNotificationIntegration();
  return null;
}

function record(id: string, type: "info" | "success" | "warning" | "error") {
  act(() => {
    useNotificationsStore.getState().actions.record({ id, message: id, type });
  });
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.isMac = true;
  mocks.setBadgeCount.mockClear();
  useNotificationsStore.getState().actions.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Dock badge", () => {
  it("counts unread notifications except successes", async () => {
    await act(async () => root.render(<Harness />));
    expect(mocks.setBadgeCount).toHaveBeenLastCalledWith(undefined);

    record("saved", "success");
    expect(mocks.setBadgeCount).toHaveBeenCalledTimes(1);

    record("warn", "warning");
    record("fail", "error");
    expect(mocks.setBadgeCount).toHaveBeenLastCalledWith(2);
  });

  it("clears the badge once everything is read", async () => {
    await act(async () => root.render(<Harness />));
    record("fail", "error");
    expect(mocks.setBadgeCount).toHaveBeenLastCalledWith(1);

    act(() => useNotificationsStore.getState().actions.markAllRead());

    expect(mocks.setBadgeCount).toHaveBeenLastCalledWith(undefined);
  });

  it("does not touch the badge outside macOS", async () => {
    mocks.isMac = false;
    await act(async () => root.render(<Harness />));
    record("fail", "error");

    expect(mocks.setBadgeCount).not.toHaveBeenCalled();
  });
});
