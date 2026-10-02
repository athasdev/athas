import { describe, expect, it, vi } from "vite-plus/test";
import type { AuthUser, SubscriptionInfo } from "../services/auth-api";
import {
  createAuthStore,
  getReconnectDelayMs,
  type AuthStoreDependencies,
} from "../stores/auth.store";

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
  it("signs out an expired session even when its token cannot be removed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dependencies = createDependencies({
      fetchCurrentUser: vi.fn(async () => {
        throw new Error("expired");
      }),
      isAuthInvalidError: vi.fn(() => true),
      removeAuthToken: vi.fn(async () => {
        throw new Error("keychain locked");
      }),
    });
    const store = createAuthStore(dependencies);

    await expect(store.getState().actions.initialize()).resolves.toBeUndefined();
    expect(store.getState()).toMatchObject({ isAuthenticated: false, isLoading: false });
  });

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

describe("startup reconnect", () => {
  it("retries the saved session when the server was unreachable at startup", async () => {
    let reconnect: (() => void) | null = null;
    const fetchCurrentUser = vi
      .fn<AuthStoreDependencies["fetchCurrentUser"]>()
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValue(user);
    const store = createAuthStore(
      createDependencies({
        fetchCurrentUser,
        waitForReconnect: vi.fn((retry: () => void) => {
          reconnect = retry;
          return () => {};
        }),
      }),
    );

    await store.getState().actions.initialize();
    expect(store.getState().isAuthenticated).toBe(false);
    expect(store.getState().error).toBeNull();
    expect(store.getState().sessionCheck).toMatchObject({ attempt: 1 });

    reconnect!();
    await vi.waitFor(() => expect(store.getState().isAuthenticated).toBe(true));
    expect(store.getState().subscription).toEqual(subscription);
  });

  it("does not wait for a reconnect when the session was rejected", async () => {
    const waitForReconnect = vi.fn(() => () => {});
    const store = createAuthStore(
      createDependencies({
        fetchCurrentUser: vi.fn(async () => {
          throw new Error("Unauthorized");
        }),
        isAuthInvalidError: vi.fn(() => true),
        waitForReconnect,
      }),
    );
    await store.getState().actions.initialize();
    expect(waitForReconnect).not.toHaveBeenCalled();
    expect(store.getState().sessionCheck).toBeNull();
  });

  it("keeps the saved token and says what failed when the server is unreachable", async () => {
    const removeAuthToken = vi.fn(async () => {});
    const store = createAuthStore(
      createDependencies({
        fetchCurrentUser: vi.fn(async () => {
          throw new TypeError("error sending request");
        }),
        removeAuthToken,
        waitForReconnect: vi.fn(() => () => {}),
        describeSessionCheckFailure: () => ({
          reason: "local_server_down",
          message: "Nothing is answering at localhost:3000.",
          host: "localhost:3000",
        }),
        now: () => 1_000,
      }),
    );

    await store.getState().actions.initialize();

    expect(removeAuthToken).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ isLoading: false, error: null });
    expect(store.getState().sessionCheck).toEqual({
      reason: "local_server_down",
      message: "Nothing is answering at localhost:3000.",
      host: "localhost:3000",
      attempt: 1,
      nextRetryAt: 1_000 + getReconnectDelayMs(0),
    });
  });

  it("backs off between failed checks and resets once the session is verified", async () => {
    const retries: Array<() => void> = [];
    const waitForReconnect = vi.fn<NonNullable<AuthStoreDependencies["waitForReconnect"]>>(
      (retry) => {
        retries.push(retry);
        return () => {};
      },
    );
    const fetchCurrentUser = vi
      .fn<AuthStoreDependencies["fetchCurrentUser"]>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(user);
    const store = createAuthStore(createDependencies({ fetchCurrentUser, waitForReconnect }));

    await store.getState().actions.initialize();
    retries.shift()!();
    await vi.waitFor(() => expect(store.getState().sessionCheck?.attempt).toBe(2));
    expect(waitForReconnect.mock.calls.map((call) => call[1])).toEqual([0, 1]);
    expect(getReconnectDelayMs(1)).toBeGreaterThan(getReconnectDelayMs(0));

    retries.shift()!();
    await vi.waitFor(() => expect(store.getState().isAuthenticated).toBe(true));
    expect(store.getState().sessionCheck).toBeNull();
  });

  it("checks again immediately on a manual retry and cancels the pending wait", async () => {
    const stop = vi.fn();
    const fetchCurrentUser = vi
      .fn<AuthStoreDependencies["fetchCurrentUser"]>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(user);
    const store = createAuthStore(
      createDependencies({ fetchCurrentUser, waitForReconnect: vi.fn(() => stop) }),
    );

    await store.getState().actions.initialize();
    await store.getState().actions.retrySessionCheck();

    expect(stop).toHaveBeenCalledOnce();
    expect(fetchCurrentUser).toHaveBeenCalledTimes(2);
    expect(store.getState()).toMatchObject({ isAuthenticated: true, sessionCheck: null });
  });

  it("does nothing on a manual retry when no check failed", async () => {
    const fetchCurrentUser = vi.fn(async () => user);
    const store = createAuthStore(createDependencies({ fetchCurrentUser }));
    await store.getState().actions.retrySessionCheck();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });
});

describe("subscription refresh", () => {
  it("collapses a burst of refresh requests into one while signed in", async () => {
    vi.useFakeTimers();
    try {
      const fetchSubscriptionStatus = vi.fn(async () => subscription);
      const store = createAuthStore(createDependencies({ fetchSubscriptionStatus }));
      store.setState({ user, isAuthenticated: true });
      store.getState().actions.scheduleSubscriptionRefresh();
      store.getState().actions.scheduleSubscriptionRefresh();
      store.getState().actions.scheduleSubscriptionRefresh();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fetchSubscriptionStatus).toHaveBeenCalledOnce();

      store.setState({ isAuthenticated: false });
      store.getState().actions.scheduleSubscriptionRefresh();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fetchSubscriptionStatus).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
