import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

export const SIDEBAR_BUILDER_VIEW_ID = "sidebar-builder";

export type SidebarBuilderWidgetType =
  | "github-prs"
  | "github-issues"
  | "github-actions"
  | "git-changes"
  | "git-history"
  | "git-branches"
  | "git-stashes"
  | "git-worktrees"
  | "terminals"
  | "browser-tabs";

export interface SidebarBuilderWidget {
  id: string;
  type: SidebarBuilderWidgetType;
  itemLimit: number;
  isOpen: boolean;
}

interface SidebarBuilderState {
  widgets: SidebarBuilderWidget[];
  favoriteItemIds: string[];
  actions: {
    addWidget: (type: SidebarBuilderWidgetType) => void;
    removeWidget: (id: string) => void;
    toggleWidget: (id: string) => void;
    updateWidgetLimit: (id: string, itemLimit: number) => void;
    toggleFavoriteItem: (itemId: string) => void;
    reset: () => void;
  };
}

const DEFAULT_ITEM_LIMIT = 3;

const createWidgetId = (type: SidebarBuilderWidgetType) => `${type}-${Date.now()}`;

export const useSidebarBuilderStore = createSelectors(
  create<SidebarBuilderState>()(
    persist(
      (set) => ({
        widgets: [],
        favoriteItemIds: [],
        actions: {
          addWidget: (type) => {
            set((state) => {
              const existing = state.widgets.find((widget) => widget.type === type);
              if (existing) {
                return {
                  widgets: state.widgets.map((widget) =>
                    widget.id === existing.id ? { ...widget, isOpen: true } : widget,
                  ),
                };
              }

              return {
                widgets: [
                  ...state.widgets,
                  {
                    id: createWidgetId(type),
                    type,
                    itemLimit: DEFAULT_ITEM_LIMIT,
                    isOpen: true,
                  },
                ],
              };
            });
          },
          removeWidget: (id) => {
            set((state) => ({
              widgets: state.widgets.filter((widget) => widget.id !== id),
            }));
          },
          toggleWidget: (id) => {
            set((state) => ({
              widgets: state.widgets.map((widget) =>
                widget.id === id ? { ...widget, isOpen: !widget.isOpen } : widget,
              ),
            }));
          },
          updateWidgetLimit: (id, itemLimit) => {
            const normalizedLimit = Math.max(1, Math.min(20, Math.round(itemLimit)));
            set((state) => ({
              widgets: state.widgets.map((widget) =>
                widget.id === id ? { ...widget, itemLimit: normalizedLimit } : widget,
              ),
            }));
          },
          toggleFavoriteItem: (itemId) => {
            set((state) => {
              const isFavorite = state.favoriteItemIds.includes(itemId);
              return {
                favoriteItemIds: isFavorite
                  ? state.favoriteItemIds.filter((id) => id !== itemId)
                  : [itemId, ...state.favoriteItemIds],
              };
            });
          },
          reset: () => set({ widgets: [], favoriteItemIds: [] }),
        },
      }),
      {
        name: "athas-sidebar-builder-storage",
        partialize: (state) => ({
          widgets: state.widgets,
          favoriteItemIds: state.favoriteItemIds,
        }),
      },
    ),
  ),
);
