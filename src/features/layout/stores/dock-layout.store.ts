import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import type { DockLayout, DockOwner, DockPaneId } from "../types/dock.types";

/** Owners whose dock is kept across restarts, most recently used first. */
const MAX_REMEMBERED_LAYOUTS = 300;
export const DEFAULT_DOCK_WIDTH = 380;
export const MIN_DOCK_WIDTH = 260;
/** A project shown without a session opens on its files, as the sidebar did. */
export const DEFAULT_PROJECT_PANES: readonly DockPaneId[] = ["view:files"];

const EMPTY_SESSION_LAYOUT: DockLayout = {
  panes: [],
  sizes: {},
  maximized: null,
  infoExpanded: false,
  updatedAt: 0,
};
const EMPTY_PROJECT_LAYOUT: DockLayout = {
  ...EMPTY_SESSION_LAYOUT,
  panes: [...DEFAULT_PROJECT_PANES],
};

export function getDockOwnerKey(owner: DockOwner): string {
  return `${owner.kind}:${owner.id}`;
}

export function selectDockLayout(
  state: Pick<DockLayoutStoreState, "layouts">,
  owner: DockOwner | null | undefined,
): DockLayout {
  if (!owner) return EMPTY_SESSION_LAYOUT;
  return (
    state.layouts[getDockOwnerKey(owner)] ??
    (owner.kind === "project" ? EMPTY_PROJECT_LAYOUT : EMPTY_SESSION_LAYOUT)
  );
}

/** Whether `pane` is open in the owner's dock and the dock is out. */
export function isDockPaneShowing(owner: DockOwner | null | undefined, pane: DockPaneId): boolean {
  const state = useDockLayoutStoreBase.getState();
  return !state.hidden && selectDockLayout(state, owner).panes.includes(pane);
}

/** A tool panel a session had before the dock, as `athas-agent-session-panels-v1` stored it. */
export interface LegacySessionPanel {
  open?: boolean;
  tab?: string;
  fullscreen?: boolean;
  updatedAt?: number;
}

/** The dock a session had as its old tool panel: the tool it showed, covering the chat or not. */
export function getLegacyDockLayout(panel: LegacySessionPanel): DockLayout | null {
  if (!panel.open || !panel.tab) return null;
  return {
    ...EMPTY_SESSION_LAYOUT,
    panes: [panel.tab],
    maximized: panel.fullscreen ? panel.tab : null,
    updatedAt: panel.updatedAt ?? 0,
  };
}

/** Each open pane's share of the dock height, as percentages that add up to 100. */
export function getDockPaneShares(layout: Pick<DockLayout, "panes" | "sizes">): number[] {
  const { panes, sizes } = layout;
  if (panes.length === 0) return [];
  const known = panes.map((pane) => sizes[pane]).filter((size) => size !== undefined && size > 0);
  const fallback = known.length > 0 ? known.reduce((sum, size) => sum + size, 0) / known.length : 1;
  const weights = panes.map((pane) => {
    const size = sizes[pane];
    return size !== undefined && size > 0 ? size : fallback;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (weight / total) * 100);
}

interface DockLayoutStoreState {
  layouts: Record<string, DockLayout>;
  /** The dock's width while it shows tool panes, in pixels. */
  width: number;
  /** The user put the dock away; it comes back when a tool opens. */
  hidden: boolean;
  /** Whose tools the dock shows now; the workbench dock keeps it current. */
  currentOwner: DockOwner | null;
  /** A pane the user asked for, which takes focus once when it shows. */
  focusRequest: { owner: string; pane: DockPaneId; nonce: number } | null;
  actions: {
    /** Adds `pane` to the owner's dock, or keeps it where it is, and shows the dock. */
    open: (owner: DockOwner, pane: DockPaneId, options?: { focus?: boolean }) => void;
    close: (owner: DockOwner, pane: DockPaneId) => void;
    /** Opens `pane`, or closes it when it is already open. Returns whether it is open now. */
    toggle: (owner: DockOwner, pane: DockPaneId, options?: { focus?: boolean }) => boolean;
    move: (owner: DockOwner, pane: DockPaneId, toIndex: number) => void;
    resize: (owner: DockOwner, sizes: Record<DockPaneId, number>) => void;
    toggleMaximized: (owner: DockOwner, pane: DockPaneId) => void;
    setInfoExpanded: (owner: DockOwner, expanded: boolean) => void;
    setWidth: (width: number) => void;
    setHidden: (hidden: boolean) => void;
    setCurrentOwner: (owner: DockOwner | null) => void;
    /** Whether `pane` was asked to take focus, clearing the request. */
    consumeFocus: (owner: DockOwner, pane: DockPaneId) => boolean;
    /** Gives sessions without a dock the one their old tool panel described. */
    seedLegacyPanels: (panels: Record<string, LegacySessionPanel>) => void;
  };
}

type PersistedDockLayouts = Pick<DockLayoutStoreState, "layouts" | "width" | "hidden">;

function rememberRecent(layouts: Record<string, DockLayout>) {
  const entries = Object.entries(layouts);
  if (entries.length <= MAX_REMEMBERED_LAYOUTS) return layouts;
  return Object.fromEntries(
    entries
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_REMEMBERED_LAYOUTS),
  );
}

function withoutPane(sizes: Record<DockPaneId, number>, pane: DockPaneId) {
  if (!(pane in sizes)) return sizes;
  const next = { ...sizes };
  delete next[pane];
  return next;
}

const useDockLayoutStoreBase = create<DockLayoutStoreState>()(
  persist(
    (set, get) => {
      const patchLayout = (
        owner: DockOwner,
        patch: (layout: DockLayout) => Partial<DockLayout> | null,
      ) =>
        set((state) => {
          const layout = selectDockLayout(state, owner);
          const changes = patch(layout);
          if (!changes) return state;
          return {
            layouts: {
              ...state.layouts,
              [getDockOwnerKey(owner)]: { ...layout, ...changes, updatedAt: Date.now() },
            },
          };
        });

      const open: DockLayoutStoreState["actions"]["open"] = (owner, pane, options = {}) => {
        patchLayout(owner, (layout) => {
          const isOpen = layout.panes.includes(pane);
          if (isOpen && (layout.maximized === null || layout.maximized === pane)) return null;
          return {
            panes: isOpen ? layout.panes : [...layout.panes, pane],
            maximized: null,
          };
        });
        set((state) => ({
          hidden: false,
          focusRequest: options.focus
            ? { owner: getDockOwnerKey(owner), pane, nonce: (state.focusRequest?.nonce ?? 0) + 1 }
            : state.focusRequest,
        }));
      };

      const close: DockLayoutStoreState["actions"]["close"] = (owner, pane) =>
        patchLayout(owner, (layout) =>
          layout.panes.includes(pane)
            ? {
                panes: layout.panes.filter((candidate) => candidate !== pane),
                sizes: withoutPane(layout.sizes, pane),
                maximized: layout.maximized === pane ? null : layout.maximized,
              }
            : null,
        );

      return {
        layouts: {},
        width: DEFAULT_DOCK_WIDTH,
        hidden: false,
        currentOwner: null,
        focusRequest: null,
        actions: {
          open,
          close,
          toggle: (owner, pane, options) => {
            const layout = selectDockLayout(get(), owner);
            if (layout.panes.includes(pane) && !get().hidden) {
              close(owner, pane);
              return false;
            }
            open(owner, pane, options);
            return true;
          },
          move: (owner, pane, toIndex) =>
            patchLayout(owner, (layout) => {
              const from = layout.panes.indexOf(pane);
              const to = Math.max(0, Math.min(layout.panes.length - 1, toIndex));
              if (from === -1 || from === to) return null;
              const panes = [...layout.panes];
              panes.splice(from, 1);
              panes.splice(to, 0, pane);
              return { panes };
            }),
          resize: (owner, sizes) =>
            patchLayout(owner, (layout) => ({ sizes: { ...layout.sizes, ...sizes } })),
          toggleMaximized: (owner, pane) =>
            patchLayout(owner, (layout) =>
              layout.panes.includes(pane)
                ? { maximized: layout.maximized === pane ? null : pane }
                : null,
            ),
          setInfoExpanded: (owner, expanded) =>
            patchLayout(owner, (layout) =>
              layout.infoExpanded === expanded ? null : { infoExpanded: expanded },
            ),
          setWidth: (width) => set({ width: Math.max(MIN_DOCK_WIDTH, Math.round(width)) }),
          setHidden: (hidden) => set({ hidden }),
          setCurrentOwner: (owner) =>
            set((state) =>
              state.currentOwner?.kind === owner?.kind && state.currentOwner?.id === owner?.id
                ? state
                : { currentOwner: owner },
            ),
          consumeFocus: (owner, pane) => {
            const request = get().focusRequest;
            if (!request || request.owner !== getDockOwnerKey(owner) || request.pane !== pane) {
              return false;
            }
            set({ focusRequest: null });
            return true;
          },
          seedLegacyPanels: (panels) =>
            set((state) => {
              const seeded: Record<string, DockLayout> = {};
              for (const [chatId, panel] of Object.entries(panels)) {
                const key = getDockOwnerKey({ kind: "session", id: chatId });
                const layout = getLegacyDockLayout(panel);
                if (layout && !state.layouts[key]) seeded[key] = layout;
              }
              return Object.keys(seeded).length > 0
                ? { layouts: { ...seeded, ...state.layouts } }
                : state;
            }),
        },
      };
    },
    {
      name: "athas-dock-layouts-v1",
      version: 1,
      storage: createJSONStorage<PersistedDockLayouts>(() => localStorage),
      partialize: (state): PersistedDockLayouts => ({
        layouts: rememberRecent(state.layouts),
        width: state.width,
        hidden: state.hidden,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PersistedDockLayouts> | undefined;
        return {
          ...currentState,
          layouts: Object.fromEntries(
            Object.entries(persisted?.layouts ?? {}).map(([key, layout]) => [
              key,
              { ...EMPTY_SESSION_LAYOUT, ...layout },
            ]),
          ),
          width: Math.max(MIN_DOCK_WIDTH, persisted?.width ?? DEFAULT_DOCK_WIDTH),
          hidden: persisted?.hidden ?? false,
        };
      },
    },
  ),
);

export const useDockLayoutStore = createSelectors(useDockLayoutStoreBase);

export function useDockLayout(owner: DockOwner | null | undefined): DockLayout {
  return useDockLayoutStore((state) => selectDockLayout(state, owner));
}
