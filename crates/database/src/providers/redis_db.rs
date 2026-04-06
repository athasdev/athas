use crate::{ConnectionManager, DatabasePool};
use redis::AsyncCommands;

#[derive(Debug, serde::Serialize)]
pub struct RedisKeyInfo {
   pub key: String,
   pub key_type: String,
   pub ttl: i64,
}

#[derive(Debug, serde::Serialize)]
pub struct RedisServerInfo {
   pub version: String,
   pub connected_clients: String,
   pub used_memory_human: String,
   pub total_keys: u64,
   pub uptime_seconds: String,
}

pub async fn redis_scan_keys(
   connection_id: String,
   pattern: Option<String>,
   count: Option<usize>,
   manager: &ConnectionManager,
) -> Result<Vec<RedisKeyInfo>, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let mut conn = match pool_arc.as_ref() {
      DatabasePool::Redis(c) => (**c).clone(),
      _ => return Err("Invalid pool type".to_string()),
   };

   let pattern = pattern.unwrap_or_else(|| "*".to_string());
   let count = count.unwrap_or(100);

   let keys: Vec<String> = redis::cmd("SCAN")
      .arg(0)
      .arg("MATCH")
      .arg(&pattern)
      .arg("COUNT")
      .arg(count)
      .query_async::<Vec<redis::Value>>(&mut conn)
      .await
      .map_err(|e| format!("Failed to scan keys: {}", e))
      .map(|result| {
         if result.len() >= 2 {
            if let redis::Value::Array(ref keys) = result[1] {
               keys
                  .iter()
                  .filter_map(|k| {
                     if let redis::Value::BulkString(s) = k {
                        String::from_utf8(s.clone()).ok()
                     } else {
                        None
                     }
                  })
                  .collect()
            } else {
               Vec::new()
            }
         } else {
            Vec::new()
         }
      })?;

   let mut key_infos = Vec::new();
   for key in keys.into_iter().take(count) {
      let key_type: String = redis::cmd("TYPE")
         .arg(&key)
         .query_async(&mut conn)
         .await
         .unwrap_or_else(|_| "unknown".to_string());

      let ttl: i64 = conn.ttl(&key).await.unwrap_or(-1);

      key_infos.push(RedisKeyInfo { key, key_type, ttl });
   }

   Ok(key_infos)
}

pub async fn redis_get_value(
   connection_id: String,
   key: String,
   manager: &ConnectionManager,
) -> Result<serde_json::Value, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let mut conn = match pool_arc.as_ref() {
      DatabasePool::Redis(c) => (**c).clone(),
      _ => return Err("Invalid pool type".to_string()),
   };

   let key_type: String = redis::cmd("TYPE")
      .arg(&key)
      .query_async(&mut conn)
      .await
      .map_err(|e| format!("Failed to get type: {}", e))?;

   let value = match key_type.as_str() {
      "string" => {
         let val: String = conn
            .get(&key)
            .await
            .map_err(|e| format!("Failed to get: {}", e))?;
         serde_json::json!({ "type": "string", "value": val })
      }
      "list" => {
         let val: Vec<String> = conn
            .lrange(&key, 0, -1)
            .await
            .map_err(|e| format!("Failed to get list: {}", e))?;
         serde_json::json!({ "type": "list", "value": val })
      }
      "set" => {
         let val: Vec<String> = conn
            .smembers(&key)
            .await
            .map_err(|e| format!("Failed to get set: {}", e))?;
         serde_json::json!({ "type": "set", "value": val })
      }
      "hash" => {
         let val: Vec<(String, String)> = conn
            .hgetall(&key)
            .await
            .map_err(|e| format!("Failed to get hash: {}", e))?;
         let map: std::collections::HashMap<String, String> = val.into_iter().collect();
         serde_json::json!({ "type": "hash", "value": map })
      }
      "zset" => {
         let val: Vec<(String, f64)> = conn
            .zrange_withscores(&key, 0, -1)
            .await
            .map_err(|e| format!("Failed to get zset: {}", e))?;
         serde_json::json!({ "type": "zset", "value": val })
      }
      _ => serde_json::json!({ "type": key_type, "value": null }),
   };

   Ok(value)
}

pub async fn redis_set_value(
   connection_id: String,
   key: String,
   value: String,
   ttl: Option<i64>,
   manager: &ConnectionManager,
) -> Result<(), String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let mut conn = match pool_arc.as_ref() {
      DatabasePool::Redis(c) => (**c).clone(),
      _ => return Err("Invalid pool type".to_string()),
   };

   conn
      .set::<_, _, ()>(&key, &value)
      .await
      .map_err(|e| format!("Failed to set: {}", e))?;

   if let Some(ttl_secs) = ttl
      && ttl_secs > 0
   {
      conn
         .expire::<_, ()>(&key, ttl_secs)
         .await
         .map_err(|e| format!("Failed to set TTL: {}", e))?;
   }

   Ok(())
}

pub async fn redis_delete_key(
   connection_id: String,
   key: String,
   manager: &ConnectionManager,
) -> Result<bool, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let mut conn = match pool_arc.as_ref() {
      DatabasePool::Redis(c) => (**c).clone(),
      _ => return Err("Invalid pool type".to_string()),
   };

   let deleted: i64 = conn
      .del(&key)
      .await
      .map_err(|e| format!("Failed to delete: {}", e))?;
   Ok(deleted > 0)
}

pub async fn redis_get_info(
   connection_id: String,
   manager: &ConnectionManager,
) -> Result<RedisServerInfo, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let mut conn = match pool_arc.as_ref() {
      DatabasePool::Redis(c) => (**c).clone(),
      _ => return Err("Invalid pool type".to_string()),
   };

   let info: String = redis::cmd("INFO")
      .query_async(&mut conn)
      .await
      .map_err(|e| format!("Failed to get info: {}", e))?;

   let get_field = |field: &str| -> String {
      info
         .lines()
         .find(|line| line.starts_with(&format!("{}:", field)))
         .map(|line| line.split(':').nth(1).unwrap_or("").trim().to_string())
         .unwrap_or_default()
   };

   let total_keys: u64 = info
      .lines()
      .find(|line| line.starts_with("db0:"))
      .and_then(|line| {
         line
            .split("keys=")
            .nth(1)
            .and_then(|s| s.split(',').next())
            .and_then(|s| s.parse().ok())
      })
      .unwrap_or(0);

   Ok(RedisServerInfo {
      version: get_field("redis_version"),
      connected_clients: get_field("connected_clients"),
      used_memory_human: get_field("used_memory_human"),
      total_keys,
      uptime_seconds: get_field("uptime_in_seconds"),
   })
}
