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
