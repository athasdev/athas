#[cfg(any(
   feature = "postgres",
   feature = "mysql",
   feature = "mongodb",
   feature = "redis"
))]
use crate::connection_manager::{ConnectionManager, connect_database};
#[cfg(feature = "postgres")]
use crate::sql_common::CreatePostgresSubscriptionParams;
#[cfg(feature = "duckdb")]
use crate::sql_common::FilteredQueryParams;
use crate::{
   connection_manager::{ConnectionConfig, test_connection},
   providers::*,
};
use futures_util::FutureExt;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
   any::Any,
   io::{self, Read, Write},
   panic::AssertUnwindSafe,
};

#[derive(Debug, Deserialize)]
struct SidecarRequest {
   #[serde(rename = "protocolVersion")]
   protocol_version: u32,
   #[serde(rename = "providerId")]
   provider_id: String,
   command: String,
   payload: Value,
}

#[derive(Debug, Serialize)]
struct SidecarError {
   message: String,
}

#[derive(Debug, Serialize)]
struct SidecarResponse {
   #[serde(rename = "protocolVersion")]
   protocol_version: u32,
   ok: bool,
   #[serde(skip_serializing_if = "Option::is_none")]
   result: Option<Value>,
   #[serde(skip_serializing_if = "Option::is_none")]
   error: Option<SidecarError>,
}

pub async fn run_stdio() -> Result<(), String> {
   let mut input = String::new();
   io::stdin()
      .read_to_string(&mut input)
      .map_err(|e| format!("Failed to read sidecar request: {}", e))?;

   let response = handle_stdio_request(&input).await;
   let output =
      serde_json::to_vec(&response).map_err(|e| format!("Failed to encode response: {}", e))?;

   io::stdout()
      .write_all(&output)
      .map_err(|e| format!("Failed to write sidecar response: {}", e))
}

async fn handle_stdio_request(input: &str) -> SidecarResponse {
   let request: Result<SidecarRequest, _> = serde_json::from_str(input);
   match request {
      Ok(request) => match AssertUnwindSafe(run_request(request)).catch_unwind().await {
         Ok(Ok(result)) => SidecarResponse {
            protocol_version: 1,
            ok: true,
            result: Some(result),
            error: None,
         },
         Ok(Err(message)) => SidecarResponse {
            protocol_version: 1,
            ok: false,
            result: None,
            error: Some(SidecarError { message }),
         },
         Err(payload) => SidecarResponse {
            protocol_version: 1,
            ok: false,
            result: None,
            error: Some(SidecarError {
               message: format!(
                  "Database sidecar panic: {}",
                  panic_payload_message(&payload)
               ),
            }),
         },
      },
      Err(error) => SidecarResponse {
         protocol_version: 1,
         ok: false,
         result: None,
         error: Some(SidecarError {
            message: format!("Invalid sidecar request: {}", error),
         }),
      },
   }
}

fn panic_payload_message(payload: &Box<dyn Any + Send>) -> String {
   payload
      .downcast_ref::<&str>()
      .map(|message| (*message).to_string())
      .or_else(|| payload.downcast_ref::<String>().cloned())
      .unwrap_or_else(|| "unknown panic".to_string())
}

async fn run_request(request: SidecarRequest) -> Result<Value, String> {
   if request.protocol_version != 1 {
      return Err(format!(
         "Unsupported database sidecar protocol version: {}",
         request.protocol_version
      ));
   }

   let provider_id = request.provider_id.trim();
   if provider_id.is_empty() {
      return Err("Database sidecar provider id is required".to_string());
   }

   let command = request.command.trim();
   if command.is_empty() {
      return Err("Database sidecar command is required".to_string());
   }

   if let Some(command_provider_id) = provider_id_for_command(command)? {
      if command_provider_id != provider_id {
         return Err(format!(
            "Database command {} does not belong to provider {}",
            command, provider_id
         ));
      }
   }

   #[cfg(test)]
   if command == "__panic_for_test" {
      panic!("simulated provider panic");
   }

   match command {
      "connect_database" => connect(request.payload).await,
      "disconnect_database" => disconnect(request.payload).await,
      "test_connection" => test(request.payload).await,
      command
         if command.starts_with("get_sqlite_")
            || command.starts_with("query_sqlite")
            || command.starts_with("execute_sqlite")
            || command.contains("_sqlite_row") =>
      {
         #[cfg(not(feature = "sqlite"))]
         {
            Err("SQLite provider support is not enabled".to_string())
         }
         #[cfg(feature = "sqlite")]
         run_sqlite(command, request.payload).await
      }
      command
         if command.starts_with("get_duckdb_")
            || command.starts_with("query_duckdb")
            || command.starts_with("execute_duckdb")
            || command.contains("_duckdb_row") =>
      {
         #[cfg(not(feature = "duckdb"))]
         {
            Err("DuckDB provider support is not enabled".to_string())
         }
         #[cfg(feature = "duckdb")]
         run_duckdb(command, request.payload).await
      }
      command if command.contains("postgres") => {
         #[cfg(not(feature = "postgres"))]
         {
            Err("PostgreSQL provider support is not enabled".to_string())
         }
         #[cfg(feature = "postgres")]
         run_postgres(command, request.payload).await
      }
      command if command.contains("mysql") => {
         #[cfg(not(feature = "mysql"))]
         {
            Err("MySQL provider support is not enabled".to_string())
         }
         #[cfg(feature = "mysql")]
         run_mysql(command, request.payload).await
      }
      command if command.contains("mongo") => {
         #[cfg(not(feature = "mongodb"))]
         {
            Err("MongoDB provider support is not enabled".to_string())
         }
         #[cfg(feature = "mongodb")]
         run_mongodb(command, request.payload).await
      }
      command if command.starts_with("redis_") => {
         #[cfg(not(feature = "redis"))]
         {
            Err("Redis provider support is not enabled".to_string())
         }
         #[cfg(feature = "redis")]
         run_redis(command, request.payload).await
      }
      _ => Err(format!(
         "Unsupported {} database command: {}",
         provider_id, command
      )),
   }
}

fn command_has_provider_token(command: &str, token: &str) -> bool {
   command == token
      || command.starts_with(&format!("{}_", token))
      || command.ends_with(&format!("_{}", token))
      || command.contains(&format!("_{}_", token))
}

fn provider_id_for_command(command: &str) -> Result<Option<&'static str>, String> {
   let matches: Vec<&'static str> = [
      ("sqlite", "sqlite"),
      ("duckdb", "duckdb"),
      ("postgres", "postgres"),
      ("mysql", "mysql"),
      ("mongo", "mongodb"),
      ("redis", "redis"),
   ]
   .into_iter()
   .filter_map(|(token, provider_id)| {
      command_has_provider_token(command, token).then_some(provider_id)
   })
   .collect();

   match matches.as_slice() {
      [] => Ok(None),
      [provider_id] => Ok(Some(provider_id)),
      _ => Err(format!("Ambiguous database provider command {}", command)),
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

#[cfg(any(
   feature = "postgres",
   feature = "mysql",
   feature = "mongodb",
   feature = "redis"
))]
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

#[cfg(feature = "sqlite")]
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
      "update_sqlite_row_by_values" => serde_json::to_value(
         update_sqlite_row_by_values(
            path,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["setColumns", "set_columns"])?,
            read_field(&payload, &["setValues", "set_values"])?,
            read_field(&payload, &["identity"])?,
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
      "delete_sqlite_row_by_values" => serde_json::to_value(
         delete_sqlite_row_by_values(
            path,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["identity"])?,
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

#[cfg(feature = "duckdb")]
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
      "update_duckdb_row_by_values" => serde_json::to_value(
         update_duckdb_row_by_values(
            path,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["setColumns", "set_columns"])?,
            read_field(&payload, &["setValues", "set_values"])?,
            read_field(&payload, &["identity"])?,
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
      "delete_duckdb_row_by_values" => serde_json::to_value(
         delete_duckdb_row_by_values(
            path,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["identity"])?,
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

#[cfg(feature = "postgres")]
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
      "update_postgres_row_by_values" => serde_json::to_value(
         update_postgres_row_by_values(
            connection_id,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["setColumns", "set_columns"])?,
            read_field(&payload, &["setValues", "set_values"])?,
            read_field(&payload, &["identity"])?,
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
      "delete_postgres_row_by_values" => serde_json::to_value(
         delete_postgres_row_by_values(
            connection_id,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["identity"])?,
            &manager,
         )
         .await?,
      ),
      _ => return Err(format!("Unsupported PostgreSQL command: {}", command)),
   };
   value.map_err(|e| e.to_string())
}

#[cfg(feature = "mysql")]
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
      "update_mysql_row_by_values" => serde_json::to_value(
         update_mysql_row_by_values(
            connection_id,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["setColumns", "set_columns"])?,
            read_field(&payload, &["setValues", "set_values"])?,
            read_field(&payload, &["identity"])?,
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
      "delete_mysql_row_by_values" => serde_json::to_value(
         delete_mysql_row_by_values(
            connection_id,
            read_field(&payload, &["table"])?,
            read_field(&payload, &["identity"])?,
            &manager,
         )
         .await?,
      ),
      _ => return Err(format!("Unsupported MySQL command: {}", command)),
   };
   value.map_err(|e| e.to_string())
}

#[cfg(feature = "mongodb")]
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

#[cfg(feature = "redis")]
async fn run_redis(command: &str, payload: Value) -> Result<Value, String> {
   let connection_id: String = read_field(&payload, &["connectionId", "connection_id"])?;
   let manager = manager_for_connection(&payload).await?;
   let value = match command {
      "redis_scan_keys" => serde_json::to_value(
         redis_scan_keys(
            connection_id,
            read_optional_field(&payload, &["pattern"])?,
            read_optional_field(&payload, &["cursor"])?,
            read_optional_field(&payload, &["count"])?,
            &manager,
         )
         .await?,
      ),
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

#[cfg(test)]
mod tests {
   use super::*;
   use std::{
      fs,
      path::PathBuf,
      time::{SystemTime, UNIX_EPOCH},
   };

   fn temp_sqlite_path(name: &str) -> PathBuf {
      let nanos = SystemTime::now()
         .duration_since(UNIX_EPOCH)
         .expect("system time")
         .as_nanos();
      std::env::temp_dir().join(format!("athas-sidecar-{}-{}.sqlite", name, nanos))
   }

   #[tokio::test]
   async fn encodes_successful_stdio_requests_in_response_envelope() {
      let response = handle_stdio_request(include_str!("fixtures/sidecar_request_v1.json")).await;

      let response_json = serde_json::to_value(&response).expect("response json");

      assert_eq!(
         response_json,
         json!({
            "protocolVersion": 1,
            "ok": true,
            "result": true
         })
      );
   }

   #[tokio::test]
   async fn rejects_unsupported_protocol_versions() {
      let error = run_request(SidecarRequest {
         protocol_version: 2,
         provider_id: "sqlite".to_string(),
         command: "query_sqlite".to_string(),
         payload: json!({}),
      })
      .await
      .expect_err("protocol version should be rejected");

      assert_eq!(error, "Unsupported database sidecar protocol version: 2");
   }

   #[tokio::test]
   async fn encodes_stdio_errors_in_response_envelope() {
      let response = handle_stdio_request(include_str!(
         "fixtures/sidecar_unsupported_protocol_request_v2.json"
      ))
      .await;

      assert!(!response.ok);
      assert_eq!(response.protocol_version, 1);
      assert_eq!(
         response.error.expect("error").message,
         "Unsupported database sidecar protocol version: 2"
      );
   }

   #[tokio::test]
   async fn encodes_provider_command_mismatches_in_response_envelope() {
      let response =
         handle_stdio_request(include_str!("fixtures/sidecar_provider_mismatch_v1.json")).await;

      assert!(!response.ok);
      assert_eq!(response.protocol_version, 1);
      assert_eq!(
         response.error.expect("error").message,
         "Database command query_sqlite does not belong to provider redis"
      );
   }

   #[tokio::test]
   async fn encodes_invalid_stdio_json_in_response_envelope() {
      let response = handle_stdio_request("{not-json").await;

      assert!(!response.ok);
      assert_eq!(response.protocol_version, 1);
      assert!(
         response
            .error
            .expect("error")
            .message
            .starts_with("Invalid sidecar request:")
      );
   }

   #[tokio::test]
   async fn maps_stdio_request_panics_to_error_envelopes() {
      let response =
         handle_stdio_request(include_str!("fixtures/sidecar_panic_request_v1.json")).await;

      assert!(!response.ok);
      assert_eq!(response.protocol_version, 1);
      assert_eq!(
         response.error.expect("error").message,
         "Database sidecar panic: simulated provider panic"
      );
   }

   #[tokio::test]
   async fn returns_clear_error_for_unknown_provider_command() {
      let error = run_provider_command(
         "sqlite".to_string(),
         "unknown_command".to_string(),
         json!({}),
      )
      .await
      .expect_err("unknown command should fail");

      assert_eq!(
         error,
         "Unsupported sqlite database command: unknown_command"
      );
   }

   #[tokio::test]
   async fn rejects_blank_provider_ids_and_commands() {
      let provider_error = run_provider_command(
         " ".to_string(),
         "query_sqlite".to_string(),
         json!({ "path": "/tmp/app.sqlite", "query": "SELECT 1" }),
      )
      .await
      .expect_err("blank provider id should fail");

      assert_eq!(provider_error, "Database sidecar provider id is required");

      let command_error = run_provider_command("sqlite".to_string(), " ".to_string(), json!({}))
         .await
         .expect_err("blank command should fail");

      assert_eq!(command_error, "Database sidecar command is required");
   }

   #[tokio::test]
   async fn trims_provider_ids_and_commands_before_routing() {
      let error = run_provider_command(
         " redis ".to_string(),
         " query_sqlite ".to_string(),
         json!({}),
      )
      .await
      .expect_err("mismatched trimmed command should fail");

      assert_eq!(
         error,
         "Database command query_sqlite does not belong to provider redis"
      );
   }

   #[tokio::test]
   async fn rejects_commands_that_do_not_match_the_provider_id() {
      let error = run_provider_command(
         "redis".to_string(),
         "query_sqlite".to_string(),
         json!({ "path": "/tmp/app.sqlite", "query": "SELECT 1" }),
      )
      .await
      .expect_err("mismatched provider command should fail");

      assert_eq!(
         error,
         "Database command query_sqlite does not belong to provider redis"
      );
   }

   #[tokio::test]
   async fn rejects_ambiguous_provider_commands() {
      let error = run_provider_command(
         "sqlite".to_string(),
         "query_sqlite_postgres".to_string(),
         json!({}),
      )
      .await
      .expect_err("ambiguous command should fail");

      assert_eq!(
         error,
         "Ambiguous database provider command query_sqlite_postgres"
      );
   }

   #[test]
   fn resolves_provider_ids_using_provider_token_boundaries() {
      assert_eq!(provider_id_for_command("query_sqlite"), Ok(Some("sqlite")));
      assert_eq!(
         provider_id_for_command("get_duckdb_tables"),
         Ok(Some("duckdb"))
      );
      assert_eq!(
         provider_id_for_command("create_postgres_subscription"),
         Ok(Some("postgres"))
      );
      assert_eq!(
         provider_id_for_command("get_mysql_table_schema"),
         Ok(Some("mysql"))
      );
      assert_eq!(
         provider_id_for_command("query_mongo_documents"),
         Ok(Some("mongodb"))
      );
      assert_eq!(
         provider_id_for_command("redis_scan_keys"),
         Ok(Some("redis"))
      );
      assert_eq!(provider_id_for_command("query_presqlite_data"), Ok(None));
      assert_eq!(provider_id_for_command("query_mongolian_data"), Ok(None));
      assert_eq!(
         provider_id_for_command("query_sqlite_postgres"),
         Err("Ambiguous database provider command query_sqlite_postgres".to_string())
      );
   }

   #[cfg(feature = "sqlite")]
   #[tokio::test]
   async fn routes_sqlite_row_identity_commands_from_json_payloads() {
      let path = temp_sqlite_path("row-identity");
      let path_str = path.to_string_lossy().to_string();

      let create = run_provider_command(
         "sqlite".to_string(),
         "execute_sqlite".to_string(),
         json!({
            "path": path_str,
            "statement": "CREATE TABLE users (name TEXT, email TEXT)"
         }),
      )
      .await;
      assert!(create.is_ok(), "create table failed: {:?}", create);

      let insert = run_provider_command(
         "sqlite".to_string(),
         "insert_sqlite_row".to_string(),
         json!({
            "path": path_str,
            "table": "users",
            "columns": ["name", "email"],
            "values": ["Alice", null]
         }),
      )
      .await;
      assert!(insert.is_ok(), "insert row failed: {:?}", insert);

      let update = run_provider_command(
         "sqlite".to_string(),
         "update_sqlite_row_by_values".to_string(),
         json!({
            "path": path_str,
            "table": "users",
            "setColumns": ["name"],
            "setValues": ["Alicia"],
            "identity": {
               "columns": ["name", "email"],
               "values": ["Alice", null]
            }
         }),
      )
      .await;
      assert_eq!(update.expect("update row"), json!(1));

      let query = run_provider_command(
         "sqlite".to_string(),
         "query_sqlite".to_string(),
         json!({
            "path": path_str,
            "query": "SELECT name, email FROM users"
         }),
      )
      .await
      .expect("query row");
      assert_eq!(query["rows"], json!([["Alicia", null]]));

      let delete = run_provider_command(
         "sqlite".to_string(),
         "delete_sqlite_row_by_values".to_string(),
         json!({
            "path": path_str,
            "table": "users",
            "identity": {
               "columns": ["name", "email"],
               "values": ["Alicia", null]
            }
         }),
      )
      .await;
      assert_eq!(delete.expect("delete row"), json!(1));

      let _ = fs::remove_file(path);
   }
}
