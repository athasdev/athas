//! SQLite files, read and changed in place (`providers/sqlite.rs` of the old app, plus the schema
//! and info queries its store ran through `query_sqlite`).

use std::{path::Path, time::Instant};

use anyhow::{Context as _, Result, anyhow};
use athas_database::sql_common::{build_where_clause_generic, escape_identifier};
use rusqlite::{Connection, OpenFlags, types::ValueRef};
use serde_json::Value;

pub use crate::statements::{delete_sql, insert_sql, update_sql};
use crate::model::{
    Column, DbInfo, DbObject, ForeignKey, MAX_QUERY_ROWS, ObjectKind, Page, PageRequest, QueryOutcome, ResultSet,
    RowIdentity,
};

/// Opens an existing database file; SQLite would otherwise create an empty one at a mistyped path.
pub fn open(path: &Path) -> Result<Connection> {
    if !path.is_file() {
        return Err(anyhow!("{} does not exist", path.display()));
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .or_else(|_| Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX))
    .with_context(|| format!("Failed to open {}", path.display()))?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(connection)
}

pub fn objects(connection: &Connection) -> Result<Vec<DbObject>> {
    let mut statement = connection.prepare(
        "SELECT name, type, CASE WHEN type = 'index' THEN tbl_name ELSE NULL END \
         FROM sqlite_master WHERE type IN ('table', 'view', 'index') AND name NOT LIKE 'sqlite_%' \
         ORDER BY type, name COLLATE NOCASE",
    )?;
    let rows = statement.query_map([], |row| {
        let kind: String = row.get(1)?;
        Ok(DbObject { name: row.get(0)?, kind: ObjectKind::parse(&kind), owner: row.get(2)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn columns(connection: &Connection, table: &str) -> Result<Vec<Column>> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({})", escape_identifier(table)))?;
    let rows = statement.query_map([], |row| {
        Ok(Column {
            name: row.get(1)?,
            ty: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            notnull: row.get::<_, i64>(3)? != 0,
            default_value: row.get::<_, Option<String>>(4)?,
            primary_key: row.get::<_, i64>(5)? != 0,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn foreign_keys(connection: &Connection, table: &str) -> Result<Vec<ForeignKey>> {
    let mut statement = connection.prepare(&format!("PRAGMA foreign_key_list({})", escape_identifier(table)))?;
    let rows = statement.query_map([], |row| {
        Ok(ForeignKey { from_column: row.get(3)?, to_table: row.get(2)?, to_column: row.get(4)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn info(connection: &Connection, path: &Path) -> Result<DbInfo> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let sqlite: String = connection.query_row("SELECT sqlite_version()", [], |row| row.get(0))?;
    let tables: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    let indexes: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    Ok(DbInfo {
        version: format!("SQLite {sqlite} · user_version {version}"),
        size_bytes: std::fs::metadata(path).ok().map(|metadata| metadata.len()),
        tables: tables as usize,
        indexes: indexes as usize,
    })
}

fn value(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(int) => Value::from(int),
        ValueRef::Real(real) => {
            serde_json::Number::from_f64(real).map(Value::Number).unwrap_or_else(|| Value::String(real.to_string()))
        }
        ValueRef::Text(text) => match std::str::from_utf8(text) {
            Ok(text) => Value::String(text.to_string()),
            Err(_) => Value::String(format!("<binary data: {} bytes>", text.len())),
        },
        ValueRef::Blob(blob) => Value::String(format!("<binary data: {} bytes>", blob.len())),
    }
}

fn to_sql(value: &Value) -> rusqlite::types::Value {
    match value {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(flag) => rusqlite::types::Value::Integer(i64::from(*flag)),
        Value::Number(number) => match number.as_i64() {
            Some(int) => rusqlite::types::Value::Integer(int),
            None => rusqlite::types::Value::Real(number.as_f64().unwrap_or_default()),
        },
        Value::String(text) => rusqlite::types::Value::Text(text.clone()),
        other => rusqlite::types::Value::Text(other.to_string()),
    }
}

/// Runs a prepared statement and reads up to `limit` rows.
fn read_rows(
    statement: &mut rusqlite::Statement<'_>,
    params: &[rusqlite::types::Value],
    limit: usize,
) -> Result<(ResultSet, bool)> {
    let columns: Vec<String> = statement.column_names().into_iter().map(str::to_string).collect();
    let count = columns.len();
    let mut rows = statement.query(rusqlite::params_from_iter(params.iter()))?;
    let mut result = Vec::new();
    let mut truncated = false;
    while let Some(row) = rows.next()? {
        if result.len() == limit {
            truncated = true;
            break;
        }
        result.push((0..count).map(|ix| row.get_ref(ix).map(value)).collect::<rusqlite::Result<Vec<_>>>()?);
    }
    Ok((ResultSet { columns, rows: result }, truncated))
}

pub fn page(connection: &Connection, request: &PageRequest) -> Result<Page> {
    let params = request.to_params();
    let table = escape_identifier(&request.table);
    let mut placeholder = 0;
    let (where_clause, where_params) = build_where_clause_generic(
        &params.filters,
        &params.search_term,
        &params.search_columns,
        "AND",
        escape_identifier,
        |_| "?".to_string(),
        &mut placeholder,
    );
    let where_params: Vec<rusqlite::types::Value> =
        where_params.into_iter().map(rusqlite::types::Value::Text).collect();

    let total: i64 = connection.query_row(
        &format!("SELECT COUNT(*) FROM {table} {where_clause}"),
        rusqlite::params_from_iter(where_params.iter()),
        |row| row.get(0),
    )?;

    let order = match &params.sort_column {
        Some(column) => format!("ORDER BY {} {}", escape_identifier(column), params.sort_direction),
        None => String::new(),
    };
    let mut data_params = where_params;
    data_params.push(rusqlite::types::Value::Integer(request.page_size.max(1) as i64));
    data_params.push(rusqlite::types::Value::Integer(request.offset as i64));
    let mut statement = connection.prepare(&format!("SELECT * FROM {table} {where_clause} {order} LIMIT ? OFFSET ?"))?;
    let (result, _) = read_rows(&mut statement, &data_params, usize::MAX)?;
    Ok(Page { result, total: total.max(0) as u64 })
}

fn total_changes(connection: &Connection) -> u64 {
    connection.query_row("SELECT total_changes()", [], |row| row.get::<_, i64>(0)).unwrap_or(0).max(0) as u64
}

/// Runs what the query editor holds, one statement after another. The last statement that returns
/// rows gives the result; a script that returns none reports the rows it changed.
pub fn run(connection: &Connection, sql: &str) -> Result<QueryOutcome> {
    let started = Instant::now();
    let before = total_changes(connection);
    let mut batch = rusqlite::Batch::new(connection, sql);
    let mut rows = None;
    while let Some(mut statement) = batch.next()? {
        if statement.column_count() > 0 {
            rows = Some(read_rows(&mut statement, &[], MAX_QUERY_ROWS)?);
        } else {
            statement.raw_execute()?;
        }
    }
    Ok(match rows {
        Some((result, truncated)) => QueryOutcome { result, affected: None, truncated, elapsed: started.elapsed() },
        None => QueryOutcome {
            result: ResultSet::default(),
            affected: Some(total_changes(connection) - before),
            truncated: false,
            elapsed: started.elapsed(),
        },
    })
}

pub fn insert(connection: &Connection, table: &str, columns: &[String], values: &[Value]) -> Result<u64> {
    let sql = insert_sql(table, columns);
    let values: Vec<_> = values.iter().map(to_sql).collect();
    Ok(connection.execute(&sql, rusqlite::params_from_iter(values.iter()))? as u64)
}

pub fn update(
    connection: &Connection,
    table: &str,
    columns: &[String],
    values: &[Value],
    identity: &RowIdentity,
) -> Result<u64> {
    let (sql, where_values) = update_sql(table, columns, identity)?;
    let params: Vec<_> = values.iter().chain(where_values.iter()).map(to_sql).collect();
    one_row(connection, identity, |connection| Ok(connection.execute(&sql, rusqlite::params_from_iter(params.iter()))? as u64))
}

/// Runs a change keyed by `identity`; without a primary key it is undone when it reached more
/// than one row (identical rows), instead of changing or deleting all of them.
fn one_row(connection: &Connection, identity: &RowIdentity, change: impl FnOnce(&Connection) -> Result<u64>) -> Result<u64> {
    if identity.unique {
        return change(connection);
    }
    let transaction = connection.unchecked_transaction()?;
    let affected = change(&transaction)?;
    if affected > 1 {
        transaction.rollback()?;
        anyhow::bail!("{affected} identical rows match and the table has no primary key, so nothing was changed. Change it with SQL (for example by rowid).");
    }
    transaction.commit()?;
    Ok(affected)
}

pub fn delete(connection: &Connection, table: &str, identity: &RowIdentity) -> Result<u64> {
    let (sql, where_values) = delete_sql(table, identity)?;
    let params: Vec<_> = where_values.iter().map(to_sql).collect();
    one_row(connection, identity, |connection| Ok(connection.execute(&sql, rusqlite::params_from_iter(params.iter()))? as u64))
}
