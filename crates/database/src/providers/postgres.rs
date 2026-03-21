use crate::{ConnectionManager, DatabasePool, sql_common::*};
use sqlx::{Column, Row};

fn escape_literal(value: &str) -> String {
   format!("'{}'", value.replace('\'', "''"))
}

fn redact_conninfo_password(conninfo: &str) -> String {
   let mut redacted_parts = Vec::new();
   for part in conninfo.split_whitespace() {
      if let Some((key, _)) = part.split_once('=')
         && key.eq_ignore_ascii_case("password")
      {
         redacted_parts.push(format!("{}=******", key));
      } else {
         redacted_parts.push(part.to_string());
      }
   }
   redacted_parts.join(" ")
}

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

pub async fn get_postgres_tables(
   connection_id: String,
   manager: &ConnectionManager,
) -> Result<Vec<TableInfo>, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let rows = sqlx::query(
      r#"
      SELECT table_name AS name, 'table' AS kind
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      UNION ALL
      SELECT subname AS name, 'subscription' AS kind
      FROM pg_catalog.pg_subscription
      ORDER BY kind, name
      "#,
   )
   .fetch_all(pool)
   .await
   .map_err(|e| format!("Failed to get tables: {}", e))?;

   Ok(rows
      .iter()
      .map(|r| TableInfo {
         name: r.get("name"),
         kind: r.get("kind"),
      })
      .collect())
}

pub async fn query_postgres(
   connection_id: String,
   query: String,
   manager: &ConnectionManager,
) -> Result<QueryResult, String> {
   let pool_arc = manager
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

pub async fn query_postgres_filtered(
   connection_id: String,
   params: FilteredQueryParams,
   manager: &ConnectionManager,
) -> Result<FilteredQueryResult, String> {
   let pool_arc = manager
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

pub async fn execute_postgres(
   connection_id: String,
   statement: String,
   manager: &ConnectionManager,
) -> Result<i64, String> {
   let pool_arc = manager
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

pub async fn get_postgres_foreign_keys(
   connection_id: String,
   table: String,
   manager: &ConnectionManager,
) -> Result<Vec<ForeignKeyInfo>, String> {
   let pool_arc = manager
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

pub async fn get_postgres_table_schema(
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
      .map(|r| ColumnInfo {
         name: r.get("name"),
         r#type: r.get("type"),
         notnull: r.get("notnull"),
         default_value: r.get("default_value"),
         primary_key: r.get("primary_key"),
      })
      .collect())
}

pub async fn get_postgres_subscription_info(
   connection_id: String,
   subscription: String,
   manager: &ConnectionManager,
) -> Result<PostgresSubscriptionInfo, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let sql = r#"
      SELECT
         sub.subname AS name,
         pg_get_userbyid(sub.subowner) AS owner,
         sub.subenabled AS enabled,
         sub.subpublications AS publications,
         sub.subconninfo AS connection_string,
         sub.subslotname AS slot_name,
         sub.subsynccommit AS synchronous_commit,
         sub.subbinary AS binary,
         sub.substream::text AS streaming,
         sub.subtwophasestate::text AS two_phase_state,
         sub.subdisableonerr AS disable_on_error,
         sub.subpasswordrequired AS password_required,
         sub.subrunasowner AS run_as_owner,
         sub.suborigin::text AS origin,
         sub.subfailover AS failover,
         sub.subtwophasestate IN ('enabled', 'pending') AS two_phase
      FROM pg_catalog.pg_subscription sub
      WHERE sub.subname = $1
   "#;

   let row = sqlx::query(sql)
      .bind(&subscription)
      .fetch_one(pool)
      .await
      .map_err(|e| format!("Failed to get subscription info: {}", e))?;

   Ok(PostgresSubscriptionInfo {
      name: row.get("name"),
      owner: row.get("owner"),
      enabled: row.get("enabled"),
      publications: row.get("publications"),
      connection_string: redact_conninfo_password(
         row.try_get::<String, _>("connection_string")
            .unwrap_or_default()
            .as_str(),
      ),
      slot_name: row.get("slot_name"),
      synchronous_commit: row.get("synchronous_commit"),
      binary: row.get("binary"),
      streaming: row.get("streaming"),
      two_phase: row.get("two_phase"),
      disable_on_error: row.get("disable_on_error"),
      password_required: row.get("password_required"),
      run_as_owner: row.get("run_as_owner"),
      origin: row.get("origin"),
      failover: row.get("failover"),
      two_phase_state: row.get("two_phase_state"),
   })
}

pub async fn get_postgres_subscription_status(
   connection_id: String,
   subscription: String,
   manager: &ConnectionManager,
) -> Result<QueryResult, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let sql = r#"
      SELECT
         sr.srsubstate::text AS state,
         c.relname AS relation,
         sr.srsublsn::text AS lsn
      FROM pg_catalog.pg_subscription_rel sr
      JOIN pg_catalog.pg_subscription s ON s.oid = sr.srsubid
      JOIN pg_catalog.pg_class c ON c.oid = sr.srrelid
      WHERE s.subname = $1
      ORDER BY c.relname
   "#;

   let rows = sqlx::query(sql)
      .bind(&subscription)
      .fetch_all(pool)
      .await
      .map_err(|e| format!("Failed to get subscription status: {}", e))?;

   let columns = vec![
      "state".to_string(),
      "relation".to_string(),
      "lsn".to_string(),
   ];
   let result_rows = rows.iter().map(row_to_json_values).collect();

   Ok(QueryResult {
      columns,
      rows: result_rows,
   })
}

pub async fn create_postgres_subscription(
   connection_id: String,
   params: CreatePostgresSubscriptionParams,
   manager: &ConnectionManager,
) -> Result<i64, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   if params.name.trim().is_empty() {
      return Err("Subscription name is required".to_string());
   }
   if params.connection_string.trim().is_empty() {
      return Err("Connection string is required".to_string());
   }
   if params.publications.is_empty() {
      return Err("At least one publication is required".to_string());
   }

   let publication_list = params
      .publications
      .iter()
      .map(|name| escape_identifier(name))
      .collect::<Vec<_>>()
      .join(", ");

   let mut with_parts = vec![
      format!(
         "enabled = {}",
         if params.enabled { "true" } else { "false" }
      ),
      format!(
         "create_slot = {}",
         if params.create_slot { "true" } else { "false" }
      ),
      format!(
         "copy_data = {}",
         if params.copy_data { "true" } else { "false" }
      ),
      format!(
         "connect = {}",
         if params.connect { "true" } else { "false" }
      ),
      format!(
         "failover = {}",
         if params.failover { "true" } else { "false" }
      ),
   ];

   if let Some(slot_name) = &params.with_slot_name
      && !slot_name.trim().is_empty()
   {
      with_parts.push(format!("slot_name = {}", escape_literal(slot_name)));
   }

   let sql = format!(
      "CREATE SUBSCRIPTION {} CONNECTION {} PUBLICATION {} WITH ({})",
      escape_identifier(&params.name),
      escape_literal(&params.connection_string),
      publication_list,
      with_parts.join(", ")
   );

   let result = sqlx::query(&sql)
      .execute(pool)
      .await
      .map_err(|e| format!("Failed to create subscription: {}", e))?;
   Ok(result.rows_affected() as i64)
}

pub async fn drop_postgres_subscription(
   connection_id: String,
   subscription: String,
   with_drop_slot: bool,
   manager: &ConnectionManager,
) -> Result<i64, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   if with_drop_slot {
      let sql = format!("DROP SUBSCRIPTION {}", escape_identifier(&subscription));
      let result = sqlx::query(&sql)
         .execute(pool)
         .await
         .map_err(|e| format!("Failed to drop subscription: {}", e))?;
      return Ok(result.rows_affected() as i64);
   }

   let mut tx = pool
      .begin()
      .await
      .map_err(|e| format!("Failed to start transaction: {}", e))?;

   let disable_sql = format!(
      "ALTER SUBSCRIPTION {} DISABLE",
      escape_identifier(&subscription)
   );
   sqlx::query(&disable_sql)
      .execute(&mut *tx)
      .await
      .map_err(|e| format!("Failed to disable subscription before drop: {}", e))?;

   let detach_slot_sql = format!(
      "ALTER SUBSCRIPTION {} SET (slot_name = NONE)",
      escape_identifier(&subscription)
   );
   sqlx::query(&detach_slot_sql)
      .execute(&mut *tx)
      .await
      .map_err(|e| format!("Failed to detach slot before drop: {}", e))?;

   let drop_sql = format!("DROP SUBSCRIPTION {}", escape_identifier(&subscription));
   let result = sqlx::query(&drop_sql)
      .execute(&mut *tx)
      .await
      .map_err(|e| format!("Failed to drop subscription: {}", e))?;

   tx.commit()
      .await
      .map_err(|e| format!("Failed to commit subscription drop: {}", e))?;

   Ok(result.rows_affected() as i64)
}

pub async fn set_postgres_subscription_enabled(
   connection_id: String,
   subscription: String,
   enabled: bool,
   manager: &ConnectionManager,
) -> Result<i64, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let sql = format!(
      "ALTER SUBSCRIPTION {} {}",
      escape_identifier(&subscription),
      if enabled { "ENABLE" } else { "DISABLE" }
   );

   let result = sqlx::query(&sql)
      .execute(pool)
      .await
      .map_err(|e| format!("Failed to update subscription state: {}", e))?;
   Ok(result.rows_affected() as i64)
}

pub async fn refresh_postgres_subscription(
   connection_id: String,
   subscription: String,
   copy_data: bool,
   manager: &ConnectionManager,
) -> Result<i64, String> {
   let pool_arc = manager
      .get_pool(&connection_id)
      .await
      .ok_or("Not connected")?;
   let pool = match pool_arc.as_ref() {
      DatabasePool::Postgres(p) => p,
      _ => return Err("Invalid pool type".to_string()),
   };

   let sql = format!(
      "ALTER SUBSCRIPTION {} REFRESH PUBLICATION WITH (copy_data = {})",
      escape_identifier(&subscription),
      if copy_data { "true" } else { "false" }
   );

   let result = sqlx::query(&sql)
      .execute(pool)
      .await
      .map_err(|e| format!("Failed to refresh subscription: {}", e))?;
   Ok(result.rows_affected() as i64)
}

pub async fn insert_postgres_row(
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

pub async fn update_postgres_row(
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

pub async fn delete_postgres_row(
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
