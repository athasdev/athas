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
  newChat: vi.fn(),
  base: "http://localhost:3000",
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: state.openUrl }));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
vi.mock("@/utils/api-base", () => ({ getApiBase: () => state.base }));
vi.mock("@/config/services", () => ({
  getServiceUrls: () => ({
    websiteBaseUrl: "https://website.test",
    dashboardBillingUrl: "https://website.test/dashboard/settings/billing",
  }),
}));
vi.mock("@/features/ai/services/open-new-agent-chat", () => ({ openNewAgentChat: state.newChat }));
vi.mock("@/features/auth/hooks/use-desktop-sign-in", () => ({
  useDesktopSignIn: () => ({ signIn: state.signIn, isSigningIn: false }),
}));
vi.mock("@/features/layout/stores/ui-state.store", () => ({
  useUIState: { getState: () => ({ openSettings: state.settings }) },
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
async function click(
  code: string,
  providerId: string,
  onRetry?: () => void,
  extra: { serverCode?: string; billingUrl?: string } = {},
) {
  await act(async () =>
    root.render(
      <ApiErrorActions code={code} providerId={providerId} onRetry={onRetry} {...extra} />,
    ),
  );
  const button = container.querySelector("button")!;
  const label = button.textContent;
  await act(async () => button.click());
  return label;
}
describe("API error recovery", () => {
  it("opens billing on the website, not the API server", async () => {
    state.base = "http://localhost:3000";
    await click("402", "athas");
    expect(state.openUrl).toHaveBeenCalledWith("https://website.test/dashboard/settings/billing");
    expect(state.signIn).not.toHaveBeenCalled();
  });
  it("offers to add credit and opens the billing page the server sent", async () => {
    const label = await click("402", "athas", undefined, {
      serverCode: "insufficient_balance",
      billingUrl: "/dashboard/settings/billing?topup=1",
    });
    expect(label).toBe("Add credit");
    expect(state.openUrl).toHaveBeenCalledWith(
      "http://localhost:3000/dashboard/settings/billing?topup=1",
    );
  });
  it("ignores a billing link to another site", async () => {
    const label = await click("402", "athas", undefined, {
      serverCode: "spending_limit_reached",
      billingUrl: "https://elsewhere.test/pay",
    });
    expect(label).toBe("Manage billing");
    expect(state.openUrl).toHaveBeenCalledWith("https://website.test/dashboard/settings/billing");
  });
  it("starts a new chat when the conversation is too large", async () => {
    expect(await click("402", "athas", undefined, { serverCode: "request_too_large" })).toBe(
      "Start new chat",
    );
    expect(state.newChat).toHaveBeenCalledOnce();
    expect(state.openUrl).not.toHaveBeenCalled();
  });
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
