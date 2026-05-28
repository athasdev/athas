use crate::{ConnectionManager, DatabasePool};
use redis::AsyncCommands;

#[derive(Debug, serde::Serialize)]
pub struct RedisKeyInfo {
   pub key: String,
   #[serde(rename = "type")]
   pub key_type: String,
   pub ttl: i64,
}

#[derive(Debug, serde::Serialize)]
pub struct RedisScanResult {
   pub keys: Vec<RedisKeyInfo>,
   pub cursor: String,
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
   cursor: Option<String>,
   count: Option<usize>,
   manager: &ConnectionManager,
) -> Result<RedisScanResult, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let mut conn = match pool_arc.as_ref() {
      DatabasePool::Redis(c) => (**c).clone(),
      _ => return Err("Invalid pool type".to_string()),
   };

   let pattern = pattern.unwrap_or_else(|| "*".to_string());
   let cursor = cursor.unwrap_or_else(|| "0".to_string());
   let count = count.unwrap_or(100);

   let scan_result: (String, Vec<String>) = redis::cmd("SCAN")
      .arg(&cursor)
      .arg("MATCH")
      .arg(&pattern)
      .arg("COUNT")
      .arg(count)
      .query_async::<Vec<redis::Value>>(&mut conn)
      .await
      .map_err(|e| format!("Failed to scan keys: {}", e))
      .map(decode_scan_response)?;

   let mut key_infos = Vec::new();
   for key in scan_result.1.into_iter().take(count) {
      let key_type: String = redis::cmd("TYPE")
         .arg(&key)
         .query_async(&mut conn)
         .await
         .unwrap_or_else(|_| "unknown".to_string());

      let ttl: i64 = conn.ttl(&key).await.unwrap_or(-1);

      key_infos.push(RedisKeyInfo { key, key_type, ttl });
   }

   Ok(RedisScanResult {
      keys: key_infos,
      cursor: scan_result.0,
   })
}

fn decode_scan_response(result: Vec<redis::Value>) -> (String, Vec<String>) {
   let cursor = result
      .first()
      .and_then(redis_value_to_string)
      .unwrap_or_else(|| "0".to_string());
   let keys = result
      .get(1)
      .and_then(|value| match value {
         redis::Value::Array(values) => Some(
            values
               .iter()
               .filter_map(redis_value_to_string)
               .collect::<Vec<_>>(),
         ),
         _ => None,
      })
      .unwrap_or_default();

   (cursor, keys)
}

fn redis_value_to_string(value: &redis::Value) -> Option<String> {
   match value {
      redis::Value::BulkString(bytes) => String::from_utf8(bytes.clone()).ok(),
      redis::Value::SimpleString(text) => Some(text.clone()),
      _ => None,
   }
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

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn decodes_redis_scan_cursor_and_keys() {
      let (cursor, keys) = decode_scan_response(vec![
         redis::Value::BulkString(b"42".to_vec()),
         redis::Value::Array(vec![
            redis::Value::BulkString(b"user:1".to_vec()),
            redis::Value::SimpleString("session:1".to_string()),
         ]),
      ]);

      assert_eq!(cursor, "42");
      assert_eq!(keys, vec!["user:1".to_string(), "session:1".to_string()]);
   }

   #[test]
   fn serializes_redis_key_type_for_frontend_contract() {
      let value = serde_json::to_value(RedisScanResult {
         cursor: "0".to_string(),
         keys: vec![RedisKeyInfo {
            key: "user:1".to_string(),
            key_type: "string".to_string(),
            ttl: 30,
         }],
      })
      .expect("redis scan json");

      assert_eq!(
         value,
         serde_json::json!({
            "cursor": "0",
            "keys": [{ "key": "user:1", "type": "string", "ttl": 30 }]
         })
      );
   }
}
