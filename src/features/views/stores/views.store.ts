import { create } from "zustand";
import { loadViews, saveViews } from "@/features/views/lib/view-model";
import type { CustomViewDefinition } from "@/features/views/types/view.types";
import { createSelectors } from "@/utils/zustand-selectors";

interface ViewsState {
  viewsByProject: Record<string, CustomViewDefinition[]>;
  loadedProjectPaths: string[];
  actions: {
    loadProject: (projectPath: string) => void;
    upsertView: (projectPath: string, view: CustomViewDefinition) => void;
    removeView: (projectPath: string, viewId: string) => void;
  };
}

const useViewsStoreBase = create<ViewsState>()((set, get) => ({
  viewsByProject: {},
  loadedProjectPaths: [],
  actions: {
    loadProject: (projectPath) => {
      set((state) => ({
        viewsByProject: {
          ...state.viewsByProject,
          [projectPath]: loadViews(projectPath),
        },
        loadedProjectPaths: state.loadedProjectPaths.includes(projectPath)
          ? state.loadedProjectPaths
          : [...state.loadedProjectPaths, projectPath],
      }));
    },
    upsertView: (projectPath, view) => {
      const currentViews = get().viewsByProject[projectPath] ?? loadViews(projectPath);
      const nextViews = currentViews.some((item) => item.id === view.id)
        ? currentViews.map((item) => (item.id === view.id ? view : item))
        : [...currentViews, view];

      saveViews(projectPath, nextViews);
      set((state) => ({
        viewsByProject: {
          ...state.viewsByProject,
          [projectPath]: nextViews,
        },
      }));
    },
    removeView: (projectPath, viewId) => {
      const currentViews = get().viewsByProject[projectPath] ?? loadViews(projectPath);
      const nextViews = currentViews.filter((view) => view.id !== viewId);

      saveViews(projectPath, nextViews);
      set((state) => ({
        viewsByProject: {
          ...state.viewsByProject,
          [projectPath]: nextViews,
        },
      }));
    },
  },
}));

export const useViewsStore = createSelectors(useViewsStoreBase);
