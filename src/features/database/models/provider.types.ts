import type { ColumnInfo, DatabaseInfo, QueryResult, TableInfo } from "./common.types";

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

  // CRUD operations
  insertRow(tableName: string, data: Record<string, any>): Promise<void>;
  updateRow(tableName: string, rowId: any, data: Record<string, any>): Promise<void>;
  deleteRow(tableName: string, rowId: any): Promise<void>;

  // Table operations
  createTable(tableName: string, columns: ColumnInfo[]): Promise<void>;
  dropTable(tableName: string): Promise<void>;
}

export type DatabaseType = "sqlite" | "postgres" | "mysql" | "duckdb" | "mongodb" | "redis";
