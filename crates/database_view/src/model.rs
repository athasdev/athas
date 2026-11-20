//! What the providers return and what the view keeps: objects, columns, result sets, filters.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(target_family = "wasm")]
use crate::athas_database;

/// The database engines Athas knows (`services/provider-registry.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Sqlite,
    Duckdb,
    Postgres,
    Mysql,
    Mongodb,
    Redis,
}

impl Provider {
    pub const ALL: [Provider; 6] =
        [Provider::Sqlite, Provider::Duckdb, Provider::Postgres, Provider::Mysql, Provider::Mongodb, Provider::Redis];

    pub fn label(self) -> &'static str {
        match self {
            Provider::Sqlite => "SQLite",
            Provider::Duckdb => "DuckDB",
            Provider::Postgres => "PostgreSQL",
            Provider::Mysql => "MySQL",
            Provider::Mongodb => "MongoDB",
            Provider::Redis => "Redis",
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Provider::Sqlite => "sqlite",
            Provider::Duckdb => "duckdb",
            Provider::Postgres => "postgres",
            Provider::Mysql => "mysql",
            Provider::Mongodb => "mongodb",
            Provider::Redis => "redis",
        }
    }

    pub fn is_file_based(self) -> bool {
        matches!(self, Provider::Sqlite | Provider::Duckdb)
    }

    /// Whether it has tables and runs SQL; MongoDB and Redis get their own browsers.
    pub fn is_sql(self) -> bool {
        !matches!(self, Provider::Mongodb | Provider::Redis)
    }

    pub fn default_port(self) -> u16 {
        match self {
            Provider::Postgres => 5432,
            Provider::Mysql => 3306,
            Provider::Mongodb => 27017,
            Provider::Redis => 6379,
            Provider::Sqlite | Provider::Duckdb => 0,
        }
    }

    pub fn file_extensions(self) -> &'static [&'static str] {
        match self {
            Provider::Sqlite => &["sqlite", "db", "sqlite3", "db3"],
            Provider::Duckdb => &["duckdb", "duck"],
            _ => &[],
        }
    }

    /// Whether this build can open it. DuckDB and the network engines are cargo features; on the
    /// web the workspace server opens them and answers for itself.
    pub fn is_available(self) -> bool {
        match self {
            Provider::Sqlite => true,
            Provider::Duckdb => cfg!(feature = "duckdb"),
            Provider::Postgres => cfg!(any(feature = "postgres", target_family = "wasm")),
            Provider::Mysql => cfg!(any(feature = "mysql", target_family = "wasm")),
            Provider::Mongodb => cfg!(any(feature = "mongodb", target_family = "wasm")),
            Provider::Redis => cfg!(any(feature = "redis", target_family = "wasm")),
        }
    }

    /// The provider a database file belongs to, by its extension.
    pub fn for_file(path: &str) -> Option<Provider> {
        let extension = std::path::Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
        [Provider::Sqlite, Provider::Duckdb]
            .into_iter()
            .find(|provider| provider.file_extensions().contains(&extension.as_str()))
    }

    /// Whether statements in the query editor use MySQL's backtick quoting.
    pub fn quote(self, name: &str) -> String {
        match self {
            Provider::Mysql => athas_database::sql_common::escape_identifier_mysql(name),
            _ => athas_database::sql_common::escape_identifier(name),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ObjectKind {
    Table,
    View,
    MaterializedView,
    Index,
    Subscription,
}

impl ObjectKind {
    pub fn parse(kind: &str) -> ObjectKind {
        match kind {
            "view" => ObjectKind::View,
            "materialized_view" => ObjectKind::MaterializedView,
            "index" => ObjectKind::Index,
            "subscription" => ObjectKind::Subscription,
            _ => ObjectKind::Table,
        }
    }

    pub fn group_label(self) -> &'static str {
        match self {
            ObjectKind::Table => "Tables",
            ObjectKind::View => "Views",
            ObjectKind::MaterializedView => "Materialized views",
            ObjectKind::Index => "Indexes",
            ObjectKind::Subscription => "Subscriptions",
        }
    }

    /// Whether its rows can be browsed in a grid.
    pub fn has_rows(self) -> bool {
        matches!(self, ObjectKind::Table | ObjectKind::View | ObjectKind::MaterializedView)
    }

    pub const ORDER: [ObjectKind; 5] =
        [ObjectKind::Table, ObjectKind::View, ObjectKind::MaterializedView, ObjectKind::Index, ObjectKind::Subscription];
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DbObject {
    pub name: String,
    pub kind: ObjectKind,
    /// The table an index belongs to.
    pub owner: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Column {
    pub name: String,
    pub ty: String,
    pub notnull: bool,
    pub default_value: Option<String>,
    pub primary_key: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ForeignKey {
    pub from_column: String,
    pub to_table: String,
    pub to_column: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DbInfo {
    pub version: String,
    pub size_bytes: Option<u64>,
    pub tables: usize,
    pub indexes: usize,
}

/// Rows as the grid shows them.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ResultSet {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

/// One page of a table, and how many rows match its filters.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Page {
    pub result: ResultSet,
    pub total: u64,
}

/// What running a statement in the query editor gave back.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct QueryOutcome {
    pub result: ResultSet,
    /// Rows changed, for statements that return none.
    pub affected: Option<u64>,
    /// The result was cut at [`MAX_QUERY_ROWS`].
    pub truncated: bool,
    pub elapsed: Duration,
}

/// The query editor keeps at most this many rows of a result.
pub const MAX_QUERY_ROWS: usize = 50_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FilterOp {
    Equals,
    NotEquals,
    Contains,
    StartsWith,
    EndsWith,
    Gt,
    Gte,
    Lt,
    Lte,
    Between,
    IsNull,
    IsNotNull,
}

impl FilterOp {
    pub const ALL: [FilterOp; 12] = [
        FilterOp::Equals,
        FilterOp::NotEquals,
        FilterOp::Contains,
        FilterOp::StartsWith,
        FilterOp::EndsWith,
        FilterOp::Gt,
        FilterOp::Gte,
        FilterOp::Lt,
        FilterOp::Lte,
        FilterOp::Between,
        FilterOp::IsNull,
        FilterOp::IsNotNull,
    ];

    pub fn label(self) -> &'static str {
        match self {
            FilterOp::Equals => "=",
            FilterOp::NotEquals => "!=",
            FilterOp::Contains => "contains",
            FilterOp::StartsWith => "starts with",
            FilterOp::EndsWith => "ends with",
            FilterOp::Gt => ">",
            FilterOp::Gte => ">=",
            FilterOp::Lt => "<",
            FilterOp::Lte => "<=",
            FilterOp::Between => "between",
            FilterOp::IsNull => "is null",
            FilterOp::IsNotNull => "is not null",
        }
    }

    /// The operator name the providers' WHERE builder takes.
    pub fn key(self) -> &'static str {
        match self {
            FilterOp::Equals => "equals",
            FilterOp::NotEquals => "notEquals",
            FilterOp::Contains => "contains",
            FilterOp::StartsWith => "startsWith",
            FilterOp::EndsWith => "endsWith",
            FilterOp::Gt => "gt",
            FilterOp::Gte => "gte",
            FilterOp::Lt => "lt",
            FilterOp::Lte => "lte",
            FilterOp::Between => "between",
            FilterOp::IsNull => "isNull",
            FilterOp::IsNotNull => "isNotNull",
        }
    }

    pub fn takes_value(self) -> bool {
        !matches!(self, FilterOp::IsNull | FilterOp::IsNotNull)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Filter {
    pub column: String,
    pub op: FilterOp,
    pub value: String,
    pub value2: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SortDirection {
    Asc,
    Desc,
}

/// Which page of a table to load.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PageRequest {
    pub table: String,
    pub filters: Vec<Filter>,
    pub search: String,
    pub search_columns: Vec<String>,
    pub sort: Option<(String, SortDirection)>,
    pub page_size: usize,
    pub offset: usize,
}

impl PageRequest {
    pub fn to_params(&self) -> athas_database::sql_common::FilteredQueryParams {
        athas_database::sql_common::FilteredQueryParams {
            table: self.table.clone(),
            filters: self
                .filters
                .iter()
                .map(|filter| athas_database::sql_common::ColumnFilter {
                    column: filter.column.clone(),
                    operator: filter.op.key().to_string(),
                    value: filter.value.clone(),
                    value2: (filter.op == FilterOp::Between).then(|| filter.value2.clone()),
                })
                .collect(),
            search_term: (!self.search.trim().is_empty()).then(|| self.search.trim().to_string()),
            search_columns: if self.search.trim().is_empty() { Vec::new() } else { self.search_columns.clone() },
            sort_column: self.sort.as_ref().map(|(column, _)| column.clone()),
            sort_direction: match self.sort {
                Some((_, SortDirection::Desc)) => "DESC".to_string(),
                _ => "ASC".to_string(),
            },
            page_size: self.page_size as i64,
            offset: self.offset as i64,
        }
    }
}

/// How a row is found again to change or delete it: its primary key, or every value it holds.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RowIdentity {
    pub columns: Vec<String>,
    pub values: Vec<Value>,
    /// Found by its primary key. Otherwise it is every value it holds, which identical rows
    /// share: a change through it must not touch more than one row.
    #[serde(default)]
    pub unique: bool,
}

impl RowIdentity {
    pub fn for_row(columns: &[Column], result_columns: &[String], row: &[Value]) -> RowIdentity {
        let keys: Vec<&Column> = columns.iter().filter(|column| column.primary_key).collect();
        let by_key = !keys.is_empty()
            && keys.iter().all(|key| {
                result_columns
                    .iter()
                    .position(|name| *name == key.name)
                    .and_then(|ix| row.get(ix))
                    .is_some_and(|value| !value.is_null())
            });
        if by_key {
            let (columns, values) = keys
                .iter()
                .filter_map(|key| {
                    let ix = result_columns.iter().position(|name| *name == key.name)?;
                    Some((key.name.clone(), row[ix].clone()))
                })
                .unzip();
            return RowIdentity { columns, values, unique: true };
        }
        // Binary values are shown as a "<binary data: N bytes>" placeholder, which no row holds:
        // matching on it would find nothing, so those columns are left out of the match.
        let (columns, values) = result_columns
            .iter()
            .zip(row)
            .filter(|(_, value)| !value.as_str().is_some_and(|text| text.starts_with("<binary data: ") && text.ends_with(" bytes>")))
            .map(|(column, value)| (column.clone(), value.clone()))
            .unzip();
        RowIdentity { columns, values, unique: false }
    }

    pub fn to_athas(&self) -> athas_database::sql_common::RowIdentity {
        athas_database::sql_common::RowIdentity { columns: self.columns.clone(), values: self.values.clone() }
    }
}
