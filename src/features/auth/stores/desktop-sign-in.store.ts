import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import { beginDesktopAuthSession, waitForDesktopAuthToken } from "../services/auth-api";
import { useAuthStore } from "./auth.store";

interface Dependencies {
  begin: typeof beginDesktopAuthSession;
  wait: typeof waitForDesktopAuthToken;
  open: (url: string) => Promise<void>;
  complete: (token: string) => Promise<void>;
}

interface State {
  isSigningIn: boolean;
  loginUrl: string | null;
  error: string | null;
  actions: {
    signIn: (apiBase?: string) => Promise<boolean>;
    cancel: () => void;
    reopen: () => Promise<void>;
  };
}

export function createDesktopSignInStore(dependencies: Dependencies) {
  let pending: Promise<boolean> | null = null;
  let controller: AbortController | null = null;
  return create<State>()((set, get) => ({
    isSigningIn: false,
    loginUrl: null,
    error: null,
    actions: {
      signIn: (apiBase) => {
        if (pending) return pending;
        const attempt = new AbortController();
        controller = attempt;
        set({ isSigningIn: true, error: null });
        const request = (async () => {
          try {
            const session = await dependencies.begin({ apiBase, signal: attempt.signal });
            attempt.signal.throwIfAborted();
            set({ loginUrl: session.loginUrl });
            await dependencies.open(session.loginUrl);
            attempt.signal.throwIfAborted();
            const token = await dependencies.wait(
              session.sessionId,
              session.pollSecret,
              undefined,
              {
                apiBase: session.apiBase,
                signal: attempt.signal,
              },
            );
            attempt.signal.throwIfAborted();
            await dependencies.complete(token);
            return true;
          } catch (error) {
            if (attempt.signal.aborted) return false;
            set({ error: error instanceof Error ? error.message : "Sign-in failed." });
            return false;
          } finally {
            if (controller === attempt) {
              controller = null;
              pending = null;
              set({ isSigningIn: false, loginUrl: null });
            }
          }
        })();
        pending = request;
        return request;
      },
      cancel: () => {
        controller?.abort();
        controller = null;
        pending = null;
        set({ isSigningIn: false, loginUrl: null, error: null });
      },
      reopen: async () => {
        const url = get().loginUrl;
        if (url) await dependencies.open(url);
      },
    },
  }));
}

export const useDesktopSignInStore = createSelectors(
  createDesktopSignInStore({
    begin: beginDesktopAuthSession,
    wait: waitForDesktopAuthToken,
    open: openUrl,
    complete: (token) => useAuthStore.getState().actions.handleAuthCallback(token),
  }),
);

if (import.meta.hot)
  import.meta.hot.dispose(() => useDesktopSignInStore.getState().actions.cancel());
