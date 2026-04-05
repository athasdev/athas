use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct TableInfo {
   name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
   columns: Vec<String>,
   rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnFilter {
   column: String,
   operator: String,
   value: String,
   #[serde(default)]
   value2: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilteredQueryParams {
   table: String,
   filters: Vec<ColumnFilter>,
   #[serde(default)]
   search_term: Option<String>,
   #[serde(default)]
   search_columns: Vec<String>,
   #[serde(default)]
   sort_column: Option<String>,
   #[serde(default = "default_sort_direction")]
   sort_direction: String,
   #[serde(default = "default_page_size")]
   page_size: i64,
   #[serde(default)]
   offset: i64,
}

fn default_sort_direction() -> String {
   "ASC".to_string()
}

fn default_page_size() -> i64 {
   50
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FilteredQueryResult {
   columns: Vec<String>,
   rows: Vec<Vec<serde_json::Value>>,
   total_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
   pub from_column: String,
   pub to_table: String,
   pub to_column: String,
}

/// Escape a SQL identifier by wrapping in double quotes and escaping internal quotes
fn escape_identifier(name: &str) -> String {
   format!("\"{}\"", name.replace('"', "\"\""))
}

/// Convert a serde_json::Value to a rusqlite::types::Value
fn json_to_rusqlite(v: &serde_json::Value) -> Result<rusqlite::types::Value, String> {
   match v {
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
   }
}

/// Execute a query and collect rows into a QueryResult
fn execute_query(
   conn: &Connection,
   sql: &str,
   params: &[&dyn rusqlite::ToSql],
) -> Result<QueryResult, String> {
   let mut stmt = conn
      .prepare(sql)
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let column_count = stmt.column_count();
   let mut columns = Vec::new();

   for i in 0..column_count {
      columns.push(stmt.column_name(i).unwrap_or("unknown").to_string());
   }

   let rows_iter = stmt
      .query_map(params, |row| {
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

/// Build WHERE clause and parameter values from structured filters
fn build_where_clause(
   filters: &[ColumnFilter],
   search_term: &Option<String>,
   search_columns: &[String],
   logic: &str,
) -> (String, Vec<rusqlite::types::Value>) {
   let mut conditions: Vec<String> = Vec::new();
   let mut params: Vec<rusqlite::types::Value> = Vec::new();

   // Search term across columns
   if let Some(term) = search_term
      && !term.is_empty()
      && !search_columns.is_empty()
   {
      let search_conditions: Vec<String> = search_columns
         .iter()
         .map(|col| format!("CAST({} AS TEXT) LIKE ?", escape_identifier(col)))
         .collect();
      conditions.push(format!("({})", search_conditions.join(" OR ")));
      let like_value = format!("%{}%", term);
      for _ in search_columns {
         params.push(rusqlite::types::Value::Text(like_value.clone()));
      }
   }

   // Column filters
   for filter in filters {
      let col = escape_identifier(&filter.column);
      match filter.operator.as_str() {
         "equals" => {
            conditions.push(format!("{} = ?", col));
            params.push(rusqlite::types::Value::Text(filter.value.clone()));
         }
         "notEquals" => {
            conditions.push(format!("{} != ?", col));
            params.push(rusqlite::types::Value::Text(filter.value.clone()));
         }
         "contains" => {
            conditions.push(format!("{} LIKE ?", col));
            params.push(rusqlite::types::Value::Text(format!("%{}%", filter.value)));
         }
         "startsWith" => {
            conditions.push(format!("{} LIKE ?", col));
            params.push(rusqlite::types::Value::Text(format!("{}%", filter.value)));
         }
         "endsWith" => {
            conditions.push(format!("{} LIKE ?", col));
            params.push(rusqlite::types::Value::Text(format!("%{}", filter.value)));
         }
         "gt" => {
            conditions.push(format!("{} > ?", col));
            params.push(rusqlite::types::Value::Text(filter.value.clone()));
         }
         "gte" => {
            conditions.push(format!("{} >= ?", col));
            params.push(rusqlite::types::Value::Text(filter.value.clone()));
         }
         "lt" => {
            conditions.push(format!("{} < ?", col));
            params.push(rusqlite::types::Value::Text(filter.value.clone()));
         }
         "lte" => {
            conditions.push(format!("{} <= ?", col));
            params.push(rusqlite::types::Value::Text(filter.value.clone()));
         }
         "between" => {
            if let Some(ref value2) = filter.value2 {
               conditions.push(format!("{} BETWEEN ? AND ?", col));
               params.push(rusqlite::types::Value::Text(filter.value.clone()));
               params.push(rusqlite::types::Value::Text(value2.clone()));
            }
         }
         "isNull" => {
            conditions.push(format!("{} IS NULL", col));
         }
         "isNotNull" => {
            conditions.push(format!("{} IS NOT NULL", col));
         }
         _ => {}
      }
   }

   if conditions.is_empty() {
      return (String::new(), params);
   }

   let joiner = if logic == "OR" { " OR " } else { " AND " };
   (format!("WHERE {}", conditions.join(joiner)), params)
}

/// Get all table names from a SQLite database
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
pub async fn execute_sqlite(path: String, statement: String) -> Result<i64, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

   let result = conn
      .execute(&statement, [])
      .map_err(|e| format!("Failed to execute statement: {}", e))?;

   Ok(result as i64)
}

/// Insert a new row into a table
pub async fn insert_sqlite_row(
   path: String,
   table: String,
   columns: Vec<String>,
   values: Vec<serde_json::Value>,
) -> Result<i64, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

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

   let mut stmt = conn
      .prepare(&sql)
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let rusqlite_values: Result<Vec<_>, String> = values.iter().map(json_to_rusqlite).collect();
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
      .map(|col| format!("{} = ?", escape_identifier(col)))
      .collect::<Vec<_>>()
      .join(", ");
   let sql = format!(
      "UPDATE {} SET {} WHERE {} = ?",
      escape_identifier(&table),
      set_clause,
      escape_identifier(&where_column)
   );

   let mut stmt = conn
      .prepare(&sql)
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let mut all_values = set_values;
   all_values.push(where_value);

   let rusqlite_values: Result<Vec<_>, String> = all_values.iter().map(json_to_rusqlite).collect();
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
pub async fn delete_sqlite_row(
   path: String,
   table: String,
   where_column: String,
   where_value: serde_json::Value,
) -> Result<i64, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

   let sql = format!(
      "DELETE FROM {} WHERE {} = ?",
      escape_identifier(&table),
      escape_identifier(&where_column)
   );

   let mut stmt = conn
      .prepare(&sql)
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let rusqlite_value = json_to_rusqlite(&where_value)?;

   let affected = stmt
      .execute([&rusqlite_value])
      .map_err(|e| format!("Failed to execute delete: {}", e))?;

   Ok(affected as i64)
}

/// Execute a SQL query on a SQLite database
pub async fn query_sqlite(path: String, query: String) -> Result<QueryResult, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;
   execute_query(&conn, &query, &[])
}

/// Query a table with structured filters, pagination, and sorting (parameterized, safe from
/// injection)
pub async fn query_sqlite_filtered(
   path: String,
   params: FilteredQueryParams,
) -> Result<FilteredQueryResult, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;
   let table = escape_identifier(&params.table);
   let logic = "AND";

   let (where_clause, where_params) = build_where_clause(
      &params.filters,
      &params.search_term,
      &params.search_columns,
      logic,
   );

   // Count query
   let count_sql = format!("SELECT COUNT(*) FROM {} {}", table, where_clause);
   let param_refs: Vec<&dyn rusqlite::ToSql> = where_params
      .iter()
      .map(|v| v as &dyn rusqlite::ToSql)
      .collect();

   let total_count: i64 = conn
      .query_row(&count_sql, &param_refs[..], |row| row.get(0))
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
      "SELECT * FROM {} {} {} LIMIT ? OFFSET ?",
      table, where_clause, order_clause
   );

   let mut data_params = where_params.clone();
   data_params.push(rusqlite::types::Value::Integer(params.page_size));
   data_params.push(rusqlite::types::Value::Integer(params.offset));

   let data_param_refs: Vec<&dyn rusqlite::ToSql> = data_params
      .iter()
      .map(|v| v as &dyn rusqlite::ToSql)
      .collect();

   let result = execute_query(&conn, &data_sql, &data_param_refs)?;

   Ok(FilteredQueryResult {
      columns: result.columns,
      rows: result.rows,
      total_count,
   })
}

/// Get foreign key information for a table
pub async fn get_sqlite_foreign_keys(
   path: String,
   table: String,
) -> Result<Vec<ForeignKeyInfo>, String> {
   let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

   let sql = format!("PRAGMA foreign_key_list({})", escape_identifier(&table));
   let mut stmt = conn
      .prepare(&sql)
      .map_err(|e| format!("Failed to prepare statement: {}", e))?;

   let fk_iter = stmt
      .query_map([], |row| {
         Ok(ForeignKeyInfo {
            from_column: row.get(3)?,
            to_table: row.get(2)?,
            to_column: row.get(4)?,
         })
      })
      .map_err(|e| format!("Failed to get foreign keys: {}", e))?;

   let mut foreign_keys = Vec::new();
   for fk in fk_iter {
      match fk {
         Ok(fk_info) => foreign_keys.push(fk_info),
         Err(e) => return Err(format!("Error reading foreign key: {}", e)),
      }
   }

   Ok(foreign_keys)
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn test_escape_identifier_simple() {
      assert_eq!(escape_identifier("users"), "\"users\"");
   }

   #[test]
   fn test_escape_identifier_with_quotes() {
      assert_eq!(escape_identifier("my\"table"), "\"my\"\"table\"");
   }

   #[test]
   fn test_escape_identifier_with_spaces() {
      assert_eq!(escape_identifier("my table"), "\"my table\"");
   }

   #[test]
   fn test_escape_identifier_injection_attempt() {
      let malicious = "users\"; DROP TABLE users; --";
      let escaped = escape_identifier(malicious);
      assert_eq!(escaped, "\"users\"\"; DROP TABLE users; --\"");
   }

   #[test]
   fn test_build_where_clause_empty() {
      let (clause, params) = build_where_clause(&[], &None, &[], "AND");
      assert_eq!(clause, "");
      assert!(params.is_empty());
   }

   #[test]
   fn test_build_where_clause_equals() {
      let filters = vec![ColumnFilter {
         column: "name".to_string(),
         operator: "equals".to_string(),
         value: "Alice".to_string(),
         value2: None,
      }];
      let (clause, params) = build_where_clause(&filters, &None, &[], "AND");
      assert_eq!(clause, "WHERE \"name\" = ?");
      assert_eq!(params.len(), 1);
   }

   #[test]
   fn test_build_where_clause_contains() {
      let filters = vec![ColumnFilter {
         column: "email".to_string(),
         operator: "contains".to_string(),
         value: "test".to_string(),
         value2: None,
      }];
      let (clause, params) = build_where_clause(&filters, &None, &[], "AND");
      assert_eq!(clause, "WHERE \"email\" LIKE ?");
      assert_eq!(params.len(), 1);
      if let rusqlite::types::Value::Text(ref v) = params[0] {
         assert_eq!(v, "%test%");
      } else {
         panic!("Expected text param");
      }
   }

   #[test]
   fn test_build_where_clause_between() {
      let filters = vec![ColumnFilter {
         column: "age".to_string(),
         operator: "between".to_string(),
         value: "18".to_string(),
         value2: Some("65".to_string()),
      }];
      let (clause, params) = build_where_clause(&filters, &None, &[], "AND");
      assert_eq!(clause, "WHERE \"age\" BETWEEN ? AND ?");
      assert_eq!(params.len(), 2);
   }

   #[test]
   fn test_build_where_clause_is_null() {
      let filters = vec![ColumnFilter {
         column: "deleted_at".to_string(),
         operator: "isNull".to_string(),
         value: String::new(),
         value2: None,
      }];
      let (clause, params) = build_where_clause(&filters, &None, &[], "AND");
      assert_eq!(clause, "WHERE \"deleted_at\" IS NULL");
      assert!(params.is_empty());
   }

   #[test]
   fn test_build_where_clause_search_term() {
      let search_columns = vec!["name".to_string(), "email".to_string()];
      let (clause, params) =
         build_where_clause(&[], &Some("alice".to_string()), &search_columns, "AND");
      assert!(clause.contains("CAST(\"name\" AS TEXT) LIKE ?"));
      assert!(clause.contains("CAST(\"email\" AS TEXT) LIKE ?"));
      assert_eq!(params.len(), 2);
   }

   #[test]
   fn test_build_where_clause_multiple_filters() {
      let filters = vec![
         ColumnFilter {
            column: "name".to_string(),
            operator: "contains".to_string(),
            value: "Alice".to_string(),
            value2: None,
         },
         ColumnFilter {
            column: "age".to_string(),
            operator: "gt".to_string(),
            value: "18".to_string(),
            value2: None,
         },
      ];
      let (clause, params) = build_where_clause(&filters, &None, &[], "AND");
      assert!(clause.contains("AND"));
      assert_eq!(params.len(), 2);
   }

   #[test]
   fn test_build_where_clause_injection_in_column_name() {
      let filters = vec![ColumnFilter {
         column: "name\"; DROP TABLE users; --".to_string(),
         operator: "equals".to_string(),
         value: "test".to_string(),
         value2: None,
      }];
      let (clause, _) = build_where_clause(&filters, &None, &[], "AND");
      // The column name is wrapped in double quotes with internal quotes escaped
      assert!(clause.contains("\"name\"\"; DROP TABLE users; --\""));
      // The DROP TABLE text is inside the quoted identifier, not as a standalone SQL statement
      assert!(clause.starts_with("WHERE \""));
   }

   #[test]
   fn test_json_to_rusqlite_null() {
      let result = json_to_rusqlite(&serde_json::Value::Null).unwrap();
      assert!(matches!(result, rusqlite::types::Value::Null));
   }

   #[test]
   fn test_json_to_rusqlite_bool() {
      let result = json_to_rusqlite(&serde_json::Value::Bool(true)).unwrap();
      assert!(matches!(result, rusqlite::types::Value::Integer(1)));
   }

   #[test]
   fn test_json_to_rusqlite_string() {
      let result = json_to_rusqlite(&serde_json::Value::String("hello".to_string())).unwrap();
      if let rusqlite::types::Value::Text(v) = result {
         assert_eq!(v, "hello");
      } else {
         panic!("Expected text");
      }
   }

   #[test]
   fn test_json_to_rusqlite_integer() {
      let result = json_to_rusqlite(&serde_json::json!(42)).unwrap();
      assert!(matches!(result, rusqlite::types::Value::Integer(42)));
   }

   #[test]
   fn test_json_to_rusqlite_float() {
      let result = json_to_rusqlite(&serde_json::json!(std::f64::consts::PI)).unwrap();
      if let rusqlite::types::Value::Real(v) = result {
         assert!((v - std::f64::consts::PI).abs() < f64::EPSILON);
      } else {
         panic!("Expected real");
      }
   }

   #[test]
   fn test_filtered_query_builds_safe_sql() {
      let conn = Connection::open_in_memory().unwrap();
      conn
         .execute(
            "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)",
            [],
         )
         .unwrap();
      conn
         .execute("INSERT INTO test VALUES (1, 'Alice', 30)", [])
         .unwrap();
      conn
         .execute("INSERT INTO test VALUES (2, 'Bob', 25)", [])
         .unwrap();

      let table = escape_identifier("test");
      let filters = vec![ColumnFilter {
         column: "name".to_string(),
         operator: "equals".to_string(),
         value: "Alice".to_string(),
         value2: None,
      }];

      let (where_clause, where_params) = build_where_clause(&filters, &None, &[], "AND");
      let sql = format!("SELECT * FROM {} {} LIMIT 50 OFFSET 0", table, where_clause);
      let param_refs: Vec<&dyn rusqlite::ToSql> = where_params
         .iter()
         .map(|v| v as &dyn rusqlite::ToSql)
         .collect();

      let result = execute_query(&conn, &sql, &param_refs).unwrap();
      assert_eq!(result.rows.len(), 1);
      assert_eq!(
         result.rows[0][1],
         serde_json::Value::String("Alice".to_string())
      );
   }

   #[test]
   fn test_injection_attempt_in_filter_value() {
      let conn = Connection::open_in_memory().unwrap();
      conn
         .execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)", [])
         .unwrap();
      conn
         .execute("INSERT INTO test VALUES (1, 'Alice')", [])
         .unwrap();

      let filters = vec![ColumnFilter {
         column: "name".to_string(),
         operator: "equals".to_string(),
         value: "'; DROP TABLE test; --".to_string(),
         value2: None,
      }];

      let table = escape_identifier("test");
      let (where_clause, where_params) = build_where_clause(&filters, &None, &[], "AND");
      let sql = format!("SELECT * FROM {} {}", table, where_clause);
      let param_refs: Vec<&dyn rusqlite::ToSql> = where_params
         .iter()
         .map(|v| v as &dyn rusqlite::ToSql)
         .collect();

      let result = execute_query(&conn, &sql, &param_refs).unwrap();
      assert_eq!(result.rows.len(), 0);

      // Table should still exist
      let count: i64 = conn
         .query_row("SELECT COUNT(*) FROM test", [], |row| row.get(0))
         .unwrap();
      assert_eq!(count, 1);
   }
}
