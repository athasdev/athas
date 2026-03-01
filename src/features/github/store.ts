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

const PR_LIST_CACHE_TTL_MS = 30_000;
const PR_DETAILS_CACHE_TTL_MS = 120_000;

interface PRListCacheEntry {
  fetchedAt: number;
  prs: PullRequest[];
}

interface PRDetailsCacheEntry {
  fetchedAt: number;
  details: PullRequestDetails;
  diff?: string;
  files?: PullRequestFile[];
  comments?: PullRequestComment[];
  filesFetchedAt?: number;
  commentsFetchedAt?: number;
  contentFetchedAt?: number;
}

interface GitHubState {
  prs: PullRequest[];
  currentFilter: PRFilter;
  isLoading: boolean;
  error: string | null;
  activeRepoPath: string | null;
  isAuthenticated: boolean;
  currentUser: string | null;
  // Selected PR state
  selectedPRNumber: number | null;
  selectedPRDetails: PullRequestDetails | null;
  selectedPRDiff: string | null;
  selectedPRFiles: PullRequestFile[];
  selectedPRComments: PullRequestComment[];
  isLoadingDetails: boolean;
  isLoadingContent: boolean;
  detailsError: string | null;
  contentError: string | null;
  prListCache: Record<string, PRListCacheEntry>;
  prDetailsCache: Record<string, PRDetailsCacheEntry>;
}

const initialState: GitHubState = {
  prs: [],
  currentFilter: "all",
  isLoading: false,
  error: null,
  activeRepoPath: null,
  isAuthenticated: false,
  currentUser: null,
  // Selected PR state
  selectedPRNumber: null,
  selectedPRDetails: null,
  selectedPRDiff: null,
  selectedPRFiles: [],
  selectedPRComments: [],
  isLoadingDetails: false,
  isLoadingContent: false,
  detailsError: null,
  contentError: null,
  prListCache: {},
  prDetailsCache: {},
};

let prsRequestSeq = 0;
const prDetailsRequestSeqByKey: Record<string, number> = {};
const prContentRequestSeqByKey: Record<string, number> = {};

function getPRListCacheKey(repoPath: string, filter: PRFilter): string {
  return `${repoPath}::${filter}`;
}

function getPRDetailsCacheKey(repoPath: string, prNumber: number): string {
  return `${repoPath}::${prNumber}`;
}

function isFresh(timestamp: number, ttlMs: number): boolean {
  return Date.now() - timestamp < ttlMs;
}

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

      fetchPRs: async (repoPath: string, options?: { force?: boolean }) => {
        const { currentFilter } = get();
        const force = options?.force ?? false;
        const cacheKey = getPRListCacheKey(repoPath, currentFilter);
        const cached = get().prListCache[cacheKey];

        set({ activeRepoPath: repoPath, error: null });

        if (cached && !force && isFresh(cached.fetchedAt, PR_LIST_CACHE_TTL_MS)) {
          set({ prs: cached.prs, isLoading: false });
          return;
        }

        if (cached) {
          set({ prs: cached.prs, isLoading: true });
        } else {
          set({ isLoading: true });
        }

        const requestId = ++prsRequestSeq;

        try {
          const prs = await invoke<PullRequest[]>("github_list_prs", {
            repoPath,
            filter: currentFilter,
          });

          if (requestId !== prsRequestSeq) return;

          set((state) => ({
            prs,
            isLoading: false,
            prListCache: {
              ...state.prListCache,
              [cacheKey]: {
                fetchedAt: Date.now(),
                prs,
              },
            },
          }));
        } catch (err) {
          if (requestId !== prsRequestSeq) return;

          set({
            error: err instanceof Error ? err.message : String(err),
            isLoading: false,
            prs: cached?.prs ?? [],
          });
        }
      },

      setFilter: (filter: PRFilter) => {
        set({ currentFilter: filter });
      },

      setActiveRepoPath: (repoPath: string | null) => {
        set({ activeRepoPath: repoPath });
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

      selectPR: async (repoPath: string, prNumber: number, options?: { force?: boolean }) => {
        const force = options?.force ?? false;
        const cacheKey = getPRDetailsCacheKey(repoPath, prNumber);
        const cached = get().prDetailsCache[cacheKey];
        const hasFreshDetails =
          cached && !force && isFresh(cached.fetchedAt, PR_DETAILS_CACHE_TTL_MS);

        if (hasFreshDetails) {
          set({
            selectedPRNumber: prNumber,
            selectedPRDetails: cached.details,
            selectedPRDiff: cached.diff ?? null,
            selectedPRFiles: cached.files ?? [],
            selectedPRComments: cached.comments ?? [],
            isLoadingDetails: false,
            detailsError: null,
            contentError: null,
          });
          return;
        }

        if (cached) {
          set({
            selectedPRNumber: prNumber,
            selectedPRDetails: cached.details,
            selectedPRDiff: cached.diff ?? null,
            selectedPRFiles: cached.files ?? [],
            selectedPRComments: cached.comments ?? [],
            isLoadingDetails: true,
            detailsError: null,
            contentError: null,
          });
        } else {
          set({
            selectedPRNumber: prNumber,
            selectedPRDetails: null,
            selectedPRDiff: null,
            selectedPRFiles: [],
            selectedPRComments: [],
            isLoadingDetails: true,
            detailsError: null,
            contentError: null,
          });
        }

        const requestId = (prDetailsRequestSeqByKey[cacheKey] ?? 0) + 1;
        prDetailsRequestSeqByKey[cacheKey] = requestId;

        try {
          const details = await invoke<PullRequestDetails>("github_get_pr_details", {
            repoPath,
            prNumber,
          });

          if (requestId !== prDetailsRequestSeqByKey[cacheKey]) return;

          set((state) => ({
            selectedPRDetails: details,
            isLoadingDetails: false,
            detailsError: null,
            contentError: null,
            prDetailsCache: {
              ...state.prDetailsCache,
              [cacheKey]: {
                ...(state.prDetailsCache[cacheKey] ?? {}),
                fetchedAt: Date.now(),
                details,
              },
            },
          }));
        } catch (err) {
          if (requestId !== prDetailsRequestSeqByKey[cacheKey]) return;

          set({
            detailsError: err instanceof Error ? err.message : String(err),
            isLoadingDetails: false,
          });
        }
      },

      fetchPRContent: async (
        repoPath: string,
        prNumber: number,
        options?: { force?: boolean; mode?: "files" | "comments" | "full" },
      ) => {
        const force = options?.force ?? false;
        const mode = options?.mode ?? "full";
        const needsFiles = mode === "full" || mode === "files";
        const needsComments = mode === "full" || mode === "comments";
        const cacheKey = getPRDetailsCacheKey(repoPath, prNumber);
        const cached = get().prDetailsCache[cacheKey];
        const filesFetchedAt = cached?.filesFetchedAt ?? cached?.contentFetchedAt;
        const commentsFetchedAt = cached?.commentsFetchedAt ?? cached?.contentFetchedAt;

        const hasFreshFiles =
          filesFetchedAt &&
          cached.diff !== undefined &&
          cached.files !== undefined &&
          isFresh(filesFetchedAt, PR_DETAILS_CACHE_TTL_MS);
        const hasFreshComments =
          commentsFetchedAt &&
          cached.comments !== undefined &&
          isFresh(commentsFetchedAt, PR_DETAILS_CACHE_TTL_MS);
        const hasFreshContent =
          !force && (!needsFiles || !!hasFreshFiles) && (!needsComments || !!hasFreshComments);

        if (hasFreshContent) {
          const current = get();
          set({
            selectedPRDiff: needsFiles ? (cached?.diff ?? null) : current.selectedPRDiff,
            selectedPRFiles: needsFiles ? (cached?.files ?? []) : current.selectedPRFiles,
            selectedPRComments: needsComments
              ? (cached?.comments ?? [])
              : current.selectedPRComments,
            isLoadingContent: false,
            contentError: null,
          });
          return;
        }

        const current = get();
        const hasCachedRequestedData =
          (needsFiles && (cached?.diff !== undefined || cached?.files !== undefined)) ||
          (needsComments && cached?.comments !== undefined);

        if (hasCachedRequestedData) {
          set({
            selectedPRDiff: needsFiles ? (cached?.diff ?? null) : current.selectedPRDiff,
            selectedPRFiles: needsFiles ? (cached?.files ?? []) : current.selectedPRFiles,
            selectedPRComments: needsComments
              ? (cached?.comments ?? [])
              : current.selectedPRComments,
            isLoadingContent: true,
            contentError: null,
          });
        } else {
          set({
            selectedPRDiff: needsFiles ? null : current.selectedPRDiff,
            selectedPRFiles: needsFiles ? [] : current.selectedPRFiles,
            selectedPRComments: needsComments ? [] : current.selectedPRComments,
            isLoadingContent: true,
            contentError: null,
          });
        }

        const shouldFetchFiles = needsFiles && (!!force || !hasFreshFiles);
        const shouldFetchComments = needsComments && (!!force || !hasFreshComments);
        const requestId = (prContentRequestSeqByKey[cacheKey] ?? 0) + 1;
        prContentRequestSeqByKey[cacheKey] = requestId;

        try {
          const [diff, files, comments] = await Promise.all([
            shouldFetchFiles
              ? invoke<string>("github_get_pr_diff", { repoPath, prNumber })
              : Promise.resolve(undefined),
            shouldFetchFiles
              ? invoke<PullRequestFile[]>("github_get_pr_files", { repoPath, prNumber })
              : Promise.resolve(undefined),
            shouldFetchComments
              ? invoke<PullRequestComment[]>("github_get_pr_comments", { repoPath, prNumber })
              : Promise.resolve(undefined),
          ]);

          if (requestId !== prContentRequestSeqByKey[cacheKey]) return;

          set((state) => {
            const now = Date.now();
            const baseDetails =
              state.prDetailsCache[cacheKey]?.details ??
              (state.selectedPRNumber === prNumber ? state.selectedPRDetails : null);
            const currentEntry = state.prDetailsCache[cacheKey];

            return {
              selectedPRDiff: needsFiles
                ? shouldFetchFiles
                  ? (diff ?? null)
                  : state.selectedPRDiff
                : state.selectedPRDiff,
              selectedPRFiles: needsFiles
                ? shouldFetchFiles
                  ? (files ?? [])
                  : state.selectedPRFiles
                : state.selectedPRFiles,
              selectedPRComments: needsComments
                ? shouldFetchComments
                  ? (comments ?? [])
                  : state.selectedPRComments
                : state.selectedPRComments,
              isLoadingContent: false,
              contentError: null,
              prDetailsCache: baseDetails
                ? {
                    ...state.prDetailsCache,
                    [cacheKey]: {
                      ...(currentEntry ?? {
                        fetchedAt: now,
                        details: baseDetails,
                      }),
                      diff: shouldFetchFiles ? diff : currentEntry?.diff,
                      files: shouldFetchFiles ? files : currentEntry?.files,
                      comments: shouldFetchComments ? comments : currentEntry?.comments,
                      filesFetchedAt: shouldFetchFiles ? now : currentEntry?.filesFetchedAt,
                      commentsFetchedAt: shouldFetchComments
                        ? now
                        : currentEntry?.commentsFetchedAt,
                      contentFetchedAt:
                        shouldFetchFiles || shouldFetchComments
                          ? now
                          : currentEntry?.contentFetchedAt,
                    },
                  }
                : state.prDetailsCache,
            };
          });
        } catch (err) {
          if (requestId !== prContentRequestSeqByKey[cacheKey]) return;

          set({
            contentError: err instanceof Error ? err.message : String(err),
            isLoadingContent: false,
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
          isLoadingDetails: false,
          isLoadingContent: false,
          detailsError: null,
          contentError: null,
        });
      },

      reset: () => {
        set(initialState);
      },
    },
  })),
);
