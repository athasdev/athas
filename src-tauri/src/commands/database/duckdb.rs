use athas_database::{
   providers::{
      delete_duckdb_row as db_delete_duckdb_row, execute_duckdb as db_execute_duckdb,
      get_duckdb_foreign_keys as db_get_duckdb_foreign_keys,
      get_duckdb_tables as db_get_duckdb_tables, insert_duckdb_row as db_insert_duckdb_row,
      query_duckdb as db_query_duckdb, query_duckdb_filtered as db_query_duckdb_filtered,
      update_duckdb_row as db_update_duckdb_row,
   },
   sql_common::{FilteredQueryParams, FilteredQueryResult, ForeignKeyInfo, QueryResult, TableInfo},
};

#[tauri::command]
pub async fn get_duckdb_tables(path: String) -> Result<Vec<TableInfo>, String> {
   db_get_duckdb_tables(path).await
}

#[tauri::command]
pub async fn query_duckdb(path: String, query: String) -> Result<QueryResult, String> {
   db_query_duckdb(path, query).await
}

#[tauri::command]
pub async fn query_duckdb_filtered(
   path: String,
   params: FilteredQueryParams,
) -> Result<FilteredQueryResult, String> {
   db_query_duckdb_filtered(path, params).await
}

#[tauri::command]
pub async fn execute_duckdb(path: String, statement: String) -> Result<i64, String> {
   db_execute_duckdb(path, statement).await
}

#[tauri::command]
pub async fn insert_duckdb_row(
   path: String,
   table: String,
   columns: Vec<String>,
   values: Vec<serde_json::Value>,
) -> Result<i64, String> {
   db_insert_duckdb_row(path, table, columns, values).await
}

#[tauri::command]
pub async fn update_duckdb_row(
   path: String,
   table: String,
   set_columns: Vec<String>,
   set_values: Vec<serde_json::Value>,
   where_column: String,
   where_value: serde_json::Value,
) -> Result<i64, String> {
   db_update_duckdb_row(path, table, set_columns, set_values, where_column, where_value).await
}

#[tauri::command]
pub async fn delete_duckdb_row(
   path: String,
   table: String,
   where_column: String,
   where_value: serde_json::Value,
) -> Result<i64, String> {
   db_delete_duckdb_row(path, table, where_column, where_value).await
}

#[tauri::command]
pub async fn get_duckdb_foreign_keys(
   path: String,
   table: String,
) -> Result<Vec<ForeignKeyInfo>, String> {
   db_get_duckdb_foreign_keys(path, table).await
}
