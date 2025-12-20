import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import type {
  PRFilter,
  PullRequest,
  PullRequestComment,
  PullRequestDetails,
  PullRequestFile,
} from "./types";

interface GitHubState {
  prs: PullRequest[];
  currentFilter: PRFilter;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  currentUser: string | null;
  // Selected PR state
  selectedPRNumber: number | null;
  selectedPRDetails: PullRequestDetails | null;
  selectedPRDiff: string | null;
  selectedPRFiles: PullRequestFile[];
  selectedPRComments: PullRequestComment[];
  isLoadingDetails: boolean;
  detailsError: string | null;
}

const initialState: GitHubState = {
  prs: [],
  currentFilter: "all",
  isLoading: false,
  error: null,
  isAuthenticated: false,
  currentUser: null,
  // Selected PR state
  selectedPRNumber: null,
  selectedPRDetails: null,
  selectedPRDiff: null,
  selectedPRFiles: [],
  selectedPRComments: [],
  isLoadingDetails: false,
  detailsError: null,
};

export const useGitHubStore = create(
  combine(initialState, (set, get) => ({
    actions: {
      checkAuth: async () => {
        try {
          const isAuth = await invoke<boolean>("github_check_cli_auth");
          if (isAuth) {
            const user = await invoke<string>("github_get_current_user");
            set({ isAuthenticated: true, currentUser: user, error: null });
          } else {
            set({ isAuthenticated: false, currentUser: null });
          }
        } catch {
          set({ isAuthenticated: false, currentUser: null });
        }
      },

      fetchPRs: async (repoPath: string) => {
        const { currentFilter } = get();
        set({ isLoading: true, error: null });

        try {
          const prs = await invoke<PullRequest[]>("github_list_prs", {
            repoPath,
            filter: currentFilter,
          });
          set({ prs, isLoading: false });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : String(err),
            isLoading: false,
            prs: [],
          });
        }
      },

      setFilter: (filter: PRFilter) => {
        set({ currentFilter: filter });
      },

      openPRInBrowser: async (repoPath: string, prNumber: number) => {
        try {
          await invoke("github_open_pr_in_browser", { repoPath, prNumber });
        } catch (err) {
          console.error("Failed to open PR:", err);
        }
      },

      checkoutPR: async (repoPath: string, prNumber: number) => {
        try {
          await invoke("github_checkout_pr", { repoPath, prNumber });
          window.dispatchEvent(new CustomEvent("git-status-changed"));
        } catch (err) {
          console.error("Failed to checkout PR:", err);
          throw err;
        }
      },

      selectPR: async (repoPath: string, prNumber: number) => {
        set({
          selectedPRNumber: prNumber,
          isLoadingDetails: true,
          detailsError: null,
          selectedPRDetails: null,
          selectedPRDiff: null,
          selectedPRFiles: [],
          selectedPRComments: [],
        });

        try {
          // Fetch all PR data in parallel
          const [details, diff, files, comments] = await Promise.all([
            invoke<PullRequestDetails>("github_get_pr_details", { repoPath, prNumber }),
            invoke<string>("github_get_pr_diff", { repoPath, prNumber }),
            invoke<PullRequestFile[]>("github_get_pr_files", { repoPath, prNumber }),
            invoke<PullRequestComment[]>("github_get_pr_comments", { repoPath, prNumber }),
          ]);

          set({
            selectedPRDetails: details,
            selectedPRDiff: diff,
            selectedPRFiles: files,
            selectedPRComments: comments,
            isLoadingDetails: false,
          });
        } catch (err) {
          set({
            detailsError: err instanceof Error ? err.message : String(err),
            isLoadingDetails: false,
          });
        }
      },

      deselectPR: () => {
        set({
          selectedPRNumber: null,
          selectedPRDetails: null,
          selectedPRDiff: null,
          selectedPRFiles: [],
          selectedPRComments: [],
          detailsError: null,
        });
      },

      reset: () => {
        set(initialState);
      },
    },
  })),
);
