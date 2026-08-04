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
      error: null,
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
