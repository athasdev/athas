import { create } from "zustand";
import {
  loadAdminDataSources,
  saveAdminDataSources,
} from "@/features/admin-data/lib/admin-data-model";
import type { AdminDataSource } from "@/features/admin-data/types/admin-data.types";
import { createSelectors } from "@/utils/zustand-selectors";

interface AdminDataState {
  sourcesByProject: Record<string, AdminDataSource[]>;
  loadedProjectPaths: string[];
  actions: {
    loadProject: (projectPath: string) => void;
    upsertSource: (projectPath: string, source: AdminDataSource) => void;
    removeSource: (projectPath: string, sourceId: string) => void;
  };
}

const useAdminDataStoreBase = create<AdminDataState>()((set, get) => ({
  sourcesByProject: {},
  loadedProjectPaths: [],
  actions: {
    loadProject: (projectPath) => {
      set((state) => ({
        sourcesByProject: {
          ...state.sourcesByProject,
          [projectPath]: loadAdminDataSources(projectPath),
        },
        loadedProjectPaths: state.loadedProjectPaths.includes(projectPath)
          ? state.loadedProjectPaths
          : [...state.loadedProjectPaths, projectPath],
      }));
    },
    upsertSource: (projectPath, source) => {
      const currentSources =
        get().sourcesByProject[projectPath] ?? loadAdminDataSources(projectPath);
      const nextSources = currentSources.some((item) => item.id === source.id)
        ? currentSources.map((item) => (item.id === source.id ? source : item))
        : [...currentSources, source];

      saveAdminDataSources(projectPath, nextSources);
      set((state) => ({
        sourcesByProject: {
          ...state.sourcesByProject,
          [projectPath]: nextSources,
        },
      }));
    },
    removeSource: (projectPath, sourceId) => {
      const currentSources =
        get().sourcesByProject[projectPath] ?? loadAdminDataSources(projectPath);
      const nextSources = currentSources.filter((source) => source.id !== sourceId);

      saveAdminDataSources(projectPath, nextSources);
      set((state) => ({
        sourcesByProject: {
          ...state.sourcesByProject,
          [projectPath]: nextSources,
        },
      }));
    },
  },
}));

export const useAdminDataStore = createSelectors(useAdminDataStoreBase);
