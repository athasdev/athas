import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import type { DatabaseObjectKind, DatabaseRow } from "../types/common.types";
import type { DatabaseType } from "../types/provider.types";

interface DatabaseTableMenu {
  x: number;
  y: number;
  tableName: string;
  objectKind?: DatabaseObjectKind;
  databaseType?: DatabaseType;
}

interface DatabaseRowMenu {
  x: number;
  y: number;
  rowData: DatabaseRow;
  tableName: string;
  databaseType?: DatabaseType;
}

interface DatabaseContextMenuState {
  tableMenu: DatabaseTableMenu | null;
  rowMenu: DatabaseRowMenu | null;
  actions: {
    setTableMenu: (menu: DatabaseTableMenu | null) => void;
    setRowMenu: (menu: DatabaseRowMenu | null) => void;
  };
}

/** The open table and row context menus of the database viewers, per workspace. */
export const useDatabaseContextMenuStore = createWorkspaceScopedStore("database-context-menu", () =>
  createStore<DatabaseContextMenuState>()((set) => ({
    tableMenu: null,
    rowMenu: null,
    actions: {
      setTableMenu: (tableMenu) => set({ tableMenu }),
      setRowMenu: (rowMenu) => set({ rowMenu }),
    },
  })),
);
