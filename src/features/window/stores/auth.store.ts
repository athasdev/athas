import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AuthUser, SubscriptionInfo } from "@/features/window/services/auth-api";
import {
  fetchCurrentUser,
  fetchSubscriptionStatus,
  getAuthToken,
  isAuthInvalidError,
  logoutFromServer,
  removeAuthToken,
  storeAuthToken,
} from "@/features/window/services/auth-api";
import { createSelectors } from "@/utils/zustand-selectors";

interface AuthState {
  user: AuthUser | null;
  subscription: SubscriptionInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthActions {
  initialize: () => Promise<void>;
  handleAuthCallback: (token: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshSubscription: () => Promise<boolean>;
  /**
   * Refreshes the plan and credits after a short quiet period, so several hosted turns or
   * focus changes in a row cost one request. Does nothing while signed out.
   */
  scheduleSubscriptionRefresh: (delayMs?: number) => void;
  setCollaborationSnapshot: (collaboration: SubscriptionInfo["collaboration"] | null) => void;
  logout: () => Promise<void>;
}

interface AuthStore extends AuthState {
  actions: AuthActions;
}

export interface AuthStoreDependencies {
  fetchCurrentUser: typeof fetchCurrentUser;
  fetchSubscriptionStatus: typeof fetchSubscriptionStatus;
  getAuthToken: typeof getAuthToken;
  isAuthInvalidError: typeof isAuthInvalidError;
  logoutFromServer: typeof logoutFromServer;
  removeAuthToken: typeof removeAuthToken;
  storeAuthToken: typeof storeAuthToken;
  /**
   * Calls `retry` once the connection may be back (the network comes online, or a backoff
   * delay passes) and returns a function that stops waiting.
   */
  waitForReconnect?: (retry: () => void, attempt: number) => () => void;
}

const RECONNECT_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
const SUBSCRIPTION_REFRESH_DEBOUNCE_MS = 1_500;

function waitForBrowserReconnect(retry: () => void, attempt: number): () => void {
  if (typeof window === "undefined") return () => {};
  let done = false;
  const run = () => {
    if (done) return;
    stop();
    retry();
  };
  const timer = setTimeout(
    run,
    RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)],
  );
  window.addEventListener("online", run);
  function stop() {
    done = true;
    clearTimeout(timer);
    window.removeEventListener("online", run);
  }
  return stop;
}

const defaultAuthStoreDependencies: AuthStoreDependencies = {
  fetchCurrentUser,
  fetchSubscriptionStatus,
  getAuthToken,
  isAuthInvalidError,
  logoutFromServer,
  removeAuthToken,
  storeAuthToken,
  waitForReconnect: waitForBrowserReconnect,
};

export function createAuthStore(
  dependencies: AuthStoreDependencies = defaultAuthStoreDependencies,
) {
  let sessionRevision = 0;
  let reconnectAttempt = 0;
  let stopWaitingForReconnect: (() => void) | null = null;
  let subscriptionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelReconnect = () => {
    stopWaitingForReconnect?.();
    stopWaitingForReconnect = null;
  };
  return create<AuthStore>()(
    immer((set, get) => ({
      user: null,
      subscription: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,

      actions: {
        initialize: async () => {
          cancelReconnect();
          const revision = ++sessionRevision;
          set((state) => {
            state.isLoading = true;
            state.error = null;
          });
          try {
            const token = await dependencies.getAuthToken();
            if (revision !== sessionRevision) return;
            if (token) {
              const user = await dependencies.fetchCurrentUser(token);
              if (revision !== sessionRevision) return;
              let subscription: SubscriptionInfo | null = null;
              let subscriptionError: string | null = null;
              try {
                subscription = await dependencies.fetchSubscriptionStatus(token);
                if (revision !== sessionRevision) return;
              } catch (error) {
                if (revision !== sessionRevision) return;
                if (dependencies.isAuthInvalidError(error)) {
                  throw error;
                }
                subscriptionError =
                  error instanceof Error ? error.message : "Could not load your Athas access.";
              }
              reconnectAttempt = 0;
              set((state) => {
                state.user = user;
                state.subscription = subscription;
                state.error = subscriptionError;
                state.isAuthenticated = true;
                state.isLoading = false;
              });
            } else {
              set((state) => {
                state.isLoading = false;
              });
            }
          } catch (error) {
            if (revision !== sessionRevision) return;
            const invalid = dependencies.isAuthInvalidError(error);
            if (invalid) {
              await dependencies.removeAuthToken();
            } else if (dependencies.waitForReconnect) {
              // The server could not be reached; the saved session may still be fine.
              const attempt = reconnectAttempt++;
              stopWaitingForReconnect = dependencies.waitForReconnect(() => {
                stopWaitingForReconnect = null;
                if (revision !== sessionRevision) return;
                void get().actions.initialize();
              }, attempt);
            }
            set((state) => {
              state.user = null;
              state.subscription = null;
              state.isAuthenticated = false;
              state.error = dependencies.isAuthInvalidError(error)
                ? null
                : "Could not verify your saved session. Check your connection and try again.";
              state.isLoading = false;
            });
          }
        },

        handleAuthCallback: async (token: string) => {
          cancelReconnect();
          const revision = ++sessionRevision;
          set((state) => {
            state.isLoading = true;
            state.error = null;
          });
          try {
            await dependencies.storeAuthToken(token);
            if (revision !== sessionRevision) return;
            const user = await dependencies.fetchCurrentUser(token);
            if (revision !== sessionRevision) return;
            let subscription: SubscriptionInfo | null = null;
            let subscriptionError: string | null = null;
            try {
              subscription = await dependencies.fetchSubscriptionStatus(token);
              if (revision !== sessionRevision) return;
            } catch (error) {
              if (revision !== sessionRevision) return;
              if (dependencies.isAuthInvalidError(error)) {
                throw error;
              }
              subscriptionError =
                error instanceof Error ? error.message : "Could not load your Athas access.";
            }
            set((state) => {
              state.user = user;
              state.subscription = subscription;
              state.error = subscriptionError;
              state.isAuthenticated = true;
              state.isLoading = false;
            });
          } catch (error) {
            if (revision !== sessionRevision) return;
            if (dependencies.isAuthInvalidError(error)) {
              await dependencies.removeAuthToken();
            }
            set((state) => {
              if (dependencies.isAuthInvalidError(error)) {
                state.user = null;
                state.subscription = null;
                state.isAuthenticated = false;
              }
              state.error = "Authentication failed. Please try again.";
              state.isLoading = false;
            });
            throw error;
          }
        },

        refreshUser: async () => {
          const revision = sessionRevision;
          try {
            const user = await dependencies.fetchCurrentUser();
            if (revision !== sessionRevision) return;
            set((state) => {
              state.user = user;
              state.isAuthenticated = true;
              state.error = null;
            });
          } catch (error) {
            if (revision !== sessionRevision) return;
            if (dependencies.isAuthInvalidError(error)) {
              await get().actions.logout();
              return;
            }

            set((state) => {
              state.error =
                "Could not refresh account details. Check your connection and try again.";
            });
          }
        },

        refreshSubscription: async () => {
          const revision = sessionRevision;
          try {
            const subscription = await dependencies.fetchSubscriptionStatus();
            if (revision !== sessionRevision) return false;
            set((state) => {
              state.subscription = subscription;
              state.error = null;
            });
            return true;
          } catch (error) {
            if (revision !== sessionRevision) return false;
            const invalid = dependencies.isAuthInvalidError(error);
            if (invalid) {
              await get().actions.logout();
              if (sessionRevision !== revision + 1) return false;
            }
            set((state) => {
              state.error = invalid
                ? "Your session is no longer valid on this server. Sign in again."
                : error instanceof Error
                  ? error.message
                  : "Could not connect to Athas. Check your connection.";
            });
            return false;
          }
        },

        scheduleSubscriptionRefresh: (delayMs = SUBSCRIPTION_REFRESH_DEBOUNCE_MS) => {
          if (subscriptionRefreshTimer) clearTimeout(subscriptionRefreshTimer);
          subscriptionRefreshTimer = setTimeout(() => {
            subscriptionRefreshTimer = null;
            if (!get().isAuthenticated) return;
            void get().actions.refreshSubscription();
          }, delayMs);
        },

        setCollaborationSnapshot: (collaboration) => {
          set((state) => {
            if (!state.subscription) return;
            state.subscription.collaboration = collaboration;
          });
        },

        logout: async () => {
          cancelReconnect();
          if (subscriptionRefreshTimer) clearTimeout(subscriptionRefreshTimer);
          subscriptionRefreshTimer = null;
          const revision = ++sessionRevision;
          void dependencies.logoutFromServer().catch(() => {});
          set((state) => {
            state.user = null;
            state.subscription = null;
            state.isAuthenticated = false;
            state.isLoading = false;
            state.error = null;
          });
          try {
            await dependencies.removeAuthToken();
          } catch {
            if (revision !== sessionRevision) return;
            set((state) => {
              state.error = "Could not remove the saved session from secure storage.";
            });
          }
        },
      },
    })),
  );
}

export const useAuthStore = createSelectors(createAuthStore());
