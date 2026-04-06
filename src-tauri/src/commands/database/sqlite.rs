use athas_database::providers::{
   FilteredQueryParams, FilteredQueryResult, ForeignKeyInfo, QueryResult, TableInfo,
   delete_sqlite_row as db_delete_sqlite_row, execute_sqlite as db_execute_sqlite,
   get_sqlite_foreign_keys as db_get_sqlite_foreign_keys,
   get_sqlite_tables as db_get_sqlite_tables, insert_sqlite_row as db_insert_sqlite_row,
   query_sqlite as db_query_sqlite, query_sqlite_filtered as db_query_sqlite_filtered,
   update_sqlite_row as db_update_sqlite_row,
};

#[tauri::command]
pub async fn get_sqlite_tables(path: String) -> Result<Vec<TableInfo>, String> {
   db_get_sqlite_tables(path).await
}

#[tauri::command]
pub async fn execute_sqlite(path: String, statement: String) -> Result<i64, String> {
   db_execute_sqlite(path, statement).await
}

#[tauri::command]
pub async fn insert_sqlite_row(
   path: String,
   table: String,
   columns: Vec<String>,
   values: Vec<serde_json::Value>,
) -> Result<i64, String> {
   db_insert_sqlite_row(path, table, columns, values).await
}

#[tauri::command]
pub async fn update_sqlite_row(
   path: String,
   table: String,
   set_columns: Vec<String>,
   set_values: Vec<serde_json::Value>,
   where_column: String,
   where_value: serde_json::Value,
) -> Result<i64, String> {
   db_update_sqlite_row(
      path,
      table,
      set_columns,
      set_values,
      where_column,
      where_value,
   )
   .await
}

#[tauri::command]
pub async fn delete_sqlite_row(
   path: String,
   table: String,
   where_column: String,
   where_value: serde_json::Value,
) -> Result<i64, String> {
   db_delete_sqlite_row(path, table, where_column, where_value).await
}

#[tauri::command]
pub async fn query_sqlite(path: String, query: String) -> Result<QueryResult, String> {
   db_query_sqlite(path, query).await
}

#[tauri::command]
pub async fn query_sqlite_filtered(
   path: String,
   params: FilteredQueryParams,
) -> Result<FilteredQueryResult, String> {
   db_query_sqlite_filtered(path, params).await
}

#[tauri::command]
pub async fn get_sqlite_foreign_keys(
   path: String,
   table: String,
) -> Result<Vec<ForeignKeyInfo>, String> {
   db_get_sqlite_foreign_keys(path, table).await
}
