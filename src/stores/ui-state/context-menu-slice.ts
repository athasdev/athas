import type { StateCreator } from "zustand";

export interface ContextMenuState {
  folderHeaderContextMenu: { x: number; y: number } | null;
  projectNameMenu: { x: number; y: number } | null;
  sqliteTableMenu: { x: number; y: number; tableName: string } | null;
  sqliteRowMenu: {
    x: number;
    y: number;
    rowData: Record<string, any>;
    tableName: string;
  } | null;
}

export interface ContextMenuActions {
  setProjectNameMenu: (v: { x: number; y: number } | null) => void;
  setSqliteTableMenu: (v: { x: number; y: number; tableName: string } | null) => void;
  setSqliteRowMenu: (
    v: { x: number; y: number; rowData: Record<string, any>; tableName: string } | null,
  ) => void;
}

export type ContextMenuSlice = ContextMenuState & ContextMenuActions;

export const createContextMenuSlice: StateCreator<ContextMenuSlice, [], [], ContextMenuSlice> = (
  set,
) => ({
  // State
  folderHeaderContextMenu: null,
  projectNameMenu: null,
  sqliteTableMenu: null,
  sqliteRowMenu: null,

  // Actions
  setProjectNameMenu: (v: { x: number; y: number } | null) => set({ projectNameMenu: v }),
  setSqliteTableMenu: (v: { x: number; y: number; tableName: string } | null) =>
    set({ sqliteTableMenu: v }),
  setSqliteRowMenu: (
    v: { x: number; y: number; rowData: Record<string, any>; tableName: string } | null,
  ) => set({ sqliteRowMenu: v }),
});
