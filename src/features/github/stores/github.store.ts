import { commands } from "@/bindings/commands";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import type { PRFilter } from "../types/github.types";
import { syncGitHubTokenFromAccount } from "../services/github-token-service";
import {
  AUTH_CACHE_TTL_MS,
  getGitHubAccountStatus,
  getGitHubErrorMessage,
  isFresh,
} from "../services/github-pr-store-service";
import { githubKeys } from "../services/github-queries";
import { queryClient } from "@/utils/query-client";
import { createSelectors } from "@/utils/zustand-selectors";

type GitHubAuthStatus = "authenticated" | "notAuthenticated";
type GitHubAccountStatus = "unknown" | "notSignedIn" | "notConnected" | "connected";

interface GitHubState {
  currentFilter: PRFilter;
  isAuthenticated: boolean;
  isCheckingAuth: boolean;
  authStatus: GitHubAuthStatus;
  githubAccountStatus: GitHubAccountStatus;
  authError: string | null;
  currentUser: string | null;
}

const initialState: GitHubState = {
  currentFilter: "all",
  isAuthenticated: false,
  isCheckingAuth: false,
  authStatus: "notAuthenticated" as GitHubAuthStatus,
  githubAccountStatus: "unknown" as GitHubAccountStatus,
  authError: null,
  currentUser: null,
};

let authCheckedAt = 0;
let authCheckInFlight: Promise<void> | null = null;

const useGitHubStoreBase = create(
  combine(initialState, (set, get) => ({
    actions: {
      checkAuth: async (options?: { force?: boolean }) => {
        if (authCheckInFlight) {
          await authCheckInFlight;
          return;
        }

        const authState = get();
        const hasResolvedAuthState =
          authState.isAuthenticated ||
          authState.githubAccountStatus === "notSignedIn" ||
          authState.githubAccountStatus === "notConnected" ||
          authState.authError !== null;

        if (
          !options?.force &&
          authCheckedAt &&
          isFresh(authCheckedAt, AUTH_CACHE_TTL_MS) &&
          hasResolvedAuthState
        ) {
          return;
        }

        let finishAuthCheck!: () => void;
        authCheckInFlight = new Promise<void>((resolve) => {
          finishAuthCheck = resolve;
        });
        set({ isCheckingAuth: true, authError: null });

        try {
          const status = await commands.githubCheckAuth();
          if (status === "authenticated") {
            const user = await commands.githubGetCurrentUser();
            set({
              isAuthenticated: true,
              isCheckingAuth: false,
              authStatus: status,
              githubAccountStatus: "connected",
              currentUser: user,
              authError: null,
            });
          } else {
            let githubAccountStatus = get().githubAccountStatus;

            if (status === "notAuthenticated") {
              try {
                const syncResult = await syncGitHubTokenFromAccount();
                githubAccountStatus = getGitHubAccountStatus(syncResult.status);

                if (syncResult.status === "synced") {
                  const syncedStatus = await commands.githubCheckAuth();

                  if (syncedStatus === "authenticated") {
                    const user = await commands.githubGetCurrentUser();
                    set({
                      isAuthenticated: true,
                      isCheckingAuth: false,
                      authStatus: syncedStatus,
                      githubAccountStatus,
                      currentUser: user,
                      authError: null,
                    });
                    authCheckedAt = Date.now();
                    return;
                  }

                  set({
                    isAuthenticated: false,
                    isCheckingAuth: false,
                    authStatus: syncedStatus,
                    githubAccountStatus,
                    currentUser: null,
                    authError:
                      "A GitHub token was synced from your Athas account, but GitHub rejected it.",
                  });
                  authCheckedAt = Date.now();
                  return;
                }
              } catch (error) {
                const message = getGitHubErrorMessage(error);
                console.error("Failed to sync GitHub account token:", error);
                set({ authError: `Failed to sync GitHub account token: ${message}` });
              }
            }

            set({
              isAuthenticated: false,
              isCheckingAuth: false,
              authStatus: status,
              githubAccountStatus,
              currentUser: null,
              authError:
                get().authError ??
                (status === "notAuthenticated"
                  ? "No valid GitHub token is available for this workspace."
                  : null),
            });
          }
          authCheckedAt = Date.now();
        } catch (error) {
          const message = getGitHubErrorMessage(error);
          console.error("Failed to check GitHub authentication:", error);
          set({
            isAuthenticated: false,
            isCheckingAuth: false,
            authStatus: "notAuthenticated",
            githubAccountStatus: get().githubAccountStatus,
            authError: message,
            currentUser: null,
          });
          authCheckedAt = Date.now();
        } finally {
          authCheckInFlight = null;
          finishAuthCheck();
        }
      },

      setFilter: (filter: PRFilter) => {
        set({ currentFilter: filter });
      },

      /** A GitHub request was rejected for its credentials: show the sign-in state again. */
      markAuthFailed: (message: string) => {
        authCheckedAt = 0;
        set({ isAuthenticated: false, currentUser: null, authError: message });
      },

      reset: () => {
        set(initialState);
      },
    },
  })),
);

/**
 * Notifications belong to the signed-in account. When it signs out or changes, drop them and cancel
 * a request still in flight so it cannot fill the list for the next account.
 */
useGitHubStoreBase.subscribe((state, previous) => {
  if (!previous.currentUser || state.currentUser === previous.currentUser) return;
  void queryClient.cancelQueries({ queryKey: githubKeys.notificationsRoot });
  queryClient.removeQueries({ queryKey: githubKeys.notificationsRoot });
});

export const useGitHubStore = createSelectors(useGitHubStoreBase);
