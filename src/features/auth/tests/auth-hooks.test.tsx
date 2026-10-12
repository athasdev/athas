// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  fetchCurrentUser: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: harness.toast }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("../services/auth-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/auth-api")>()),
  getAuthToken: async () => "saved-token",
  fetchCurrentUser: harness.fetchCurrentUser,
  fetchSubscriptionStatus: async () => ({
    status: "pro",
    subscription: { plan: "pro", renews_at: null, ends_at: null },
  }),
}));

import type { AuthUser, SubscriptionInfo } from "../services/auth-api";
import { useDesktopSignIn } from "../hooks/use-desktop-sign-in";
import { useProFeature } from "../hooks/use-pro-feature";
import { useSubscriptionRefresh } from "../hooks/use-subscription-refresh";
import { createAuthStore, useAuthStore } from "../stores/auth.store";
import { useDesktopSignInStore } from "../stores/desktop-sign-in.store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const user = {
  id: 1,
  email: "dev@athas.dev",
  name: "Dev",
  avatar_url: null,
  provider: "github",
  github_username: "dev",
  subscription_status: "free",
  created_at: "2026-01-01",
} as AuthUser;

function renderHook<P, T>(useHook: (props: P) => T, props: P) {
  const result = {} as { current: T };
  function Probe({ value }: { value: P }) {
    result.current = useHook(value);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe, { value: props })));
  return { result, unmount: () => act(() => root.unmount()) };
}

const originalAuthActions = useAuthStore.getState().actions;
const originalSignInActions = useDesktopSignInStore.getState().actions;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  useAuthStore.setState({
    actions: originalAuthActions,
    user: null,
    subscription: null,
    isAuthenticated: false,
  });
  useDesktopSignInStore.setState({ actions: originalSignInActions, error: null });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useDesktopSignIn", () => {
  it("announces a completed sign-in and runs the follow-up", async () => {
    const signIn = vi.fn(async () => true);
    useDesktopSignInStore.setState({ actions: { ...originalSignInActions, signIn } });
    const onSuccess = vi.fn();
    const { result } = renderHook(useDesktopSignIn, {
      apiBase: "http://localhost:3000",
      onSuccess,
    });

    await act(async () => result.current.signIn());

    expect(signIn).toHaveBeenCalledWith("http://localhost:3000");
    expect(harness.toast.success).toHaveBeenCalledWith("Signed in to Athas Desktop.");
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("reports why sign-in failed and rejects so callers can stop", async () => {
    useDesktopSignInStore.setState({
      actions: {
        ...originalSignInActions,
        signIn: async () => {
          useDesktopSignInStore.setState({ error: "Desktop sign-in timed out." });
          return false;
        },
      },
    });
    const { result } = renderHook(useDesktopSignIn, {});

    await expect(result.current.signIn()).rejects.toThrow("Desktop sign-in timed out.");
    expect(harness.toast.error).toHaveBeenCalledWith("Desktop sign-in timed out.");
  });

  it("stays quiet when sign-in was cancelled", async () => {
    useDesktopSignInStore.setState({
      actions: { ...originalSignInActions, signIn: async () => false },
    });
    const { result } = renderHook(useDesktopSignIn, {});

    await expect(result.current.signIn()).resolves.toBeUndefined();
    expect(harness.toast.error).not.toHaveBeenCalled();
    expect(harness.toast.success).not.toHaveBeenCalled();
  });
});

describe("useSubscriptionRefresh", () => {
  function stubRefresh() {
    const scheduleSubscriptionRefresh = vi.fn();
    useAuthStore.setState({ actions: { ...originalAuthActions, scheduleSubscriptionRefresh } });
    return scheduleSubscriptionRefresh;
  }

  it("refreshes on focus and on the interval while signed in", () => {
    vi.useFakeTimers();
    const refresh = stubRefresh();
    useAuthStore.setState({ isAuthenticated: true });
    const { unmount } = renderHook(useSubscriptionRefresh, { intervalMs: 60_000 });

    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(3);

    unmount();
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("skips hidden windows and signed-out sessions", () => {
    const refresh = stubRefresh();
    useAuthStore.setState({ isAuthenticated: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const hidden = renderHook(useSubscriptionRefresh, {});
    window.dispatchEvent(new Event("focus"));
    hidden.unmount();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });

    useAuthStore.setState({ isAuthenticated: false });
    const signedOut = renderHook(useSubscriptionRefresh, {});
    window.dispatchEvent(new Event("focus"));
    signedOut.unmount();

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("useProFeature", () => {
  it("treats a pro user snapshot as pro until the plan loads", () => {
    useAuthStore.setState({
      user: { ...user, subscription_status: "pro" },
      subscription: null,
      isAuthenticated: true,
    });
    const { result } = renderHook(useProFeature, {});

    expect(result.current).toMatchObject({
      isPro: true,
      hasIntelligence: true,
      hasHostedAi: true,
      hasSettingsSync: true,
      hasCloudWorkspaces: true,
      hasCloudAgents: false,
      subscriptionStatus: "pro",
    });
  });

  it("follows the loaded plan's capabilities", () => {
    useAuthStore.setState({
      user,
      isAuthenticated: true,
      subscription: {
        status: "free",
        subscription: null,
        capabilities: {
          intelligence: false,
          hostedAi: false,
          settingsSync: true,
          cloudWorkspaces: false,
          cloudAgents: true,
          previews: true,
          collaboration: false,
          enterprisePolicy: false,
        },
      } as SubscriptionInfo,
    });
    const { result } = renderHook(useProFeature, {});

    expect(result.current).toMatchObject({
      isPro: true,
      hasIntelligence: false,
      hasSettingsSync: true,
      hasCloudAgents: true,
      hasPreviews: true,
      subscriptionStatus: "free",
    });
  });

  it("reports a signed-out free account", () => {
    const { result } = renderHook(useProFeature, {});

    expect(result.current).toMatchObject({
      isPro: false,
      isAuthenticated: false,
      subscriptionStatus: "free",
    });
  });
});

describe("default session reconnect", () => {
  it("checks the saved session again once the network comes back", async () => {
    harness.fetchCurrentUser
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(user);
    const store = createAuthStore();

    await store.getState().actions.initialize();
    expect(store.getState().sessionCheck).toMatchObject({ attempt: 1 });
    expect(store.getState().sessionCheck?.nextRetryAt).toBeGreaterThan(Date.now());

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(store.getState().isAuthenticated).toBe(true));
    window.dispatchEvent(new Event("online"));

    expect(harness.fetchCurrentUser).toHaveBeenCalledTimes(2);
  });

  it("checks again after the backoff delay", async () => {
    vi.useFakeTimers();
    harness.fetchCurrentUser
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(user);
    const store = createAuthStore();

    await store.getState().actions.initialize();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(store.getState().isAuthenticated).toBe(true);
  });
});
