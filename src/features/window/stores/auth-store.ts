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
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState & AuthActions>()(
  immer((set, get) => ({
    user: null,
    subscription: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,

    initialize: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const token = await getAuthToken();
        if (token) {
          const user = await fetchCurrentUser(token);
          let subscription: SubscriptionInfo | null = null;
          try {
            subscription = await fetchSubscriptionStatus(token);
          } catch (error) {
            if (isAuthInvalidError(error)) {
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
        if (isAuthInvalidError(error)) {
          await removeAuthToken();
        }
        set((state) => {
          state.user = null;
          state.subscription = null;
          state.isAuthenticated = false;
          state.error = isAuthInvalidError(error)
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
        await storeAuthToken(token);
        const user = await fetchCurrentUser(token);
        let subscription: SubscriptionInfo | null = null;
        try {
          subscription = await fetchSubscriptionStatus(token);
        } catch (error) {
          if (isAuthInvalidError(error)) {
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
        if (isAuthInvalidError(error)) {
          await removeAuthToken();
        }
        set((state) => {
          if (isAuthInvalidError(error)) {
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
        const user = await fetchCurrentUser();
        set((state) => {
          state.user = user;
          state.isAuthenticated = true;
          state.error = null;
        });
      } catch (error) {
        if (isAuthInvalidError(error)) {
          await get().logout();
          return;
        }

        set((state) => {
          state.error = "Could not refresh account details. Check your connection and try again.";
        });
      }
    },

    refreshSubscription: async () => {
      try {
        const subscription = await fetchSubscriptionStatus();
        set((state) => {
          state.subscription = subscription;
          state.error = null;
        });
      } catch (error) {
        if (isAuthInvalidError(error)) {
          await get().logout();
        }
      }
    },

    logout: async () => {
      await logoutFromServer();
      await removeAuthToken();
      set((state) => {
        state.user = null;
        state.subscription = null;
        state.isAuthenticated = false;
        state.error = null;
      });
    },
  })),
);
