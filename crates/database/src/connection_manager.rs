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
   #[cfg(feature = "postgres")]
   Postgres(sqlx::Pool<sqlx::Postgres>),
   #[cfg(feature = "mysql")]
   MySql(sqlx::Pool<sqlx::MySql>),
   #[cfg(feature = "mongodb")]
   Mongo(mongodb::Client),
   #[cfg(feature = "redis")]
   Redis(Box<redis::aio::ConnectionManager>),
   #[doc(hidden)]
   Unsupported,
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
   #[cfg(not(any(
      feature = "postgres",
      feature = "mysql",
      feature = "mongodb",
      feature = "redis"
   )))]
   {
      let _ = (password, manager);
      Err(format!("Unsupported database type: {}", config.db_type))
   }

   #[cfg(any(
      feature = "postgres",
      feature = "mysql",
      feature = "mongodb",
      feature = "redis"
   ))]
   {
      connect_network_database(config, password, manager).await
   }
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
   #[cfg(not(any(
      feature = "postgres",
      feature = "mysql",
      feature = "mongodb",
      feature = "redis"
   )))]
   {
      let _ = password;
      Err(format!("Unsupported database type: {}", config.db_type))
   }

   #[cfg(any(
      feature = "postgres",
      feature = "mysql",
      feature = "mongodb",
      feature = "redis"
   ))]
   {
      test_network_connection(config, password).await
   }
}

#[cfg(any(
   feature = "postgres",
   feature = "mysql",
   feature = "mongodb",
   feature = "redis"
))]
async fn connect_network_database(
   config: ConnectionConfig,
   password: Option<String>,
   manager: &ConnectionManager,
) -> Result<ConnectionResult, String> {
   let connection_id = config.id.clone();
   let conn_str = network_connection_string(&config, password)?;

   match config.db_type.as_str() {
      #[cfg(feature = "postgres")]
      "postgres" => {
         let pool = sqlx::PgPool::connect(&conn_str)
            .await
            .map_err(|e| format!("Failed to connect to PostgreSQL: {}", e))?;
         manager
            .add_pool(connection_id.clone(), DatabasePool::Postgres(pool))
            .await;
      }
      #[cfg(feature = "mysql")]
      "mysql" => {
         let pool = sqlx::MySqlPool::connect(&conn_str)
            .await
            .map_err(|e| format!("Failed to connect to MySQL: {}", e))?;
         manager
            .add_pool(connection_id.clone(), DatabasePool::MySql(pool))
            .await;
      }
      #[cfg(feature = "mongodb")]
      "mongodb" => {
         let client = mongodb::Client::with_uri_str(&conn_str)
            .await
            .map_err(|e| format!("Failed to connect to MongoDB: {}", e))?;
         client
            .list_database_names()
            .await
            .map_err(|e| format!("Failed to connect to MongoDB: {}", e))?;
         manager
            .add_pool(connection_id.clone(), DatabasePool::Mongo(client))
            .await;
      }
      #[cfg(feature = "redis")]
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

#[cfg(any(
   feature = "postgres",
   feature = "mysql",
   feature = "mongodb",
   feature = "redis"
))]
async fn test_network_connection(
   config: ConnectionConfig,
   password: Option<String>,
) -> Result<ConnectionResult, String> {
   let conn_str = network_connection_string(&config, password)?;

   match config.db_type.as_str() {
      #[cfg(feature = "postgres")]
      "postgres" => {
         let pool = sqlx::PgPool::connect(&conn_str)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
         pool.close().await;
      }
      #[cfg(feature = "mysql")]
      "mysql" => {
         let pool = sqlx::MySqlPool::connect(&conn_str)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
         pool.close().await;
      }
      #[cfg(feature = "mongodb")]
      "mongodb" => {
         let client = mongodb::Client::with_uri_str(&conn_str)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
         client
            .list_database_names()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
      }
      #[cfg(feature = "redis")]
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

#[cfg(any(
   feature = "postgres",
   feature = "mysql",
   feature = "mongodb",
   feature = "redis"
))]
fn network_connection_string(
   config: &ConnectionConfig,
   password: Option<String>,
) -> Result<String, String> {
   if let Some(ref cs) = config.connection_string {
      return Ok(cs.clone());
   }

   let pass = password.unwrap_or_default();
   match config.db_type.as_str() {
      #[cfg(feature = "postgres")]
      "postgres" => Ok(format!(
         "postgres://{}:{}@{}:{}/{}",
         config.username, pass, config.host, config.port, config.database
      )),
      #[cfg(feature = "mysql")]
      "mysql" => Ok(format!(
         "mysql://{}:{}@{}:{}/{}",
         config.username, pass, config.host, config.port, config.database
      )),
      #[cfg(feature = "mongodb")]
      "mongodb" => Ok(format!(
         "mongodb://{}:{}@{}:{}/{}",
         config.username, pass, config.host, config.port, config.database
      )),
      #[cfg(feature = "redis")]
      "redis" => {
         if !config.username.is_empty() {
            Ok(format!(
               "redis://{}:{}@{}:{}",
               config.username, pass, config.host, config.port
            ))
         } else if !pass.is_empty() {
            Ok(format!("redis://:{}@{}:{}", pass, config.host, config.port))
         } else {
            Ok(format!("redis://{}:{}", config.host, config.port))
         }
      }
      _ => Err(format!("Unsupported database type: {}", config.db_type)),
   }
}
