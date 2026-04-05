export type DatabaseObjectKind = "table" | "subscription";

export interface TableInfo {
  name: string;
  kind?: DatabaseObjectKind;
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

export interface PostgresSubscriptionInfo {
  name: string;
  owner: string;
  enabled: boolean;
  publications: string[];
  connection_string: string;
  slot_name: string | null;
  synchronous_commit: string | null;
  binary: boolean;
  streaming: string | null;
  two_phase: boolean;
  disable_on_error: boolean;
  password_required: boolean;
  run_as_owner: boolean;
  origin: string | null;
  failover: boolean;
  two_phase_state: string | null;
}

export interface CreatePostgresSubscriptionParams {
  name: string;
  connection_string: string;
  publications: string[];
  enabled: boolean;
  create_slot: boolean;
  copy_data: boolean;
  connect: boolean;
  failover: boolean;
  with_slot_name?: string | null;
}

export type ViewMode = "data" | "schema" | "info";
