import { invokeDatabaseProvider } from "@/features/database/services/database-provider-sidecar";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import { formatDatabaseError } from "../../../lib/database-errors";

export const MONGODB_PROVIDER_COMMANDS = {
  getDatabases: "get_mongo_databases",
  getCollections: "get_mongo_collections",
  queryDocuments: "query_mongo_documents",
  insertDocument: "insert_mongo_document",
  updateDocument: "update_mongo_document",
  deleteDocument: "delete_mongo_document",
} as const;

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
  setQueryJson: (filter: string, sort: string) => void;

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

function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.min(Math.trunc(page), Math.max(1, totalPages)));
}

function normalizePageSize(size: number): number {
  if (!Number.isFinite(size)) return 50;
  return Math.max(1, Math.min(Math.trunc(size), 500));
}

function normalizeMongoQueryJson(value: string): string {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : "{}";
}

function getMongoQueryJsonError(value: string, label: "filter" | "sort"): string | null {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return `MongoDB ${label} JSON must be an object`;
    }
    return null;
  } catch {
    return `Invalid MongoDB ${label} JSON`;
  }
}

function normalizeMongoName(value: string): string | null {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

function normalizeTotalCount(count: number): number {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.trunc(count));
}

function normalizeMongoStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalizedItem = item.trim();
    if (!normalizedItem || seen.has(normalizedItem)) continue;
    seen.add(normalizedItem);
    items.push(normalizedItem);
  }

  return items;
}

function normalizeMongoCollections(value: unknown): { name: string }[] {
  return normalizeMongoStringList(
    Array.isArray(value)
      ? value.map((collection) =>
          collection &&
          typeof collection === "object" &&
          "name" in collection &&
          typeof collection.name === "string"
            ? collection.name
            : collection,
        )
      : value,
  ).map((name) => ({ name }));
}

function normalizeMongoDocumentResult(value: unknown): {
  documents: Record<string, unknown>[];
  totalCount: number;
} {
  if (!value || typeof value !== "object") {
    return { documents: [], totalCount: 0 };
  }

  const result = value as { documents?: unknown; total_count?: unknown };
  const documents = Array.isArray(result.documents)
    ? result.documents.filter(
        (document): document is Record<string, unknown> =>
          !!document && typeof document === "object" && !Array.isArray(document),
      )
    : [];

  return {
    documents,
    totalCount:
      typeof result.total_count === "number" ? normalizeTotalCount(result.total_count) : 0,
  };
}

const useMongoDbStoreBase = create<MongoDbState & { actions: MongoDbActions }>()(
  immer((set, get) => {
    let initRequestId = 0;
    let refreshRequestId = 0;

    return {
      ...initialState,

      actions: {
        init: async (connectionId: string) => {
          const requestId = ++initRequestId;
          refreshRequestId += 1;
          set({
            connectionId,
            fileName: connectionId,
            databases: [],
            selectedDatabase: null,
            collections: [],
            selectedCollection: null,
            documents: [],
            totalCount: 0,
            totalPages: 1,
            currentPage: 1,
            filterJson: "{}",
            sortJson: "{}",
            isLoading: true,
            error: null,
          });

          try {
            const databases = normalizeMongoStringList(
              await invokeDatabaseProvider(MONGODB_PROVIDER_COMMANDS.getDatabases, {
                connectionId,
              }),
            );
            if (requestId !== initRequestId) return;
            set({ databases });

            if (databases.length > 0) {
              await get().actions.selectDatabase(databases[0]);
            }
          } catch (err) {
            if (requestId !== initRequestId) return;
            set({ error: formatDatabaseError("Failed to load databases", err) });
          } finally {
            if (requestId === initRequestId) {
              set({ isLoading: false });
            }
          }
        },

        reset: () => {
          initRequestId += 1;
          refreshRequestId += 1;
          set(initialState);
        },

        selectDatabase: async (dbName: string) => {
          const databaseName = normalizeMongoName(dbName);
          if (!databaseName) return;
          const { connectionId } = get();
          if (!connectionId) return;
          const requestId = ++refreshRequestId;

          set({
            selectedDatabase: databaseName,
            selectedCollection: null,
            collections: [],
            documents: [],
            totalCount: 0,
            totalPages: 1,
            currentPage: 1,
            filterJson: "{}",
            sortJson: "{}",
            isLoading: true,
            error: null,
          });

          try {
            const collections = normalizeMongoCollections(
              await invokeDatabaseProvider(MONGODB_PROVIDER_COMMANDS.getCollections, {
                connectionId,
                database: databaseName,
              }),
            );

            if (requestId !== refreshRequestId) return;

            set({ collections });

            if (collections.length > 0) {
              await get().actions.selectCollection(collections[0].name);
            }
          } catch (err) {
            if (requestId !== refreshRequestId) return;
            set({ error: formatDatabaseError("Failed to load collections", err) });
          } finally {
            if (requestId === refreshRequestId) {
              set({ isLoading: false });
            }
          }
        },

        selectCollection: async (collectionName: string) => {
          const normalizedCollectionName = normalizeMongoName(collectionName);
          if (!normalizedCollectionName) return;
          set({
            selectedCollection: normalizedCollectionName,
            documents: [],
            totalCount: 0,
            totalPages: 1,
            currentPage: 1,
            filterJson: "{}",
            sortJson: "{}",
            error: null,
          });
          await get().actions.refresh();
        },

        refresh: async () => {
          const state = get();
          if (!state.connectionId || !state.selectedDatabase || !state.selectedCollection) return;
          const requestId = ++refreshRequestId;
          const filterError = getMongoQueryJsonError(state.filterJson, "filter");
          const sortError = getMongoQueryJsonError(state.sortJson, "sort");

          if (filterError || sortError) {
            set({ error: filterError ?? sortError, isLoading: false });
            return;
          }

          set({ isLoading: true, error: null });

          try {
            const offset = (state.currentPage - 1) * state.pageSize;
            let result = normalizeMongoDocumentResult(
              await invokeDatabaseProvider(MONGODB_PROVIDER_COMMANDS.queryDocuments, {
                connectionId: state.connectionId,
                database: state.selectedDatabase,
                collection: state.selectedCollection,
                filterJson: state.filterJson,
                sortJson: state.sortJson,
                limit: state.pageSize,
                skip: offset,
              }),
            );

            if (requestId !== refreshRequestId) return;

            const totalCount = result.totalCount;
            const totalPages = Math.max(1, Math.ceil(totalCount / state.pageSize));
            const currentPage = clampPage(state.currentPage, totalPages);

            if (currentPage !== state.currentPage && totalCount > 0) {
              result = normalizeMongoDocumentResult(
                await invokeDatabaseProvider(MONGODB_PROVIDER_COMMANDS.queryDocuments, {
                  connectionId: state.connectionId,
                  database: state.selectedDatabase,
                  collection: state.selectedCollection,
                  filterJson: state.filterJson,
                  sortJson: state.sortJson,
                  limit: state.pageSize,
                  skip: (currentPage - 1) * state.pageSize,
                }),
              );
            }

            if (requestId !== refreshRequestId) return;

            const nextTotalCount = result.totalCount;
            set({
              documents: result.documents,
              totalCount: nextTotalCount,
              currentPage,
              totalPages: Math.max(1, Math.ceil(nextTotalCount / state.pageSize)),
            });
          } catch (err) {
            if (requestId !== refreshRequestId) return;
            set({ error: formatDatabaseError("Query failed", err) });
          } finally {
            if (requestId === refreshRequestId) {
              set({ isLoading: false });
            }
          }
        },

        setCurrentPage: (page: number) => {
          set((state) => {
            state.currentPage = clampPage(page, state.totalPages);
          });
          get().actions.refresh();
        },

        setPageSize: (size: number) => {
          set({ pageSize: normalizePageSize(size), currentPage: 1 });
          get().actions.refresh();
        },

        setFilterJson: (filter: string) => {
          set({ filterJson: normalizeMongoQueryJson(filter), currentPage: 1 });
          get().actions.refresh();
        },

        setSortJson: (sort: string) => {
          set({ sortJson: normalizeMongoQueryJson(sort), currentPage: 1 });
          get().actions.refresh();
        },

        setQueryJson: (filter: string, sort: string) => {
          set({
            filterJson: normalizeMongoQueryJson(filter),
            sortJson: normalizeMongoQueryJson(sort),
            currentPage: 1,
          });
          get().actions.refresh();
        },

        insertDocument: async (document: Record<string, unknown>) => {
          const { connectionId, selectedDatabase, selectedCollection } = get();
          if (!connectionId || !selectedDatabase || !selectedCollection) return;

          set({ isLoading: true, error: null });
          try {
            await invokeDatabaseProvider(MONGODB_PROVIDER_COMMANDS.insertDocument, {
              connectionId,
              database: selectedDatabase,
              collection: selectedCollection,
              documentJson: JSON.stringify(document),
            });
            const current = get();
            if (
              current.connectionId !== connectionId ||
              current.selectedDatabase !== selectedDatabase ||
              current.selectedCollection !== selectedCollection
            ) {
              return;
            }
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            const current = get();
            if (
              current.connectionId !== connectionId ||
              current.selectedDatabase !== selectedDatabase ||
              current.selectedCollection !== selectedCollection
            ) {
              return;
            }
            set({ error: formatDatabaseError("Insert failed", err), isLoading: false });
          }
        },

        updateDocument: async (id: string, update: Record<string, unknown>) => {
          const { connectionId, selectedDatabase, selectedCollection } = get();
          if (!connectionId || !selectedDatabase || !selectedCollection) return;

          set({ isLoading: true, error: null });
          try {
            await invokeDatabaseProvider(MONGODB_PROVIDER_COMMANDS.updateDocument, {
              connectionId,
              database: selectedDatabase,
              collection: selectedCollection,
              filterJson: JSON.stringify({ _id: id }),
              updateJson: JSON.stringify(update),
            });
            const current = get();
            if (
              current.connectionId !== connectionId ||
              current.selectedDatabase !== selectedDatabase ||
              current.selectedCollection !== selectedCollection
            ) {
              return;
            }
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            const current = get();
            if (
              current.connectionId !== connectionId ||
              current.selectedDatabase !== selectedDatabase ||
              current.selectedCollection !== selectedCollection
            ) {
              return;
            }
            set({ error: formatDatabaseError("Update failed", err), isLoading: false });
          }
        },

        deleteDocument: async (id: string) => {
          const { connectionId, selectedDatabase, selectedCollection } = get();
          if (!connectionId || !selectedDatabase || !selectedCollection) return;

          set({ isLoading: true, error: null });
          try {
            await invokeDatabaseProvider(MONGODB_PROVIDER_COMMANDS.deleteDocument, {
              connectionId,
              database: selectedDatabase,
              collection: selectedCollection,
              filterJson: JSON.stringify({ _id: id }),
            });
            const current = get();
            if (
              current.connectionId !== connectionId ||
              current.selectedDatabase !== selectedDatabase ||
              current.selectedCollection !== selectedCollection
            ) {
              return;
            }
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            const current = get();
            if (
              current.connectionId !== connectionId ||
              current.selectedDatabase !== selectedDatabase ||
              current.selectedCollection !== selectedCollection
            ) {
              return;
            }
            set({ error: formatDatabaseError("Delete failed", err), isLoading: false });
          }
        },
      },
    };
  }),
);

export const useMongoDbStore = createSelectors(useMongoDbStoreBase);
