use athas_database::{
   ConnectionManager,
   providers::{
      create_postgres_subscription as db_create_postgres_subscription,
      delete_postgres_row as db_delete_postgres_row,
      drop_postgres_subscription as db_drop_postgres_subscription,
      execute_postgres as db_execute_postgres,
      get_postgres_foreign_keys as db_get_postgres_foreign_keys,
      get_postgres_subscription_info as db_get_postgres_subscription_info,
      get_postgres_subscription_status as db_get_postgres_subscription_status,
      get_postgres_table_schema as db_get_postgres_table_schema,
      get_postgres_tables as db_get_postgres_tables, insert_postgres_row as db_insert_postgres_row,
      query_postgres as db_query_postgres, query_postgres_filtered as db_query_postgres_filtered,
      refresh_postgres_subscription as db_refresh_postgres_subscription,
      set_postgres_subscription_enabled as db_set_postgres_subscription_enabled,
      update_postgres_row as db_update_postgres_row,
   },
   sql_common::{
      ColumnInfo, CreatePostgresSubscriptionParams, FilteredQueryParams, FilteredQueryResult,
      ForeignKeyInfo, PostgresSubscriptionInfo, QueryResult, TableInfo,
   },
};
use std::sync::Arc;

#[tauri::command]
pub async fn get_postgres_tables(
   connection_id: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<TableInfo>, String> {
   db_get_postgres_tables(connection_id, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn query_postgres(
   connection_id: String,
   query: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<QueryResult, String> {
   db_query_postgres(connection_id, query, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn query_postgres_filtered(
   connection_id: String,
   params: FilteredQueryParams,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<FilteredQueryResult, String> {
   db_query_postgres_filtered(connection_id, params, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn execute_postgres(
   connection_id: String,
   statement: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   db_execute_postgres(connection_id, statement, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn get_postgres_foreign_keys(
   connection_id: String,
   table: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<ForeignKeyInfo>, String> {
   db_get_postgres_foreign_keys(connection_id, table, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn get_postgres_table_schema(
   connection_id: String,
   table: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<ColumnInfo>, String> {
   db_get_postgres_table_schema(connection_id, table, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn get_postgres_subscription_info(
   connection_id: String,
   subscription: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<PostgresSubscriptionInfo, String> {
   db_get_postgres_subscription_info(connection_id, subscription, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn get_postgres_subscription_status(
   connection_id: String,
   subscription: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<QueryResult, String> {
   db_get_postgres_subscription_status(connection_id, subscription, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn create_postgres_subscription(
   connection_id: String,
   params: CreatePostgresSubscriptionParams,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   db_create_postgres_subscription(connection_id, params, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn drop_postgres_subscription(
   connection_id: String,
   subscription: String,
   with_drop_slot: bool,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   db_drop_postgres_subscription(
      connection_id,
      subscription,
      with_drop_slot,
      state.inner().as_ref(),
   )
   .await
}

#[tauri::command]
pub async fn set_postgres_subscription_enabled(
   connection_id: String,
   subscription: String,
   enabled: bool,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   db_set_postgres_subscription_enabled(
      connection_id,
      subscription,
      enabled,
      state.inner().as_ref(),
   )
   .await
}

#[tauri::command]
pub async fn refresh_postgres_subscription(
   connection_id: String,
   subscription: String,
   copy_data: bool,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   db_refresh_postgres_subscription(
      connection_id,
      subscription,
      copy_data,
      state.inner().as_ref(),
   )
   .await
}

#[tauri::command]
pub async fn insert_postgres_row(
   connection_id: String,
   table: String,
   columns: Vec<String>,
   values: Vec<serde_json::Value>,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   db_insert_postgres_row(
      connection_id,
      table,
      columns,
      values,
      state.inner().as_ref(),
   )
   .await
}

#[tauri::command]
pub async fn update_postgres_row(
   connection_id: String,
   table: String,
   set_columns: Vec<String>,
   set_values: Vec<serde_json::Value>,
   where_column: String,
   where_value: serde_json::Value,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   db_update_postgres_row(
      connection_id,
      table,
      set_columns,
      set_values,
      where_column,
      where_value,
      state.inner().as_ref(),
   )
   .await
}

#[tauri::command]
pub async fn delete_postgres_row(
   connection_id: String,
   table: String,
   where_column: String,
   where_value: serde_json::Value,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   db_delete_postgres_row(
      connection_id,
      table,
      where_column,
      where_value,
      state.inner().as_ref(),
   )
   .await
}
