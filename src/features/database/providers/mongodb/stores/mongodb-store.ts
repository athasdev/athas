import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";

interface MongoDbState {
  connectionId: string | null;
  fileName: string;
  databases: string[];
  selectedDatabase: string | null;
  collections: { name: string }[];
  selectedCollection: string | null;
  documents: Record<string, unknown>[];
  totalCount: number;
  error: string | null;
  isLoading: boolean;

  currentPage: number;
  pageSize: number;
  totalPages: number;

  filterJson: string;
  sortJson: string;
}

interface MongoDbActions {
  init: (connectionId: string) => Promise<void>;
  reset: () => void;
  selectDatabase: (dbName: string) => Promise<void>;
  selectCollection: (collectionName: string) => Promise<void>;
  refresh: () => Promise<void>;

  setCurrentPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setFilterJson: (filter: string) => void;
  setSortJson: (sort: string) => void;

  insertDocument: (document: Record<string, unknown>) => Promise<void>;
  updateDocument: (id: string, update: Record<string, unknown>) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
}

const initialState: MongoDbState = {
  connectionId: null,
  fileName: "",
  databases: [],
  selectedDatabase: null,
  collections: [],
  selectedCollection: null,
  documents: [],
  totalCount: 0,
  error: null,
  isLoading: false,
  currentPage: 1,
  pageSize: 50,
  totalPages: 1,
  filterJson: "{}",
  sortJson: "{}",
};

const useMongoDbStoreBase = create<MongoDbState & { actions: MongoDbActions }>()(
  immer((set, get) => ({
    ...initialState,

    actions: {
      init: async (connectionId: string) => {
        set({ connectionId, fileName: connectionId, isLoading: true, error: null });

        try {
          const databases = (await invoke("get_mongo_databases", {
            connectionId,
          })) as string[];
          set({ databases });

          if (databases.length > 0) {
            await get().actions.selectDatabase(databases[0]);
          }
        } catch (err) {
          set({ error: `Failed to load databases: ${err}` });
        } finally {
          set({ isLoading: false });
        }
      },

      reset: () => set(initialState),

      selectDatabase: async (dbName: string) => {
        const { connectionId } = get();
        if (!connectionId) return;

        set({ selectedDatabase: dbName, selectedCollection: null, isLoading: true });

        try {
          const collections = (await invoke("get_mongo_collections", {
            connectionId,
            database: dbName,
          })) as { name: string }[];
          set({ collections });

          if (collections.length > 0) {
            await get().actions.selectCollection(collections[0].name);
          }
        } catch (err) {
          set({ error: `Failed to load collections: ${err}` });
        } finally {
          set({ isLoading: false });
        }
      },

      selectCollection: async (collectionName: string) => {
        set({
          selectedCollection: collectionName,
          currentPage: 1,
          filterJson: "{}",
          sortJson: "{}",
        });
        await get().actions.refresh();
      },

      refresh: async () => {
        const state = get();
        if (!state.connectionId || !state.selectedDatabase || !state.selectedCollection) return;

        set({ isLoading: true, error: null });

        try {
          const offset = (state.currentPage - 1) * state.pageSize;
          const result = (await invoke("query_mongo_documents", {
            connectionId: state.connectionId,
            database: state.selectedDatabase,
            collection: state.selectedCollection,
            filterJson: state.filterJson,
            sortJson: state.sortJson,
            limit: state.pageSize,
            skip: offset,
          })) as { documents: Record<string, unknown>[]; total_count: number };

          const totalPages = Math.max(1, Math.ceil(result.total_count / state.pageSize));

          set({
            documents: result.documents,
            totalCount: result.total_count,
            totalPages,
          });
        } catch (err) {
          set({ error: `Query failed: ${err}`, documents: [] });
        } finally {
          set({ isLoading: false });
        }
      },

      setCurrentPage: (page: number) => {
        set({ currentPage: page });
        get().actions.refresh();
      },

      setPageSize: (size: number) => {
        set({ pageSize: size, currentPage: 1 });
        get().actions.refresh();
      },

      setFilterJson: (filter: string) => {
        set({ filterJson: filter, currentPage: 1 });
      },

      setSortJson: (sort: string) => {
        set({ sortJson: sort });
      },

      insertDocument: async (document: Record<string, unknown>) => {
        const { connectionId, selectedDatabase, selectedCollection } = get();
        if (!connectionId || !selectedDatabase || !selectedCollection) return;

        try {
          await invoke("insert_mongo_document", {
            connectionId,
            database: selectedDatabase,
            collection: selectedCollection,
            documentJson: JSON.stringify(document),
          });
          set({ error: null });
          await get().actions.refresh();
        } catch (err) {
          set({ error: `Insert failed: ${err}` });
        }
      },

      updateDocument: async (id: string, update: Record<string, unknown>) => {
        const { connectionId, selectedDatabase, selectedCollection } = get();
        if (!connectionId || !selectedDatabase || !selectedCollection) return;

        try {
          await invoke("update_mongo_document", {
            connectionId,
            database: selectedDatabase,
            collection: selectedCollection,
            filterJson: JSON.stringify({ _id: id }),
            updateJson: JSON.stringify(update),
          });
          set({ error: null });
          await get().actions.refresh();
        } catch (err) {
          set({ error: `Update failed: ${err}` });
        }
      },

      deleteDocument: async (id: string) => {
        const { connectionId, selectedDatabase, selectedCollection } = get();
        if (!connectionId || !selectedDatabase || !selectedCollection) return;

        try {
          await invoke("delete_mongo_document", {
            connectionId,
            database: selectedDatabase,
            collection: selectedCollection,
            filterJson: JSON.stringify({ _id: id }),
          });
          set({ error: null });
          await get().actions.refresh();
        } catch (err) {
          set({ error: `Delete failed: ${err}` });
        }
      },
    },
  })),
);

export const useMongoDbStore = createSelectors(useMongoDbStoreBase);
