import type { StateCreator } from "zustand";
import type { DatabaseType } from "@/features/database/models/provider.types";

export interface ContextMenuState {
  folderHeaderContextMenu: { x: number; y: number } | null;
  projectNameMenu: { x: number; y: number } | null;
  databaseTableMenu: {
    x: number;
    y: number;
    tableName: string;
    databaseType?: DatabaseType;
  } | null;
  databaseRowMenu: {
    x: number;
    y: number;
    rowData: Record<string, any>;
    tableName: string;
    databaseType?: DatabaseType;
  } | null;
}

export interface ContextMenuActions {
  setProjectNameMenu: (v: { x: number; y: number } | null) => void;
  setDatabaseTableMenu: (
    v: { x: number; y: number; tableName: string; databaseType?: DatabaseType } | null,
  ) => void;
  setDatabaseRowMenu: (
    v: {
      x: number;
      y: number;
      rowData: Record<string, any>;
      tableName: string;
      databaseType?: DatabaseType;
    } | null,
  ) => void;
}

export type ContextMenuSlice = ContextMenuState & ContextMenuActions;

export const createContextMenuSlice: StateCreator<ContextMenuSlice, [], [], ContextMenuSlice> = (
  set,
) => ({
  // State
  folderHeaderContextMenu: null,
  projectNameMenu: null,
  databaseTableMenu: null,
  databaseRowMenu: null,

  // Actions
  setProjectNameMenu: (v: { x: number; y: number } | null) => set({ projectNameMenu: v }),
  setDatabaseTableMenu: (
    v: { x: number; y: number; tableName: string; databaseType?: DatabaseType } | null,
  ) => set({ databaseTableMenu: v }),
  setDatabaseRowMenu: (
    v: {
      x: number;
      y: number;
      rowData: Record<string, any>;
      tableName: string;
      databaseType?: DatabaseType;
    } | null,
  ) => set({ databaseRowMenu: v }),
});
