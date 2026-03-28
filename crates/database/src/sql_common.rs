use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct TableInfo {
   pub name: String,
   #[serde(default = "default_database_object_kind")]
   pub kind: String,
}

fn default_database_object_kind() -> String {
   "table".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
   pub columns: Vec<String>,
   pub rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnFilter {
   pub column: String,
   pub operator: String,
   pub value: String,
   #[serde(default)]
   pub value2: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilteredQueryParams {
   pub table: String,
   pub filters: Vec<ColumnFilter>,
   #[serde(default)]
   pub search_term: Option<String>,
   #[serde(default)]
   pub search_columns: Vec<String>,
   #[serde(default)]
   pub sort_column: Option<String>,
   #[serde(default = "default_sort_direction")]
   pub sort_direction: String,
   #[serde(default = "default_page_size")]
   pub page_size: i64,
   #[serde(default)]
   pub offset: i64,
}

fn default_sort_direction() -> String {
   "ASC".to_string()
}

fn default_page_size() -> i64 {
   50
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FilteredQueryResult {
   pub columns: Vec<String>,
   pub rows: Vec<Vec<serde_json::Value>>,
   pub total_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
   pub from_column: String,
   pub to_table: String,
   pub to_column: String,
}

/// Escape a SQL identifier by wrapping in the given quote character (double-quote for standard SQL,
/// backtick for MySQL)
pub fn escape_identifier_with(name: &str, quote: char) -> String {
   let escaped = name.replace(quote, &format!("{}{}", quote, quote));
   format!("{}{}{}", quote, escaped, quote)
}

/// Standard SQL identifier escaping (double quotes) - for SQLite, PostgreSQL, DuckDB
pub fn escape_identifier(name: &str) -> String {
   escape_identifier_with(name, '"')
}

/// MySQL identifier escaping (backticks)
pub fn escape_identifier_mysql(name: &str) -> String {
   escape_identifier_with(name, '`')
}

/// Build WHERE clause and string parameter values from structured filters.
/// `placeholder_fn` generates the placeholder for a given 1-based parameter index, e.g. "?" for
/// SQLite/MySQL, "$1" for PostgreSQL.
pub fn build_where_clause_generic<F>(
   filters: &[ColumnFilter],
   search_term: &Option<String>,
   search_columns: &[String],
   logic: &str,
   escape_fn: fn(&str) -> String,
   placeholder_fn: F,
   param_offset: &mut usize,
) -> (String, Vec<String>)
where
   F: Fn(usize) -> String,
{
   let mut conditions: Vec<String> = Vec::new();
   let mut params: Vec<String> = Vec::new();

   // Search term across columns
   if let Some(term) = search_term
      && !term.is_empty()
      && !search_columns.is_empty()
   {
      let search_conditions: Vec<String> = search_columns
         .iter()
         .map(|col| {
            *param_offset += 1;
            format!(
               "CAST({} AS TEXT) LIKE {}",
               escape_fn(col),
               placeholder_fn(*param_offset)
            )
         })
         .collect();
      conditions.push(format!("({})", search_conditions.join(" OR ")));
      let like_value = format!("%{}%", term);
      for _ in search_columns {
         params.push(like_value.clone());
      }
   }

   // Column filters
   for filter in filters {
      let col = escape_fn(&filter.column);
      match filter.operator.as_str() {
         "equals" => {
            *param_offset += 1;
            conditions.push(format!("{} = {}", col, placeholder_fn(*param_offset)));
            params.push(filter.value.clone());
         }
         "notEquals" => {
            *param_offset += 1;
            conditions.push(format!("{} != {}", col, placeholder_fn(*param_offset)));
            params.push(filter.value.clone());
         }
         "contains" => {
            *param_offset += 1;
            conditions.push(format!("{} LIKE {}", col, placeholder_fn(*param_offset)));
            params.push(format!("%{}%", filter.value));
         }
         "startsWith" => {
            *param_offset += 1;
            conditions.push(format!("{} LIKE {}", col, placeholder_fn(*param_offset)));
            params.push(format!("{}%", filter.value));
         }
         "endsWith" => {
            *param_offset += 1;
            conditions.push(format!("{} LIKE {}", col, placeholder_fn(*param_offset)));
            params.push(format!("%{}", filter.value));
         }
         "gt" => {
            *param_offset += 1;
            conditions.push(format!("{} > {}", col, placeholder_fn(*param_offset)));
            params.push(filter.value.clone());
         }
         "gte" => {
            *param_offset += 1;
            conditions.push(format!("{} >= {}", col, placeholder_fn(*param_offset)));
            params.push(filter.value.clone());
         }
         "lt" => {
            *param_offset += 1;
            conditions.push(format!("{} < {}", col, placeholder_fn(*param_offset)));
            params.push(filter.value.clone());
         }
         "lte" => {
            *param_offset += 1;
            conditions.push(format!("{} <= {}", col, placeholder_fn(*param_offset)));
            params.push(filter.value.clone());
         }
         "between" => {
            if let Some(ref value2) = filter.value2 {
               *param_offset += 1;
               let p1 = placeholder_fn(*param_offset);
               *param_offset += 1;
               let p2 = placeholder_fn(*param_offset);
               conditions.push(format!("{} BETWEEN {} AND {}", col, p1, p2));
               params.push(filter.value.clone());
               params.push(value2.clone());
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

/// Convert a serde_json::Value to a SQL-safe string representation
pub fn json_to_sql_string(v: &serde_json::Value) -> String {
   match v {
      serde_json::Value::Null => "NULL".to_string(),
      serde_json::Value::Bool(b) => if *b { "1" } else { "0" }.to_string(),
      serde_json::Value::Number(n) => n.to_string(),
      serde_json::Value::String(s) => s.clone(),
      _ => v.to_string(),
   }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ColumnInfo {
   pub name: String,
   #[serde(rename = "type")]
   pub r#type: String,
   pub notnull: bool,
   pub default_value: Option<String>,
   pub primary_key: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PostgresSubscriptionInfo {
   pub name: String,
   pub owner: String,
   pub enabled: bool,
   pub publications: Vec<String>,
   pub connection_string: String,
   pub slot_name: Option<String>,
   pub synchronous_commit: Option<String>,
   pub binary: bool,
   pub streaming: Option<String>,
   pub two_phase: bool,
   pub disable_on_error: bool,
   pub password_required: bool,
   pub run_as_owner: bool,
   pub origin: Option<String>,
   pub failover: bool,
   pub two_phase_state: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatePostgresSubscriptionParams {
   pub name: String,
   pub connection_string: String,
   pub publications: Vec<String>,
   #[serde(default)]
   pub enabled: bool,
   #[serde(default)]
   pub create_slot: bool,
   #[serde(default)]
   pub copy_data: bool,
   #[serde(default)]
   pub connect: bool,
   #[serde(default)]
   pub failover: bool,
   #[serde(default)]
   pub with_slot_name: Option<String>,
}
