import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import { skipUnchangedPersistWrites } from "@/features/ai/stores/ai-chat/ai-chat-persist-storage";
import {
  type LegacySessionPanel,
  selectDockLayout,
  useDockLayoutStore,
} from "@/features/layout/stores/dock-layout.store";
import type { DockOwner } from "@/features/layout/types/dock.types";
import type {
  SessionBoxId,
  SessionPanelState,
  SessionPanelTab,
} from "../types/session-panel.types";

/** Sessions whose panel state is kept across restarts, most recently used first. */
const MAX_REMEMBERED_PANELS = 200;
const MAX_SERVERS_PER_SESSION = 8;

export const DEFAULT_SESSION_PANEL: SessionPanelState = {
  browserUrl: "",
  terminalGeneration: 0,
  autoOpened: false,
  updatedAt: 0,
};

function isBlankAddress(url: string) {
  return !url || url === "about:blank";
}

/** The dock of a chat's session. */
export function getSessionDockOwner(chatId: string): DockOwner {
  return { kind: "session", id: chatId };
}

/**
 * What a dev server becoming reachable changes in a session's tools. The browser opens itself
 * once per session: a session showing only its details opens Browser at the server, a dock with
 * tools open keeps them and only marks Browser, and a page the user is reading is never replaced.
 */
export function planDevServerOpen(
  panel: SessionPanelState,
  url: string,
  dockPanes: readonly string[],
): {
  patch: Partial<SessionPanelState>;
  openBrowser: boolean;
  attention: SessionPanelTab | null;
} | null {
  if (panel.autoOpened) return null;
  const browserUrl = isBlankAddress(panel.browserUrl) ? url : panel.browserUrl;
  const patch = { browserUrl, autoOpened: true };
  if (dockPanes.length === 0) return { patch, openBrowser: true, attention: null };
  return {
    patch,
    openBrowser: false,
    attention: dockPanes.includes("browser") ? null : "browser",
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
  /** The changed file each session's Changes tool shows the diff of. */
  selectedChanges: Record<string, string>;
  /** Boxes the user folded to their header, the same in every session. */
  collapsedBoxes: Partial<Record<SessionBoxId, true>>;
  actions: {
    /** Gives the session a new terminal; the current one moved into an editor tab. */
    detachTerminal: (chatId: string) => void;
    setBrowserPage: (chatId: string, page: { url?: string; zoom?: number }) => void;
    recordServer: (chatId: string, url: string) => void;
    markServerLive: (chatId: string, url: string) => void;
    clearServerLive: (chatId: string) => void;
    markAttention: (chatId: string, tab: SessionPanelTab) => void;
    clearAttention: (chatId: string, tab: SessionPanelTab) => void;
    /** Applies {@link planDevServerOpen}; returns whether the session's tools changed. */
    openForDevServer: (chatId: string, url: string) => boolean;
    selectChange: (chatId: string, path: string) => void;
    toggleBoxCollapsed: (box: SessionBoxId) => void;
  };
}

type PersistedSessionPanels = Pick<SessionPanelStoreState, "panels" | "collapsedBoxes">;

const KEPT_PANEL_FIELDS = new Set<string>([
  "browserUrl",
  "browserZoom",
  "terminalGeneration",
  "autoOpened",
  "updatedAt",
]);

/**
 * Before the dock, a session's panel kept which tool it showed (`open`, `tab`, `fullscreen`).
 * Version 3 hands that to the dock as the session's layout and drops it here.
 */
export function migrateSessionPanels(
  persisted: unknown,
  version: number,
  seedDock: (panels: Record<string, LegacySessionPanel>) => void,
): PersistedSessionPanels {
  const state = (persisted ?? {}) as Partial<PersistedSessionPanels> & {
    panels?: Record<string, SessionPanelState & LegacySessionPanel>;
  };
  if (version >= 3) return state as PersistedSessionPanels;
  const legacy = state.panels ?? {};
  seedDock(legacy);
  return {
    collapsedBoxes: state.collapsedBoxes ?? {},
    panels: Object.fromEntries(
      Object.entries(legacy).map(([chatId, panel]) => [
        chatId,
        Object.fromEntries(
          Object.entries(panel).filter(
            ([key, value]) => KEPT_PANEL_FIELDS.has(key) && value !== undefined,
          ),
        ) as SessionPanelState,
      ]),
    ),
  };
}

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
        selectedChanges: {},
        collapsedBoxes: {},
        actions: {
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
          clearServerLive: (chatId) =>
            set((state) => {
              if (!(chatId in state.liveServers)) return state;
              const liveServers = { ...state.liveServers };
              delete liveServers[chatId];
              return { liveServers };
            }),
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
          openForDevServer: (chatId, url) => {
            const owner = getSessionDockOwner(chatId);
            const dock = useDockLayoutStore.getState();
            const plan = planDevServerOpen(
              selectSessionPanel(get(), chatId),
              url,
              selectDockLayout(dock, owner).panes,
            );
            if (!plan) return false;
            patchPanel(chatId, plan.patch);
            if (plan.openBrowser) dock.actions.open(owner, "browser");
            if (plan.attention) get().actions.markAttention(chatId, plan.attention);
            return true;
          },
          selectChange: (chatId, path) =>
            set((state) =>
              state.selectedChanges[chatId] === path
                ? state
                : { selectedChanges: { ...state.selectedChanges, [chatId]: path } },
            ),
          toggleBoxCollapsed: (box) =>
            set((state) => {
              const collapsedBoxes = { ...state.collapsedBoxes };
              if (collapsedBoxes[box]) delete collapsedBoxes[box];
              else collapsedBoxes[box] = true;
              return { collapsedBoxes };
            }),
        },
      };
    },
    {
      name: "athas-agent-session-panels-v1",
      version: 3,
      storage: skipUnchangedPersistWrites(
        createJSONStorage<PersistedSessionPanels>(() => localStorage),
      ),
      migrate: (persistedState, version) =>
        migrateSessionPanels(persistedState, version, (panels) =>
          useDockLayoutStore.getState().actions.seedLegacyPanels(panels),
        ),
      partialize: (state): PersistedSessionPanels => ({
        panels: rememberRecent(state.panels),
        collapsedBoxes: state.collapsedBoxes,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PersistedSessionPanels> | undefined;
        return {
          ...currentState,
          panels: Object.fromEntries(
            Object.entries(persisted?.panels ?? {}).map(([chatId, panel]) => [
              chatId,
              { ...DEFAULT_SESSION_PANEL, ...panel },
            ]),
          ),
          collapsedBoxes: persisted?.collapsedBoxes ?? {},
        };
      },
    },
  ),
);

export const useSessionPanelStore = createSelectors(useSessionPanelStoreBase);

export function useSessionPanel(chatId: string | null | undefined): SessionPanelState {
  return useSessionPanelStore((state) => selectSessionPanel(state, chatId));
}
