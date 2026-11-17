//! The SQL a row edit runs, shown before it is applied and run by the SQLite engine.

use anyhow::{Result, anyhow};
use serde_json::Value;

#[cfg(target_family = "wasm")]
use crate::athas_database;
use crate::model::RowIdentity;
use athas_database::sql_common::{build_row_identity_where_clause, escape_identifier};

pub fn insert_sql(table: &str, columns: &[String]) -> String {
    if columns.is_empty() {
        return format!("INSERT INTO {} DEFAULT VALUES", escape_identifier(table));
    }
    let names: Vec<String> = columns.iter().map(|column| escape_identifier(column)).collect();
    format!(
        "INSERT INTO {} ({}) VALUES ({})",
        escape_identifier(table),
        names.join(", "),
        vec!["?"; columns.len()].join(", ")
    )
}

pub fn update_sql(table: &str, columns: &[String], identity: &RowIdentity) -> Result<(String, Vec<Value>)> {
    let set: Vec<String> = columns.iter().map(|column| format!("{} = ?", escape_identifier(column))).collect();
    let mut placeholder = 0;
    let (where_clause, where_values) =
        build_row_identity_where_clause(&identity.to_athas(), escape_identifier, |_| "?".to_string(), &mut placeholder)
            .map_err(|error| anyhow!(error))?;
    Ok((format!("UPDATE {} SET {} {}", escape_identifier(table), set.join(", "), where_clause), where_values))
}

pub fn delete_sql(table: &str, identity: &RowIdentity) -> Result<(String, Vec<Value>)> {
    let mut placeholder = 0;
    let (where_clause, where_values) =
        build_row_identity_where_clause(&identity.to_athas(), escape_identifier, |_| "?".to_string(), &mut placeholder)
            .map_err(|error| anyhow!(error))?;
    Ok((format!("DELETE FROM {} {}", escape_identifier(table), where_clause), where_values))
}
