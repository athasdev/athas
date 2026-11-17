//! Renders the database view to a PNG without a window or a database server.
//!
//! `cargo run -p database_view --example database_snapshot -- out.png [dark|light] [sqlite|create-table|json|schema|info|sql[:query]|mongo|redis|redis-info|subscription|subscription-details|subscription-form]`

use std::{sync::Arc, time::Duration};

use anyhow::{Context as _, Result};
use database_view::DatabaseView;
use gpui::{AppContext as _, HeadlessAppContext, px, size};
use theme::Appearance;

fn fixture() -> Result<String> {
    let dir = std::env::temp_dir().join(format!("athas-db-snapshot-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("shop.sqlite");
    std::fs::remove_file(&path).ok();
    let connection = rusqlite::Connection::open(&path)?;
    connection.execute_batch(
        "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, settings TEXT);
         CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), total REAL);
         CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100;
         INSERT INTO customers (name, email, settings) VALUES
           ('Ada Lovelace', 'ada@example.com', '{\"theme\":\"dark\",\"tabs\":[1,2]}'),
           ('Grace Hopper', 'grace@example.com', NULL),
           ('Alan Turing', NULL, '{\"theme\":\"light\"}');
         INSERT INTO orders (customer_id, total) VALUES (1, 120.5), (2, 33.0), (1, 980.0);",
    )?;
    Ok(path.to_string_lossy().into_owned())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "database.png".into());
    let appearance = if args.get(1).map(String::as_str) == Some("light") { Appearance::Light } else { Appearance::Dark };
    let scene = args.get(2).cloned().unwrap_or_else(|| "sqlite".into());
    let file = (matches!(scene.as_str(), "sqlite" | "create-table" | "json" | "schema" | "info") || scene.starts_with("sql")).then(fixture).transpose()?;

    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), gpui_platform::current_headless_renderer);
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        theme::init(cx, None, appearance, false);
        Ok(())
    })?;

    let window = cx.open_window(size(px(1100.), px(640.)), |window, cx| cx.new(|cx| DatabaseView::new(file.clone(), window, cx)))?;
    let settle = |cx: &mut HeadlessAppContext| -> Result<()> {
        for _ in 0..8 {
            cx.update_window(window.into(), |_, window, _| window.refresh())?;
            cx.run_until_parked();
            std::thread::sleep(Duration::from_millis(40));
        }
        Ok(())
    };
    settle(&mut cx)?;
    cx.update_window(window.into(), |root, window, cx| {
        if let Ok(view) = root.downcast::<DatabaseView>() {
            view.update(cx, |view, cx| view.preview(&scene, window, cx));
        }
    })?;
    settle(&mut cx)?;
    let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}
