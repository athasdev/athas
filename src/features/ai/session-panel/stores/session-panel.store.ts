import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import { skipUnchangedPersistWrites } from "@/features/ai/stores/ai-chat/ai-chat-persist-storage";
import type { SessionPanelState, SessionPanelTab } from "../types/session-panel.types";

/** Sessions whose panel state is kept across restarts, most recently used first. */
const MAX_REMEMBERED_PANELS = 200;
const MAX_SERVERS_PER_SESSION = 8;

export const DEFAULT_SESSION_PANEL: SessionPanelState = {
  open: false,
  tab: "changes",
  fullscreen: false,
  browserUrl: "",
  terminalGeneration: 0,
  autoOpened: false,
  updatedAt: 0,
};

function isBlankAddress(url: string) {
  return !url || url === "about:blank";
}

/**
 * What a dev server becoming reachable changes in a session's tools. The browser opens itself
 * once per session: a collapsed session expands its card on Browser at the server, an expanded
 * card keeps the tool the user chose and only marks Browser, and a page the user is reading is
 * never replaced.
 */
export function planDevServerOpen(
  panel: SessionPanelState,
  url: string,
): { patch: Partial<SessionPanelState>; attention: SessionPanelTab | null } | null {
  if (panel.autoOpened) return null;
  const browserUrl = isBlankAddress(panel.browserUrl) ? url : panel.browserUrl;
  if (!panel.open) {
    return {
      patch: { open: true, tab: "browser", browserUrl, autoOpened: true },
      attention: null,
    };
  }
  return {
    patch: { browserUrl, autoOpened: true },
    attention: panel.tab === "browser" ? null : "browser",
  };
}

export function getSessionBrowserPageId(chatId: string) {
  return `agent-session-browser:${chatId}`;
}

const TERMINAL_PREFIX = "agent-session-terminal-";
const TERMINAL_GENERATION = /~\d+$/;

/**
 * The id of a session's terminal. A terminal moved into an editor tab keeps its id, so the
 * session's next terminal takes the following generation.
 */
export function getSessionTerminalId(chatId: string, generation = 0) {
  return generation > 0
    ? `${TERMINAL_PREFIX}${chatId}~${generation}`
    : `${TERMINAL_PREFIX}${chatId}`;
}

/** The chat a session terminal belongs to, or null for any other terminal. */
export function getSessionTerminalChatId(terminalId: string): string | null {
  if (!terminalId.startsWith(TERMINAL_PREFIX)) return null;
  return terminalId.slice(TERMINAL_PREFIX.length).replace(TERMINAL_GENERATION, "");
}

interface SessionPanelStoreState {
  panels: Record<string, SessionPanelState>;
  /** Local servers each session's commands printed, newest first. */
  servers: Record<string, string[]>;
  /** The latest of those servers that answered. */
  liveServers: Record<string, string>;
  /** Tabs that have something new since the user last looked at them. */
  attention: Record<string, Partial<Record<SessionPanelTab, true>>>;
  /** A tab the user asked to use, so its view takes keyboard focus once when it shows. */
  focusRequests: Record<string, SessionPanelTab>;
  actions: {
    toggle: (chatId: string) => void;
    open: (chatId: string, tab?: SessionPanelTab) => void;
    close: (chatId: string) => void;
    selectTab: (chatId: string, tab: SessionPanelTab) => void;
    toggleFullscreen: (chatId: string) => void;
    /** Gives the session a new terminal; the current one moved into an editor tab. */
    detachTerminal: (chatId: string) => void;
    setBrowserPage: (chatId: string, page: { url?: string; zoom?: number }) => void;
    recordServer: (chatId: string, url: string) => void;
    markServerLive: (chatId: string, url: string) => void;
    markAttention: (chatId: string, tab: SessionPanelTab) => void;
    clearAttention: (chatId: string, tab: SessionPanelTab) => void;
    requestFocus: (chatId: string, tab: SessionPanelTab) => void;
    /** Whether `tab` was asked to take focus, clearing the request. */
    consumeFocus: (chatId: string, tab: SessionPanelTab) => boolean;
    /** Applies {@link planDevServerOpen}; returns whether the panel changed. */
    openForDevServer: (chatId: string, url: string) => boolean;
  };
}

type PersistedSessionPanels = Pick<SessionPanelStoreState, "panels">;

function rememberRecent(panels: Record<string, SessionPanelState>) {
  const entries = Object.entries(panels);
  if (entries.length <= MAX_REMEMBERED_PANELS) return panels;
  return Object.fromEntries(
    entries
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_REMEMBERED_PANELS),
  );
}

export function selectSessionPanel(
  state: Pick<SessionPanelStoreState, "panels">,
  chatId: string | null | undefined,
): SessionPanelState {
  return (chatId ? state.panels[chatId] : undefined) ?? DEFAULT_SESSION_PANEL;
}

const useSessionPanelStoreBase = create<SessionPanelStoreState>()(
  persist(
    (set, get) => {
      const patchPanel = (chatId: string, patch: Partial<SessionPanelState>) =>
        set((state) => ({
          panels: {
            ...state.panels,
            [chatId]: { ...selectSessionPanel(state, chatId), ...patch, updatedAt: Date.now() },
          },
        }));

      const clearAttention = (chatId: string, tab: SessionPanelTab) =>
        set((state) => {
          if (!state.attention[chatId]?.[tab]) return state;
          const tabs = { ...state.attention[chatId] };
          delete tabs[tab];
          return { attention: { ...state.attention, [chatId]: tabs } };
        });

      return {
        panels: {},
        servers: {},
        liveServers: {},
        attention: {},
        focusRequests: {},
        actions: {
          toggle: (chatId) => {
            const panel = selectSessionPanel(get(), chatId);
            patchPanel(chatId, { open: !panel.open });
            if (!panel.open) clearAttention(chatId, panel.tab);
          },
          open: (chatId, tab) => {
            const panel = selectSessionPanel(get(), chatId);
            const nextTab = tab ?? panel.tab;
            patchPanel(chatId, { open: true, tab: nextTab });
            clearAttention(chatId, nextTab);
          },
          close: (chatId) => patchPanel(chatId, { open: false }),
          selectTab: (chatId, tab) => {
            patchPanel(chatId, { tab });
            clearAttention(chatId, tab);
          },
          toggleFullscreen: (chatId) =>
            patchPanel(chatId, { fullscreen: !selectSessionPanel(get(), chatId).fullscreen }),
          detachTerminal: (chatId) =>
            patchPanel(chatId, {
              terminalGeneration: selectSessionPanel(get(), chatId).terminalGeneration + 1,
            }),
          setBrowserPage: (chatId, page) => {
            const panel = selectSessionPanel(get(), chatId);
            const url = page.url ?? panel.browserUrl;
            const zoom = "zoom" in page ? page.zoom : panel.browserZoom;
            if (url === panel.browserUrl && zoom === panel.browserZoom) return;
            patchPanel(chatId, { browserUrl: url, browserZoom: zoom });
          },
          recordServer: (chatId, url) =>
            set((state) => {
              const current = state.servers[chatId] ?? [];
              if (current[0] === url) return state;
              const next = [url, ...current.filter((entry) => entry !== url)].slice(
                0,
                MAX_SERVERS_PER_SESSION,
              );
              return { servers: { ...state.servers, [chatId]: next } };
            }),
          markServerLive: (chatId, url) =>
            set((state) =>
              state.liveServers[chatId] === url
                ? state
                : { liveServers: { ...state.liveServers, [chatId]: url } },
            ),
          markAttention: (chatId, tab) =>
            set((state) => {
              if (state.attention[chatId]?.[tab]) return state;
              return {
                attention: {
                  ...state.attention,
                  [chatId]: { ...state.attention[chatId], [tab]: true },
                },
              };
            }),
          clearAttention,
          requestFocus: (chatId, tab) =>
            set((state) => ({ focusRequests: { ...state.focusRequests, [chatId]: tab } })),
          consumeFocus: (chatId, tab) => {
            if (get().focusRequests[chatId] !== tab) return false;
            set((state) => {
              const focusRequests = { ...state.focusRequests };
              delete focusRequests[chatId];
              return { focusRequests };
            });
            return true;
          },
          openForDevServer: (chatId, url) => {
            const plan = planDevServerOpen(selectSessionPanel(get(), chatId), url);
            if (!plan) return false;
            patchPanel(chatId, plan.patch);
            if (plan.attention) get().actions.markAttention(chatId, plan.attention);
            return true;
          },
        },
      };
    },
    {
      name: "athas-agent-session-panels-v1",
      version: 1,
      storage: skipUnchangedPersistWrites(
        createJSONStorage<PersistedSessionPanels>(() => localStorage),
      ),
      partialize: (state): PersistedSessionPanels => ({ panels: rememberRecent(state.panels) }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        panels: Object.fromEntries(
          Object.entries((persistedState as PersistedSessionPanels | undefined)?.panels ?? {}).map(
            ([chatId, panel]) => [chatId, { ...DEFAULT_SESSION_PANEL, ...panel }],
          ),
        ),
      }),
    },
  ),
);

export const useSessionPanelStore = createSelectors(useSessionPanelStoreBase);

export function useSessionPanel(chatId: string | null | undefined): SessionPanelState {
  return useSessionPanelStore((state) => selectSessionPanel(state, chatId));
}
