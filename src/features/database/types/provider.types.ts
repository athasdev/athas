import type {
  ColumnFilter,
  ColumnInfo,
  DatabaseInfo,
  FilteredQueryResult,
  ForeignKeyInfo,
  QueryResult,
  TableInfo,
} from "./common.types";

export interface DatabaseProvider {
  // Connection
  connect(path: string): Promise<void>;
  disconnect(): Promise<void>;

  // Schema operations
  getTables(): Promise<TableInfo[]>;
  getTableSchema(tableName: string): Promise<ColumnInfo[]>;
  getDatabaseInfo(): Promise<DatabaseInfo>;

  // Data operations
  query(sql: string): Promise<QueryResult>;
  getTableData(
    tableName: string,
    page: number,
    pageSize: number,
    orderBy?: string,
    orderDirection?: "ASC" | "DESC",
  ): Promise<QueryResult>;

  // Filtered data operations
  getFilteredData?(
    tableName: string,
    filters: ColumnFilter[],
    searchTerm: string | null,
    sortColumn: string | null,
    sortDirection: "ASC" | "DESC",
    pageSize: number,
    offset: number,
  ): Promise<FilteredQueryResult>;

  // Foreign key introspection
  getForeignKeys?(tableName: string): Promise<ForeignKeyInfo[]>;

  // CRUD operations
  insertRow(tableName: string, data: Record<string, unknown>): Promise<void>;
  updateRow(tableName: string, rowId: unknown, data: Record<string, unknown>): Promise<void>;
  deleteRow(tableName: string, rowId: unknown): Promise<void>;

  // Table operations
  createTable(tableName: string, columns: ColumnInfo[]): Promise<void>;
  dropTable(tableName: string): Promise<void>;
}

export type DatabaseType = "sqlite" | "postgres" | "mysql" | "duckdb" | "mongodb" | "redis";
