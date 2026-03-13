import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AuthUser, SubscriptionInfo } from "@/utils/auth-api";
import {
  fetchCurrentUser,
  fetchSubscriptionStatus,
  getAuthToken,
  logoutFromServer,
  removeAuthToken,
  storeAuthToken,
} from "@/utils/auth-api";

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
          const user = await fetchCurrentUser();
          const subscription = await fetchSubscriptionStatus();
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
      } catch {
        // Token is invalid or expired — clear it
        await removeAuthToken();
        set((state) => {
          state.user = null;
          state.subscription = null;
          state.isAuthenticated = false;
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
        const user = await fetchCurrentUser();
        const subscription = await fetchSubscriptionStatus();
        set((state) => {
          state.user = user;
          state.subscription = subscription;
          state.isAuthenticated = true;
          state.isLoading = false;
        });
      } catch {
        await removeAuthToken();
        set((state) => {
          state.error = "Authentication failed. Please try again.";
          state.isLoading = false;
        });
      }
    },

    refreshUser: async () => {
      try {
        const user = await fetchCurrentUser();
        set((state) => {
          state.user = user;
        });
      } catch {
        await get().logout();
      }
    },

    refreshSubscription: async () => {
      try {
        const subscription = await fetchSubscriptionStatus();
        set((state) => {
          state.subscription = subscription;
        });
      } catch {
        // Ignore refresh failures
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
