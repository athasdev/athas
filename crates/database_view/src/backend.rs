//! One open database, whatever its engine. Every method blocks, so the view calls them from
//! background tasks only.

#[cfg(not(target_family = "wasm"))]
use std::path::{Path, PathBuf};

#[cfg(not(target_family = "wasm"))]
use anyhow::{Result, anyhow};
#[cfg(not(target_family = "wasm"))]
use serde_json::Value;

#[cfg(target_family = "wasm")]
pub use crate::relay::RemoteBackend as Backend;
#[cfg(not(target_family = "wasm"))]
use crate::{
    connections::SavedConnection,
    model::{Column, DbInfo, DbObject, ForeignKey, Page, PageRequest, Provider, QueryOutcome, RowIdentity},
    sqlite,
};

#[cfg(not(target_family = "wasm"))]
pub enum Backend {
    Sqlite(PathBuf),
    #[cfg(feature = "duckdb")]
    Duckdb(PathBuf),
    #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
    Network { id: String, provider: Provider },
}

/// Only SQLite can undo a change that reached identical rows (`sqlite::one_row`); elsewhere a
/// row without a primary key is not changed from the grid, since every identical row would be.
#[cfg(not(target_family = "wasm"))]
fn refuse_ambiguous(backend: &Backend, identity: &RowIdentity) -> Result<()> {
    if identity.unique || matches!(backend, Backend::Sqlite(_)) {
        return Ok(());
    }
    anyhow::bail!("This table has no primary key, so Athas can't tell this row from identical ones. Change it with SQL instead.")
}

#[cfg(not(target_family = "wasm"))]
impl Backend {
    /// Opens `connection`, connecting network databases with `password`.
    pub fn open(connection: &SavedConnection, password: Option<String>) -> Result<Backend> {
        let provider = connection.provider;
        if !provider.is_available() {
            return Err(anyhow!("{} is not available in this build", provider.label()));
        }
        match provider {
            Provider::Sqlite => {
                let path = PathBuf::from(&connection.file_path);
                sqlite::open(&path)?;
                Ok(Backend::Sqlite(path))
            }
            #[cfg(feature = "duckdb")]
            Provider::Duckdb => {
                let path = PathBuf::from(&connection.file_path);
                if !path.is_file() {
                    return Err(anyhow!("{} does not exist", path.display()));
                }
                Ok(Backend::Duckdb(path))
            }
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Provider::Postgres | Provider::Mysql | Provider::Mongodb | Provider::Redis => {
                network::connect(connection, password)?;
                *open_pools().entry(connection.id.clone()).or_insert(0) += 1;
                Ok(Backend::Network { id: connection.id.clone(), provider })
            }
            _ => {
                let _ = password;
                Err(anyhow!("{} is not available in this build", provider.label()))
            }
        }
    }

    /// Checks that `connection` opens, without keeping it.
    pub fn test(connection: &SavedConnection, password: Option<String>) -> Result<()> {
        match connection.provider {
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Provider::Postgres | Provider::Mysql | Provider::Mongodb | Provider::Redis => network::test(connection, password),
            _ => Backend::open(connection, password).map(drop),
        }
    }

    pub fn provider(&self) -> Provider {
        match self {
            Backend::Sqlite(_) => Provider::Sqlite,
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(_) => Provider::Duckdb,
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { provider, .. } => *provider,
        }
    }

    pub fn file_path(&self) -> Option<&Path> {
        match self {
            Backend::Sqlite(path) => Some(path),
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(path) => Some(path),
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { .. } => None,
        }
    }

    /// The pool a network connection keeps in the shared manager.
    pub fn network_id(&self) -> Option<&str> {
        match self {
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { id, .. } => Some(id),
            _ => None,
        }
    }

    pub fn objects(&self) -> Result<Vec<DbObject>> {
        match self {
            Backend::Sqlite(path) => sqlite::objects(&sqlite::open(path)?),
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(path) => duckdb::objects(path),
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { id, provider } => network::objects(id, *provider),
        }
    }

    pub fn columns(&self, table: &str) -> Result<Vec<Column>> {
        match self {
            Backend::Sqlite(path) => sqlite::columns(&sqlite::open(path)?, table),
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(path) => duckdb::columns(path, table),
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { id, provider } => network::columns(id, *provider, table),
        }
    }

    pub fn foreign_keys(&self, table: &str) -> Result<Vec<ForeignKey>> {
        match self {
            Backend::Sqlite(path) => sqlite::foreign_keys(&sqlite::open(path)?, table),
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(path) => duckdb::foreign_keys(path, table),
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { id, provider } => network::foreign_keys(id, *provider, table),
        }
    }

    pub fn info(&self, object_count: usize) -> Result<DbInfo> {
        match self {
            Backend::Sqlite(path) => sqlite::info(&sqlite::open(path)?, path),
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(path) => Ok(DbInfo {
                version: "DuckDB".into(),
                size_bytes: std::fs::metadata(path).ok().map(|metadata| metadata.len()),
                tables: object_count,
                indexes: 0,
            }),
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { provider, .. } => {
                Ok(DbInfo { version: provider.label().into(), size_bytes: None, tables: object_count, indexes: 0 })
            }
        }
    }

    pub fn page(&self, request: &PageRequest) -> Result<Page> {
        match self {
            Backend::Sqlite(path) => sqlite::page(&sqlite::open(path)?, request),
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(path) => duckdb::page(path, request),
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { id, provider } => network::page(id, *provider, request),
        }
    }

    pub fn run(&self, sql: &str) -> Result<QueryOutcome> {
        match self {
            Backend::Sqlite(path) => sqlite::run(&sqlite::open(path)?, sql),
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(path) => duckdb::run(path, sql),
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { id, provider } => network::run(id, *provider, sql),
        }
    }

    pub fn insert(&self, table: &str, columns: &[String], values: &[Value]) -> Result<u64> {
        match self {
            Backend::Sqlite(path) => sqlite::insert(&sqlite::open(path)?, table, columns, values),
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(path) => duckdb::insert(path, table, columns, values),
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { id, provider } => network::insert(id, *provider, table, columns, values),
        }
    }

    pub fn update(&self, table: &str, columns: &[String], values: &[Value], identity: &RowIdentity) -> Result<u64> {
        refuse_ambiguous(self, identity)?;
        match self {
            Backend::Sqlite(path) => sqlite::update(&sqlite::open(path)?, table, columns, values, identity),
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(path) => duckdb::update(path, table, columns, values, identity),
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { id, provider } => network::update(id, *provider, table, columns, values, identity),
        }
    }

    pub fn delete(&self, table: &str, identity: &RowIdentity) -> Result<u64> {
        refuse_ambiguous(self, identity)?;
        match self {
            Backend::Sqlite(path) => sqlite::delete(&sqlite::open(path)?, table, identity),
            #[cfg(feature = "duckdb")]
            Backend::Duckdb(path) => duckdb::delete(path, table, identity),
            #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
            Backend::Network { id, provider } => network::delete(id, *provider, table, identity),
        }
    }

    /// Closes the network pool behind it.
    pub fn close(&self) {
        #[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
        if let Backend::Network { id, .. } = self {
            // The pool is kept by connection id and shared by every view of that connection:
            // it closes with the last of them.
            let last = {
                let mut pools = open_pools();
                let count = pools.entry(id.clone()).or_insert(1);
                *count = count.saturating_sub(1);
                let last = *count == 0;
                if last {
                    pools.remove(id);
                }
                last
            };
            if last {
                network::disconnect(id);
            }
        }
    }
}

/// How many open backends use each network connection's pool.
#[cfg(all(not(target_family = "wasm"), any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis")))]
fn open_pools() -> std::sync::MutexGuard<'static, std::collections::HashMap<String, usize>> {
    static MAP: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, usize>>> = std::sync::OnceLock::new();
    MAP.get_or_init(Default::default).lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Whether a statement hands rows back, so the network engines fetch instead of execute.
pub fn returns_rows(sql: &str) -> bool {
    let first = strip_leading_comments(sql)
        .split(|c: char| c.is_whitespace() || c == '(' || c == ';')
        .find(|word| !word.is_empty())
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(
        first.as_str(),
        "SELECT" | "WITH" | "SHOW" | "EXPLAIN" | "PRAGMA" | "VALUES" | "DESCRIBE" | "DESC" | "TABLE" | "FROM"
    ) || sql.to_ascii_uppercase().contains(" RETURNING ")
}

pub fn strip_leading_comments(sql: &str) -> &str {
    let mut rest = sql.trim_start();
    loop {
        if rest.starts_with("--") || rest.starts_with('#') {
            match rest.find('\n') {
                Some(end) => rest = rest[end + 1..].trim_start(),
                None => return "",
            }
        } else if rest.starts_with("/*") {
            match rest[2..].find("*/") {
                Some(end) => rest = rest[end + 4..].trim_start(),
                None => return rest,
            }
        } else {
            return rest;
        }
    }
}

#[cfg(not(target_family = "wasm"))]
fn convert_objects(tables: Vec<athas_database::sql_common::TableInfo>) -> Vec<DbObject> {
    tables
        .into_iter()
        .map(|table| DbObject {
            name: table.name,
            kind: crate::model::ObjectKind::parse(&table.kind),
            owner: table.table_name,
        })
        .collect()
}

#[cfg(not(target_family = "wasm"))]
fn convert_columns(columns: Vec<athas_database::sql_common::ColumnInfo>) -> Vec<Column> {
    columns
        .into_iter()
        .map(|column| Column {
            name: column.name,
            ty: column.r#type,
            notnull: column.notnull,
            default_value: column.default_value,
            primary_key: column.primary_key,
        })
        .collect()
}

#[cfg(not(target_family = "wasm"))]
fn convert_foreign_keys(keys: Vec<athas_database::sql_common::ForeignKeyInfo>) -> Vec<ForeignKey> {
    keys.into_iter()
        .map(|key| ForeignKey { from_column: key.from_column, to_table: key.to_table, to_column: key.to_column })
        .collect()
}

#[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis", feature = "duckdb"))]
fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("athas-database")
            .enable_all()
            .build()
            .expect("the database runtime starts")
    })
}

#[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis", feature = "duckdb"))]
pub(crate) fn block_on<T>(future: impl std::future::Future<Output = std::result::Result<T, String>>) -> Result<T> {
    runtime().block_on(future).map_err(|error| anyhow!(error))
}

#[cfg(any(feature = "postgres", feature = "mysql", feature = "mongodb", feature = "redis"))]
pub(crate) mod network {
    use std::{sync::LazyLock, time::Instant};

    use anyhow::{Result, anyhow};
    use athas_database::{ConnectionConfig, ConnectionManager};
    use serde_json::Value;

    use super::{block_on, convert_columns, convert_foreign_keys, convert_objects, returns_rows};
    use crate::{
        connections::SavedConnection,
        model::{Column, DbObject, ForeignKey, MAX_QUERY_ROWS, Page, PageRequest, Provider, QueryOutcome, ResultSet, RowIdentity},
    };

    pub(crate) static MANAGER: LazyLock<ConnectionManager> = LazyLock::new(ConnectionManager::new);

    fn config(connection: &SavedConnection) -> ConnectionConfig {
        ConnectionConfig {
            id: connection.id.clone(),
            name: connection.name.clone(),
            db_type: connection.provider.id().to_string(),
            host: connection.host.clone(),
            port: connection.port,
            database: connection.database.clone(),
            username: connection.username.clone(),
            connection_string: connection
                .connection_string
                .clone()
                .filter(|string| !string.trim().is_empty())
                .or_else(|| crate::nosql::mongo_url(connection)),
        }
    }

    pub fn connect(connection: &SavedConnection, password: Option<String>) -> Result<()> {
        block_on(athas_database::connect_database(config(connection), password, &MANAGER)).map(drop)
    }

    pub fn test(connection: &SavedConnection, password: Option<String>) -> Result<()> {
        block_on(athas_database::test_connection(config(connection), password)).map(drop)
    }

    pub fn disconnect(id: &str) {
        block_on(athas_database::disconnect_database(id.to_string(), &MANAGER)).ok();
    }

    fn unsupported(provider: Provider) -> anyhow::Error {
        anyhow!("{} is not available in this build", provider.label())
    }

    pub fn objects(id: &str, provider: Provider) -> Result<Vec<DbObject>> {
        let id = id.to_string();
        let tables = match provider {
            #[cfg(feature = "postgres")]
            Provider::Postgres => block_on(athas_database::providers::get_postgres_tables(id, &MANAGER))?,
            #[cfg(feature = "mysql")]
            Provider::Mysql => block_on(athas_database::providers::get_mysql_tables(id, &MANAGER))?,
            _ => return Err(unsupported(provider)),
        };
        Ok(convert_objects(tables))
    }

    pub fn columns(id: &str, provider: Provider, table: &str) -> Result<Vec<Column>> {
        let (id, table) = (id.to_string(), table.to_string());
        let columns = match provider {
            #[cfg(feature = "postgres")]
            Provider::Postgres => block_on(athas_database::providers::get_postgres_table_schema(id, table, &MANAGER))?,
            #[cfg(feature = "mysql")]
            Provider::Mysql => block_on(athas_database::providers::get_mysql_table_schema(id, table, &MANAGER))?,
            _ => return Err(unsupported(provider)),
        };
        Ok(convert_columns(columns))
    }

    pub fn foreign_keys(id: &str, provider: Provider, table: &str) -> Result<Vec<ForeignKey>> {
        let (id, table) = (id.to_string(), table.to_string());
        let keys = match provider {
            #[cfg(feature = "postgres")]
            Provider::Postgres => block_on(athas_database::providers::get_postgres_foreign_keys(id, table, &MANAGER))?,
            #[cfg(feature = "mysql")]
            Provider::Mysql => block_on(athas_database::providers::get_mysql_foreign_keys(id, table, &MANAGER))?,
            _ => return Err(unsupported(provider)),
        };
        Ok(convert_foreign_keys(keys))
    }

    pub fn page(id: &str, provider: Provider, request: &PageRequest) -> Result<Page> {
        let (id, params) = (id.to_string(), request.to_params());
        let page = match provider {
            #[cfg(feature = "postgres")]
            Provider::Postgres => block_on(athas_database::providers::query_postgres_filtered(id, params, &MANAGER))?,
            #[cfg(feature = "mysql")]
            Provider::Mysql => block_on(athas_database::providers::query_mysql_filtered(id, params, &MANAGER))?,
            _ => return Err(unsupported(provider)),
        };
        Ok(Page { result: ResultSet { columns: page.columns, rows: page.rows }, total: page.total_count.max(0) as u64 })
    }

    pub fn run(id: &str, provider: Provider, sql: &str) -> Result<QueryOutcome> {
        let started = Instant::now();
        let (id, sql) = (id.to_string(), sql.to_string());
        if returns_rows(&sql) {
            let result = match provider {
                #[cfg(feature = "postgres")]
                Provider::Postgres => block_on(athas_database::providers::query_postgres(id, sql, &MANAGER))?,
                #[cfg(feature = "mysql")]
                Provider::Mysql => block_on(athas_database::providers::query_mysql(id, sql, &MANAGER))?,
                _ => return Err(unsupported(provider)),
            };
            let mut rows = result.rows;
            let truncated = rows.len() > MAX_QUERY_ROWS;
            rows.truncate(MAX_QUERY_ROWS);
            return Ok(QueryOutcome {
                result: ResultSet { columns: result.columns, rows },
                affected: None,
                truncated,
                elapsed: started.elapsed(),
            });
        }
        let affected = match provider {
            #[cfg(feature = "postgres")]
            Provider::Postgres => block_on(athas_database::providers::execute_postgres(id, sql, &MANAGER))?,
            #[cfg(feature = "mysql")]
            Provider::Mysql => block_on(athas_database::providers::execute_mysql(id, sql, &MANAGER))?,
            _ => return Err(unsupported(provider)),
        };
        Ok(QueryOutcome {
            result: ResultSet::default(),
            affected: Some(affected.max(0) as u64),
            truncated: false,
            elapsed: started.elapsed(),
        })
    }

    pub fn insert(id: &str, provider: Provider, table: &str, columns: &[String], values: &[Value]) -> Result<u64> {
        let (id, table, columns, values) = (id.to_string(), table.to_string(), columns.to_vec(), values.to_vec());
        let affected = match provider {
            #[cfg(feature = "postgres")]
            Provider::Postgres => {
                block_on(athas_database::providers::insert_postgres_row(id, table, columns, values, &MANAGER))?
            }
            #[cfg(feature = "mysql")]
            Provider::Mysql => block_on(athas_database::providers::insert_mysql_row(id, table, columns, values, &MANAGER))?,
            _ => return Err(unsupported(provider)),
        };
        Ok(affected.max(0) as u64)
    }

    pub fn update(
        id: &str,
        provider: Provider,
        table: &str,
        columns: &[String],
        values: &[Value],
        identity: &RowIdentity,
    ) -> Result<u64> {
        let (id, table, columns, values, identity) =
            (id.to_string(), table.to_string(), columns.to_vec(), values.to_vec(), identity.to_athas());
        let affected = match provider {
            #[cfg(feature = "postgres")]
            Provider::Postgres => block_on(athas_database::providers::update_postgres_row_by_values(
                id, table, columns, values, identity, &MANAGER,
            ))?,
            #[cfg(feature = "mysql")]
            Provider::Mysql => block_on(athas_database::providers::update_mysql_row_by_values(
                id, table, columns, values, identity, &MANAGER,
            ))?,
            _ => return Err(unsupported(provider)),
        };
        Ok(affected.max(0) as u64)
    }

    pub fn delete(id: &str, provider: Provider, table: &str, identity: &RowIdentity) -> Result<u64> {
        let (id, table, identity) = (id.to_string(), table.to_string(), identity.to_athas());
        let affected = match provider {
            #[cfg(feature = "postgres")]
            Provider::Postgres => {
                block_on(athas_database::providers::delete_postgres_row_by_values(id, table, identity, &MANAGER))?
            }
            #[cfg(feature = "mysql")]
            Provider::Mysql => block_on(athas_database::providers::delete_mysql_row_by_values(id, table, identity, &MANAGER))?,
            _ => return Err(unsupported(provider)),
        };
        Ok(affected.max(0) as u64)
    }
}

#[cfg(feature = "duckdb")]
mod duckdb {
    use std::{path::Path, time::Instant};

    use anyhow::Result;
    use athas_database::sql_common::{RowIdentity as AthasIdentity, escape_identifier};
    use serde_json::Value;

    use super::{block_on, convert_foreign_keys, convert_objects, returns_rows};
    use crate::model::{
        Column, DbObject, ForeignKey, MAX_QUERY_ROWS, Page, PageRequest, QueryOutcome, ResultSet, RowIdentity,
    };

    fn path(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    pub fn objects(file: &Path) -> Result<Vec<DbObject>> {
        Ok(convert_objects(block_on(athas_database::providers::get_duckdb_tables(path(file)))?))
    }

    pub fn columns(file: &Path, table: &str) -> Result<Vec<Column>> {
        let result =
            block_on(athas_database::providers::query_duckdb(path(file), format!("PRAGMA table_info({})", escape_identifier(table))))?;
        Ok(result
            .rows
            .into_iter()
            .map(|row| Column {
                name: row.get(1).and_then(Value::as_str).unwrap_or_default().to_string(),
                ty: row.get(2).and_then(Value::as_str).unwrap_or_default().to_string(),
                notnull: row.get(3).and_then(Value::as_bool).unwrap_or(false),
                default_value: row.get(4).and_then(Value::as_str).map(str::to_string),
                primary_key: row.get(5).and_then(Value::as_bool).unwrap_or(false),
            })
            .collect())
    }

    pub fn foreign_keys(file: &Path, table: &str) -> Result<Vec<ForeignKey>> {
        Ok(convert_foreign_keys(block_on(athas_database::providers::get_duckdb_foreign_keys(path(file), table.to_string()))?))
    }

    pub fn page(file: &Path, request: &PageRequest) -> Result<Page> {
        let page = block_on(athas_database::providers::query_duckdb_filtered(path(file), request.to_params()))?;
        Ok(Page { result: ResultSet { columns: page.columns, rows: page.rows }, total: page.total_count.max(0) as u64 })
    }

    pub fn run(file: &Path, sql: &str) -> Result<QueryOutcome> {
        let started = Instant::now();
        if returns_rows(sql) {
            let result = block_on(athas_database::providers::query_duckdb(path(file), sql.to_string()))?;
            let mut rows = result.rows;
            let truncated = rows.len() > MAX_QUERY_ROWS;
            rows.truncate(MAX_QUERY_ROWS);
            return Ok(QueryOutcome {
                result: ResultSet { columns: result.columns, rows },
                affected: None,
                truncated,
                elapsed: started.elapsed(),
            });
        }
        let affected = block_on(athas_database::providers::execute_duckdb(path(file), sql.to_string()))?;
        Ok(QueryOutcome {
            result: ResultSet::default(),
            affected: Some(affected.max(0) as u64),
            truncated: false,
            elapsed: started.elapsed(),
        })
    }

    pub fn insert(file: &Path, table: &str, columns: &[String], values: &[Value]) -> Result<u64> {
        let rows = block_on(athas_database::providers::insert_duckdb_row(
            path(file),
            table.to_string(),
            columns.to_vec(),
            values.to_vec(),
        ))?;
        Ok(rows.max(0) as u64)
    }

    fn identity(identity: &RowIdentity) -> AthasIdentity {
        identity.to_athas()
    }

    pub fn update(file: &Path, table: &str, columns: &[String], values: &[Value], row: &RowIdentity) -> Result<u64> {
        let rows = block_on(athas_database::providers::update_duckdb_row_by_values(
            path(file),
            table.to_string(),
            columns.to_vec(),
            values.to_vec(),
            identity(row),
        ))?;
        Ok(rows.max(0) as u64)
    }

    pub fn delete(file: &Path, table: &str, row: &RowIdentity) -> Result<u64> {
        let rows =
            block_on(athas_database::providers::delete_duckdb_row_by_values(path(file), table.to_string(), identity(row)))?;
        Ok(rows.max(0) as u64)
    }
}
