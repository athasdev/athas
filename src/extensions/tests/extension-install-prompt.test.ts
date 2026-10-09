// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { emitAppEvent } from "@/utils/app-events";
import type { ToastInput } from "@/utils/toast";
import { useExtensionInstallPrompt } from "../hooks/use-extension-install-prompt";
import { useExtensionStore } from "../registry/extension-store";

const toasts = vi.hoisted(() => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: () => Promise.resolve(null),
    transformCallback: () => 0,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };
  return {
    open: new Map<string, ToastInput>(),
    nextId: 1,
  };
});

vi.mock("@/utils/toast", () => {
  const showToast = (toast: ToastInput) => {
    const id = `toast-${toasts.nextId++}`;
    toasts.open.set(id, toast);
    return id;
  };
  const updateToast = (id: string, updates: Partial<ToastInput>) => {
    const current = toasts.open.get(id);
    if (current) toasts.open.set(id, { ...current, ...updates });
  };
  const dismissToast = (id: string) => {
    toasts.open.delete(id);
  };
  const hasToast = (id: string) => toasts.open.has(id);
  return { useToast: () => ({ showToast, updateToast, dismissToast, hasToast }) };
});
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordFrictionSignal: vi.fn().mockResolvedValue(undefined),
}));

enableMapSet();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalActions = useExtensionStore.getState().actions;
const installExtension = vi.fn<(extensionId: string) => Promise<void>>();
let root: Root;

const request = (extensionId = "athas.rust", extensionName = "Rust") => ({
  extensionId,
  extensionName,
  filePath: "/repo/main.rs",
});

function openToasts() {
  return [...toasts.open.entries()];
}

async function clickAction(id: string) {
  await act(async () => {
    await toasts.open.get(id)?.action?.onClick();
  });
}

beforeEach(async () => {
  toasts.open.clear();
  installExtension.mockReset().mockResolvedValue(undefined);
  useExtensionStore.setState({
    installedExtensions: new Map(),
    actions: { ...originalActions, installExtension },
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  function Harness() {
    useExtensionInstallPrompt();
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  useExtensionStore.setState({ actions: originalActions });
});

describe("extension install prompt", () => {
  it("offers to install a missing language integration once per extension", () => {
    act(() => {
      emitAppEvent("extensions:install-needed", request());
      emitAppEvent("extensions:install-needed", request());
    });

    const prompts = openToasts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0][1]).toMatchObject({
      message: "Rust integration not installed. Install it to enable language support?",
      type: "info",
      duration: 0,
      action: { label: "Install" },
    });
  });

  it("does not prompt for extensions that are already installed", () => {
    useExtensionStore.setState({
      installedExtensions: new Map([["athas.rust", {} as never]]),
    });

    act(() => emitAppEvent("extensions:install-needed", request()));

    expect(openToasts()).toEqual([]);
  });

  it("installs from the prompt, reports success, and closes the toast later", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    act(() => emitAppEvent("extensions:install-needed", request()));
    const [[id]] = openToasts();

    await clickAction(id);

    expect(installExtension).toHaveBeenCalledWith("athas.rust");
    expect(toasts.open.get(id)).toMatchObject({
      message: "Rust installed successfully!",
      type: "success",
    });

    await act(async () => vi.advanceTimersByTime(3_000));
    expect(toasts.open.has(id)).toBe(false);
  });

  it("shows install failures with a retry that prompts again", async () => {
    installExtension.mockRejectedValueOnce(new Error("checksum mismatch"));
    act(() => emitAppEvent("extensions:install-needed", request()));
    const [[id]] = openToasts();

    await clickAction(id);
    expect(toasts.open.get(id)).toMatchObject({
      message: "Failed to install Rust: checksum mismatch",
      type: "error",
      action: { label: "Retry" },
    });

    await clickAction(id);

    const prompts = openToasts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0][0]).not.toBe(id);
    expect(prompts[0][1].action?.label).toBe("Install");
  });

  it("stops prompting for an extension after the user dismisses its prompt", () => {
    act(() => emitAppEvent("extensions:install-needed", request("athas.go", "Go")));
    const [[id]] = openToasts();

    act(() => {
      toasts.open.delete(id);
      emitAppEvent("toast:dismissed", { toastId: "unrelated" });
      emitAppEvent("toast:dismissed", { toastId: id });
      emitAppEvent("extensions:install-needed", request("athas.go", "Go"));
    });

    expect(openToasts()).toEqual([]);
  });

  it("shows a new prompt when the previous toast disappeared on its own", () => {
    act(() => emitAppEvent("extensions:install-needed", request("athas.zig", "Zig")));
    toasts.open.clear();

    act(() => emitAppEvent("extensions:install-needed", request("athas.zig", "Zig")));

    expect(openToasts()).toHaveLength(1);
  });
});
