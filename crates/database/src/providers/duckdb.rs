use crate::sql_common::*;
use duckdb::Connection;

fn execute_query_duckdb(
   conn: &Connection,
   sql: &str,
   params: &[&dyn duckdb::ToSql],
) -> Result<QueryResult, String> {
   let mut stmt = conn
      .prepare(sql)
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let column_count = stmt.column_count();
   let columns: Vec<String> = (0..column_count)
      .map(|i| {
         stmt
            .column_name(i)
            .map_or("unknown".to_string(), |v| v.to_string())
      })
      .collect();

   let rows_iter = stmt
      .query_map(params, |row| {
         let mut row_data = Vec::new();
         for i in 0..column_count {
            let value: serde_json::Value = match row.get_ref(i) {
               Ok(value_ref) => match value_ref {
                  duckdb::types::ValueRef::Null => serde_json::Value::Null,
                  duckdb::types::ValueRef::Int(i) => serde_json::json!(i),
                  duckdb::types::ValueRef::BigInt(i) => serde_json::json!(i),
                  duckdb::types::ValueRef::TinyInt(i) => serde_json::json!(i),
                  duckdb::types::ValueRef::SmallInt(i) => serde_json::json!(i),
                  duckdb::types::ValueRef::HugeInt(i) => {
                     serde_json::json!(i.to_string())
                  }
                  duckdb::types::ValueRef::Float(f) => serde_json::Number::from_f64(f as f64)
                     .map(serde_json::Value::Number)
                     .unwrap_or(serde_json::Value::String(f.to_string())),
                  duckdb::types::ValueRef::Double(f) => serde_json::Number::from_f64(f)
                     .map(serde_json::Value::Number)
                     .unwrap_or(serde_json::Value::String(f.to_string())),
                  duckdb::types::ValueRef::Text(s) => {
                     serde_json::Value::String(String::from_utf8_lossy(s).to_string())
                  }
                  duckdb::types::ValueRef::Blob(b) => {
                     serde_json::Value::String(format!("<binary data: {} bytes>", b.len()))
                  }
                  _ => serde_json::Value::String("<unsupported type>".to_string()),
               },
               Err(_) => serde_json::Value::Null,
            };
            row_data.push(value);
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

pub async fn get_duckdb_tables(path: String) -> Result<Vec<TableInfo>, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;

   let mut stmt = conn
      .prepare(
         "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY \
          table_name",
      )
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let table_iter = stmt
      .query_map([], |row| {
         Ok(TableInfo {
            name: row.get(0)?,
            kind: "table".to_string(),
         })
      })
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

pub async fn query_duckdb(path: String, query: String) -> Result<QueryResult, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;
   execute_query_duckdb(&conn, &query, &[])
}

pub async fn query_duckdb_filtered(
   path: String,
   params: FilteredQueryParams,
) -> Result<FilteredQueryResult, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;
   let table = escape_identifier(&params.table);

   let mut offset = 0;
   let (where_clause, where_params) = build_where_clause_generic(
      &params.filters,
      &params.search_term,
      &params.search_columns,
      "AND",
      escape_identifier,
      |_| "?".to_string(),
      &mut offset,
   );

   // Count query
   let count_sql = format!("SELECT COUNT(*) FROM {} {}", table, where_clause);
   let total_count: i64 = conn
      .query_row(
         &count_sql,
         duckdb::params_from_iter(where_params.iter()),
         |row| row.get(0),
      )
      .map_err(|e| format!("Failed to count rows: {}", e))?;

   // Data query
   let order_clause = if let Some(ref sort_col) = params.sort_column {
      let direction = if params.sort_direction.to_uppercase() == "DESC" {
         "DESC"
      } else {
         "ASC"
      };
      format!("ORDER BY {} {}", escape_identifier(sort_col), direction)
   } else {
      String::new()
   };

   let data_sql = format!(
      "SELECT * FROM {} {} {} LIMIT {} OFFSET {}",
      table, where_clause, order_clause, params.page_size, params.offset
   );

   let result = execute_query_duckdb(
      &conn,
      &data_sql,
      &where_params
         .iter()
         .map(|s| s as &dyn duckdb::ToSql)
         .collect::<Vec<_>>(),
   )?;

   Ok(FilteredQueryResult {
      columns: result.columns,
      rows: result.rows,
      total_count,
   })
}

pub async fn execute_duckdb(path: String, statement: String) -> Result<i64, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;
   let result = conn
      .execute(&statement, [])
      .map_err(|e| format!("Failed to execute statement: {}", e))?;
   Ok(result as i64)
}

pub async fn insert_duckdb_row(
   path: String,
   table: String,
   columns: Vec<String>,
   values: Vec<serde_json::Value>,
) -> Result<i64, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;
   let placeholders = vec!["?"; values.len()].join(", ");
   let column_names = columns
      .iter()
      .map(|c| escape_identifier(c))
      .collect::<Vec<_>>()
      .join(", ");
   let sql = format!(
      "INSERT INTO {} ({}) VALUES ({})",
      escape_identifier(&table),
      column_names,
      placeholders
   );
   let str_values: Vec<String> = values.iter().map(json_to_sql_string).collect();
   conn
      .execute(&sql, duckdb::params_from_iter(str_values.iter()))
      .map_err(|e| format!("Failed to insert row: {}", e))?;
   Ok(0)
}

pub async fn update_duckdb_row(
   path: String,
   table: String,
   set_columns: Vec<String>,
   set_values: Vec<serde_json::Value>,
   where_column: String,
   where_value: serde_json::Value,
) -> Result<i64, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;
   let set_clause = set_columns
      .iter()
      .map(|col| format!("{} = ?", escape_identifier(col)))
      .collect::<Vec<_>>()
      .join(", ");
   let sql = format!(
      "UPDATE {} SET {} WHERE {} = ?",
      escape_identifier(&table),
      set_clause,
      escape_identifier(&where_column)
   );
   let mut all_values: Vec<String> = set_values.iter().map(json_to_sql_string).collect();
   all_values.push(json_to_sql_string(&where_value));
   let affected = conn
      .execute(&sql, duckdb::params_from_iter(all_values.iter()))
      .map_err(|e| format!("Failed to update row: {}", e))?;
   Ok(affected as i64)
}

pub async fn delete_duckdb_row(
   path: String,
   table: String,
   where_column: String,
   where_value: serde_json::Value,
) -> Result<i64, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;
   let sql = format!(
      "DELETE FROM {} WHERE {} = ?",
      escape_identifier(&table),
      escape_identifier(&where_column)
   );
   let val = json_to_sql_string(&where_value);
   let affected = conn
      .execute(&sql, [&val])
      .map_err(|e| format!("Failed to delete row: {}", e))?;
   Ok(affected as i64)
}

pub async fn get_duckdb_foreign_keys(
   _path: String,
   _table: String,
) -> Result<Vec<ForeignKeyInfo>, String> {
   // DuckDB doesn't have a simple PRAGMA for FKs like SQLite; return empty for now
   Ok(Vec::new())
}
