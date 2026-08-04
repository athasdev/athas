import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { emitGitChanged } from "@/features/git/events/git-events";
import type {
  PRFilter,
  PullRequest,
  PullRequestComment,
  PullRequestDetails,
  PullRequestFile,
} from "../types/github.types";
import { syncGitHubTokenFromAccount } from "../services/github-token-service";
import {
  AUTH_CACHE_TTL_MS,
  fetchNormalizedPRDetails,
  getGitHubAccountStatus,
  getGitHubErrorMessage,
  getPRDetailsCacheKey,
  getPRListCacheKey,
  isFresh,
  normalizePullRequest,
  normalizePullRequestFiles,
  PR_DETAILS_CACHE_TTL_MS,
  PR_LIST_CACHE_TTL_MS,
} from "../services/github-pr-store-service";
import { createSelectors } from "@/utils/zustand-selectors";

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

type GitHubAuthStatus = "authenticated" | "notAuthenticated";
type GitHubAccountStatus = "unknown" | "notSignedIn" | "notConnected" | "connected";

interface GitHubState {
  prs: PullRequest[];
  currentFilter: PRFilter;
  isLoading: boolean;
  error: string | null;
  activeRepoPath: string | null;
  isAuthenticated: boolean;
  isCheckingAuth: boolean;
  authStatus: GitHubAuthStatus;
  githubAccountStatus: GitHubAccountStatus;
  authError: string | null;
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
  isCheckingAuth: false,
  authStatus: "notAuthenticated" as GitHubAuthStatus,
  githubAccountStatus: "unknown" as GitHubAccountStatus,
  authError: null,
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
let authCheckedAt = 0;
let authCheckInFlight: Promise<void> | null = null;
let selectedPRRequestSeq = 0;
const prDetailsRequestSeqByKey: Record<string, number> = {};
const prContentRequestSeqByKey: Record<string, number> = {};
const prDetailsInFlightByKey: Record<string, Promise<PullRequestDetails> | undefined> = {};
const prContentInFlightByKey: Record<string, Promise<void> | undefined> = {};

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
          const status = await invoke<GitHubAuthStatus>("github_check_auth");
          if (status === "authenticated") {
            const user = await invoke<string>("github_get_current_user");
            set({
              isAuthenticated: true,
              isCheckingAuth: false,
              authStatus: status,
              githubAccountStatus: "connected",
              currentUser: user,
              error: null,
              authError: null,
            });
          } else {
            let githubAccountStatus = get().githubAccountStatus;

            if (status === "notAuthenticated") {
              try {
                const syncResult = await syncGitHubTokenFromAccount();
                githubAccountStatus = getGitHubAccountStatus(syncResult.status);

                if (syncResult.status === "synced") {
                  const syncedStatus = await invoke<GitHubAuthStatus>("github_check_auth");

                  if (syncedStatus === "authenticated") {
                    const user = await invoke<string>("github_get_current_user");
                    set({
                      isAuthenticated: true,
                      isCheckingAuth: false,
                      authStatus: syncedStatus,
                      githubAccountStatus,
                      currentUser: user,
                      error: null,
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
          const prsResponse = await invoke<PullRequest[]>("github_list_prs", {
            repoPath,
            filter: currentFilter,
          });
          const prs = prsResponse.map(normalizePullRequest);

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

          const message = err instanceof Error ? err.message : String(err);
          const isAuthError = /unauthorized|forbidden|401|403|credential|auth|token/i.test(message);

          if (isAuthError) {
            console.warn("GitHub pull request fetch failed authentication:", err);
            authCheckedAt = 0;
            set({
              isAuthenticated: false,
              currentUser: null,
              isLoading: false,
              error: null,
              authError: message,
            });
            return;
          }

          set({
            error: message,
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
          const cacheKey = getPRDetailsCacheKey(repoPath, prNumber);
          const cachedUrl = get().prDetailsCache[cacheKey]?.details?.url;
          const url =
            cachedUrl ||
            (
              await invoke<PullRequestDetails>("github_get_pr_details", {
                repoPath,
                prNumber,
              })
            ).url;

          if (url.startsWith("https://github.com/")) {
            await openUrl(url);
          }
        } catch (err) {
          console.error("Failed to open PR:", err);
        }
      },

      checkoutPR: async (repoPath: string, prNumber: number) => {
        try {
          await invoke("github_checkout_pr", { repoPath, prNumber });
          emitGitChanged({
            repoPath,
            scopes: ["working-tree", "history", "refs"],
            source: "checkout-pull-request",
          });
        } catch (err) {
          console.error("Failed to checkout PR:", err);
          throw err;
        }
      },

      prefetchPR: async (repoPath: string, prNumber: number) => {
        const cacheKey = getPRDetailsCacheKey(repoPath, prNumber);
        const cached = get().prDetailsCache[cacheKey];

        if (cached && isFresh(cached.fetchedAt, PR_DETAILS_CACHE_TTL_MS)) {
          return;
        }

        const existingRequest = prDetailsInFlightByKey[cacheKey];
        if (existingRequest) {
          try {
            await existingRequest;
          } catch {
            return;
          }
          return;
        }

        let request: Promise<PullRequestDetails>;
        request = fetchNormalizedPRDetails(repoPath, prNumber)
          .then((details) => {
            set((state) => ({
              prDetailsCache: {
                ...state.prDetailsCache,
                [cacheKey]: {
                  ...state.prDetailsCache[cacheKey],
                  fetchedAt: Date.now(),
                  details,
                },
              },
            }));
            return details;
          })
          .finally(() => {
            if (prDetailsInFlightByKey[cacheKey] === request) {
              delete prDetailsInFlightByKey[cacheKey];
            }
          });

        prDetailsInFlightByKey[cacheKey] = request;

        try {
          await request;
        } catch {
          return;
        }
      },

      selectPR: async (repoPath: string, prNumber: number, options?: { force?: boolean }) => {
        const force = options?.force ?? false;
        const cacheKey = getPRDetailsCacheKey(repoPath, prNumber);
        const cached = get().prDetailsCache[cacheKey];
        const hasFreshDetails =
          cached && !force && isFresh(cached.fetchedAt, PR_DETAILS_CACHE_TTL_MS);
        const selectionRequestId = ++selectedPRRequestSeq;

        const applyCachedSelection = (entry: PRDetailsCacheEntry, isRefreshing: boolean) => {
          set({
            selectedPRNumber: prNumber,
            selectedPRDetails: entry.details,
            selectedPRDiff: entry.diff ?? null,
            selectedPRFiles: entry.files ?? [],
            selectedPRComments: entry.comments ?? [],
            isLoadingDetails: isRefreshing,
            detailsError: null,
            contentError: null,
          });
        };

        if (hasFreshDetails) {
          applyCachedSelection(cached, false);
          return;
        }

        if (cached) {
          applyCachedSelection(cached, true);
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

        const existingRequest = !force ? prDetailsInFlightByKey[cacheKey] : undefined;
        let request = existingRequest;
        if (!request) {
          request = fetchNormalizedPRDetails(repoPath, prNumber)
            .then((details) => {
              if (requestId === prDetailsRequestSeqByKey[cacheKey]) {
                set((state) => ({
                  prDetailsCache: {
                    ...state.prDetailsCache,
                    [cacheKey]: {
                      ...state.prDetailsCache[cacheKey],
                      fetchedAt: Date.now(),
                      details,
                    },
                  },
                }));
              }
              return details;
            })
            .finally(() => {
              if (prDetailsInFlightByKey[cacheKey] === request) {
                delete prDetailsInFlightByKey[cacheKey];
              }
            });

          prDetailsInFlightByKey[cacheKey] = request;
        }

        try {
          await request;
          if (
            selectionRequestId !== selectedPRRequestSeq ||
            requestId !== prDetailsRequestSeqByKey[cacheKey]
          ) {
            return;
          }

          const nextCached = get().prDetailsCache[cacheKey];
          if (nextCached) {
            applyCachedSelection(nextCached, false);
          } else {
            set((state) => ({
              selectedPRDetails: state.selectedPRDetails,
              isLoadingDetails: false,
              detailsError: null,
              contentError: null,
            }));
          }
        } catch (err) {
          if (
            selectionRequestId !== selectedPRRequestSeq ||
            requestId !== prDetailsRequestSeqByKey[cacheKey]
          ) {
            return;
          }

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
        const inFlightKey = `${cacheKey}::${mode}`;
        const cached = get().prDetailsCache[cacheKey];
        const filesFetchedAt = cached?.filesFetchedAt ?? cached?.contentFetchedAt;
        const commentsFetchedAt = cached?.commentsFetchedAt ?? cached?.contentFetchedAt;

        if (!force && prContentInFlightByKey[inFlightKey]) {
          await prContentInFlightByKey[inFlightKey];
          return;
        }

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

        const run = (async () => {
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

            if (
              requestId !== prContentRequestSeqByKey[cacheKey] ||
              get().selectedPRNumber !== prNumber
            ) {
              return;
            }

            const normalizedFiles = shouldFetchFiles ? normalizePullRequestFiles(files) : undefined;

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
                    ? (normalizedFiles ?? [])
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
                        files: shouldFetchFiles ? normalizedFiles : currentEntry?.files,
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
            if (
              requestId !== prContentRequestSeqByKey[cacheKey] ||
              get().selectedPRNumber !== prNumber
            ) {
              return;
            }

            set({
              contentError: err instanceof Error ? err.message : String(err),
              isLoadingContent: false,
            });
          } finally {
            delete prContentInFlightByKey[inFlightKey];
          }
        })();

        prContentInFlightByKey[inFlightKey] = run;
        await run;
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

export const useGitHubStore = createSelectors(useGitHubStoreBase);
