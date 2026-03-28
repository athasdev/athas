use crate::{ConnectionManager, DatabasePool, sql_common::*};
use sqlx::{Column, Row};

fn mysql_row_to_json(row: &sqlx::mysql::MySqlRow) -> Vec<serde_json::Value> {
   use sqlx::TypeInfo;
   let mut values = Vec::new();
   for i in 0..row.columns().len() {
      let col = &row.columns()[i];
      let type_name = col.type_info().name();
      let value: serde_json::Value = match type_name {
         "BOOLEAN" | "TINYINT(1)" => row
            .try_get::<bool, _>(i)
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
         "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" => row
            .try_get::<i32, _>(i)
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
         "BIGINT" => row
            .try_get::<i64, _>(i)
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
         "FLOAT" => row
            .try_get::<f32, _>(i)
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),
         "DOUBLE" => row
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

pub async fn get_mysql_tables(
   connection_id: String,
   manager: &ConnectionManager,
) -> Result<Vec<TableInfo>, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::MySql(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let rows = sqlx::query("SHOW TABLES")
      .fetch_all(pool)
      .await
      .map_err(|e| format!("Failed to get tables: {}", e))?;

   Ok(rows
      .iter()
      .map(|r| TableInfo {
         name: r.get::<String, _>(0),
         kind: "table".to_string(),
      })
      .collect())
}

pub async fn query_mysql(
   connection_id: String,
   query: String,
   manager: &ConnectionManager,
) -> Result<QueryResult, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::MySql(p) => p,
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
   let result_rows: Vec<Vec<serde_json::Value>> = rows.iter().map(mysql_row_to_json).collect();

   Ok(QueryResult {
      columns,
      rows: result_rows,
   })
}

pub async fn query_mysql_filtered(
   connection_id: String,
   params: FilteredQueryParams,
   manager: &ConnectionManager,
) -> Result<FilteredQueryResult, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::MySql(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let table = escape_identifier_mysql(&params.table);
   let mut offset = 0;
   let (where_clause, where_params) = build_where_clause_generic(
      &params.filters,
      &params.search_term,
      &params.search_columns,
      "AND",
      escape_identifier_mysql,
      |_| "?".to_string(),
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
      .map_err(|e| format!("Failed to count: {}", e))?;

   // Data
   let order_clause = if let Some(ref sort_col) = params.sort_column {
      let direction = if params.sort_direction.to_uppercase() == "DESC" {
         "DESC"
      } else {
         "ASC"
      };
      format!(
         "ORDER BY {} {}",
         escape_identifier_mysql(sort_col),
         direction
      )
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
      .map_err(|e| format!("Failed to query: {}", e))?;

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
   let result_rows: Vec<Vec<serde_json::Value>> = rows.iter().map(mysql_row_to_json).collect();

   Ok(FilteredQueryResult {
      columns,
      rows: result_rows,
      total_count,
   })
}

pub async fn execute_mysql(
   connection_id: String,
   statement: String,
   manager: &ConnectionManager,
) -> Result<i64, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::MySql(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };
   let result = sqlx::query(&statement)
      .execute(pool)
      .await
      .map_err(|e| format!("Failed to execute: {}", e))?;
   Ok(result.rows_affected() as i64)
}

pub async fn get_mysql_foreign_keys(
   connection_id: String,
   table: String,
   manager: &ConnectionManager,
) -> Result<Vec<ForeignKeyInfo>, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::MySql(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let sql = "SELECT COLUMN_NAME as from_column, REFERENCED_TABLE_NAME as to_table, \
              REFERENCED_COLUMN_NAME as to_column FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE \
              TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL";
   let rows = sqlx::query(sql)
      .bind(&table)
      .fetch_all(pool)
      .await
      .map_err(|e| format!("Failed to get FKs: {}", e))?;

   Ok(rows
      .iter()
      .map(|r| ForeignKeyInfo {
         from_column: r.get("from_column"),
         to_table: r.get("to_table"),
         to_column: r.get("to_column"),
      })
      .collect())
}

pub async fn get_mysql_table_schema(
   connection_id: String,
   table: String,
   manager: &ConnectionManager,
) -> Result<Vec<crate::sql_common::ColumnInfo>, String> {
   use crate::sql_common::ColumnInfo;
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::MySql(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let sql = r#"
        SELECT
            COLUMN_NAME as name,
            DATA_TYPE as type,
            CASE WHEN IS_NULLABLE = 'NO' THEN true ELSE false END as notnull,
            COLUMN_DEFAULT as default_value,
            CASE WHEN COLUMN_KEY = 'PRI' THEN true ELSE false END as primary_key
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
    "#;

   let rows = sqlx::query(sql)
      .bind(&table)
      .fetch_all(pool)
      .await
      .map_err(|e| format!("Failed to get schema: {}", e))?;

   Ok(rows
      .iter()
      .map(|r| ColumnInfo {
         name: r.get("name"),
         r#type: r.get("type"),
         notnull: r.get::<bool, _>("notnull"),
         default_value: r.try_get("default_value").ok(),
         primary_key: r.get::<bool, _>("primary_key"),
      })
      .collect())
}

pub async fn insert_mysql_row(
   connection_id: String,
   table: String,
   columns: Vec<String>,
   values: Vec<serde_json::Value>,
   manager: &ConnectionManager,
) -> Result<i64, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::MySql(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let col_str: Vec<String> = columns.iter().map(|c| escape_identifier_mysql(c)).collect();
   let placeholders: Vec<String> = columns.iter().map(|_| "?".to_string()).collect();
   let sql = format!(
      "INSERT INTO {} ({}) VALUES ({})",
      escape_identifier_mysql(&table),
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

pub async fn update_mysql_row(
   connection_id: String,
   table: String,
   set_columns: Vec<String>,
   set_values: Vec<serde_json::Value>,
   where_column: String,
   where_value: serde_json::Value,
   manager: &ConnectionManager,
) -> Result<i64, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::MySql(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let set_clauses: Vec<String> = set_columns
      .iter()
      .map(|c| format!("{} = ?", escape_identifier_mysql(c)))
      .collect();
   let sql = format!(
      "UPDATE {} SET {} WHERE {} = ?",
      escape_identifier_mysql(&table),
      set_clauses.join(", "),
      escape_identifier_mysql(&where_column)
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

pub async fn delete_mysql_row(
   connection_id: String,
   table: String,
   where_column: String,
   where_value: serde_json::Value,
   manager: &ConnectionManager,
) -> Result<i64, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::MySql(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let sql = format!(
      "DELETE FROM {} WHERE {} = ?",
      escape_identifier_mysql(&table),
      escape_identifier_mysql(&where_column)
   );

   let result = sqlx::query(&sql)
      .bind(json_to_sql_string(&where_value))
      .execute(pool)
      .await
      .map_err(|e| format!("Delete failed: {}", e))?;
   Ok(result.rows_affected() as i64)
}
