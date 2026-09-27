// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useDetachedWindow } from "../detached/use-detached-window";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  listen: vi.fn(),
  initialize: vi.fn(),
  actions: { openContent: vi.fn(), openSettingsBuffer: vi.fn(), setActiveBuffer: vi.fn() },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: mocks.close, listen: mocks.listen }),
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ actions: mocks.actions }), setState: vi.fn() },
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  initializeSettingsStore: mocks.initialize,
}));
vi.mock("@/extensions/themes/theme-initializer", () => ({
  initializeThemeSystem: mocks.initialize,
}));
vi.mock("@/features/window/stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ actions: { initialize: mocks.initialize } }) },
}));
vi.mock("@/features/window/stores/ui-state.store", () => ({
  useUIState: { getState: () => ({}) },
}));
vi.mock("@/features/window/utils/create-app-window", () => ({ createAppWindow: vi.fn() }));
vi.mock("@/features/terminal/utils/frontend-terminal-session", () => ({
  initializeFrontendTerminalSession: mocks.initialize,
}));
vi.mock("@/utils/frontend-trace", () => ({ frontendTrace: vi.fn() }));
vi.mock("@/utils/platform", () => ({ applyPlatformClass: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let channel: {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
function Window({
  onClose = vi.fn(),
  onMessage = vi.fn(),
}: {
  onClose?: () => void;
  onMessage?: () => void;
}) {
  const { error, ready } = useDetachedWindow({ kind: "agent", onCloseRequest: onClose, onMessage });
  return <div>{error || (ready ? "Ready" : "Loading")}</div>;
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "?view=detached&kind=agent&channel=test");
  mocks.initialize.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(vi.fn());
  mocks.listen.mockResolvedValue(vi.fn());
  channel = { onmessage: null, postMessage: vi.fn(), close: vi.fn() };
  vi.stubGlobal(
    "BroadcastChannel",
    vi.fn(function () {
      return channel;
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Detached window lifecycle", () => {
  it("cleans successful and late subscriptions when another subscription fails", async () => {
    const late = Promise.withResolvers<() => void>();
    const firstCleanup = vi.fn();
    const lateCleanup = vi.fn();
    mocks.close.mockResolvedValue(firstCleanup);
    mocks.listen
      .mockRejectedValueOnce(new Error("Could not listen"))
      .mockReturnValueOnce(late.promise);
    await act(async () => root.render(<Window />));
    expect(container.textContent).toContain("Could not listen");
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    await act(async () => late.resolve(lateCleanup));
    expect(lateCleanup).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(lateCleanup).toHaveBeenCalledTimes(1);
  });

  it("disposes late listeners and ignores close events after unmount", async () => {
    const pending = Promise.withResolvers<() => void>();
    mocks.close.mockReturnValue(pending.promise);
    const onClose = vi.fn();
    await act(async () => root.render(<Window onClose={onClose} />));
    const callback = mocks.close.mock.calls[0][0];
    await act(async () => root.render(null));
    const preventDefault = vi.fn();
    callback({ preventDefault });
    expect(onClose).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    const cleanup = vi.fn();
    await act(async () => pending.resolve(cleanup));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(channel.postMessage).not.toHaveBeenCalledWith({ type: "ready" });
  });

  it("uses current callbacks without reconnecting the owner channel", async () => {
    const previous = vi.fn();
    const onClose = vi.fn();
    const onMessage = vi.fn();
    await act(async () => root.render(<Window onClose={previous} onMessage={previous} />));
    await act(async () => root.render(<Window onClose={onClose} onMessage={onMessage} />));
    await act(async () => {
      mocks.close.mock.calls[0][0]({ preventDefault: vi.fn() });
      channel.onmessage?.(new MessageEvent("message", { data: { type: "content" } }));
    });
    expect(previous).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
