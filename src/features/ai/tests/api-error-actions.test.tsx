// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiErrorActions } from "../components/messages/api-error-actions";
import { formatApiError, getApiErrorCode } from "../lib/api-error";

const state = vi.hoisted(() => ({
  openUrl: vi.fn(async () => {}),
  signIn: vi.fn(async () => {}),
  settings: vi.fn(),
  error: vi.fn(),
  base: "http://localhost:3000",
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: state.openUrl }));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
vi.mock("@/utils/api-base", () => ({ getApiBase: () => state.base }));
vi.mock("@/features/window/hooks/use-desktop-sign-in", () => ({
  useDesktopSignIn: () => ({ signIn: state.signIn, isSigningIn: false }),
}));
vi.mock("@/features/window/stores/ui-state.store", () => ({
  useUIState: { getState: () => ({ openSettingsDialog: state.settings }) },
}));
vi.mock("../components/provider-api-key-command", () => ({
  ProviderApiKeyCommand: ({
    isOpen,
    initialProviderId,
  }: {
    isOpen: boolean;
    initialProviderId: string;
  }) => (isOpen ? <div role="dialog">Configure {initialProviderId}</div> : null),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.base = "http://localhost:3000";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function click(code: string, providerId: string, onRetry?: () => void) {
  await act(async () =>
    root.render(<ApiErrorActions code={code} providerId={providerId} onRetry={onRetry} />),
  );
  await act(async () => container.querySelector("button")!.click());
}
describe("API error recovery", () => {
  it.each(["http://localhost:3000", "https://athas.dev"])(
    "opens billing on the matching backend: %s",
    async (base) => {
      state.base = base;
      await click("402", "athas");
      expect(state.openUrl).toHaveBeenCalledWith(`${base}/dashboard/settings/billing`);
      expect(state.signIn).not.toHaveBeenCalled();
    },
  );
  it("starts sign-in when Athas rejects the session", async () => {
    await click("401", "athas");
    expect(state.signIn).toHaveBeenCalledOnce();
  });
  it.each(["401", "402", "403"])(
    "opens the failing external provider configuration for %s",
    async (code) => {
      await click(code, "anthropic");
      expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Configure anthropic");
      expect(state.openUrl).not.toHaveBeenCalled();
    },
  );
  it("retries a transient failure through the conversation callback", async () => {
    const retry = vi.fn();
    await click("503", "athas", retry);
    expect(retry).toHaveBeenCalledOnce();
  });
  it("does not retry a permission failure without changing configuration", async () => {
    const retry = vi.fn();
    await click("403", "athas", retry);
    expect(state.settings).toHaveBeenCalledWith("ai");
    expect(retry).not.toHaveBeenCalled();
  });
  it("reports navigation failures and restores the action", async () => {
    state.openUrl.mockRejectedValueOnce(new Error("Could not open browser"));
    await click("402", "athas");
    expect(state.error).toHaveBeenCalledWith("Could not open browser");
    expect(container.querySelector("button")?.disabled).toBe(false);
  });
  it("preserves SDK HTTP status and server details", () => {
    const error = Object.assign(new Error("Payment Required"), {
      statusCode: 402,
      responseBody: '{"error":"Monthly spending limit reached"}',
    });
    const formatted = formatApiError("athas", error);
    expect(getApiErrorCode(formatted)).toBe("402");
    expect(formatted).toContain(error.responseBody);
  });
  it("recognizes previously saved payment errors without an HTTP code", () => {
    expect(getApiErrorCode("Failed to connect to athas API: Payment Required")).toBe("402");
    expect(getApiErrorCode("Network unavailable")).toBe("");
  });
});

vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
