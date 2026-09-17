import { describe, expect, it, vi } from "vite-plus/test";
import type { AuthUser, SubscriptionInfo } from "../services/auth-api";
import { createAuthStore, type AuthStoreDependencies } from "../stores/auth.store";

const user: AuthUser = {
  id: 1,
  email: "dev@athas.dev",
  name: "Athas Dev",
  avatar_url: null,
  provider: "github",
  github_username: "athasdev",
  subscription_status: "pro",
  created_at: "2026-08-04T00:00:00.000Z",
};

const subscription: SubscriptionInfo = {
  status: "pro",
  subscription: {
    plan: "pro",
    renews_at: null,
    ends_at: null,
  },
  enterprise: {
    has_access: false,
    is_admin: false,
    policy: null,
  },
};

function createDependencies(overrides: Partial<AuthStoreDependencies> = {}): AuthStoreDependencies {
  return {
    fetchCurrentUser: vi.fn(async () => user),
    fetchSubscriptionStatus: vi.fn(async () => subscription),
    getAuthToken: vi.fn(async () => "token"),
    isAuthInvalidError: vi.fn(() => false),
    logoutFromServer: vi.fn(async () => {}),
    removeAuthToken: vi.fn(async () => {}),
    storeAuthToken: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("auth store", () => {
  it("keeps a valid session when subscription lookup has a transient failure", async () => {
    const dependencies = createDependencies({
      fetchSubscriptionStatus: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const store = createAuthStore(dependencies);

    await store.getState().actions.initialize();

    expect(store.getState()).toMatchObject({
      user,
      subscription: null,
      isAuthenticated: true,
      isLoading: false,
      error: "offline",
    });
    expect(dependencies.removeAuthToken).not.toHaveBeenCalled();
  });

  it("clears an invalid saved session without showing a connection error", async () => {
    const invalidAuth = new Error("invalid auth");
    const dependencies = createDependencies({
      fetchCurrentUser: vi.fn(async () => {
        throw invalidAuth;
      }),
      isAuthInvalidError: vi.fn((error) => error === invalidAuth),
    });
    const store = createAuthStore(dependencies);

    await store.getState().actions.initialize();

    expect(dependencies.removeAuthToken).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      user: null,
      subscription: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  it("logs out when a refresh reports invalid authentication", async () => {
    const invalidAuth = new Error("expired");
    const dependencies = createDependencies({
      fetchCurrentUser: vi.fn(async () => {
        throw invalidAuth;
      }),
      isAuthInvalidError: vi.fn((error) => error === invalidAuth),
    });
    const store = createAuthStore(dependencies);
    store.setState({ user, subscription, isAuthenticated: true });

    await store.getState().actions.refreshUser();

    expect(dependencies.logoutFromServer).toHaveBeenCalledOnce();
    expect(dependencies.removeAuthToken).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      user: null,
      subscription: null,
      isAuthenticated: false,
      error: null,
    });
  });
});

describe("sign-out recovery", () => {
  it("clears local state without waiting for the server", async () => {
    const dependencies = createDependencies({
      logoutFromServer: vi.fn(() => new Promise<void>(() => {})),
    });
    const store = createAuthStore(dependencies);
    store.setState({ user, subscription, isAuthenticated: true, isLoading: true });

    await store.getState().actions.logout();

    expect(dependencies.removeAuthToken).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      user: null,
      subscription: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  it("still removes the saved token when remote logout rejects", async () => {
    const dependencies = createDependencies({
      logoutFromServer: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const store = createAuthStore(dependencies);
    store.setState({ user, subscription, isAuthenticated: true });
    await store.getState().actions.logout();
    expect(dependencies.removeAuthToken).toHaveBeenCalledOnce();
    expect(store.getState().isAuthenticated).toBe(false);
  });

  it.each(["initialize", "refreshUser", "handleAuthCallback"] as const)(
    "does not restore a signed-out account when %s resolves late",
    async (action) => {
      const pending = Promise.withResolvers<AuthUser>();
      const dependencies = createDependencies({ fetchCurrentUser: vi.fn(() => pending.promise) });
      const store = createAuthStore(dependencies);
      store.setState({ user, subscription, isAuthenticated: true });
      const request =
        action === "handleAuthCallback"
          ? store.getState().actions.handleAuthCallback("token")
          : store.getState().actions[action]();
      await Promise.resolve();
      await store.getState().actions.logout();
      pending.resolve(user);
      await request;
      expect(store.getState()).toMatchObject({
        user: null,
        subscription: null,
        isAuthenticated: false,
        isLoading: false,
      });
    },
  );

  it("does not restore subscription data after sign-out", async () => {
    const pending = Promise.withResolvers<SubscriptionInfo>();
    const store = createAuthStore(
      createDependencies({
        fetchSubscriptionStatus: vi.fn(() => pending.promise),
      }),
    );
    store.setState({ user, subscription, isAuthenticated: true });
    const request = store.getState().actions.refreshSubscription();
    await store.getState().actions.logout();
    pending.resolve(subscription);
    await request;
    expect(store.getState().subscription).toBeNull();
  });

  it("shows a secure storage error while keeping the current session signed out", async () => {
    const store = createAuthStore(
      createDependencies({
        removeAuthToken: vi.fn(async () => {
          throw new Error("keychain unavailable");
        }),
      }),
    );
    store.setState({ user, subscription, isAuthenticated: true });
    await store.getState().actions.logout();
    expect(store.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      error: "Could not remove the saved session from secure storage.",
    });
  });
});

describe("connection failure recovery", () => {
  it("returns a failed refresh with its actual reason", async () => {
    const store = createAuthStore(
      createDependencies({
        fetchSubscriptionStatus: vi.fn(async () => {
          throw new Error("Service unavailable (503)");
        }),
      }),
    );
    store.setState({ user, subscription, isAuthenticated: true });
    expect(await store.getState().actions.refreshSubscription()).toBe(false);
    expect(store.getState().error).toBe("Service unavailable (503)");
    expect(store.getState().isAuthenticated).toBe(true);
  });
  it("turns an expired session into a sign-in action", async () => {
    const store = createAuthStore(
      createDependencies({
        fetchSubscriptionStatus: vi.fn(async () => {
          throw new Error("expired");
        }),
        isAuthInvalidError: vi.fn(() => true),
      }),
    );
    store.setState({ user, subscription, isAuthenticated: true });
    expect(await store.getState().actions.refreshSubscription()).toBe(false);
    expect(store.getState().isAuthenticated).toBe(false);
    expect(store.getState().error).toContain("Sign in again");
  });
});
