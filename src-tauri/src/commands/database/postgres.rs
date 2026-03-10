use super::{
   connection_manager::{ConnectionManager, DatabasePool},
   sql_common::*,
};
use sqlx::{Column, Row};
use std::sync::Arc;
use tauri::command;

fn row_to_json_values(row: &sqlx::postgres::PgRow) -> Vec<serde_json::Value> {
   use sqlx::TypeInfo;
   let mut values = Vec::new();
   for i in 0..row.columns().len() {
      let col = &row.columns()[i];
      let type_name = col.type_info().name();
      let value: serde_json::Value = match type_name {
         "BOOL" => row
            .try_get::<bool, _>(i)
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
         "INT2" | "SMALLINT" | "SMALLSERIAL" => row
            .try_get::<i16, _>(i)
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
         "INT4" | "INT" | "INTEGER" | "SERIAL" => row
            .try_get::<i32, _>(i)
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
         "INT8" | "BIGINT" | "BIGSERIAL" => row
            .try_get::<i64, _>(i)
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
         "FLOAT4" | "REAL" => row
            .try_get::<f32, _>(i)
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
         "FLOAT8" | "DOUBLE PRECISION" => row
            .try_get::<f64, _>(i)
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
         _ => row
            .try_get::<String, _>(i)
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
      };
      values.push(value);
   }
   values
}

#[command]
pub async fn get_postgres_tables(
   connection_id: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<TableInfo>, String> {
   let pool_arc = state
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let rows = sqlx::query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY \
       table_name",
   )
   .fetch_all(pool)
   .await
   .map_err(|e| format!("Failed to get tables: {}", e))?;

   Ok(rows
      .iter()
      .map(|r| TableInfo {
         name: r.get("table_name"),
      })
      .collect())
}

#[command]
pub async fn query_postgres(
   connection_id: String,
   query: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<QueryResult, String> {
   let pool_arc = state
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let rows = sqlx::query(&query)
      .fetch_all(pool)
      .await
      .map_err(|e| format!("Failed to execute query: {}", e))?;

   if rows.is_empty() {
      return Ok(QueryResult {
         columns: Vec::new(),
         rows: Vec::new(),
      });
   }

   let columns: Vec<String> = rows[0]
      .columns()
      .iter()
      .map(|c| c.name().to_string())
      .collect();
   let result_rows: Vec<Vec<serde_json::Value>> = rows.iter().map(row_to_json_values).collect();

   Ok(QueryResult {
      columns,
      rows: result_rows,
   })
}

#[command]
pub async fn query_postgres_filtered(
   connection_id: String,
   params: FilteredQueryParams,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<FilteredQueryResult, String> {
   let pool_arc = state
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let table = escape_identifier(&params.table);
   let mut offset = 0;
   let (where_clause, where_params) = build_where_clause_generic(
      &params.filters,
      &params.search_term,
      &params.search_columns,
      "AND",
      escape_identifier,
      |i| format!("${}", i),
      &mut offset,
   );

   // Count
   let count_sql = format!("SELECT COUNT(*) FROM {} {}", table, where_clause);
   let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
   for p in &where_params {
      count_query = count_query.bind(p);
   }
   let total_count = count_query
      .fetch_one(pool)
      .await
      .map_err(|e| format!("Failed to count rows: {}", e))?;

   // Data
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
   let mut data_query = sqlx::query(&data_sql);
   for p in &where_params {
      data_query = data_query.bind(p);
   }
   let rows = data_query
      .fetch_all(pool)
      .await
      .map_err(|e| format!("Failed to query data: {}", e))?;

   if rows.is_empty() {
      return Ok(FilteredQueryResult {
         columns: Vec::new(),
         rows: Vec::new(),
         total_count,
      });
   }

   let columns: Vec<String> = rows[0]
      .columns()
      .iter()
      .map(|c| c.name().to_string())
      .collect();
   let result_rows: Vec<Vec<serde_json::Value>> = rows.iter().map(row_to_json_values).collect();

   Ok(FilteredQueryResult {
      columns,
      rows: result_rows,
      total_count,
   })
}

#[command]
pub async fn execute_postgres(
   connection_id: String,
   statement: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   let pool_arc = state
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };
   let result = sqlx::query(&statement)
      .execute(pool)
      .await
      .map_err(|e| format!("Failed to execute: {}", e))?;
   Ok(result.rows_affected() as i64)
}

#[command]
pub async fn get_postgres_foreign_keys(
   connection_id: String,
   table: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<ForeignKeyInfo>, String> {
   let pool_arc = state
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let sql = r#"
        SELECT
            kcu.column_name AS from_column,
            ccu.table_name AS to_table,
            ccu.column_name AS to_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1
    "#;

   let rows = sqlx::query(sql)
      .bind(&table)
      .fetch_all(pool)
      .await
      .map_err(|e| format!("Failed to get foreign keys: {}", e))?;

   Ok(rows
      .iter()
      .map(|r| ForeignKeyInfo {
         from_column: r.get("from_column"),
         to_table: r.get("to_table"),
         to_column: r.get("to_column"),
      })
      .collect())
}

#[command]
pub async fn get_postgres_table_schema(
   connection_id: String,
   table: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<super::sql_common::ColumnInfo>, String> {
   let pool_arc = state
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let sql = r#"
        SELECT
            c.column_name as name,
            c.data_type as type,
            CASE WHEN c.is_nullable = 'NO' THEN true ELSE false END as notnull,
            c.column_default as default_value,
            CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN true ELSE false END as primary_key
        FROM information_schema.columns c
        LEFT JOIN information_schema.key_column_usage kcu
            ON c.column_name = kcu.column_name AND c.table_name = kcu.table_name
        LEFT JOIN information_schema.table_constraints tc
            ON kcu.constraint_name = tc.constraint_name AND tc.constraint_type = 'PRIMARY KEY'
        WHERE c.table_name = $1
        ORDER BY c.ordinal_position
    "#;

   let rows = sqlx::query(sql)
      .bind(&table)
      .fetch_all(pool)
      .await
      .map_err(|e| format!("Failed to get schema: {}", e))?;

   Ok(rows
      .iter()
      .map(|r| super::sql_common::ColumnInfo {
         name: r.get("name"),
         r#type: r.get("type"),
         notnull: r.get("notnull"),
         default_value: r.get("default_value"),
         primary_key: r.get("primary_key"),
      })
      .collect())
}

#[command]
pub async fn insert_postgres_row(
   connection_id: String,
   table: String,
   columns: Vec<String>,
   values: Vec<serde_json::Value>,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   let pool_arc = state
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let col_str: Vec<String> = columns.iter().map(|c| escape_identifier(c)).collect();
   let placeholders: Vec<String> = (1..=columns.len()).map(|i| format!("${}", i)).collect();
   let sql = format!(
      "INSERT INTO {} ({}) VALUES ({})",
      escape_identifier(&table),
      col_str.join(", "),
      placeholders.join(", ")
   );

   let mut query = sqlx::query(&sql);
   for v in &values {
      query = query.bind(json_to_sql_string(v));
   }

   let result = query
      .execute(pool)
      .await
      .map_err(|e| format!("Insert failed: {}", e))?;
   Ok(result.rows_affected() as i64)
}

#[command]
pub async fn update_postgres_row(
   connection_id: String,
   table: String,
   set_columns: Vec<String>,
   set_values: Vec<serde_json::Value>,
   where_column: String,
   where_value: serde_json::Value,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   let pool_arc = state
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let set_clauses: Vec<String> = set_columns
      .iter()
      .enumerate()
      .map(|(i, c)| format!("{} = ${}", escape_identifier(c), i + 1))
      .collect();
   let where_param_idx = set_columns.len() + 1;
   let sql = format!(
      "UPDATE {} SET {} WHERE {} = ${}",
      escape_identifier(&table),
      set_clauses.join(", "),
      escape_identifier(&where_column),
      where_param_idx
   );

   let mut query = sqlx::query(&sql);
   for v in &set_values {
      query = query.bind(json_to_sql_string(v));
   }
   query = query.bind(json_to_sql_string(&where_value));

   let result = query
      .execute(pool)
      .await
      .map_err(|e| format!("Update failed: {}", e))?;
   Ok(result.rows_affected() as i64)
}

#[command]
pub async fn delete_postgres_row(
   connection_id: String,
   table: String,
   where_column: String,
   where_value: serde_json::Value,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<i64, String> {
   let pool_arc = state
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let sql = format!(
      "DELETE FROM {} WHERE {} = $1",
      escape_identifier(&table),
      escape_identifier(&where_column)
   );

   let result = sqlx::query(&sql)
      .bind(json_to_sql_string(&where_value))
      .execute(pool)
      .await
      .map_err(|e| format!("Delete failed: {}", e))?;
   Ok(result.rows_affected() as i64)
}
