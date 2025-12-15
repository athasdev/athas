use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct TableInfo {
   name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
   columns: Vec<String>,
   rows: Vec<Vec<serde_json::Value>>,
}

/// Get all table names from a SQLite database
#[command]
pub async fn get_sqlite_tables(path: String) -> Result<Vec<TableInfo>, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

   let mut stmt = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let table_iter = stmt
      .query_map([], |row| Ok(TableInfo { name: row.get(0)? }))
      .map_err(|e| format!("Failed to execute query: {}", e))?;

   let mut tables = Vec::new();
   for table in table_iter {
      match table {
         Ok(table_info) => tables.push(table_info),
         Err(e) => return Err(format!("Error reading table: {}", e)),
      }
   }

   Ok(tables)
}

/// Execute a SQL statement that doesn't return data (INSERT, UPDATE, DELETE, CREATE TABLE)
#[command]
pub async fn execute_sqlite(path: String, statement: String) -> Result<i64, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

   let result = conn
      .execute(&statement, [])
      .map_err(|e| format!("Failed to execute statement: {}", e))?;

   Ok(result as i64)
}

/// Insert a new row into a table
#[command]
pub async fn insert_sqlite_row(
   path: String,
   table: String,
   columns: Vec<String>,
   values: Vec<serde_json::Value>,
) -> Result<i64, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

   let placeholders = vec!["?"; values.len()].join(", ");
   let column_names = columns.join(", ");
   let sql = format!(
      "INSERT INTO {} ({}) VALUES ({})",
      table, column_names, placeholders
   );

   let mut stmt = conn
      .prepare(&sql)
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let rusqlite_values: Result<Vec<_>, String> = values
      .iter()
      .map(|v| match v {
         serde_json::Value::Null => Ok(rusqlite::types::Value::Null),
         serde_json::Value::Bool(b) => Ok(rusqlite::types::Value::Integer(if *b { 1 } else { 0 })),
         serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
               Ok(rusqlite::types::Value::Integer(i))
            } else if let Some(f) = n.as_f64() {
               Ok(rusqlite::types::Value::Real(f))
            } else {
               Err("Invalid number format".to_string())
            }
         }
         serde_json::Value::String(s) => Ok(rusqlite::types::Value::Text(s.clone())),
         _ => Err("Unsupported value type".to_string()),
      })
      .collect();

   let rusqlite_values = rusqlite_values?;
   let params: Vec<&dyn rusqlite::ToSql> = rusqlite_values
      .iter()
      .map(|v| v as &dyn rusqlite::ToSql)
      .collect();

   stmt
      .execute(&params[..])
      .map_err(|e| format!("Failed to execute insert: {}", e))?;

   Ok(conn.last_insert_rowid())
}

/// Update rows in a table
#[command]
pub async fn update_sqlite_row(
   path: String,
   table: String,
   set_columns: Vec<String>,
   set_values: Vec<serde_json::Value>,
   where_column: String,
   where_value: serde_json::Value,
) -> Result<i64, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

   let set_clause = set_columns
      .iter()
      .map(|col| format!("{} = ?", col))
      .collect::<Vec<_>>()
      .join(", ");
   let sql = format!(
      "UPDATE {} SET {} WHERE {} = ?",
      table, set_clause, where_column
   );

   let mut stmt = conn
      .prepare(&sql)
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let mut all_values = set_values;
   all_values.push(where_value);

   let rusqlite_values: Result<Vec<_>, String> = all_values
      .iter()
      .map(|v| match v {
         serde_json::Value::Null => Ok(rusqlite::types::Value::Null),
         serde_json::Value::Bool(b) => Ok(rusqlite::types::Value::Integer(if *b { 1 } else { 0 })),
         serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
               Ok(rusqlite::types::Value::Integer(i))
            } else if let Some(f) = n.as_f64() {
               Ok(rusqlite::types::Value::Real(f))
            } else {
               Err("Invalid number format".to_string())
            }
         }
         serde_json::Value::String(s) => Ok(rusqlite::types::Value::Text(s.clone())),
         _ => Err("Unsupported value type".to_string()),
      })
      .collect();

   let rusqlite_values = rusqlite_values?;
   let params: Vec<&dyn rusqlite::ToSql> = rusqlite_values
      .iter()
      .map(|v| v as &dyn rusqlite::ToSql)
      .collect();

   let affected = stmt
      .execute(&params[..])
      .map_err(|e| format!("Failed to execute update: {}", e))?;

   Ok(affected as i64)
}

/// Delete rows from a table
#[command]
pub async fn delete_sqlite_row(
   path: String,
   table: String,
   where_column: String,
   where_value: serde_json::Value,
) -> Result<i64, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

   let sql = format!("DELETE FROM {} WHERE {} = ?", table, where_column);

   let mut stmt = conn
      .prepare(&sql)
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let rusqlite_value = match where_value {
      serde_json::Value::Null => rusqlite::types::Value::Null,
      serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(if b { 1 } else { 0 }),
      serde_json::Value::Number(n) => {
         if let Some(i) = n.as_i64() {
            rusqlite::types::Value::Integer(i)
         } else if let Some(f) = n.as_f64() {
            rusqlite::types::Value::Real(f)
         } else {
            return Err("Invalid number format".to_string());
         }
      }
      serde_json::Value::String(s) => rusqlite::types::Value::Text(s),
      _ => return Err("Unsupported value type".to_string()),
   };

   let affected = stmt
      .execute([&rusqlite_value])
      .map_err(|e| format!("Failed to execute delete: {}", e))?;

   Ok(affected as i64)
}

/// Execute a SQL query on a SQLite database
#[command]
pub async fn query_sqlite(path: String, query: String) -> Result<QueryResult, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

   let mut stmt = conn
      .prepare(&query)
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let column_count = stmt.column_count();
   let mut columns = Vec::new();

   for i in 0..column_count {
      columns.push(stmt.column_name(i).unwrap_or("unknown").to_string());
   }

   let rows_iter = stmt
      .query_map([], |row| {
         let mut row_data = Vec::new();
         for i in 0..column_count {
            let value: Result<serde_json::Value, _> = match row.get_ref(i) {
               Ok(value_ref) => match value_ref {
                  rusqlite::types::ValueRef::Null => Ok(serde_json::Value::Null),
                  rusqlite::types::ValueRef::Integer(i) => {
                     Ok(serde_json::Value::Number(serde_json::Number::from(i)))
                  }
                  rusqlite::types::ValueRef::Real(f) => {
                     if let Some(num) = serde_json::Number::from_f64(f) {
                        Ok(serde_json::Value::Number(num))
                     } else {
                        Ok(serde_json::Value::String(f.to_string()))
                     }
                  }
                  rusqlite::types::ValueRef::Text(s) => match std::str::from_utf8(s) {
                     Ok(string_val) => Ok(serde_json::Value::String(string_val.to_string())),
                     Err(_) => Ok(serde_json::Value::String(format!(
                        "<binary data: {} bytes>",
                        s.len()
                     ))),
                  },
                  rusqlite::types::ValueRef::Blob(b) => Ok(serde_json::Value::String(format!(
                     "<binary data: {} bytes>",
                     b.len()
                  ))),
               },
               Err(e) => Err(e),
            };

            match value {
               Ok(v) => row_data.push(v),
               Err(e) => return Err(e),
            }
         }
         Ok(row_data)
      })
      .map_err(|e| format!("Failed to execute query: {}", e))?;

   let mut rows = Vec::new();
   for row in rows_iter {
      match row {
         Ok(row_data) => rows.push(row_data),
         Err(e) => return Err(format!("Error reading row: {}", e)),
      }
   }

   Ok(QueryResult { columns, rows })
}
