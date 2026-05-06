use crate::{
   connection_manager::{ConnectionConfig, ConnectionManager, connect_database, test_connection},
   providers::*,
   sql_common::{CreatePostgresSubscriptionParams, FilteredQueryParams},
};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::io::{self, Read, Write};

#[derive(Debug, Deserialize)]
struct SidecarRequest {
   #[serde(rename = "protocolVersion")]
   protocol_version: u32,
   #[serde(rename = "providerId")]
   provider_id: String,
   command: String,
   payload: Value,
}

pub async fn run_stdio() -> Result<(), String> {
   let mut input = String::new();
   io::stdin()
      .read_to_string(&mut input)
      .map_err(|e| format!("Failed to read sidecar request: {}", e))?;

   let request: SidecarRequest =
      serde_json::from_str(&input).map_err(|e| format!("Invalid sidecar request: {}", e))?;
   let response = run_request(request).await?;
   let output =
      serde_json::to_vec(&response).map_err(|e| format!("Failed to encode response: {}", e))?;

   io::stdout()
      .write_all(&output)
      .map_err(|e| format!("Failed to write sidecar response: {}", e))
}

async fn run_request(request: SidecarRequest) -> Result<Value, String> {
   if request.protocol_version != 1 {
      return Err(format!(
         "Unsupported database sidecar protocol version: {}",
         request.protocol_version
      ));
   }

   match request.command.as_str() {
      "connect_database" => connect(request.payload).await,
      "disconnect_database" => disconnect(request.payload).await,
      "test_connection" => test(request.payload).await,
      command
         if command.starts_with("get_sqlite_")
            || command.starts_with("query_sqlite")
            || command.starts_with("execute_sqlite")
            || command.ends_with("_sqlite_row") =>
      {
         run_sqlite(command, request.payload).await
      }
      command
         if command.starts_with("get_duckdb_")
            || command.starts_with("query_duckdb")
            || command.starts_with("execute_duckdb")
            || command.ends_with("_duckdb_row") =>
      {
         run_duckdb(command, request.payload).await
      }
      command if command.contains("postgres") => run_postgres(command, request.payload).await,
      command if command.contains("mysql") => run_mysql(command, request.payload).await,
      command if command.contains("mongo") => run_mongodb(command, request.payload).await,
      command if command.starts_with("redis_") => run_redis(command, request.payload).await,
      _ => Err(format!(
         "Unsupported {} database command: {}",
         request.provider_id, request.command
      )),
   }
}

pub async fn run_provider_command(
   provider_id: String,
   command: String,
   payload: Value,
) -> Result<Value, String> {
   run_request(SidecarRequest {
      protocol_version: 1,
      provider_id,
      command,
      payload,
   })
   .await
}

fn read_field<T: DeserializeOwned>(payload: &Value, keys: &[&str]) -> Result<T, String> {
   for key in keys {
      if let Some(value) = payload.get(*key) {
         return serde_json::from_value(value.clone())
            .map_err(|e| format!("Invalid payload field '{}': {}", key, e));
      }
   }
   Err(format!("Missing payload field '{}'", keys[0]))
}

fn read_optional_field<T: DeserializeOwned>(
   payload: &Value,
   keys: &[&str],
) -> Result<Option<T>, String> {
   for key in keys {
      if let Some(value) = payload.get(*key) {
         if value.is_null() {
            return Ok(None);
         }
         return serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|e| format!("Invalid payload field '{}': {}", key, e));
      }
   }
   Ok(None)
}

async fn manager_for_connection(payload: &Value) -> Result<ConnectionManager, String> {
   let config: ConnectionConfig = read_field(payload, &["connectionConfig", "connection_config"])?;
   let password: Option<String> = read_optional_field(payload, &["password"])?;
   let manager = ConnectionManager::new();
   connect_database(config, password, &manager).await?;
   Ok(manager)
}

async fn connect(payload: Value) -> Result<Value, String> {
   let config: ConnectionConfig = read_field(&payload, &["config"])?;
   let password: Option<String> = read_optional_field(&payload, &["password"])?;
   let result = test_connection(config.clone(), password.clone()).await?;
   serde_json::to_value(result).map_err(|e| e.to_string())
}

async fn disconnect(_payload: Value) -> Result<Value, String> {
   Ok(json!(true))
}

async fn test(payload: Value) -> Result<Value, String> {
   let config: ConnectionConfig = read_field(&payload, &["config"])?;
   let password: Option<String> = read_optional_field(&payload, &["password"])?;
   let result = test_connection(config, password).await?;
   serde_json::to_value(result).map_err(|e| e.to_string())
}

async fn run_sqlite(command: &str, payload: Value) -> Result<Value, String> {
   let path: String = read_field(&payload, &["path"])?;
   let value = match command {
      "get_sqlite_tables" => serde_json::to_value(get_sqlite_tables(path).await?),
      "query_sqlite" => {
         serde_json::to_value(query_sqlite(path, read_field(&payload, &["query"])?).await?)
      }
      "query_sqlite_filtered" => {
         let params: crate::providers::sqlite::FilteredQueryParams =
            read_field(&payload, &["params"])?;
         serde_json::to_value(query_sqlite_filtered(path, params).await?)
      }
      "execute_sqlite" => {
         serde_json::to_value(execute_sqlite(path, read_field(&payload, &["statement"])?).await?)
      }
      "insert_sqlite_row" => serde_json::to_value(
         insert_sqlite_row(
            path,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["columns"])?,
            read_field(&payload, &["values"])?,
         )
         .await?,
      ),
      "update_sqlite_row" => serde_json::to_value(
         update_sqlite_row(
            path,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["setColumns", "set_columns"])?,
            read_field(&payload, &["setValues", "set_values"])?,
            read_field(&payload, &["whereColumn", "where_column"])?,
            read_field(&payload, &["whereValue", "where_value"])?,
         )
         .await?,
      ),
      "delete_sqlite_row" => serde_json::to_value(
         delete_sqlite_row(
            path,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["whereColumn", "where_column"])?,
            read_field(&payload, &["whereValue", "where_value"])?,
         )
         .await?,
      ),
      "get_sqlite_foreign_keys" => serde_json::to_value(
         get_sqlite_foreign_keys(path, read_field(&payload, &["table"])?).await?,
      ),
      _ => return Err(format!("Unsupported SQLite command: {}", command)),
   };
   value.map_err(|e| e.to_string())
}

async fn run_duckdb(command: &str, payload: Value) -> Result<Value, String> {
   let path: String = read_field(&payload, &["path"])?;
   let value = match command {
      "get_duckdb_tables" => serde_json::to_value(get_duckdb_tables(path).await?),
      "query_duckdb" => {
         serde_json::to_value(query_duckdb(path, read_field(&payload, &["query"])?).await?)
      }
      "query_duckdb_filtered" => {
         let params: FilteredQueryParams = read_field(&payload, &["params"])?;
         serde_json::to_value(query_duckdb_filtered(path, params).await?)
      }
      "execute_duckdb" => {
         serde_json::to_value(execute_duckdb(path, read_field(&payload, &["statement"])?).await?)
      }
      "insert_duckdb_row" => serde_json::to_value(
         insert_duckdb_row(
            path,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["columns"])?,
            read_field(&payload, &["values"])?,
         )
         .await?,
      ),
      "update_duckdb_row" => serde_json::to_value(
         update_duckdb_row(
            path,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["setColumns", "set_columns"])?,
            read_field(&payload, &["setValues", "set_values"])?,
            read_field(&payload, &["whereColumn", "where_column"])?,
            read_field(&payload, &["whereValue", "where_value"])?,
         )
         .await?,
      ),
      "delete_duckdb_row" => serde_json::to_value(
         delete_duckdb_row(
            path,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["whereColumn", "where_column"])?,
            read_field(&payload, &["whereValue", "where_value"])?,
         )
         .await?,
      ),
      "get_duckdb_foreign_keys" => serde_json::to_value(
         get_duckdb_foreign_keys(path, read_field(&payload, &["table"])?).await?,
      ),
      _ => return Err(format!("Unsupported DuckDB command: {}", command)),
   };
   value.map_err(|e| e.to_string())
}

async fn run_postgres(command: &str, payload: Value) -> Result<Value, String> {
   let connection_id: String = read_field(&payload, &["connectionId", "connection_id"])?;
   let manager = manager_for_connection(&payload).await?;
   let value = match command {
      "get_postgres_tables" => {
         serde_json::to_value(get_postgres_tables(connection_id, &manager).await?)
      }
      "query_postgres" => serde_json::to_value(
         query_postgres(connection_id, read_field(&payload, &["query"])?, &manager).await?,
      ),
      "query_postgres_filtered" => serde_json::to_value(
         query_postgres_filtered(connection_id, read_field(&payload, &["params"])?, &manager)
            .await?,
      ),
      "execute_postgres" => serde_json::to_value(
         execute_postgres(
            connection_id,
            read_field(&payload, &["statement"])?,
            &manager,
         )
         .await?,
      ),
      "get_postgres_foreign_keys" => serde_json::to_value(
         get_postgres_foreign_keys(connection_id, read_field(&payload, &["table"])?, &manager)
            .await?,
      ),
      "get_postgres_table_schema" => serde_json::to_value(
         get_postgres_table_schema(connection_id, read_field(&payload, &["table"])?, &manager)
            .await?,
      ),
      "get_postgres_subscription_info" => serde_json::to_value(
         get_postgres_subscription_info(
            connection_id,
            read_field(&payload, &["subscription"])?,
            &manager,
         )
         .await?,
      ),
      "get_postgres_subscription_status" => serde_json::to_value(
         get_postgres_subscription_status(
            connection_id,
            read_field(&payload, &["subscription"])?,
            &manager,
         )
         .await?,
      ),
      "create_postgres_subscription" => {
         let params: CreatePostgresSubscriptionParams = read_field(&payload, &["params"])?;
         serde_json::to_value(create_postgres_subscription(connection_id, params, &manager).await?)
      }
      "drop_postgres_subscription" => serde_json::to_value(
         drop_postgres_subscription(
            connection_id,
            read_field(&payload, &["subscription"])?,
            read_field(&payload, &["withDropSlot", "with_drop_slot"])?,
            &manager,
         )
         .await?,
      ),
      "set_postgres_subscription_enabled" => serde_json::to_value(
         set_postgres_subscription_enabled(
            connection_id,
            read_field(&payload, &["subscription"])?,
            read_field(&payload, &["enabled"])?,
            &manager,
         )
         .await?,
      ),
      "refresh_postgres_subscription" => serde_json::to_value(
         refresh_postgres_subscription(
            connection_id,
            read_field(&payload, &["subscription"])?,
            read_field(&payload, &["copyData", "copy_data"])?,
            &manager,
         )
         .await?,
      ),
      "insert_postgres_row" => serde_json::to_value(
         insert_postgres_row(
            connection_id,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["columns"])?,
            read_field(&payload, &["values"])?,
            &manager,
         )
         .await?,
      ),
      "update_postgres_row" => serde_json::to_value(
         update_postgres_row(
            connection_id,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["setColumns", "set_columns"])?,
            read_field(&payload, &["setValues", "set_values"])?,
            read_field(&payload, &["whereColumn", "where_column"])?,
            read_field(&payload, &["whereValue", "where_value"])?,
            &manager,
         )
         .await?,
      ),
      "delete_postgres_row" => serde_json::to_value(
         delete_postgres_row(
            connection_id,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["whereColumn", "where_column"])?,
            read_field(&payload, &["whereValue", "where_value"])?,
            &manager,
         )
         .await?,
      ),
      _ => return Err(format!("Unsupported PostgreSQL command: {}", command)),
   };
   value.map_err(|e| e.to_string())
}

async fn run_mysql(command: &str, payload: Value) -> Result<Value, String> {
   let connection_id: String = read_field(&payload, &["connectionId", "connection_id"])?;
   let manager = manager_for_connection(&payload).await?;
   let value = match command {
      "get_mysql_tables" => serde_json::to_value(get_mysql_tables(connection_id, &manager).await?),
      "query_mysql" => serde_json::to_value(
         query_mysql(connection_id, read_field(&payload, &["query"])?, &manager).await?,
      ),
      "query_mysql_filtered" => serde_json::to_value(
         query_mysql_filtered(connection_id, read_field(&payload, &["params"])?, &manager).await?,
      ),
      "execute_mysql" => serde_json::to_value(
         execute_mysql(
            connection_id,
            read_field(&payload, &["statement"])?,
            &manager,
         )
         .await?,
      ),
      "get_mysql_foreign_keys" => serde_json::to_value(
         get_mysql_foreign_keys(connection_id, read_field(&payload, &["table"])?, &manager).await?,
      ),
      "get_mysql_table_schema" => serde_json::to_value(
         get_mysql_table_schema(connection_id, read_field(&payload, &["table"])?, &manager).await?,
      ),
      "insert_mysql_row" => serde_json::to_value(
         insert_mysql_row(
            connection_id,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["columns"])?,
            read_field(&payload, &["values"])?,
            &manager,
         )
         .await?,
      ),
      "update_mysql_row" => serde_json::to_value(
         update_mysql_row(
            connection_id,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["setColumns", "set_columns"])?,
            read_field(&payload, &["setValues", "set_values"])?,
            read_field(&payload, &["whereColumn", "where_column"])?,
            read_field(&payload, &["whereValue", "where_value"])?,
            &manager,
         )
         .await?,
      ),
      "delete_mysql_row" => serde_json::to_value(
         delete_mysql_row(
            connection_id,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["whereColumn", "where_column"])?,
            read_field(&payload, &["whereValue", "where_value"])?,
            &manager,
         )
         .await?,
      ),
      _ => return Err(format!("Unsupported MySQL command: {}", command)),
   };
   value.map_err(|e| e.to_string())
}

async fn run_mongodb(command: &str, payload: Value) -> Result<Value, String> {
   let connection_id: String = read_field(&payload, &["connectionId", "connection_id"])?;
   let manager = manager_for_connection(&payload).await?;
   let value = match command {
      "get_mongo_databases" => {
         serde_json::to_value(get_mongo_databases(connection_id, &manager).await?)
      }
      "get_mongo_collections" => serde_json::to_value(
         get_mongo_collections(
            connection_id,
            read_field(&payload, &["database"])?,
            &manager,
         )
         .await?,
      ),
      "query_mongo_documents" => serde_json::to_value(
         query_mongo_documents(
            connection_id,
            read_field(&payload, &["database"])?,
            read_field(&payload, &["collection"])?,
            read_optional_field(&payload, &["filterJson", "filter_json"])?,
            read_optional_field(&payload, &["sortJson", "sort_json"])?,
            read_optional_field(&payload, &["limit"])?,
            read_optional_field(&payload, &["skip"])?,
            &manager,
         )
         .await?,
      ),
      "insert_mongo_document" => serde_json::to_value(
         insert_mongo_document(
            connection_id,
            read_field(&payload, &["database"])?,
            read_field(&payload, &["collection"])?,
            read_field(&payload, &["documentJson", "document_json"])?,
            &manager,
         )
         .await?,
      ),
      "update_mongo_document" => serde_json::to_value(
         update_mongo_document(
            connection_id,
            read_field(&payload, &["database"])?,
            read_field(&payload, &["collection"])?,
            read_field(&payload, &["filterJson", "filter_json"])?,
            read_field(&payload, &["updateJson", "update_json"])?,
            &manager,
         )
         .await?,
      ),
      "delete_mongo_document" => serde_json::to_value(
         delete_mongo_document(
            connection_id,
            read_field(&payload, &["database"])?,
            read_field(&payload, &["collection"])?,
            read_field(&payload, &["filterJson", "filter_json"])?,
            &manager,
         )
         .await?,
      ),
      _ => return Err(format!("Unsupported MongoDB command: {}", command)),
   };
   value.map_err(|e| e.to_string())
}

async fn run_redis(command: &str, payload: Value) -> Result<Value, String> {
   let connection_id: String = read_field(&payload, &["connectionId", "connection_id"])?;
   let manager = manager_for_connection(&payload).await?;
   let value = match command {
      "redis_scan_keys" => {
         let keys = redis_scan_keys(
            connection_id,
            read_optional_field(&payload, &["pattern"])?,
            read_optional_field(&payload, &["count"])?,
            &manager,
         )
         .await?;
         Ok(json!({ "keys": keys, "cursor": "0" }))
      }
      "redis_get_value" => serde_json::to_value(
         redis_get_value(connection_id, read_field(&payload, &["key"])?, &manager).await?,
      ),
      "redis_set_value" => serde_json::to_value(
         redis_set_value(
            connection_id,
            read_field(&payload, &["key"])?,
            read_field(&payload, &["value"])?,
            read_optional_field(&payload, &["ttl"])?,
            &manager,
         )
         .await?,
      ),
      "redis_delete_key" => serde_json::to_value(
         redis_delete_key(connection_id, read_field(&payload, &["key"])?, &manager).await?,
      ),
      "redis_get_info" => serde_json::to_value(redis_get_info(connection_id, &manager).await?),
      _ => return Err(format!("Unsupported Redis command: {}", command)),
   };
   value.map_err(|e| e.to_string())
}
