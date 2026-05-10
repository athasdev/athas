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

   let mut rows_iter = stmt
      .query(params)
      .map_err(|e| format!("Failed to execute query: {}", e))?;

   let stmt_ref = rows_iter
      .as_ref()
      .ok_or_else(|| "Failed to read query metadata".to_string())?;
   let column_count = stmt_ref.column_count();
   let columns = stmt_ref.column_names();

   let mut rows = Vec::new();
   while let Some(row) = rows_iter
      .next()
      .map_err(|e| format!("Error reading row: {}", e))?
   {
      let mut row_data = Vec::new();
      for i in 0..column_count {
         let value: serde_json::Value = match row.get_ref(i) {
            Ok(value_ref) => match value_ref {
               duckdb::types::ValueRef::Null => serde_json::Value::Null,
               duckdb::types::ValueRef::Int(i) => serde_json::json!(i),
               duckdb::types::ValueRef::BigInt(i) => serde_json::json!(i),
               duckdb::types::ValueRef::TinyInt(i) => serde_json::json!(i),
               duckdb::types::ValueRef::SmallInt(i) => serde_json::json!(i),
               duckdb::types::ValueRef::HugeInt(i) => serde_json::json!(i.to_string()),
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
      rows.push(row_data);
   }

   Ok(QueryResult { columns, rows })
}

pub async fn get_duckdb_tables(path: String) -> Result<Vec<TableInfo>, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;

   let mut stmt = conn
      .prepare(
         "SELECT table_name AS name, CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END \
          AS kind, NULL AS table_name FROM information_schema.tables WHERE table_schema = 'main' \
          AND table_type IN ('BASE TABLE', 'VIEW') UNION ALL SELECT index_name AS name, 'index' \
          AS kind, table_name FROM duckdb_indexes() WHERE schema_name = 'main' ORDER BY kind, name",
      )
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let table_iter = stmt
      .query_map([], |row| {
         Ok(TableInfo {
            name: row.get(0)?,
            kind: row.get(1)?,
            table_name: row.get(2)?,
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

pub async fn update_duckdb_row_by_values(
   path: String,
   table: String,
   set_columns: Vec<String>,
   set_values: Vec<serde_json::Value>,
   identity: RowIdentity,
) -> Result<i64, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;
   let set_clause = set_columns
      .iter()
      .map(|col| format!("{} = ?", escape_identifier(col)))
      .collect::<Vec<_>>()
      .join(", ");
   let mut param_offset = 0;
   let (where_clause, where_values) = build_row_identity_where_clause(
      &identity,
      escape_identifier,
      |_| "?".to_string(),
      &mut param_offset,
   )?;
   let sql = format!(
      "UPDATE {} SET {} {}",
      escape_identifier(&table),
      set_clause,
      where_clause
   );
   let mut all_values: Vec<String> = set_values.iter().map(json_to_sql_string).collect();
   all_values.extend(where_values.iter().map(json_to_sql_string));
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

pub async fn delete_duckdb_row_by_values(
   path: String,
   table: String,
   identity: RowIdentity,
) -> Result<i64, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;
   let mut param_offset = 0;
   let (where_clause, where_values) = build_row_identity_where_clause(
      &identity,
      escape_identifier,
      |_| "?".to_string(),
      &mut param_offset,
   )?;
   let sql = format!("DELETE FROM {} {}", escape_identifier(&table), where_clause);
   let values: Vec<String> = where_values.iter().map(json_to_sql_string).collect();
   let affected = conn
      .execute(&sql, duckdb::params_from_iter(values.iter()))
      .map_err(|e| format!("Failed to delete row: {}", e))?;
   Ok(affected as i64)
}

fn get_duckdb_foreign_keys_for_connection(
   conn: &Connection,
   table: &str,
) -> Result<Vec<ForeignKeyInfo>, String> {
   let sql = r#"
      SELECT
         unnest(constraint_column_names) AS from_column,
         referenced_table AS to_table,
         unnest(referenced_column_names) AS to_column
      FROM duckdb_constraints()
      WHERE constraint_type = 'FOREIGN KEY' AND table_name = ?
      ORDER BY constraint_index
   "#;

   let mut stmt = conn
      .prepare(sql)
      .map_err(|e| format!("Failed to prepare foreign key query: {}", e))?;
   let fk_iter = stmt
      .query_map([table], |row| {
         Ok(ForeignKeyInfo {
            from_column: row.get(0)?,
            to_table: row.get(1)?,
            to_column: row.get(2)?,
         })
      })
      .map_err(|e| format!("Failed to query foreign keys: {}", e))?;

   let mut foreign_keys = Vec::new();
   for fk in fk_iter {
      match fk {
         Ok(fk_info) => foreign_keys.push(fk_info),
         Err(e) => return Err(format!("Error reading foreign key: {}", e)),
      }
   }

   Ok(foreign_keys)
}

pub async fn get_duckdb_foreign_keys(
   path: String,
   table: String,
) -> Result<Vec<ForeignKeyInfo>, String> {
   let conn =
      Connection::open(&path).map_err(|e| format!("Failed to open DuckDB database: {}", e))?;
   get_duckdb_foreign_keys_for_connection(&conn, &table)
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn execute_query_reads_metadata_after_statement_execution() {
      let conn = Connection::open_in_memory().unwrap();
      conn
         .execute_batch(
            r#"
            CREATE TABLE users(id INTEGER, name TEXT);
            INSERT INTO users VALUES (1, 'Ada');
            "#,
         )
         .unwrap();

      let result = execute_query_duckdb(&conn, "SELECT id, name FROM users", &[]).unwrap();

      assert_eq!(result.columns, vec!["id".to_string(), "name".to_string()]);
      assert_eq!(
         result.rows,
         vec![vec![serde_json::json!(1), serde_json::json!("Ada")]]
      );
   }

   #[test]
   fn execute_query_keeps_columns_for_empty_result_sets() {
      let conn = Connection::open_in_memory().unwrap();
      conn
         .execute_batch("CREATE TABLE users(id INTEGER, name TEXT);")
         .unwrap();

      let result =
         execute_query_duckdb(&conn, "SELECT id, name FROM users WHERE id = 0", &[]).unwrap();

      assert_eq!(result.columns, vec!["id".to_string(), "name".to_string()]);
      assert!(result.rows.is_empty());
   }

   #[tokio::test]
   async fn reads_duckdb_tables_views_and_indexes() {
      let path = std::env::temp_dir().join(format!(
         "athas-duckdb-objects-{}.duckdb",
         std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
      ));
      let conn = Connection::open(&path).unwrap();
      conn
         .execute_batch(
            r#"
            CREATE TABLE users(id INTEGER, name TEXT);
            CREATE VIEW active_users AS SELECT * FROM users;
            CREATE INDEX users_name_idx ON users (name);
            "#,
         )
         .unwrap();
      drop(conn);

      let objects = get_duckdb_tables(path.to_string_lossy().to_string())
         .await
         .unwrap();

      assert!(
         objects
            .iter()
            .any(|object| object.name == "users" && object.kind == "table")
      );
      assert!(
         objects
            .iter()
            .any(|object| object.name == "active_users" && object.kind == "view")
      );
      assert!(objects.iter().any(|object| object.name == "users_name_idx"
         && object.kind == "index"
         && object.table_name.as_deref() == Some("users")));

      let _ = std::fs::remove_file(path);
   }

   #[test]
   fn reads_duckdb_foreign_keys_from_constraints_metadata() {
      let conn = Connection::open_in_memory().unwrap();
      conn
         .execute_batch(
            r#"
            CREATE TABLE authors(id INTEGER PRIMARY KEY);
            CREATE TABLE books(
               id INTEGER PRIMARY KEY,
               author_id INTEGER,
               FOREIGN KEY(author_id) REFERENCES authors(id)
            );
            "#,
         )
         .unwrap();

      let foreign_keys = get_duckdb_foreign_keys_for_connection(&conn, "books").unwrap();

      assert_eq!(foreign_keys.len(), 1);
      assert_eq!(foreign_keys[0].from_column, "author_id");
      assert_eq!(foreign_keys[0].to_table, "authors");
      assert_eq!(foreign_keys[0].to_column, "id");
   }

   #[test]
   fn reads_composite_duckdb_foreign_keys() {
      let conn = Connection::open_in_memory().unwrap();
      conn
         .execute_batch(
            r#"
            CREATE TABLE parents(a INTEGER, b INTEGER, PRIMARY KEY(a, b));
            CREATE TABLE children(
               x INTEGER,
               y INTEGER,
               FOREIGN KEY(x, y) REFERENCES parents(a, b)
            );
            "#,
         )
         .unwrap();

      let foreign_keys = get_duckdb_foreign_keys_for_connection(&conn, "children").unwrap();

      assert_eq!(foreign_keys.len(), 2);
      assert_eq!(foreign_keys[0].from_column, "x");
      assert_eq!(foreign_keys[0].to_table, "parents");
      assert_eq!(foreign_keys[0].to_column, "a");
      assert_eq!(foreign_keys[1].from_column, "y");
      assert_eq!(foreign_keys[1].to_table, "parents");
      assert_eq!(foreign_keys[1].to_column, "b");
   }
}
