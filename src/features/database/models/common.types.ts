export interface TableInfo {
  name: string;
}

export interface QueryResult {
  columns: string[];
  rows: any[][];
}

export interface ColumnInfo {
  name: string;
  type: string;
  notnull: boolean;
  default_value: string | null;
  primary_key: boolean;
}

export interface DatabaseInfo {
  version: string;
  size: number;
  tables: number;
  indexes: number;
}

export interface ColumnFilter {
  column: string;
  operator: "equals" | "contains" | "startsWith" | "endsWith" | "gt" | "lt" | "between";
  value: string;
  value2?: string;
}

export type ViewMode = "data" | "schema" | "info";
