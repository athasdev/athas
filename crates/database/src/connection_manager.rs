use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
   pub id: String,
   pub name: String,
   pub db_type: String, // "postgres", "mysql", "mongodb", "redis"
   pub host: String,
   pub port: u16,
   pub database: String,
   pub username: String,
   // password stored separately via secure_storage
   pub connection_string: Option<String>,
}

pub enum DatabasePool {
   Postgres(sqlx::Pool<sqlx::Postgres>),
   MySql(sqlx::Pool<sqlx::MySql>),
   Mongo(mongodb::Client),
   Redis(Box<redis::aio::ConnectionManager>),
}

pub struct ConnectionManager {
   pools: RwLock<HashMap<String, Arc<DatabasePool>>>,
}

impl Default for ConnectionManager {
   fn default() -> Self {
      Self::new()
   }
}

impl ConnectionManager {
   pub fn new() -> Self {
      Self {
         pools: RwLock::new(HashMap::new()),
      }
   }

   pub async fn get_pool(&self, connection_id: &str) -> Option<Arc<DatabasePool>> {
      let pools = self.pools.read().await;
      pools.get(connection_id).cloned()
   }

   pub async fn add_pool(&self, connection_id: String, pool: DatabasePool) {
      let mut pools = self.pools.write().await;
      pools.insert(connection_id, Arc::new(pool));
   }

   pub async fn remove_pool(&self, connection_id: &str) -> bool {
      let mut pools = self.pools.write().await;
      pools.remove(connection_id).is_some()
   }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionResult {
   pub success: bool,
   pub connection_id: String,
   pub message: String,
}

pub async fn connect_database(
   config: ConnectionConfig,
   password: Option<String>,
   manager: &ConnectionManager,
) -> Result<ConnectionResult, String> {
   let connection_id = config.id.clone();

   // Build connection string
   let conn_str = if let Some(ref cs) = config.connection_string {
      cs.clone()
   } else {
      let pass = password.unwrap_or_default();
      match config.db_type.as_str() {
         "postgres" => format!(
            "postgres://{}:{}@{}:{}/{}",
            config.username, pass, config.host, config.port, config.database
         ),
         "mysql" => format!(
            "mysql://{}:{}@{}:{}/{}",
            config.username, pass, config.host, config.port, config.database
         ),
         "mongodb" => format!(
            "mongodb://{}:{}@{}:{}/{}",
            config.username, pass, config.host, config.port, config.database
         ),
         "redis" => {
            if !config.username.is_empty() {
               format!(
                  "redis://{}:{}@{}:{}",
                  config.username, pass, config.host, config.port
               )
            } else if !pass.is_empty() {
               format!("redis://:{}@{}:{}", pass, config.host, config.port)
            } else {
               format!("redis://{}:{}", config.host, config.port)
            }
         }
         _ => return Err(format!("Unsupported database type: {}", config.db_type)),
      }
   };

   match config.db_type.as_str() {
      "postgres" => {
         let pool = sqlx::PgPool::connect(&conn_str)
            .await
            .map_err(|e| format!("Failed to connect to PostgreSQL: {}", e))?;
         manager
            .add_pool(connection_id.clone(), DatabasePool::Postgres(pool))
            .await;
      }
      "mysql" => {
         let pool = sqlx::MySqlPool::connect(&conn_str)
            .await
            .map_err(|e| format!("Failed to connect to MySQL: {}", e))?;
         manager
            .add_pool(connection_id.clone(), DatabasePool::MySql(pool))
            .await;
      }
      "mongodb" => {
         let client = mongodb::Client::with_uri_str(&conn_str)
            .await
            .map_err(|e| format!("Failed to connect to MongoDB: {}", e))?;
         // Test the connection
         client
            .list_database_names()
            .await
            .map_err(|e| format!("Failed to connect to MongoDB: {}", e))?;
         manager
            .add_pool(connection_id.clone(), DatabasePool::Mongo(client))
            .await;
      }
      "redis" => {
         let client = redis::Client::open(conn_str.as_str())
            .map_err(|e| format!("Failed to parse Redis URL: {}", e))?;
         let redis_manager = redis::aio::ConnectionManager::new(client)
            .await
            .map_err(|e| format!("Failed to connect to Redis: {}", e))?;
         manager
            .add_pool(
               connection_id.clone(),
               DatabasePool::Redis(Box::new(redis_manager)),
            )
            .await;
      }
      _ => return Err(format!("Unsupported database type: {}", config.db_type)),
   }

   Ok(ConnectionResult {
      success: true,
      connection_id,
      message: "Connected successfully".to_string(),
   })
}

pub async fn disconnect_database(
   connection_id: String,
   manager: &ConnectionManager,
) -> Result<bool, String> {
   Ok(manager.remove_pool(&connection_id).await)
}

pub async fn test_connection(
   config: ConnectionConfig,
   password: Option<String>,
) -> Result<ConnectionResult, String> {
   let conn_str = if let Some(ref cs) = config.connection_string {
      cs.clone()
   } else {
      let pass = password.unwrap_or_default();
      match config.db_type.as_str() {
         "postgres" => format!(
            "postgres://{}:{}@{}:{}/{}",
            config.username, pass, config.host, config.port, config.database
         ),
         "mysql" => format!(
            "mysql://{}:{}@{}:{}/{}",
            config.username, pass, config.host, config.port, config.database
         ),
         "mongodb" => format!(
            "mongodb://{}:{}@{}:{}/{}",
            config.username, pass, config.host, config.port, config.database
         ),
         "redis" => {
            if !pass.is_empty() {
               format!("redis://:{}@{}:{}", pass, config.host, config.port)
            } else {
               format!("redis://{}:{}", config.host, config.port)
            }
         }
         _ => return Err(format!("Unsupported database type: {}", config.db_type)),
      }
   };

   match config.db_type.as_str() {
      "postgres" => {
         let pool = sqlx::PgPool::connect(&conn_str)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
         pool.close().await;
      }
      "mysql" => {
         let pool = sqlx::MySqlPool::connect(&conn_str)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
         pool.close().await;
      }
      "mongodb" => {
         let client = mongodb::Client::with_uri_str(&conn_str)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
         client
            .list_database_names()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
      }
      "redis" => {
         let client = redis::Client::open(conn_str.as_str())
            .map_err(|e| format!("Connection failed: {}", e))?;
         let _conn = redis::aio::ConnectionManager::new(client)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
      }
      _ => return Err(format!("Unsupported database type: {}", config.db_type)),
   }

   Ok(ConnectionResult {
      success: true,
      connection_id: config.id,
      message: "Connection test successful".to_string(),
   })
}
