// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DialogServiceProvider, showConfirmDialog } from "@/ui/dialog";
import { withRemoteHostTrust } from "../services/remote-host-trust";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const endpoint = { host: "server", port: 22 };
const fingerprint = "SHA256:LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ";
const challenge = `ATHAS_SSH_UNKNOWN_HOST:${JSON.stringify({ ...endpoint, fingerprint })}`;
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  invoke.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <DialogServiceProvider>
        <button>Terminal tab</button>
      </DialogServiceProvider>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("SSH trust review dialog lifecycle", () => {
  it("does not leave a prompt waiting for a provider that mounts after its caller closes", async () => {
    await act(async () => root.render(null));
    const lifetime = new AbortController();
    const result = withRemoteHostTrust(endpoint, vi.fn().mockRejectedValue(challenge), {
      signal: lifetime.signal,
    }).catch((error) => error);
    await Promise.resolve();
    lifetime.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    await act(async () => root.render(<DialogServiceProvider>{null}</DialogServiceProvider>));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("removes a cancelled terminal review without discarding the next queued decision", async () => {
    const lifetime = new AbortController();
    const connect = vi.fn().mockRejectedValue(challenge);
    let result: Promise<unknown> = Promise.resolve();
    await act(async () => {
      result = withRemoteHostTrust(endpoint, connect, { signal: lifetime.signal }).catch(
        (error) => error,
      );
    });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(fingerprint);
    let next: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      next = showConfirmDialog("Keep the other task running?", {
        title: "Other task",
        confirmLabel: "Keep running",
      });
    });
    await act(async () => lifetime.abort());
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).not.toContain(fingerprint);
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "Keep the other task running?",
    );
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Keep running",
    )!;
    await act(async () => button.click());
    await expect(next).resolves.toBe(true);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("removes a queued cancelled review without disturbing the active dialog", async () => {
    let other: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      other = showConfirmDialog("Other task", { confirmLabel: "Finish" });
    });
    const lifetime = new AbortController();
    let result: Promise<unknown> = Promise.resolve();
    await act(async () => {
      result = withRemoteHostTrust(endpoint, vi.fn().mockRejectedValue(challenge), {
        signal: lifetime.signal,
      }).catch((error) => error);
    });
    await act(async () => lifetime.abort());
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Other task");
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Finish",
    )!;
    await act(async () => button.click());
    await expect(other).resolves.toBe(true);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
