import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AuthUser, SubscriptionInfo } from "../services/auth-api";
import { createAuthStore, onBeforeLogout, type AuthStoreDependencies } from "../stores/auth.store";

const user: AuthUser = {
  id: 7,
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
  subscription: { plan: "pro", renews_at: null, ends_at: null },
  enterprise: { has_access: false, is_admin: false, policy: null },
};

class AuthInvalidError extends Error {}

function createDependencies(overrides: Partial<AuthStoreDependencies> = {}): AuthStoreDependencies {
  return {
    fetchCurrentUser: vi.fn(async () => user),
    fetchSubscriptionStatus: vi.fn(async () => subscription),
    getAuthToken: vi.fn(async () => "token"),
    isAuthInvalidError: (error: unknown) => error instanceof AuthInvalidError,
    logoutFromServer: vi.fn(async () => {}),
    removeAuthToken: vi.fn(async () => {}),
    storeAuthToken: vi.fn(async () => {}),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("auth callback", () => {
  it("stores the token and signs in with the fetched user and plan", async () => {
    const storeAuthToken = vi.fn(async () => {});
    const fetchCurrentUser = vi.fn(async () => user);
    const store = createAuthStore(createDependencies({ storeAuthToken, fetchCurrentUser }));

    await store.getState().actions.handleAuthCallback("fresh-token");

    expect(storeAuthToken).toHaveBeenCalledWith("fresh-token");
    expect(fetchCurrentUser).toHaveBeenCalledWith("fresh-token");
    expect(store.getState()).toMatchObject({
      user,
      subscription,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      sessionCheck: null,
    });
  });

  it("signs in without a plan when the plan lookup fails for a transient reason", async () => {
    const store = createAuthStore(
      createDependencies({
        fetchSubscriptionStatus: vi.fn(async () => {
          throw "boom";
        }),
      }),
    );

    await store.getState().actions.handleAuthCallback("fresh-token");

    expect(store.getState()).toMatchObject({
      user,
      subscription: null,
      isAuthenticated: true,
      error: "Could not load your Athas access.",
    });
  });

  it("removes a token the server rejects and reports the failure", async () => {
    const removeAuthToken = vi.fn(async () => {});
    const store = createAuthStore(
      createDependencies({
        removeAuthToken,
        fetchSubscriptionStatus: vi.fn(async () => {
          throw new AuthInvalidError("revoked");
        }),
      }),
    );
    store.setState({ user, subscription, isAuthenticated: true });

    await expect(store.getState().actions.handleAuthCallback("bad-token")).rejects.toThrow(
      "revoked",
    );

    expect(removeAuthToken).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      user: null,
      subscription: null,
      isAuthenticated: false,
      isLoading: false,
      error: "Authentication failed. Please try again.",
    });
  });

  it("keeps the previous session when storing the token fails for another reason", async () => {
    const removeAuthToken = vi.fn(async () => {});
    const store = createAuthStore(
      createDependencies({
        removeAuthToken,
        storeAuthToken: vi.fn(async () => {
          throw new Error("keychain locked");
        }),
      }),
    );
    store.setState({ user, isAuthenticated: true });

    await expect(store.getState().actions.handleAuthCallback("token")).rejects.toThrow(
      "keychain locked",
    );

    expect(removeAuthToken).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      user,
      isAuthenticated: true,
      error: "Authentication failed. Please try again.",
    });
  });

  it("still reports a rejected token when removing it fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createAuthStore(
      createDependencies({
        fetchCurrentUser: vi.fn(async () => {
          throw new AuthInvalidError("expired");
        }),
        removeAuthToken: vi.fn(async () => {
          throw new Error("keychain locked");
        }),
      }),
    );

    await expect(store.getState().actions.handleAuthCallback("token")).rejects.toThrow("expired");

    expect(consoleError).toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ isAuthenticated: false, isLoading: false });
  });

  it("ignores a callback that is superseded by logout", async () => {
    const userRequest = deferred<AuthUser>();
    const store = createAuthStore(
      createDependencies({ fetchCurrentUser: vi.fn(() => userRequest.promise) }),
    );

    const callback = store.getState().actions.handleAuthCallback("token");
    await Promise.resolve();
    await store.getState().actions.logout();
    userRequest.resolve(user);
    await callback;

    expect(store.getState()).toMatchObject({ user: null, isAuthenticated: false });
  });

  it("ignores a plan failure from a superseded callback", async () => {
    const planRequest = deferred<SubscriptionInfo>();
    const store = createAuthStore(
      createDependencies({ fetchSubscriptionStatus: vi.fn(() => planRequest.promise) }),
    );

    const callback = store.getState().actions.handleAuthCallback("token");
    await vi.waitFor(() => expect(store.getState().isLoading).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await store.getState().actions.logout();
    planRequest.reject(new AuthInvalidError("expired"));
    await callback;

    expect(store.getState()).toMatchObject({ user: null, isAuthenticated: false, error: null });
  });
});

describe("initialize", () => {
  it("finishes loading signed out when no token is saved", async () => {
    const fetchCurrentUser = vi.fn(async () => user);
    const store = createAuthStore(
      createDependencies({ getAuthToken: vi.fn(async () => null), fetchCurrentUser }),
    );

    await store.getState().actions.initialize();

    expect(fetchCurrentUser).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      isAuthenticated: false,
      isLoading: false,
      sessionCheck: null,
    });
  });

  it("signs out when the plan lookup rejects the saved session", async () => {
    const removeAuthToken = vi.fn(async () => {});
    const store = createAuthStore(
      createDependencies({
        removeAuthToken,
        fetchSubscriptionStatus: vi.fn(async () => {
          throw new AuthInvalidError("revoked");
        }),
      }),
    );

    await store.getState().actions.initialize();

    expect(removeAuthToken).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ user: null, isAuthenticated: false });
  });

  it("drops results from an initialize that a newer one replaced", async () => {
    const firstToken = deferred<string | null>();
    const getAuthToken = vi
      .fn<AuthStoreDependencies["getAuthToken"]>()
      .mockReturnValueOnce(firstToken.promise)
      .mockResolvedValue(null);
    const fetchCurrentUser = vi.fn(async () => user);
    const store = createAuthStore(createDependencies({ getAuthToken, fetchCurrentUser }));

    const first = store.getState().actions.initialize();
    await store.getState().actions.initialize();
    firstToken.resolve("stale-token");
    await first;

    expect(fetchCurrentUser).not.toHaveBeenCalled();
    expect(store.getState().isAuthenticated).toBe(false);
  });

  it("falls back to a generic unreachable description and no retry without a reconnect waiter", async () => {
    const store = createAuthStore(
      createDependencies({
        fetchCurrentUser: vi.fn(async () => {
          throw new TypeError("offline");
        }),
      }),
    );

    await store.getState().actions.initialize();

    expect(store.getState().sessionCheck).toEqual({
      reason: "unreachable",
      message: "Could not reach Athas.",
      host: "",
      attempt: 1,
      nextRetryAt: null,
    });
  });
});

describe("account refresh", () => {
  it("updates the user on a successful refresh", async () => {
    const renamed = { ...user, name: "Renamed" };
    const store = createAuthStore(
      createDependencies({ fetchCurrentUser: vi.fn(async () => renamed) }),
    );
    store.setState({ error: "old error" });

    await store.getState().actions.refreshUser();

    expect(store.getState()).toMatchObject({ user: renamed, isAuthenticated: true, error: null });
  });

  it("keeps the session and explains a connection failure", async () => {
    const store = createAuthStore(
      createDependencies({
        fetchCurrentUser: vi.fn(async () => {
          throw new TypeError("offline");
        }),
      }),
    );
    store.setState({ user, isAuthenticated: true });

    await store.getState().actions.refreshUser();

    expect(store.getState()).toMatchObject({ user, isAuthenticated: true });
    expect(store.getState().error).toContain("Could not refresh account details");
  });

  it("logs out when the server rejects the session during a user refresh", async () => {
    const removeAuthToken = vi.fn(async () => {});
    const store = createAuthStore(
      createDependencies({
        removeAuthToken,
        fetchCurrentUser: vi.fn(async () => {
          throw new AuthInvalidError("expired");
        }),
      }),
    );
    store.setState({ user, isAuthenticated: true });

    await store.getState().actions.refreshUser();

    expect(removeAuthToken).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ user: null, isAuthenticated: false });
  });

  it("ignores a user refresh that finishes after logout", async () => {
    const request = deferred<AuthUser>();
    const store = createAuthStore(
      createDependencies({ fetchCurrentUser: vi.fn(() => request.promise) }),
    );

    const refresh = store.getState().actions.refreshUser();
    await store.getState().actions.logout();
    request.resolve(user);
    await refresh;

    expect(store.getState()).toMatchObject({ user: null, isAuthenticated: false });
  });

  it("ignores a failed user refresh that finishes after logout", async () => {
    const request = deferred<AuthUser>();
    const store = createAuthStore(
      createDependencies({ fetchCurrentUser: vi.fn(() => request.promise) }),
    );

    const refresh = store.getState().actions.refreshUser();
    await store.getState().actions.logout();
    request.reject(new TypeError("offline"));
    await refresh;

    expect(store.getState().error).toBeNull();
  });

  it("reports plan refresh failures without a message using a generic hint", async () => {
    const store = createAuthStore(
      createDependencies({
        fetchSubscriptionStatus: vi.fn(async () => {
          throw "offline";
        }),
      }),
    );

    expect(await store.getState().actions.refreshSubscription()).toBe(false);
    expect(store.getState().error).toBe("Could not connect to Athas. Check your connection.");
  });

  it("does not apply a plan refresh that finishes after logout", async () => {
    const request = deferred<SubscriptionInfo>();
    const store = createAuthStore(
      createDependencies({ fetchSubscriptionStatus: vi.fn(() => request.promise) }),
    );

    const refresh = store.getState().actions.refreshSubscription();
    await store.getState().actions.logout();
    request.resolve(subscription);

    expect(await refresh).toBe(false);
    expect(store.getState().subscription).toBeNull();
  });

  it("does not report a plan refresh failure that finishes after logout", async () => {
    const request = deferred<SubscriptionInfo>();
    const store = createAuthStore(
      createDependencies({ fetchSubscriptionStatus: vi.fn(() => request.promise) }),
    );

    const refresh = store.getState().actions.refreshSubscription();
    await store.getState().actions.logout();
    request.reject(new Error("offline"));

    expect(await refresh).toBe(false);
    expect(store.getState().error).toBeNull();
  });
});

describe("collaboration snapshot", () => {
  it("updates collaboration only while a plan is loaded", () => {
    const store = createAuthStore(createDependencies());
    const collaboration = {
      enabled: true,
      workspace: null,
      members: [],
    } as unknown as NonNullable<SubscriptionInfo["collaboration"]>;

    store.getState().actions.setCollaborationSnapshot(collaboration);
    expect(store.getState().subscription).toBeNull();

    store.setState({ subscription });
    store.getState().actions.setCollaborationSnapshot(collaboration);
    expect(store.getState().subscription?.collaboration).toEqual(collaboration);

    store.getState().actions.setCollaborationSnapshot(null);
    expect(store.getState().subscription?.collaboration).toBeNull();
  });
});

describe("before-logout hooks", () => {
  it("waits for registered hooks while the session is still available", async () => {
    const removeAuthToken = vi.fn(async () => {});
    const store = createAuthStore(createDependencies({ removeAuthToken }));
    store.setState({ user, isAuthenticated: true });
    const seen: boolean[] = [];
    const unregister = onBeforeLogout(async () => {
      seen.push(store.getState().isAuthenticated);
    });

    try {
      await store.getState().actions.logout();
    } finally {
      unregister();
    }

    expect(seen).toEqual([true]);
    expect(store.getState().isAuthenticated).toBe(false);
    expect(removeAuthToken).toHaveBeenCalledOnce();
  });

  it("gives up on a hanging hook after three seconds", async () => {
    vi.useFakeTimers();
    const store = createAuthStore(createDependencies());
    store.setState({ user, isAuthenticated: true });
    const unregister = onBeforeLogout(() => new Promise(() => {}));

    try {
      const logout = store.getState().actions.logout();
      await vi.advanceTimersByTimeAsync(2_999);
      expect(store.getState().isAuthenticated).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      await logout;
    } finally {
      unregister();
    }

    expect(store.getState().isAuthenticated).toBe(false);
  });

  it("stops running a hook once it is unregistered", async () => {
    const hook = vi.fn(async () => {});
    const unregister = onBeforeLogout(hook);
    unregister();

    await createAuthStore(createDependencies()).getState().actions.logout();

    expect(hook).not.toHaveBeenCalled();
  });

  it("cancels a pending subscription refresh on logout", async () => {
    vi.useFakeTimers();
    const fetchSubscriptionStatus = vi.fn(async () => subscription);
    const store = createAuthStore(createDependencies({ fetchSubscriptionStatus }));
    store.setState({ user, isAuthenticated: true });

    store.getState().actions.scheduleSubscriptionRefresh(100);
    await store.getState().actions.logout();
    store.setState({ isAuthenticated: true });
    await vi.advanceTimersByTimeAsync(200);

    expect(fetchSubscriptionStatus).not.toHaveBeenCalled();
  });
});
