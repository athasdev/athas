//! MongoDB and Redis (`providers/mongodb`, `providers/redis`): their calls into the old app's
//! providers, and the parsing and formatting their browsers share.

#[cfg(all(not(all(feature = "mongodb", feature = "redis")), not(target_family = "wasm")))]
use anyhow::anyhow;
#[cfg(not(target_family = "wasm"))]
use anyhow::Result;
use serde_json::Value;

#[cfg(all(any(feature = "mongodb", feature = "redis"), not(target_family = "wasm")))]
use crate::backend::{block_on, network::MANAGER};
#[cfg(not(target_family = "wasm"))]
use crate::backend::Backend;
use crate::{connections::SavedConnection, model::Provider};

pub const MONGO_PAGE_SIZES: [usize; 5] = [10, 25, 50, 100, 500];
pub const DEFAULT_MONGO_PAGE_SIZE: usize = 50;
pub const REDIS_SCAN_COUNT: usize = 100;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MongoCollection {
    pub name: String,
    pub count: u64,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MongoPage {
    pub documents: Vec<Value>,
    pub total: u64,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RedisKey {
    pub key: String,
    pub ty: String,
    pub ttl: i64,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RedisScan {
    pub keys: Vec<RedisKey>,
    pub cursor: String,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RedisValue {
    pub ty: String,
    pub value: Value,
}

/// A MongoDB URL without credentials, for a server that takes none. The old app always wrote
/// `user:password@`, which the driver rejects when both are empty.
pub fn mongo_url(connection: &SavedConnection) -> Option<String> {
    (connection.provider == Provider::Mongodb && connection.username.trim().is_empty()).then(|| {
        let database = connection.database.trim();
        let path = if database.is_empty() { String::new() } else { format!("/{database}") };
        format!("mongodb://{}:{}{path}", connection.host.trim(), connection.port)
    })
}

/// Empty filter or sort text means "everything", as `{}`.
pub fn normalize_query_json(text: &str) -> String {
    let text = text.trim();
    if text.is_empty() { "{}".to_string() } else { text.to_string() }
}

/// Why a filter or sort can't be sent, if it can't.
pub fn query_json_error(text: &str, label: &str) -> Option<String> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(_)) => None,
        Ok(_) => Some(format!("MongoDB {label} JSON must be an object")),
        Err(_) => Some(format!("Invalid MongoDB {label} JSON")),
    }
}

pub fn page_count(total: u64, page_size: usize) -> usize {
    (total as usize).div_ceil(page_size.max(1)).max(1)
}

/// The page to show once `total` is known: the last one when `page` ran past it.
pub fn clamp_page(total: u64, page_size: usize, page: usize) -> usize {
    page.min(page_count(total, page_size) - 1)
}

/// The 1-based number of the `ix`th document on zero-based `page`.
pub fn document_number(page: usize, page_size: usize, ix: usize) -> usize {
    page * page_size.max(1) + ix + 1
}

/// The filter that finds a document again: its `_id`, in extended JSON for an ObjectId.
pub fn document_id_filter(document: &Value) -> Option<String> {
    let id = document.get("_id")?;
    Some(serde_json::json!({ "_id": id }).to_string())
}

pub fn document_text(document: &Value) -> String {
    serde_json::to_string_pretty(document).unwrap_or_else(|_| document.to_string())
}

pub fn parse_mongo_page(value: Value) -> MongoPage {
    let total = value.get("total_count").and_then(Value::as_u64).unwrap_or(0);
    let documents = match value {
        Value::Object(mut object) => match object.remove("documents") {
            Some(Value::Array(documents)) => documents.into_iter().filter(Value::is_object).collect(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };
    MongoPage { documents, total }
}

/// Trimmed, non-empty, first occurrence only.
pub fn unique_names(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    names
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty() && seen.insert(name.clone()))
        .collect()
}

pub fn normalize_pattern(text: &str) -> String {
    let text = text.trim();
    if text.is_empty() { "*".to_string() } else { text.to_string() }
}

/// Adds the keys a later SCAN page found, skipping ones already listed.
pub fn merge_keys(keys: &mut Vec<RedisKey>, found: Vec<RedisKey>) {
    for key in found {
        if !key.key.is_empty() && !keys.iter().any(|existing| existing.key == key.key) {
            keys.push(key);
        }
    }
}

pub fn type_badge(ty: &str) -> String {
    ty.chars().take(3).collect()
}

pub fn format_ttl(ttl: i64) -> Option<String> {
    (ttl > 0).then(|| format!("{ttl}s"))
}

pub fn parse_redis_value(value: Value) -> RedisValue {
    let ty = value.get("type").and_then(Value::as_str).map(str::trim).filter(|ty| !ty.is_empty()).unwrap_or("unknown").to_string();
    let value = value.get("value").cloned().unwrap_or(Value::Null);
    RedisValue { ty, value }
}

/// A string as it is, anything else as indented JSON.
pub fn redis_value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_default(),
    }
}

/// The server facts the info panel lists, in the provider's order.
pub fn info_rows(info: &Value) -> Vec<(String, String)> {
    let Some(object) = info.as_object() else { return Vec::new() };
    object
        .iter()
        .filter(|(key, value)| !key.trim().is_empty() && !value.is_null())
        .map(|(key, value)| {
            let text = match value {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            (key.trim().to_string(), text)
        })
        .collect()
}

#[cfg(all(not(all(feature = "mongodb", feature = "redis")), not(target_family = "wasm")))]
fn unavailable(provider: Provider) -> anyhow::Error {
    anyhow!("{} is not available in this build", provider.label())
}

#[cfg(not(target_family = "wasm"))]
impl Backend {
    #[cfg(any(feature = "mongodb", feature = "redis"))]
    fn pool(&self, provider: Provider) -> Result<String> {
        match self.network_id() {
            Some(id) if self.provider() == provider => Ok(id.to_string()),
            _ => Err(anyhow::anyhow!("Not connected to {}", provider.label())),
        }
    }

    pub fn mongo_databases(&self) -> Result<Vec<String>> {
        #[cfg(feature = "mongodb")]
        {
            let id = self.pool(Provider::Mongodb)?;
            Ok(unique_names(block_on(athas_database::providers::get_mongo_databases(id, &MANAGER))?))
        }
        #[cfg(not(feature = "mongodb"))]
        Err(unavailable(Provider::Mongodb))
    }

    pub fn mongo_collections(&self, database: &str) -> Result<Vec<MongoCollection>> {
        #[cfg(feature = "mongodb")]
        {
            let id = self.pool(Provider::Mongodb)?;
            let collections =
                block_on(athas_database::providers::get_mongo_collections(id, database.to_string(), &MANAGER))?;
            let mut seen = std::collections::HashSet::new();
            Ok(collections
                .into_iter()
                .filter(|collection| !collection.name.trim().is_empty() && seen.insert(collection.name.clone()))
                .map(|collection| MongoCollection { name: collection.name, count: collection.count })
                .collect())
        }
        #[cfg(not(feature = "mongodb"))]
        {
            let _ = database;
            Err(unavailable(Provider::Mongodb))
        }
    }

    /// One page of a collection, and the page it really is once the total is known.
    pub fn mongo_documents(
        &self,
        database: &str,
        collection: &str,
        filter: &str,
        sort: &str,
        page: usize,
        page_size: usize,
    ) -> Result<(MongoPage, usize)> {
        #[cfg(feature = "mongodb")]
        {
            let id = self.pool(Provider::Mongodb)?;
            let query = |page: usize| {
                block_on(athas_database::providers::query_mongo_documents(
                    id.clone(),
                    database.to_string(),
                    collection.to_string(),
                    Some(filter.to_string()),
                    Some(sort.to_string()),
                    Some(page_size as i64),
                    Some((page * page_size) as u64),
                    &MANAGER,
                ))
                .map(parse_mongo_page)
            };
            let mut result = query(page)?;
            let clamped = clamp_page(result.total, page_size, page);
            if clamped != page && result.total > 0 {
                result = query(clamped)?;
            }
            Ok((result, clamped))
        }
        #[cfg(not(feature = "mongodb"))]
        {
            let _ = (database, collection, filter, sort, page, page_size);
            Err(unavailable(Provider::Mongodb))
        }
    }

    pub fn mongo_delete(&self, database: &str, collection: &str, filter: &str) -> Result<u64> {
        #[cfg(feature = "mongodb")]
        {
            let id = self.pool(Provider::Mongodb)?;
            block_on(athas_database::providers::delete_mongo_document(
                id,
                database.to_string(),
                collection.to_string(),
                filter.to_string(),
                &MANAGER,
            ))
        }
        #[cfg(not(feature = "mongodb"))]
        {
            let _ = (database, collection, filter);
            Err(unavailable(Provider::Mongodb))
        }
    }

    pub fn redis_scan(&self, pattern: &str, cursor: &str) -> Result<RedisScan> {
        #[cfg(feature = "redis")]
        {
            let id = self.pool(Provider::Redis)?;
            let result = block_on(athas_database::providers::redis_scan_keys(
                id,
                Some(pattern.to_string()),
                Some(cursor.to_string()),
                Some(REDIS_SCAN_COUNT),
                &MANAGER,
            ))?;
            let mut keys = Vec::new();
            merge_keys(
                &mut keys,
                result
                    .keys
                    .into_iter()
                    .map(|info| RedisKey {
                        key: info.key.trim().to_string(),
                        ty: if info.key_type.trim().is_empty() { "unknown".into() } else { info.key_type.trim().to_string() },
                        ttl: info.ttl,
                    })
                    .collect(),
            );
            let cursor = result.cursor.trim();
            Ok(RedisScan { keys, cursor: if cursor.is_empty() { "0".into() } else { cursor.to_string() } })
        }
        #[cfg(not(feature = "redis"))]
        {
            let _ = (pattern, cursor);
            Err(unavailable(Provider::Redis))
        }
    }

    pub fn redis_value(&self, key: &str) -> Result<RedisValue> {
        #[cfg(feature = "redis")]
        {
            let id = self.pool(Provider::Redis)?;
            Ok(parse_redis_value(block_on(athas_database::providers::redis_get_value(id, key.to_string(), &MANAGER))?))
        }
        #[cfg(not(feature = "redis"))]
        {
            let _ = key;
            Err(unavailable(Provider::Redis))
        }
    }

    pub fn redis_delete(&self, key: &str) -> Result<bool> {
        #[cfg(feature = "redis")]
        {
            let id = self.pool(Provider::Redis)?;
            block_on(athas_database::providers::redis_delete_key(id, key.to_string(), &MANAGER))
        }
        #[cfg(not(feature = "redis"))]
        {
            let _ = key;
            Err(unavailable(Provider::Redis))
        }
    }

    pub fn redis_info(&self) -> Result<Vec<(String, String)>> {
        #[cfg(feature = "redis")]
        {
            let id = self.pool(Provider::Redis)?;
            let info = block_on(athas_database::providers::redis_get_info(id, &MANAGER))?;
            Ok(info_rows(&serde_json::to_value(info)?))
        }
        #[cfg(not(feature = "redis"))]
        Err(unavailable(Provider::Redis))
    }
}
