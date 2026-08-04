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
  refreshSubscription: () => Promise<void>;
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
  return create<AuthStore>()(
    immer((set, get) => ({
      user: null,
      subscription: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,

      actions: {
        initialize: async () => {
          set((state) => {
            state.isLoading = true;
            state.error = null;
          });
          try {
            const token = await dependencies.getAuthToken();
            if (token) {
              const user = await dependencies.fetchCurrentUser(token);
              let subscription: SubscriptionInfo | null = null;
              try {
                subscription = await dependencies.fetchSubscriptionStatus(token);
              } catch (error) {
                if (dependencies.isAuthInvalidError(error)) {
                  throw error;
                }
              }
              set((state) => {
                state.user = user;
                state.subscription = subscription;
                state.isAuthenticated = true;
                state.isLoading = false;
              });
            } else {
              set((state) => {
                state.isLoading = false;
              });
            }
          } catch (error) {
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
          set((state) => {
            state.isLoading = true;
            state.error = null;
          });
          try {
            await dependencies.storeAuthToken(token);
            const user = await dependencies.fetchCurrentUser(token);
            let subscription: SubscriptionInfo | null = null;
            try {
              subscription = await dependencies.fetchSubscriptionStatus(token);
            } catch (error) {
              if (dependencies.isAuthInvalidError(error)) {
                throw error;
              }
            }
            set((state) => {
              state.user = user;
              state.subscription = subscription;
              state.isAuthenticated = true;
              state.isLoading = false;
            });
          } catch (error) {
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
          try {
            const user = await dependencies.fetchCurrentUser();
            set((state) => {
              state.user = user;
              state.isAuthenticated = true;
              state.error = null;
            });
          } catch (error) {
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
          try {
            const subscription = await dependencies.fetchSubscriptionStatus();
            set((state) => {
              state.subscription = subscription;
              state.error = null;
            });
          } catch (error) {
            if (dependencies.isAuthInvalidError(error)) {
              await get().actions.logout();
            }
          }
        },

        setCollaborationSnapshot: (collaboration) => {
          set((state) => {
            if (!state.subscription) return;
            state.subscription.collaboration = collaboration;
          });
        },

        logout: async () => {
          await dependencies.logoutFromServer();
          await dependencies.removeAuthToken();
          set((state) => {
            state.user = null;
            state.subscription = null;
            state.isAuthenticated = false;
            state.error = null;
          });
        },
      },
    })),
  );
}

export const useAuthStore = createSelectors(createAuthStore());
