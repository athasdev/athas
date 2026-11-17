//! Fixed states for the headless snapshot example, so the MongoDB, Redis and subscription views
//! can be looked at without a server.

use gpui::{Context, Window};
use serde_json::json;

use crate::{
    ConnectionState, DatabaseView, Dialog, TabBody, TableMode,
    connections::SavedConnection,
    model::{DbObject, ObjectKind, Provider, ResultSet},
    mongo_browser::MongoBrowser,
    nosql::{MongoCollection, RedisKey, RedisValue},
    redis_browser::RedisBrowser,
    subscriptions::{SubscriptionDetails, SubscriptionTab},
};

fn connection(provider: Provider, name: &str, database: &str) -> SavedConnection {
    SavedConnection {
        id: format!("preview-{}", provider.id()),
        name: name.into(),
        provider,
        file_path: String::new(),
        host: "localhost".into(),
        port: provider.default_port(),
        database: database.into(),
        username: String::new(),
        connection_string: None,
    }
}

impl DatabaseView {
    #[doc(hidden)]
    pub fn preview(&mut self, scene: &str, window: &mut Window, cx: &mut Context<Self>) {
        match scene {
            "mongo" => self.preview_mongo(window, cx),
            "redis" | "redis-info" => self.preview_redis(scene == "redis-info", window, cx),
            "subscription" | "subscription-details" => self.preview_subscription(scene == "subscription-details", window, cx),
            "subscription-form" => {
                self.preview_subscription(false, window, cx);
                self.show_create_subscription(window, cx);
            }
            "create-table" => self.show_create_table(window, cx),
            // `sql` or `sql:<query>`: a query tab with the query typed and the caret after it, so
            // its completions show (`athas_snapshot` can pass the scene through).
            scene if scene == "sql" || scene.starts_with("sql:") => {
                let query = scene.strip_prefix("sql:").unwrap_or("SELECT * FROM cu");
                self.new_query(Some(query.to_string()), window, cx);
            }
            // The open table's Schema and Info views.
            "schema" => self.set_view_mode(crate::TableMode::Structure, window, cx),
            "info" => self.set_view_mode(crate::TableMode::Info, window, cx),
            "json" => {
                self.dialog = Some(Dialog::Json {
                    title: "settings".into(),
                    text: serde_json::to_string_pretty(&json!({ "theme": "dark", "tabs": [1, 2, 3], "editor": { "wrap": true } }))
                        .unwrap_or_default(),
                });
            }
            _ => {}
        }
        cx.notify();
    }

    fn preview_mongo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.connection = Some(connection(Provider::Mongodb, "Local MongoDB", "shop"));
        self.state = ConnectionState::Connected;
        let mut mongo = MongoBrowser::new(window, cx);
        mongo.loading = false;
        mongo.databases = vec!["admin".into(), "shop".into(), "analytics".into()];
        mongo.database = Some("shop".into());
        mongo.collections = vec![
            MongoCollection { name: "customers".into(), count: 1284 },
            MongoCollection { name: "orders".into(), count: 9310 },
            MongoCollection { name: "products".into(), count: 212 },
        ];
        mongo.collection = Some("customers".into());
        mongo.total = 1284;
        mongo.elapsed = Some(std::time::Duration::from_millis(14));
        mongo.documents = vec![
            json!({ "_id": { "$oid": "65f0c0ffee0000000000a001" }, "name": "Ada Lovelace", "email": "ada@example.com", "orders": 12, "tags": ["vip", "early"] }),
            json!({ "_id": { "$oid": "65f0c0ffee0000000000a002" }, "name": "Grace Hopper", "email": "grace@example.com", "orders": 3, "address": { "city": "Arlington", "zip": "22201" } }),
            json!({ "_id": { "$oid": "65f0c0ffee0000000000a003" }, "name": "Alan Turing", "email": null, "orders": 0 }),
        ];
        self.mongo = Some(mongo);
    }

    fn preview_redis(&mut self, info: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.connection = Some(connection(Provider::Redis, "Cache", "0"));
        self.state = ConnectionState::Connected;
        let mut redis = RedisBrowser::new(window, cx);
        redis.loading = false;
        let key = |key: &str, ty: &str, ttl: i64| RedisKey { key: key.into(), ty: ty.into(), ttl };
        redis.keys = vec![
            key("session:8f2a", "string", 3540),
            key("user:42", "hash", -1),
            key("queue:emails", "list", -1),
            key("online", "set", -1),
            key("leaderboard", "zset", -1),
            key("feature:dark-mode", "string", -1),
        ];
        redis.has_more = true;
        redis.cursor = "17".into();
        redis.selected = Some("user:42".into());
        redis.value = Some(RedisValue {
            ty: "hash".into(),
            value: json!({ "name": "Ada", "email": "ada@example.com", "plan": "pro", "logins": "318" }),
        });
        redis.info = vec![
            ("connected_clients".into(), "4".into()),
            ("total_keys".into(), "1832".into()),
            ("uptime_seconds".into(), "86400".into()),
            ("used_memory_human".into(), "2.31M".into()),
            ("version".into(), "7.2.4".into()),
        ];
        redis.show_info = info;
        self.redis = Some(redis);
    }

    fn preview_subscription(&mut self, details: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.connection = Some(connection(Provider::Postgres, "Warehouse", "postgres"));
        self.state = ConnectionState::Connected;
        let object = |name: &str, kind| DbObject { name: name.into(), kind, owner: None };
        self.objects = vec![
            object("customers", ObjectKind::Table),
            object("orders", ObjectKind::Table),
            object("active_customers", ObjectKind::View),
            object("analytics_sub", ObjectKind::Subscription),
        ];
        let id = self.new_tab(
            TabBody::Subscription(SubscriptionTab {
                name: "analytics_sub".into(),
                details: Some(SubscriptionDetails {
                    name: "analytics_sub".into(),
                    enabled: true,
                    fields: vec![
                        ("Owner", "postgres".into()),
                        ("Enabled", "true".into()),
                        ("Publications", "pub_orders, pub_customers".into()),
                        ("Slot", "analytics_sub".into()),
                        ("Sync Commit", "off".into()),
                        ("Streaming", "off".into()),
                        ("Two Phase", "false".into()),
                        ("Connection", "host=primary.internal dbname=shop user=replicator password=********".into()),
                    ],
                }),
                mode: if details { TableMode::Structure } else { TableMode::Data },
            }),
            window,
            cx,
        );
        if let Some(tab) = self.tabs.iter().find(|tab| tab.id == id) {
            let status = ResultSet {
                columns: vec!["state".into(), "relation".into(), "lsn".into()],
                rows: vec![
                    vec![json!("r"), json!("customers"), json!("0/1A2B3C4")],
                    vec![json!("r"), json!("orders"), json!("0/1A2B3C4")],
                    vec![json!("d"), json!("order_items"), json!(null)],
                ],
            };
            tab.grid.update(cx, |grid, cx| grid.set_data(status, &[], &[], 0, cx));
        }
    }
}
