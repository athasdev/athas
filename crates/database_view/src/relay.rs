//! The database views of the web workbench. Each [`DatabaseCall`] is a method of the workspace
//! protocol (`database.*`): in the browser [`RemoteBackend`] stands in for the engines and sends
//! them, and the workspace server answers them with [`Host`], which opens the databases itself,
//! keeps the saved connections and their passwords, and only ever hands the browser connection
//! strings with their passwords hidden.

use std::{
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Map, Value};

#[cfg(target_family = "wasm")]
use crate::athas_database;
use crate::{
    connections::SavedConnection,
    forms::SubscriptionDraft,
    model::{Column, DbInfo, DbObject, ForeignKey, Page, PageRequest, Provider, QueryOutcome, ResultSet, RowIdentity},
    nosql::{MongoCollection, MongoPage, RedisScan, RedisValue},
    subscriptions::{SubscriptionDetails, subscription_details},
};
use athas_database::sql_common::PostgresSubscriptionInfo;

pub const METHOD_PREFIX: &str = "database.";

/// One call of the database views, named `database.<method>` on the wire. `handle` names a
/// database the server opened for this client (`open`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DatabaseCall {
    Connections,
    SaveConnections { connections: Vec<SavedConnection> },
    StorePassword { id: String, password: String },
    DeletePassword { id: String },
    LoadHistory { key: String },
    SaveHistory { key: String, history: Vec<String> },
    Test { connection: SavedConnection, password: Option<String> },
    Open { connection: SavedConnection, password: Option<String> },
    Close { handle: String },
    Objects { handle: String },
    Columns { handle: String, table: String },
    ForeignKeys { handle: String, table: String },
    Info { handle: String, object_count: usize },
    Page { handle: String, request: PageRequest },
    Run { handle: String, sql: String },
    Insert { handle: String, table: String, columns: Vec<String>, values: Vec<Value> },
    Update { handle: String, table: String, columns: Vec<String>, values: Vec<Value>, identity: RowIdentity },
    Delete { handle: String, table: String, identity: RowIdentity },
    MongoDatabases { handle: String },
    MongoCollections { handle: String, database: String },
    MongoDocuments { handle: String, database: String, collection: String, filter: String, sort: String, page: usize, page_size: usize },
    MongoDelete { handle: String, database: String, collection: String, filter: String },
    RedisScan { handle: String, pattern: String, cursor: String },
    RedisValue { handle: String, key: String },
    RedisDelete { handle: String, key: String },
    RedisInfo { handle: String },
    SubscriptionInfo { handle: String, name: String },
    SubscriptionStatus { handle: String, name: String },
    CreateSubscription { handle: String, draft: SubscriptionDraft },
    DropSubscription { handle: String, name: String },
    SetSubscriptionEnabled { handle: String, name: String, enabled: bool },
    RefreshSubscription { handle: String, name: String },
}

impl DatabaseCall {
    /// The protocol method and its parameters.
    pub fn to_method(&self) -> (String, Value) {
        let mut params = serde_json::to_value(self).unwrap_or_default();
        let method = params.as_object_mut().and_then(|fields| fields.remove("method")).and_then(|method| method.as_str().map(str::to_string)).unwrap_or_default();
        (format!("{METHOD_PREFIX}{method}"), params)
    }

    pub fn from_method(method: &str, params: &Map<String, Value>) -> Result<Self, String> {
        let name = method.strip_prefix(METHOD_PREFIX).ok_or_else(|| format!("{method} is not a database method."))?;
        let mut params = params.clone();
        params.insert("method".into(), Value::String(name.into()));
        serde_json::from_value(Value::Object(params)).map_err(|error| format!("Invalid {method} call: {error}"))
    }
}

/// How the browser reaches the workspace server.
pub trait DatabaseTransport: Send + Sync {
    /// Runs one protocol method and waits for its answer.
    fn call(&self, method: &str, params: Value) -> Result<Value, String>;
}

static TRANSPORT: RwLock<Option<Arc<dyn DatabaseTransport>>> = RwLock::new(None);

/// Sends the database views' calls to the workspace server from now on.
pub fn set_transport(transport: Arc<dyn DatabaseTransport>) {
    *TRANSPORT.write().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(transport);
}

fn call<T: DeserializeOwned>(call: DatabaseCall) -> Result<T> {
    let transport = TRANSPORT
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
        .ok_or_else(|| anyhow!("Databases are not available without a workspace server."))?;
    let (method, params) = call.to_method();
    let value = transport.call(&method, params).map_err(|error| anyhow!(error))?;
    serde_json::from_value(value).map_err(|error| anyhow!("The workspace server's database answer could not be read: {error}"))
}

/// The server's saved connections, their connection strings' passwords hidden.
pub fn connections() -> Result<Vec<SavedConnection>> {
    call(DatabaseCall::Connections)
}

pub fn save_connections(connections: &[SavedConnection]) -> Result<()> {
    call(DatabaseCall::SaveConnections { connections: connections.to_vec() })
}

pub fn store_password(id: &str, password: &str) -> Result<()> {
    call(DatabaseCall::StorePassword { id: id.into(), password: password.into() })
}

pub fn delete_password(id: &str) -> Result<()> {
    call(DatabaseCall::DeletePassword { id: id.into() })
}

pub fn load_history(key: &str) -> Result<Vec<String>> {
    call(DatabaseCall::LoadHistory { key: key.into() })
}

pub fn save_history(key: &str, history: &[String]) -> Result<()> {
    call(DatabaseCall::SaveHistory { key: key.into(), history: history.to_vec() })
}

/// A database the workspace server opened, with the engines' methods. A missing password is the
/// one the server keeps for the connection.
pub struct RemoteBackend {
    handle: String,
    provider: Provider,
    file_path: Option<PathBuf>,
}

impl RemoteBackend {
    pub fn open(connection: &SavedConnection, password: Option<String>) -> Result<RemoteBackend> {
        let handle = call(DatabaseCall::Open { connection: connection.clone(), password })?;
        let file_path = connection.provider.is_file_based().then(|| PathBuf::from(&connection.file_path));
        Ok(RemoteBackend { handle, provider: connection.provider, file_path })
    }

    pub fn test(connection: &SavedConnection, password: Option<String>) -> Result<()> {
        call(DatabaseCall::Test { connection: connection.clone(), password })
    }

    fn handle(&self) -> String {
        self.handle.clone()
    }

    pub fn provider(&self) -> Provider {
        self.provider
    }

    pub fn file_path(&self) -> Option<&Path> {
        self.file_path.as_deref()
    }

    pub fn objects(&self) -> Result<Vec<DbObject>> {
        call(DatabaseCall::Objects { handle: self.handle() })
    }

    pub fn columns(&self, table: &str) -> Result<Vec<Column>> {
        call(DatabaseCall::Columns { handle: self.handle(), table: table.into() })
    }

    pub fn foreign_keys(&self, table: &str) -> Result<Vec<ForeignKey>> {
        call(DatabaseCall::ForeignKeys { handle: self.handle(), table: table.into() })
    }

    pub fn info(&self, object_count: usize) -> Result<DbInfo> {
        call(DatabaseCall::Info { handle: self.handle(), object_count })
    }

    pub fn page(&self, request: &PageRequest) -> Result<Page> {
        call(DatabaseCall::Page { handle: self.handle(), request: request.clone() })
    }

    pub fn run(&self, sql: &str) -> Result<QueryOutcome> {
        call(DatabaseCall::Run { handle: self.handle(), sql: sql.into() })
    }

    pub fn insert(&self, table: &str, columns: &[String], values: &[Value]) -> Result<u64> {
        call(DatabaseCall::Insert { handle: self.handle(), table: table.into(), columns: columns.to_vec(), values: values.to_vec() })
    }

    pub fn update(&self, table: &str, columns: &[String], values: &[Value], identity: &RowIdentity) -> Result<u64> {
        call(DatabaseCall::Update {
            handle: self.handle(),
            table: table.into(),
            columns: columns.to_vec(),
            values: values.to_vec(),
            identity: identity.clone(),
        })
    }

    pub fn delete(&self, table: &str, identity: &RowIdentity) -> Result<u64> {
        call(DatabaseCall::Delete { handle: self.handle(), table: table.into(), identity: identity.clone() })
    }

    pub fn close(&self) {
        call::<()>(DatabaseCall::Close { handle: self.handle() }).ok();
    }

    pub fn mongo_databases(&self) -> Result<Vec<String>> {
        call(DatabaseCall::MongoDatabases { handle: self.handle() })
    }

    pub fn mongo_collections(&self, database: &str) -> Result<Vec<MongoCollection>> {
        call(DatabaseCall::MongoCollections { handle: self.handle(), database: database.into() })
    }

    pub fn mongo_documents(
        &self,
        database: &str,
        collection: &str,
        filter: &str,
        sort: &str,
        page: usize,
        page_size: usize,
    ) -> Result<(MongoPage, usize)> {
        call(DatabaseCall::MongoDocuments {
            handle: self.handle(),
            database: database.into(),
            collection: collection.into(),
            filter: filter.into(),
            sort: sort.into(),
            page,
            page_size,
        })
    }

    pub fn mongo_delete(&self, database: &str, collection: &str, filter: &str) -> Result<u64> {
        call(DatabaseCall::MongoDelete { handle: self.handle(), database: database.into(), collection: collection.into(), filter: filter.into() })
    }

    pub fn redis_scan(&self, pattern: &str, cursor: &str) -> Result<RedisScan> {
        call(DatabaseCall::RedisScan { handle: self.handle(), pattern: pattern.into(), cursor: cursor.into() })
    }

    pub fn redis_value(&self, key: &str) -> Result<RedisValue> {
        call(DatabaseCall::RedisValue { handle: self.handle(), key: key.into() })
    }

    pub fn redis_delete(&self, key: &str) -> Result<bool> {
        call(DatabaseCall::RedisDelete { handle: self.handle(), key: key.into() })
    }

    pub fn redis_info(&self) -> Result<Vec<(String, String)>> {
        call(DatabaseCall::RedisInfo { handle: self.handle() })
    }

    pub fn subscription_details(&self, name: &str) -> Result<SubscriptionDetails> {
        let info: PostgresSubscriptionInfo = call(DatabaseCall::SubscriptionInfo { handle: self.handle(), name: name.into() })?;
        Ok(subscription_details(&info))
    }

    pub fn subscription_status(&self, name: &str) -> Result<ResultSet> {
        call(DatabaseCall::SubscriptionStatus { handle: self.handle(), name: name.into() })
    }

    pub fn create_subscription(&self, draft: &SubscriptionDraft) -> Result<()> {
        call(DatabaseCall::CreateSubscription { handle: self.handle(), draft: draft.clone() })
    }

    pub fn drop_subscription(&self, name: &str) -> Result<u64> {
        call(DatabaseCall::DropSubscription { handle: self.handle(), name: name.into() })
    }

    pub fn set_subscription_enabled(&self, name: &str, enabled: bool) -> Result<()> {
        call(DatabaseCall::SetSubscriptionEnabled { handle: self.handle(), name: name.into(), enabled })
    }

    pub fn refresh_subscription(&self, name: &str) -> Result<()> {
        call(DatabaseCall::RefreshSubscription { handle: self.handle(), name: name.into() })
    }
}

#[cfg(not(target_family = "wasm"))]
pub use host::Host;

#[cfg(not(target_family = "wasm"))]
mod host {
    use std::{
        collections::BTreeMap,
        path::PathBuf,
        sync::{Arc, Mutex, MutexGuard},
    };

    use anyhow::{Result, anyhow};
    use serde::Serialize;
    use serde_json::Value;

    use super::DatabaseCall;
    use crate::{
        backend::Backend,
        connection_form::resolve_password,
        connections::{self, SavedConnection, redact},
        history,
    };

    /// Databases a client keeps open at once; opening another closes the oldest.
    const MAX_OPEN: usize = 32;

    /// The workspace server's side: the databases its clients opened, by handle, and the saved
    /// connections, history and passwords the desktop app keeps.
    pub struct Host {
        connections_path: Option<PathBuf>,
        history_path: Option<PathBuf>,
        open: Mutex<(u64, BTreeMap<u64, Arc<Backend>>)>,
    }

    impl Default for Host {
        fn default() -> Self {
            Self::new(connections::default_store_path(), history::default_store_path())
        }
    }

    fn json(value: impl Serialize) -> Result<Value> {
        Ok(serde_json::to_value(value)?)
    }

    /// The connection with its connection string's password hidden.
    fn hidden(mut connection: SavedConnection) -> SavedConnection {
        connection.connection_string = connection.connection_string.map(|string| redact(&string));
        connection
    }

    impl Host {
        pub fn new(connections_path: Option<PathBuf>, history_path: Option<PathBuf>) -> Self {
            Self { connections_path, history_path, open: Mutex::new((0, BTreeMap::new())) }
        }

        fn open(&self) -> MutexGuard<'_, (u64, BTreeMap<u64, Arc<Backend>>)> {
            self.open.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
        }

        fn saved(&self) -> Vec<SavedConnection> {
            self.connections_path.as_deref().map(connections::load).unwrap_or_default()
        }

        /// A connection the client sent back, with the hidden password of a saved one's
        /// connection string put back.
        fn restore(&self, mut connection: SavedConnection, saved: &[SavedConnection]) -> SavedConnection {
            if let Some(original) = saved
                .iter()
                .find(|saved| saved.id == connection.id)
                .and_then(|saved| saved.connection_string.clone())
                .filter(|original| connection.connection_string.as_deref() == Some(redact(original).as_str()))
            {
                connection.connection_string = Some(original);
            }
            connection
        }

        fn backend(&self, handle: &str) -> Result<Arc<Backend>> {
            let id = handle.strip_prefix("db").and_then(|id| id.parse::<u64>().ok());
            id.and_then(|id| self.open().1.get(&id).cloned()).ok_or_else(|| anyhow!("The database is no longer open; connect again."))
        }

        pub fn call(&self, call: DatabaseCall) -> Result<Value, String> {
            self.answer(call).map_err(|error| format!("{error:#}"))
        }

        fn answer(&self, call: DatabaseCall) -> Result<Value> {
            use DatabaseCall::*;
            match call {
                Connections => json(self.saved().into_iter().map(hidden).collect::<Vec<_>>()),
                SaveConnections { connections } => {
                    let path = self.connections_path.as_deref().ok_or_else(|| anyhow!("The server keeps no saved connections."))?;
                    let saved = self.saved();
                    let connections: Vec<_> = connections.into_iter().map(|connection| self.restore(connection, &saved)).collect();
                    connections::save(path, &connections)?;
                    json(())
                }
                StorePassword { id, password } => json(connections::store_password(&id, &password)?),
                DeletePassword { id } => json(connections::delete_password(&id)),
                LoadHistory { key } => json(self.history_path.as_deref().map(|path| history::load(path, &key)).unwrap_or_default()),
                SaveHistory { key, history } => {
                    if let Some(path) = &self.history_path {
                        history::save(path, &key, &history);
                    }
                    json(())
                }
                Test { connection, password } => {
                    let connection = self.restore(connection, &self.saved());
                    let password = resolve_password(&connection, password);
                    json(Backend::test(&connection, password)?)
                }
                Open { connection, password } => {
                    let connection = self.restore(connection, &self.saved());
                    let password = resolve_password(&connection, password);
                    let backend = Arc::new(Backend::open(&connection, password)?);
                    let (id, oldest) = {
                        let mut open = self.open();
                        open.0 += 1;
                        let id = open.0;
                        open.1.insert(id, backend);
                        (id, if open.1.len() > MAX_OPEN { open.1.pop_first().map(|(_, backend)| backend) } else { None })
                    };
                    if let Some(oldest) = oldest {
                        oldest.close();
                    }
                    json(format!("db{id}"))
                }
                Close { handle } => {
                    let id = handle.strip_prefix("db").and_then(|id| id.parse::<u64>().ok());
                    if let Some(backend) = id.and_then(|id| self.open().1.remove(&id)) {
                        backend.close();
                    }
                    json(())
                }
                Objects { handle } => json(self.backend(&handle)?.objects()?),
                Columns { handle, table } => json(self.backend(&handle)?.columns(&table)?),
                ForeignKeys { handle, table } => json(self.backend(&handle)?.foreign_keys(&table)?),
                Info { handle, object_count } => json(self.backend(&handle)?.info(object_count)?),
                Page { handle, request } => json(self.backend(&handle)?.page(&request)?),
                Run { handle, sql } => json(self.backend(&handle)?.run(&sql)?),
                Insert { handle, table, columns, values } => json(self.backend(&handle)?.insert(&table, &columns, &values)?),
                Update { handle, table, columns, values, identity } => {
                    json(self.backend(&handle)?.update(&table, &columns, &values, &identity)?)
                }
                Delete { handle, table, identity } => json(self.backend(&handle)?.delete(&table, &identity)?),
                MongoDatabases { handle } => json(self.backend(&handle)?.mongo_databases()?),
                MongoCollections { handle, database } => json(self.backend(&handle)?.mongo_collections(&database)?),
                MongoDocuments { handle, database, collection, filter, sort, page, page_size } => {
                    json(self.backend(&handle)?.mongo_documents(&database, &collection, &filter, &sort, page, page_size)?)
                }
                MongoDelete { handle, database, collection, filter } => {
                    json(self.backend(&handle)?.mongo_delete(&database, &collection, &filter)?)
                }
                RedisScan { handle, pattern, cursor } => json(self.backend(&handle)?.redis_scan(&pattern, &cursor)?),
                RedisValue { handle, key } => json(self.backend(&handle)?.redis_value(&key)?),
                RedisDelete { handle, key } => json(self.backend(&handle)?.redis_delete(&key)?),
                RedisInfo { handle } => json(self.backend(&handle)?.redis_info()?),
                SubscriptionInfo { handle, name } => json(self.backend(&handle)?.subscription_info(&name)?),
                SubscriptionStatus { handle, name } => json(self.backend(&handle)?.subscription_status(&name)?),
                CreateSubscription { handle, draft } => json(self.backend(&handle)?.create_subscription(&draft)?),
                DropSubscription { handle, name } => json(self.backend(&handle)?.drop_subscription(&name)?),
                SetSubscriptionEnabled { handle, name, enabled } => json(self.backend(&handle)?.set_subscription_enabled(&name, enabled)?),
                RefreshSubscription { handle, name } => json(self.backend(&handle)?.refresh_subscription(&name)?),
            }
        }
    }

    impl Drop for Host {
        fn drop(&mut self) {
            for backend in std::mem::take(&mut self.open().1).into_values() {
                backend.close();
            }
        }
    }
}
