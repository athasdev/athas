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
}

const defaultAuthStoreDependencies: AuthStoreDependencies = {
  fetchCurrentUser,
  fetchSubscriptionStatus,
  getAuthToken,
  isAuthInvalidError,
  logoutFromServer,
  removeAuthToken,
  storeAuthToken,
};

export function createAuthStore(
  dependencies: AuthStoreDependencies = defaultAuthStoreDependencies,
) {
  let sessionRevision = 0;
  return create<AuthStore>()(
    immer((set, get) => ({
      user: null,
      subscription: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,

      actions: {
        initialize: async () => {
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
            if (dependencies.isAuthInvalidError(error)) {
              await dependencies.removeAuthToken();
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

        setCollaborationSnapshot: (collaboration) => {
          set((state) => {
            if (!state.subscription) return;
            state.subscription.collaboration = collaboration;
          });
        },

        logout: async () => {
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
