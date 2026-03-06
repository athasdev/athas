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
  operator: FilterOperator;
  value: string;
  value2?: string;
}

export type FilterOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "isNull"
  | "isNotNull";

export interface FilteredQueryParams {
  table: string;
  filters: ColumnFilter[];
  search_term?: string;
  search_columns: string[];
  sort_column?: string;
  sort_direction: string;
  page_size: number;
  offset: number;
}

export interface FilteredQueryResult {
  columns: string[];
  rows: unknown[][];
  total_count: number;
}

export interface ForeignKeyInfo {
  from_column: string;
  to_table: string;
  to_column: string;
}

export type ViewMode = "data" | "schema" | "info";
