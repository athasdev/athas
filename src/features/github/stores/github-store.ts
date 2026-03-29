import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import type {
  GitHubAuthSource,
  GitHubAuthStatus,
  PRFilter,
  PullRequest,
  PullRequestComment,
  PullRequestDetails,
  PullRequestFile,
} from "../types/github";

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
  authStatus: GitHubAuthStatus;
  authSource: GitHubAuthSource;
  cliAvailable: boolean;
  hasStoredPat: boolean;
  hasLegacyStoredToken: boolean;
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

const emptyAuthStatus: GitHubAuthStatus = {
  source: "none",
  isAuthenticated: false,
  currentUser: null,
  cliAvailable: false,
  hasStoredPat: false,
  hasLegacyStoredToken: false,
};

const initialState: GitHubState = {
  prs: [],
  currentFilter: "all",
  isLoading: false,
  error: null,
  activeRepoPath: null,
  authStatus: emptyAuthStatus,
  authSource: "none",
  cliAvailable: false,
  hasStoredPat: false,
  hasLegacyStoredToken: false,
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
const prDetailsInFlightByKey: Record<string, Promise<void> | undefined> = {};
const prContentInFlightByKey: Record<string, Promise<void> | undefined> = {};

function getPRListCacheKey(repoPath: string, filter: PRFilter): string {
  return `${repoPath}::${filter}`;
}

function getPRDetailsCacheKey(repoPath: string, prNumber: number): string {
  return `${repoPath}::${prNumber}`;
}

function isFresh(timestamp: number, ttlMs: number): boolean {
  return Date.now() - timestamp < ttlMs;
}

function normalizePullRequestFiles(files: unknown): PullRequestFile[] {
  if (!Array.isArray(files)) return [];

  return files
    .map((file) => {
      if (!file || typeof file !== "object") return null;
      const record = file as Record<string, unknown>;
      const path = typeof record.path === "string" ? record.path.trim() : "";
      if (!path) return null;

      return {
        path,
        additions: typeof record.additions === "number" ? record.additions : 0,
        deletions: typeof record.deletions === "number" ? record.deletions : 0,
      };
    })
    .filter((file): file is PullRequestFile => !!file);
}

function getStringValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "";
}

function normalizePullRequest(pr: PullRequest): PullRequest {
  const record = pr as PullRequest & Record<string, unknown>;
  const headRef = getStringValue(record, ["headRef", "headRefName", "head_ref"]);
  const baseRef = getStringValue(record, ["baseRef", "baseRefName", "base_ref"]);

  if (!headRef || !baseRef) {
    console.warn("GitHub PR list item is missing branch refs", {
      number: pr.number,
      title: pr.title,
      headRef,
      baseRef,
      rawKeys: Object.keys(record),
    });
  }

  return {
    ...pr,
    headRef,
    baseRef,
  };
}

function normalizePullRequestDetails(details: PullRequestDetails): PullRequestDetails {
  const record = details as PullRequestDetails & Record<string, unknown>;

  return {
    ...details,
    headRef: getStringValue(record, ["headRef", "headRefName", "head_ref"]),
    baseRef: getStringValue(record, ["baseRef", "baseRefName", "base_ref"]),
  };
}

function buildAuthState(status: GitHubAuthStatus) {
  return {
    authStatus: status,
    authSource: status.source,
    cliAvailable: status.cliAvailable,
    hasStoredPat: status.hasStoredPat,
    hasLegacyStoredToken: status.hasLegacyStoredToken,
    isAuthenticated: status.isAuthenticated,
    currentUser: status.currentUser,
  };
}

function resetGitHubDataState() {
  return {
    prs: [] as PullRequest[],
    error: null,
    selectedPRNumber: null,
    selectedPRDetails: null,
    selectedPRDiff: null,
    selectedPRFiles: [] as PullRequestFile[],
    selectedPRComments: [] as PullRequestComment[],
    isLoading: false,
    isLoadingDetails: false,
    isLoadingContent: false,
    detailsError: null,
    contentError: null,
    prListCache: {} as Record<string, PRListCacheEntry>,
    prDetailsCache: {} as Record<string, PRDetailsCacheEntry>,
  };
}

export const useGitHubStore = create(
  combine(initialState, (set, get) => {
    const refreshAuthStatus = async () => {
      try {
        const status = await invoke<GitHubAuthStatus>("github_get_auth_status");

        set((state) => {
          const authChanged =
            state.authStatus.source !== status.source ||
            state.authStatus.isAuthenticated !== status.isAuthenticated ||
            state.authStatus.currentUser !== status.currentUser;

          return {
            ...buildAuthState(status),
            error: null,
            ...(authChanged ? resetGitHubDataState() : {}),
          };
        });

        return status;
      } catch {
        set((state) => ({
          ...buildAuthState(emptyAuthStatus),
          ...(state.isAuthenticated || state.authSource !== "none" ? resetGitHubDataState() : {}),
        }));
        return emptyAuthStatus;
      }
    };

    return {
      actions: {
        refreshAuthStatus,

        checkAuth: refreshAuthStatus,

        storePatFallback: async (token: string) => {
          const status = await invoke<GitHubAuthStatus>("store_github_pat_fallback", { token });
          set({
            ...buildAuthState(status),
            ...resetGitHubDataState(),
          });
          return status;
        },

        removePatFallback: async () => {
          const status = await invoke<GitHubAuthStatus>("remove_github_pat_fallback");
          set({
            ...buildAuthState(status),
            ...resetGitHubDataState(),
          });
          return status;
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
            const isAuthError = /unauthorized|forbidden|401|403|credential|auth|token/i.test(
              message,
            );

            if (isAuthError) {
              const status = await refreshAuthStatus();
              if (!status.isAuthenticated) {
                set({ isLoading: false, error: null });
                return;
              }
            }

            if (/checkout pull requests requires github cli authentication/i.test(message)) {
              set({ error: null, isLoading: false });
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

        openPRInBrowser: async (url: string | null | undefined) => {
          if (!url) {
            return;
          }

          try {
            const { openUrl } = await import("@tauri-apps/plugin-opener");
            await openUrl(url);
          } catch (err) {
            console.error("Failed to open PR:", err);
          }
        },

        checkoutPR: async (repoPath: string, prNumber: number) => {
          if (get().authSource === "pat") {
            throw new Error("Checking out pull requests requires GitHub CLI authentication.");
          }

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

          if (!force && prDetailsInFlightByKey[cacheKey]) {
            await prDetailsInFlightByKey[cacheKey];
            return;
          }

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

          const run = (async () => {
            try {
              const detailsResponse = await invoke<PullRequestDetails>("github_get_pr_details", {
                repoPath,
                prNumber,
              });
              const details = normalizePullRequestDetails(detailsResponse);

              if (requestId !== prDetailsRequestSeqByKey[cacheKey]) return;

              set((state) => ({
                selectedPRDetails: details,
                isLoadingDetails: false,
                detailsError: null,
                contentError: null,
                prDetailsCache: {
                  ...state.prDetailsCache,
                  [cacheKey]: {
                    ...state.prDetailsCache[cacheKey],
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
            } finally {
              delete prDetailsInFlightByKey[cacheKey];
            }
          })();

          prDetailsInFlightByKey[cacheKey] = run;
          await run;
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

              if (requestId !== prContentRequestSeqByKey[cacheKey]) return;

              const normalizedFiles = shouldFetchFiles
                ? normalizePullRequestFiles(files)
                : undefined;

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
              if (requestId !== prContentRequestSeqByKey[cacheKey]) return;

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
    };
  }),
);
