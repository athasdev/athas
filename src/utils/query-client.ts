import {
  focusManager,
  QueryClient,
  type DefaultOptions,
  type QueryKey,
} from "@tanstack/react-query";

/**
 * Cache for data fetched over IPC or HTTP (GitHub, Docker, the extension catalog). Each window has
 * its own client: detached windows are separate JavaScript contexts.
 */
const QUERY_DEFAULTS: DefaultOptions = {
  queries: {
    staleTime: 60_000,
    // Commands fail for reasons a retry does not fix (no repository, no token, daemon offline),
    // so one retry covers a transient network error without hiding real failures for long.
    retry: 1,
    // Requests go through Tauri commands, not the webview's network stack, so `navigator.onLine`
    // says nothing about whether they can succeed.
    networkMode: "always",
    refetchOnReconnect: false,
  },
  mutations: { networkMode: "always" },
};

export function createQueryClient(overrides: DefaultOptions = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: { ...QUERY_DEFAULTS.queries, ...overrides.queries },
      mutations: { ...QUERY_DEFAULTS.mutations, ...overrides.mutations },
    },
  });
}

export const queryClient = createQueryClient();

let focusTrackingInstalled = false;

/**
 * Focus follows document visibility, as before: a hidden window pauses polling. A native window
 * focus also counts as a focus event, so stale queries refresh when the user switches back to
 * Athas even though the webview never became hidden.
 */
function installFocusTracking() {
  if (focusTrackingInstalled || typeof document === "undefined") return;
  focusTrackingInstalled = true;

  focusManager.setEventListener((handleFocus) => {
    const handleVisibilityChange = () => handleFocus();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    let disposed = false;
    let unlistenWindowFocus: (() => void) | null = null;
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            if (focused && document.visibilityState !== "hidden") focusManager.onFocus();
          }),
        )
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlistenWindowFocus = unlisten;
        })
        .catch(() => {});
    }

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unlistenWindowFocus?.();
    };
  });
}

installFocusTracking();

export function getQueryErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

/**
 * Refetch after a mutation. Requests already in flight started before the mutation and may carry
 * the old state, so they are cancelled first instead of being reused.
 */
export async function refetchAfterMutation(client: QueryClient, queryKey: QueryKey) {
  await client.cancelQueries({ queryKey });
  await client.invalidateQueries({ queryKey }, { cancelRefetch: true });
}
