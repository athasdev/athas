// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ComposerNotice } from "../components/input/composer-notice";

const state = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  signIn: vi.fn(async () => {}),
  retrySessionCheck: vi.fn(async () => {}),
  refreshSubscription: vi.fn(async () => true),
  check: vi.fn(async () => {}),
}));
vi.mock("@/features/window/stores/auth.store", () => {
  const read = () => ({
    ...state.auth,
    actions: {
      retrySessionCheck: state.retrySessionCheck,
      refreshSubscription: state.refreshSubscription,
    },
  });
  return {
    useAuthStore: Object.assign((select: (value: unknown) => unknown) => select(read()), {
      getState: read,
    }),
  };
});
vi.mock("@/features/window/hooks/use-subscription-refresh", () => ({
  useSubscriptionRefresh: () => {},
}));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: (select: (value: unknown) => unknown) =>
    select({ actions: { checkApiKey: state.check } }),
}));
vi.mock("@/features/window/hooks/use-desktop-sign-in", () => ({
  useDesktopSignIn: () => ({
    signIn: state.signIn,
    isSigningIn: false,
    error: null,
    cancel: vi.fn(),
    reopen: vi.fn(async () => {}),
  }),
}));
vi.mock("@/features/window/stores/ui-state.store", () => ({
  useUIState: { getState: () => ({ openSettings: vi.fn() }) },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
vi.mock("../components/provider-api-key-command", () => ({
  ProviderApiKeyCommand: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">Add key</div> : null,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.auth = {
    isAuthenticated: false,
    isLoading: false,
    subscription: null,
    error: null,
    sessionCheck: null,
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(providerId = "athas", providerBlocked = true) {
  await act(async () =>
    root.render(
      <ComposerNotice builtInAgent providerId={providerId} providerBlocked={providerBlocked} />,
    ),
  );
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
  )!;
}

describe("composer notice slot", () => {
  it("starts desktop sign-in for a signed-out hosted chat", async () => {
    await render();
    expect(container.textContent).toContain("Sign in to use Athas models");
    await act(async () => button("Sign in").click());
    expect(state.signIn).toHaveBeenCalledOnce();
    expect(state.check).toHaveBeenCalledWith("athas");
  });

  it("retries an unverified session instead of offering sign-in", async () => {
    state.auth.sessionCheck = {
      reason: "unreachable",
      message: "Could not reach athas.dev.",
      host: "athas.dev",
      attempt: 1,
      nextRetryAt: null,
    };
    await render();
    expect(container.textContent).toContain("Can't reach Athas");
    expect(button("Sign in")).toBeUndefined();
    await act(async () => button("Retry now").click());
    expect(state.retrySessionCheck).toHaveBeenCalledOnce();
    expect(state.signIn).not.toHaveBeenCalled();
  });

  it("opens the key dialog for another provider", async () => {
    await render("anthropic");
    await act(async () => button("Add API key").click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Add key");
  });

  it("renders nothing when the chat can send", async () => {
    state.auth = { ...state.auth, isAuthenticated: true, subscription: { status: "pro" } };
    await render("athas", false);
    expect(container.textContent).toBe("");
  });
});
