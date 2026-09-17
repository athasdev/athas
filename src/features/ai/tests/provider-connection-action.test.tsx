// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ProviderConnectionAction } from "../components/input/provider-connection-action";

const state = vi.hoisted(() => ({
  authenticated: false,
  signIn: vi.fn(async () => {}),
  refresh: vi.fn(async () => true),
  error: "Subscription service unavailable",
  check: vi.fn(async () => {}),
}));
vi.mock("@/features/window/stores/auth.store", () => ({
  useAuthStore: Object.assign(
    (select: (value: unknown) => unknown) =>
      select({
        isAuthenticated: state.authenticated,
        actions: { refreshSubscription: state.refresh },
      }),
    { getState: () => ({ error: state.error }) },
  ),
}));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: (select: (value: unknown) => unknown) =>
    select({ actions: { checkApiKey: state.check } }),
}));
vi.mock("@/features/window/hooks/use-desktop-sign-in", () => ({
  useDesktopSignIn: () => ({ signIn: state.signIn, isSigningIn: false }),
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
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
  state.authenticated = false;
  state.refresh.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function clickAction(providerId: string) {
  await act(async () => root.render(<ProviderConnectionAction providerId={providerId} />));
  await act(async () => container.querySelector("button")!.click());
}
describe("provider connection action", () => {
  it("opens desktop sign-in for Athas instead of a provider key dialog", async () => {
    await clickAction("athas");
    expect(state.signIn).toHaveBeenCalledOnce();
    expect(state.check).toHaveBeenCalledWith("athas");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it("refreshes an existing Athas connection", async () => {
    state.authenticated = true;
    await clickAction("athas");
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.signIn).not.toHaveBeenCalled();
    expect(state.check).toHaveBeenCalledWith("athas");
  });
  it("shows the connection failure instead of silently retrying", async () => {
    state.authenticated = true;
    state.refresh.mockResolvedValue(false);
    await clickAction("athas");
    expect(container.textContent).toContain(state.error);
    expect(state.check).not.toHaveBeenCalled();
  });
  it("shows a failed sign-in reason", async () => {
    state.signIn.mockRejectedValueOnce(new Error("Desktop session expired"));
    await clickAction("athas");
    expect(container.textContent).toContain("Desktop session expired");
  });
  it("opens the key manager for the selected external provider", async () => {
    await clickAction("anthropic");
    expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Configure anthropic");
    expect(state.signIn).not.toHaveBeenCalled();
  });
});
