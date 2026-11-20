//! The providers and helpers against temporary SQLite files.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::{Value, json};

use crate::{
    backend::{Backend, returns_rows},
    connections::{self, SavedConnection},
    describe_sql, format, history,
    model::{Filter, FilterOp, ObjectKind, PageRequest, Provider, RowIdentity, SortDirection},
    sql_editor::{Token, highlight_line, line_starts},
    sqlite,
};

struct TempDb(PathBuf);

impl TempDb {
    fn new(name: &str) -> Self {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("athas-db-test-{name}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fixture.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
                 CREATE TABLE users (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     name TEXT NOT NULL,
                     email TEXT,
                     age INTEGER DEFAULT 30,
                     team_id INTEGER REFERENCES teams(id)
                 );
                 CREATE TABLE notes (body TEXT, score REAL);
                 CREATE VIEW adults AS SELECT * FROM users WHERE age >= 18;
                 CREATE INDEX users_email ON users (email);
                 INSERT INTO teams (name) VALUES ('core'), ('web');
                 INSERT INTO notes VALUES ('first', 1.5), ('first', 1.5), (NULL, 2.0);",
            )
            .unwrap();
        for ix in 0..120 {
            connection
                .execute(
                    "INSERT INTO users (name, email, age, team_id) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        format!("user{ix:03}"),
                        if ix % 10 == 0 { None } else { Some(format!("user{ix}@example.com")) },
                        10 + ix % 50,
                        1 + ix % 2
                    ],
                )
                .unwrap();
        }
        TempDb(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn connection(&self) -> Connection {
        sqlite::open(&self.0).unwrap()
    }

    fn backend(&self) -> Backend {
        let connection = SavedConnection::for_file(self.0.to_str().unwrap()).unwrap();
        Backend::open(&connection, None).unwrap()
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        if let Some(dir) = self.0.parent() {
            std::fs::remove_dir_all(dir).ok();
        }
    }
}

fn request(table: &str) -> PageRequest {
    PageRequest {
        table: table.into(),
        filters: Vec::new(),
        search: String::new(),
        search_columns: Vec::new(),
        sort: None,
        page_size: 50,
        offset: 0,
    }
}

#[test]
fn lists_tables_views_and_indexes() {
    let db = TempDb::new("objects");
    let objects = db.backend().objects().unwrap();
    let find = |name: &str| objects.iter().find(|object| object.name == name).unwrap();
    assert_eq!(find("users").kind, ObjectKind::Table);
    assert_eq!(find("adults").kind, ObjectKind::View);
    assert_eq!(find("users_email").kind, ObjectKind::Index);
    assert_eq!(find("users_email").owner.as_deref(), Some("users"));
    assert!(objects.iter().all(|object| !object.name.starts_with("sqlite_")));
}

#[test]
fn reads_columns_keys_and_info() {
    let db = TempDb::new("schema");
    let backend = db.backend();
    let columns = backend.columns("users").unwrap();
    let names: Vec<&str> = columns.iter().map(|column| column.name.as_str()).collect();
    assert_eq!(names, ["id", "name", "email", "age", "team_id"]);
    assert!(columns[0].primary_key);
    assert!(columns[1].notnull);
    assert_eq!(columns[3].ty, "INTEGER");
    assert_eq!(columns[3].default_value.as_deref(), Some("30"));

    let keys = backend.foreign_keys("users").unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!((keys[0].from_column.as_str(), keys[0].to_table.as_str(), keys[0].to_column.as_str()), ("team_id", "teams", "id"));

    let info = backend.info(0).unwrap();
    assert_eq!(info.tables, 3);
    assert_eq!(info.indexes, 1);
    assert!(info.size_bytes.unwrap() > 0);
}

#[test]
fn pages_through_a_table() {
    let db = TempDb::new("paging");
    let backend = db.backend();
    let first = backend.page(&request("users")).unwrap();
    assert_eq!(first.total, 120);
    assert_eq!(first.result.rows.len(), 50);
    assert_eq!(first.result.columns[1], "name");
    assert_eq!(first.result.rows[0][1], json!("user000"));

    let last = backend.page(&PageRequest { offset: 100, ..request("users") }).unwrap();
    assert_eq!(last.result.rows.len(), 20);
    assert_eq!(last.result.rows[0][1], json!("user100"));
}

#[test]
fn sorts_filters_and_searches() {
    let db = TempDb::new("filters");
    let backend = db.backend();

    let sorted = backend
        .page(&PageRequest { sort: Some(("name".into(), SortDirection::Desc)), page_size: 1, ..request("users") })
        .unwrap();
    assert_eq!(sorted.result.rows[0][1], json!("user119"));

    let null_emails = backend
        .page(&PageRequest {
            filters: vec![Filter { column: "email".into(), op: FilterOp::IsNull, value: String::new(), value2: String::new() }],
            ..request("users")
        })
        .unwrap();
    assert_eq!(null_emails.total, 12);
    assert!(null_emails.result.rows.iter().all(|row| row[2].is_null()));

    let between = backend
        .page(&PageRequest {
            filters: vec![Filter { column: "age".into(), op: FilterOp::Between, value: "20".into(), value2: "22".into() }],
            ..request("users")
        })
        .unwrap();
    assert!(between.total > 0);
    assert!(between.result.rows.iter().all(|row| (20..=22).contains(&row[3].as_i64().unwrap())));

    let searched = backend
        .page(&PageRequest {
            search: "USER11".into(),
            search_columns: vec!["name".into(), "email".into()],
            ..request("users")
        })
        .unwrap();
    assert_eq!(searched.total, 11);

    let injection = backend
        .page(&PageRequest {
            filters: vec![Filter {
                column: "name".into(),
                op: FilterOp::Equals,
                value: "'; DROP TABLE users; --".into(),
                value2: String::new(),
            }],
            ..request("users")
        })
        .unwrap();
    assert_eq!(injection.total, 0);
    assert_eq!(backend.page(&request("users")).unwrap().total, 120);
}

#[test]
fn runs_queries_and_statements() {
    let db = TempDb::new("queries");
    let backend = db.backend();

    let outcome = backend.run("SELECT name, age FROM users WHERE id <= 3 ORDER BY id").unwrap();
    assert_eq!(outcome.result.columns, ["name", "age"]);
    assert_eq!(outcome.result.rows.len(), 3);
    assert_eq!(outcome.affected, None);

    let typed = backend.run("SELECT 1 AS one, 2.5 AS half, NULL AS empty, x'00ff' AS blob").unwrap();
    assert_eq!(typed.result.rows[0], vec![json!(1), json!(2.5), Value::Null, json!("<binary data: 2 bytes>")]);

    let update = backend.run("UPDATE users SET age = 99 WHERE id <= 5").unwrap();
    assert_eq!(update.affected, Some(5));
    assert!(update.result.columns.is_empty());

    let script = backend.run("INSERT INTO teams (name) VALUES ('ops'); DELETE FROM teams WHERE name = 'ops';").unwrap();
    assert_eq!(script.affected, Some(2));

    let mixed = backend.run("INSERT INTO teams (name) VALUES ('qa'); SELECT name FROM teams ORDER BY id DESC LIMIT 1").unwrap();
    assert_eq!(mixed.result.rows, vec![vec![json!("qa")]]);

    let created = backend.run("CREATE TABLE fresh (id INTEGER)").unwrap();
    assert_eq!(created.affected, Some(0));
    assert!(backend.objects().unwrap().iter().any(|object| object.name == "fresh"));

    assert!(backend.run("SELECT * FROM missing").is_err());
}

#[test]
fn inserts_updates_and_deletes_rows() {
    let db = TempDb::new("edits");
    let backend = db.backend();
    let columns = backend.columns("users").unwrap();

    let inserted = backend
        .insert("users", &["name".into(), "email".into()], &[json!("new person"), Value::Null])
        .unwrap();
    assert_eq!(inserted, 1);
    let row = db.connection().query_row("SELECT id, age, email FROM users WHERE name = 'new person'", [], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, Option<String>>(2)?))
    });
    let (id, age, email) = row.unwrap();
    assert_eq!((id, age, email), (121, 30, None));

    let page = backend.page(&PageRequest { offset: 120, ..request("users") }).unwrap();
    let identity = RowIdentity::for_row(&columns, &page.result.columns, &page.result.rows[0]);
    assert_eq!(identity.columns, ["id"]);
    let updated = backend.update("users", &["email".into(), "age".into()], &[json!("n@example.com"), json!(41)], &identity).unwrap();
    assert_eq!(updated, 1);
    let (email, age): (String, i64) = db
        .connection()
        .query_row("SELECT email, age FROM users WHERE id = 121", [], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap();
    assert_eq!((email.as_str(), age), ("n@example.com", 41));

    assert_eq!(backend.delete("users", &identity).unwrap(), 1);
    assert_eq!(backend.page(&request("users")).unwrap().total, 120);
}

#[test]
fn edits_rows_without_a_primary_key_by_their_values() {
    let db = TempDb::new("rowvalues");
    let backend = db.backend();
    let columns = backend.columns("notes").unwrap();
    let page = backend.page(&request("notes")).unwrap();
    let null_row = page.result.rows.iter().find(|row| row[0].is_null()).unwrap();
    let identity = RowIdentity::for_row(&columns, &page.result.columns, null_row);
    assert_eq!(identity.columns, ["body", "score"]);
    assert_eq!(backend.update("notes", &["body".into()], &[json!("filled")], &identity).unwrap(), 1);
    let filled: i64 = db.connection().query_row("SELECT COUNT(*) FROM notes WHERE body = 'filled'", [], |row| row.get(0)).unwrap();
    assert_eq!(filled, 1);
}

#[test]
fn refuses_missing_files() {
    let missing = SavedConnection::for_file("/definitely/not/here.sqlite").unwrap();
    assert!(Backend::open(&missing, None).is_err());
    assert!(!Path::new("/definitely/not/here.sqlite").exists());
}

#[test]
fn builds_statements_for_confirmation() {
    let identity = RowIdentity { columns: vec!["id".into(), "email".into()], values: vec![json!(7), Value::Null], unique: false };
    let (sql, values) = sqlite::update_sql("users", &["name".into()], &identity).unwrap();
    assert_eq!(sql, "UPDATE \"users\" SET \"name\" = ? WHERE \"id\" = ? AND \"email\" IS NULL");
    let all: Vec<Value> = std::iter::once(json!("O'Brien")).chain(values).collect();
    assert_eq!(describe_sql(&sql, &all), "UPDATE \"users\" SET \"name\" = 'O''Brien' WHERE \"id\" = 7 AND \"email\" IS NULL");
    assert_eq!(sqlite::insert_sql("t", &[]), "INSERT INTO \"t\" DEFAULT VALUES");
}

#[test]
fn saves_connections_without_secrets() {
    let db = TempDb::new("connections");
    let store = db.path().with_file_name("connections.json");
    let saved = vec![
        SavedConnection::for_file(db.path().to_str().unwrap()).unwrap(),
        SavedConnection {
            id: "pg".into(),
            name: "Production".into(),
            provider: Provider::Postgres,
            file_path: String::new(),
            host: "db.internal".into(),
            port: 5432,
            database: "app".into(),
            username: "app".into(),
            connection_string: None,
        },
    ];
    connections::save(&store, &saved).unwrap();
    let text = std::fs::read_to_string(&store).unwrap();
    assert!(!text.contains("password"));
    assert!(text.contains("\"db_type\": \"postgres\""));
    assert_eq!(connections::load(&store), saved);
    assert_eq!(saved[1].location(), "app@db.internal:5432/app");
    assert!(saved[1].validate().is_ok());

    let mut url = saved[1].clone();
    url.connection_string = Some("postgres://app:hunter2@db/app".into());
    assert_eq!(url.location(), "postgres://app:••••@db/app");
}

#[test]
fn keeps_sql_history() {
    let db = TempDb::new("history");
    let store = db.path().with_file_name("history.json");
    let mut entries = Vec::new();
    for query in ["SELECT 1", "select 2;", "SELECT   1;", "-- note\nSELECT 3"] {
        entries = history::add(&entries, query);
    }
    assert_eq!(entries, ["-- note\nSELECT 3", "SELECT   1;", "select 2;"]);
    for ix in 0..20 {
        entries = history::add(&entries, &format!("SELECT {ix}0"));
    }
    assert_eq!(entries.len(), history::LIMIT);
    history::save(&store, "sqlite:file:/x", &entries);
    assert_eq!(history::load(&store, "sqlite:file:/x"), entries);
    assert!(history::load(&store, "other").is_empty());
    let removed = history::remove(&entries, "SELECT 190;");
    assert_eq!(removed.len(), history::LIMIT - 1);
    assert_eq!(history::preview("SELECT\n  *\nFROM t;"), "SELECT * FROM t");
}

#[test]
fn detects_dates_and_timestamps() {
    for date in ["2024-01-15T10:30:00Z", "2024-01-15T10:30:00.000Z", "2024-01-15T10:30:00+05:30", "2024-01-15T10:30:00-07:00", "2024-01-15", "2024-12-31", "2024-01-15T10:30", "2024-01-15T10:30:00"] {
        assert!(format::is_iso_date(date), "{date}");
    }
    for text in ["hello world", "12345", "2024/01/15", "", "not-a-date", "2024-01", &"a".repeat(31), "2024-13-01", "2024-01-15T10:30:00.Z"] {
        assert!(!format::is_iso_date(text), "{text}");
    }
    assert!(format::is_unix_timestamp(1_705_320_000.));
    assert!(format::is_unix_timestamp(946_684_800.));
    for value in [0., -1., 100., 5_000_000_000.] {
        assert!(!format::is_unix_timestamp(value));
    }
    let (text, raw) = format::date_cell(&json!("2024-01-15T10:30:00Z")).unwrap();
    assert!(text.contains("2024") && text.ends_with('M'), "{text}");
    assert_eq!(raw, "2024-01-15T10:30:00Z");
    let (_, raw) = format::date_cell(&json!(1_705_320_000)).unwrap();
    assert_eq!(raw, "Raw: 1705320000");
    assert!(format::date_cell(&json!(42)).is_none());
    assert!(format::date_cell(&json!("hello")).is_none());
}

#[test]
fn formats_values() {
    assert_eq!(format::cell_text(&Value::Null), "NULL");
    assert_eq!(format::cell_text(&json!("a\nb")), "a↵b");
    assert_eq!(format::parse_input("42", "INTEGER"), json!(42));
    assert_eq!(format::parse_input("4.5", "REAL"), json!(4.5));
    assert_eq!(format::parse_input("042abc", "INTEGER"), json!("042abc"));
    assert_eq!(format::parse_input("true", "boolean"), json!(true));
    assert_eq!(format::parse_input("42", "TEXT"), json!("42"));
    let result = crate::model::ResultSet {
        columns: vec!["a".into(), "b".into()],
        rows: vec![vec![json!("x,y"), Value::Null], vec![json!(1), json!("say \"hi\"")]],
    };
    assert_eq!(format::to_csv(&result), "a,b\n\"x,y\",\n1,\"say \"\"hi\"\"\"");
    assert_eq!(format::format_count(1234567), "1,234,567");
    assert_eq!(format::format_bytes(2048), "2.0 KB");
}

#[test]
fn tells_queries_from_statements() {
    assert!(returns_rows("  -- comment\nselect 1"));
    assert!(returns_rows("WITH x AS (SELECT 1) SELECT * FROM x"));
    assert!(returns_rows("INSERT INTO t VALUES (1) RETURNING id"));
    assert!(!returns_rows("update t set a = 1"));
    assert!(!returns_rows("/* c */ DELETE FROM t"));
}

#[test]
fn highlights_sql() {
    let (spans, in_comment) = highlight_line("SELECT name, 'it''s' FROM t -- done", false);
    let kinds: Vec<Token> = spans.iter().map(|(_, token)| *token).collect();
    assert_eq!(kinds, [Token::Keyword, Token::String, Token::Keyword, Token::Comment]);
    assert!(!in_comment);
    let (spans, in_comment) = highlight_line("a /* open", false);
    assert_eq!(spans.last().unwrap().1, Token::Comment);
    assert!(in_comment);
    let (spans, in_comment) = highlight_line("still */ count(1)", true);
    assert_eq!(spans[0], (0..8, Token::Comment));
    assert_eq!(spans[1].1, Token::Function);
    assert!(!in_comment);
    assert_eq!(line_starts("a\nbc\n"), [0, 2, 5]);
}

mod nosql_and_forms {
    use serde_json::{Value, json};

    use crate::{
        backend::Backend,
        connections::SavedConnection,
        format,
        forms::{self, ColumnDraft, SubscriptionDraft},
        model::{ObjectKind, Provider},
        nosql::{self, RedisKey},
        subscriptions,
    };

    fn network(provider: Provider, host: &str, username: &str, database: &str) -> SavedConnection {
        SavedConnection {
            id: format!("test-{}", provider.id()),
            name: provider.label().into(),
            provider,
            file_path: String::new(),
            host: host.into(),
            port: provider.default_port(),
            database: database.into(),
            username: username.into(),
            connection_string: None,
        }
    }

    /// A server already listening on localhost, for the live checks; they pass quietly without one.
    fn listening(port: u16) -> bool {
        let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        std::net::TcpStream::connect_timeout(&address, std::time::Duration::from_millis(200)).is_ok()
    }

    #[test]
    fn document_stores_are_available() {
        assert!(Provider::Mongodb.is_available());
        assert!(Provider::Redis.is_available());
        assert!(!Provider::Mongodb.is_sql() && !Provider::Redis.is_sql() && Provider::Postgres.is_sql());
    }

    #[test]
    fn builds_mongo_urls_without_empty_credentials() {
        let anonymous = network(Provider::Mongodb, "localhost", "", "app");
        assert_eq!(nosql::mongo_url(&anonymous).as_deref(), Some("mongodb://localhost:27017/app"));
        let no_database = network(Provider::Mongodb, "db.local", "", "");
        assert_eq!(nosql::mongo_url(&no_database).as_deref(), Some("mongodb://db.local:27017"));
        assert_eq!(nosql::mongo_url(&network(Provider::Mongodb, "localhost", "admin", "app")), None);
        assert_eq!(nosql::mongo_url(&network(Provider::Redis, "localhost", "", "")), None);
    }

    #[test]
    fn validates_mongo_filters_and_sorts() {
        assert_eq!(nosql::normalize_query_json("  "), "{}");
        assert_eq!(nosql::normalize_query_json(r#" {"a": 1} "#), r#"{"a": 1}"#);
        assert_eq!(nosql::query_json_error(r#"{"name": "John"}"#, "filter"), None);
        assert_eq!(nosql::query_json_error("[1, 2]", "sort").as_deref(), Some("MongoDB sort JSON must be an object"));
        assert_eq!(nosql::query_json_error("{name:", "filter").as_deref(), Some("Invalid MongoDB filter JSON"));
    }

    #[test]
    fn pages_mongo_documents() {
        assert_eq!(nosql::page_count(0, 50), 1);
        assert_eq!(nosql::page_count(101, 50), 3);
        assert_eq!(nosql::clamp_page(101, 50, 7), 2);
        assert_eq!(nosql::clamp_page(0, 50, 3), 0);
        assert_eq!(nosql::document_number(0, 50, 0), 1);
        assert_eq!(nosql::document_number(2, 25, 4), 55);

        let page = nosql::parse_mongo_page(json!({
            "documents": [{ "_id": { "$oid": "65f0c0ffee" }, "name": "Ada" }, 3, { "name": "Grace" }],
            "total_count": 42
        }));
        assert_eq!(page.total, 42);
        assert_eq!(page.documents.len(), 2);
        assert_eq!(nosql::parse_mongo_page(json!(null)), nosql::MongoPage::default());
    }

    #[test]
    fn finds_documents_again_by_id() {
        let document = json!({ "_id": { "$oid": "65f0c0ffee0000000000abcd" }, "name": "Ada" });
        let filter: Value = serde_json::from_str(&nosql::document_id_filter(&document).unwrap()).unwrap();
        assert_eq!(filter, json!({ "_id": { "$oid": "65f0c0ffee0000000000abcd" } }));
        assert_eq!(nosql::document_id_filter(&json!({ "name": "no id" })), None);
        assert!(nosql::document_text(&document).contains("\n  \"name\": \"Ada\""));
    }

    #[test]
    fn scans_redis_keys() {
        assert_eq!(nosql::normalize_pattern("  "), "*");
        assert_eq!(nosql::normalize_pattern(" user:* "), "user:*");
        let key = |name: &str| RedisKey { key: name.into(), ty: "string".into(), ttl: -1 };
        let mut keys = vec![key("a"), key("b")];
        nosql::merge_keys(&mut keys, vec![key("b"), key(""), key("c")]);
        let names: Vec<&str> = keys.iter().map(|key| key.key.as_str()).collect();
        assert_eq!(names, ["a", "b", "c"]);
        assert_eq!(nosql::type_badge("string"), "str");
        assert_eq!(nosql::type_badge("zset"), "zse");
        assert_eq!(nosql::format_ttl(30).as_deref(), Some("30s"));
        assert_eq!(nosql::format_ttl(-1), None);
    }

    #[test]
    fn shows_redis_values_and_info() {
        let string = nosql::parse_redis_value(json!({ "type": "string", "value": "hello" }));
        assert_eq!(string.ty, "string");
        assert_eq!(nosql::redis_value_text(&string.value), "hello");
        let hash = nosql::parse_redis_value(json!({ "type": "hash", "value": { "name": "Ada" } }));
        assert_eq!(nosql::redis_value_text(&hash.value), "{\n  \"name\": \"Ada\"\n}");
        assert_eq!(nosql::parse_redis_value(json!({})).ty, "unknown");

        let rows = nosql::info_rows(&json!({ "redis_version": "7.2.4", "total_keys": 12, "missing": null }));
        assert_eq!(rows, [("redis_version".to_string(), "7.2.4".to_string()), ("total_keys".to_string(), "12".to_string())]);
    }

    #[test]
    fn writes_create_table_statements() {
        let columns = forms::normalize_columns(vec![
            ColumnDraft { name: " id ".into(), ty: "INTEGER".into(), notnull: true },
            ColumnDraft { name: "".into(), ty: "TEXT".into(), notnull: false },
            ColumnDraft { name: "ID".into(), ty: "TEXT".into(), notnull: false },
            ColumnDraft { name: "note".into(), ty: " ".into(), notnull: false },
        ]);
        assert_eq!(columns.len(), 2);
        assert_eq!(columns[1].ty, "TEXT");
        assert_eq!(
            forms::create_table_sql(Provider::Sqlite, " todo items ", &columns),
            r#"CREATE TABLE "todo items" ("id" INTEGER NOT NULL, "note" TEXT)"#
        );
        assert_eq!(forms::create_table_sql(Provider::Mysql, "t", &columns), "CREATE TABLE `t` (`id` INTEGER NOT NULL, `note` TEXT)");
    }

    #[test]
    fn identical_rows_without_a_key_are_not_all_deleted() {
        let db = super::TempDb::new("no-key");
        let backend = db.backend();
        backend.run("CREATE TABLE log(msg TEXT); INSERT INTO log VALUES ('x'); INSERT INTO log VALUES ('x');").unwrap();
        let identity = crate::RowIdentity { columns: vec!["msg".into()], values: vec![json!("x")], unique: false };
        assert!(backend.delete("log", &identity).is_err());
        assert_eq!(backend.run("SELECT COUNT(*) FROM log").unwrap().result.rows[0][0], json!(2), "both rows are still there");
    }

    #[test]
    fn creates_a_table_in_sqlite() {
        let db = super::TempDb::new("create-table");
        let backend = db.backend();
        let columns = vec![
            ColumnDraft { name: "id".into(), ty: "INTEGER".into(), notnull: true },
            ColumnDraft { name: "title".into(), ty: "TEXT".into(), notnull: false },
        ];
        backend.run(&forms::create_table_sql(Provider::Sqlite, "todos", &columns)).unwrap();
        let objects = backend.objects().unwrap();
        assert!(objects.iter().any(|object| object.name == "todos" && object.kind == ObjectKind::Table));
        let created = backend.columns("todos").unwrap();
        assert!(created[0].notnull);
        assert_eq!(created[1].ty, "TEXT");
    }

    #[test]
    fn prepares_subscriptions() {
        assert_eq!(forms::parse_publications(" pub_one, ,pub_two "), ["pub_one", "pub_two"]);
        let draft = SubscriptionDraft {
            name: " analytics ".into(),
            connection_string: " host=db ".into(),
            publications: vec![" pub_one ".into(), "".into()],
            slot_name: Some("  ".into()),
            ..SubscriptionDraft::default()
        };
        assert!(draft.is_complete());
        assert!(!SubscriptionDraft::default().is_complete());
        let params = subscriptions::subscription_params(&draft);
        assert_eq!(params.name, "analytics");
        assert_eq!(params.publications, ["pub_one"]);
        assert_eq!(params.with_slot_name, None);
        assert!(params.enabled && params.create_slot && params.copy_data && params.connect && !params.failover);
    }

    #[test]
    fn lists_subscription_settings() {
        let info = athas_database::sql_common::PostgresSubscriptionInfo {
            name: "analytics".into(),
            owner: "postgres".into(),
            enabled: false,
            publications: vec!["pub_one".into(), "pub_two".into()],
            connection_string: "host=db password=********".into(),
            slot_name: None,
            synchronous_commit: Some("off".into()),
            binary: true,
            streaming: None,
            two_phase: false,
            disable_on_error: false,
            password_required: true,
            run_as_owner: false,
            origin: Some("any".into()),
            failover: false,
            two_phase_state: Some("d".into()),
        };
        let details = subscriptions::subscription_details(&info);
        assert!(!details.enabled);
        let field = |label: &str| details.fields.iter().find(|(name, _)| *name == label).unwrap().1.clone();
        assert_eq!(field("Publications"), "pub_one, pub_two");
        assert_eq!(field("Slot"), "-");
        assert_eq!(field("Binary"), "true");
        assert_eq!(field("Enabled"), "false");
        assert_eq!(details.fields.len(), 15);
    }

    #[test]
    fn formats_json_cells() {
        assert_eq!(format::json_text(&json!(r#"{"a":[1,2]}"#)).unwrap(), "{\n  \"a\": [\n    1,\n    2\n  ]\n}");
        assert_eq!(format::json_text(&json!({ "a": 1 })).unwrap(), "{\n  \"a\": 1\n}");
        assert_eq!(format::json_text(&json!("{not json}")), None);
        assert_eq!(format::json_text(&json!("plain")), None);
        assert_eq!(format::json_text(&json!(12)), None);
    }

    #[test]
    fn sql_calls_refuse_document_stores() {
        let db = super::TempDb::new("not-mongo");
        let backend = db.backend();
        assert!(backend.mongo_databases().is_err());
        assert!(backend.redis_scan("*", "0").is_err());
        assert!(backend.subscription_details("analytics").is_err());
    }

    #[test]
    fn browses_a_local_mongodb_if_one_is_running() {
        if !listening(27017) {
            return;
        }
        let connection = network(Provider::Mongodb, "127.0.0.1", "", "");
        let backend = Backend::open(&connection, None).unwrap();
        let databases = backend.mongo_databases().unwrap();
        if let Some(database) = databases.first() {
            let collections = backend.mongo_collections(database).unwrap();
            if let Some(collection) = collections.first() {
                let (page, number) = backend.mongo_documents(database, &collection.name, "{}", "{}", 0, 10).unwrap();
                assert_eq!(number, 0);
                assert!(page.documents.len() <= 10);
            }
        }
        backend.close();
    }

    #[test]
    fn browses_a_local_redis_if_one_is_running() {
        if !listening(6379) {
            return;
        }
        let connection = network(Provider::Redis, "127.0.0.1", "", "");
        let backend = Backend::open(&connection, None).unwrap();
        let scan = backend.redis_scan("*", "0").unwrap();
        if let Some(key) = scan.keys.first() {
            assert!(!backend.redis_value(&key.key).unwrap().ty.is_empty());
        }
        assert!(!backend.redis_info().unwrap().is_empty());
        backend.close();
    }
}

#[cfg(feature = "duckdb")]
#[test]
fn duckdb_files_list_page_query_and_edit() {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("athas-duckdb-test-{nanos}"));
    std::fs::create_dir_all(&dir).unwrap();
    let backend = Backend::Duckdb(dir.join("fixture.duckdb"));
    backend.run("CREATE TABLE teams (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL)").unwrap();
    backend.run("INSERT INTO teams VALUES (1, 'core'), (2, 'web')").unwrap();
    assert!(backend.objects().unwrap().iter().any(|object| object.name == "teams" && object.kind == ObjectKind::Table));
    let columns = backend.columns("teams").unwrap();
    assert_eq!(columns.iter().map(|column| column.name.as_str()).collect::<Vec<_>>(), ["id", "name"]);
    assert!(columns[0].primary_key);
    assert_eq!(backend.page(&request("teams")).unwrap().total, 2);
    backend.insert("teams", &["id".into(), "name".into()], &[json!(3), json!("docs")]).unwrap();
    let outcome = backend.run("SELECT name FROM teams ORDER BY id").unwrap();
    assert_eq!(outcome.result.rows.iter().map(|row| row[0].clone()).collect::<Vec<Value>>(), [json!("core"), json!("web"), json!("docs")]);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn database_page_lists_new_saved_then_detected_files() {
    use crate::connections_picker::{DatabaseConnectionsDelegate, Row, workspace_database_files};
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let root = std::env::temp_dir().join(format!("athas-db-page-{nanos}"));
    std::fs::create_dir_all(root.join("data")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    std::fs::write(root.join("data/app.sqlite"), b"").unwrap();
    std::fs::write(root.join("saved.db"), b"").unwrap();
    std::fs::write(root.join("node_modules/pkg/skip.sqlite"), b"").unwrap();
    let files = workspace_database_files(&root);
    let relative: Vec<&str> = files.iter().map(|(_, relative, _)| relative.as_str()).collect();
    assert_eq!(relative, ["data/app.sqlite", "saved.db"]);

    let saved = crate::SavedConnection::for_file(&root.join("saved.db").to_string_lossy()).unwrap();
    let delegate = DatabaseConnectionsDelegate::with(vec![saved.clone()], files);
    let rows = delegate.rows();
    assert_eq!(rows[0], Row::New);
    assert_eq!(rows[1], Row::Saved(saved));
    // A saved file is not listed again as found in the project.
    assert_eq!(rows.len(), 3);
    assert!(matches!(&rows[2], Row::Detected { relative, .. } if relative == "data/app.sqlite"));
    std::fs::remove_dir_all(&root).ok();
}
