//! Renders the Run and Debug view to a PNG without a window, paused in a session on the scripted
//! adapter (`dap::testing::FakeAdapter`).
//!
//! `cargo run -p debugger_ui --example debugger_snapshot -- out.png [dark|light] [paused|idle] [width] [height]`

use std::{sync::Arc, time::Duration};

use anyhow::{Context as _, Result};
use dap::{BreakpointField, BreakpointStore, DebugSession, SessionStatus, testing::FakeAdapter};
use debugger_ui::DebuggerView;
use gpui::{AppContext as _, HeadlessAppContext, px, size};
use theme::Appearance;

const PROGRAM: &str = "import json\n\n\ndef compute(items):\n    count = len(items)\n    user = {'name': 'Ada', 'age': 36}\n    total = sum(items)\n    return total * count\n\n\ndef main():\n    print(compute([1, 2, 3]))\n";

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "debugger.png".into());
    let appearance = if args.get(1).map(String::as_str) == Some("light") { Appearance::Light } else { Appearance::Dark };
    let scene = args.get(2).cloned().unwrap_or_else(|| "paused".into());
    let width: f32 = args.get(3).and_then(|width| width.parse().ok()).unwrap_or(380.);
    let height: f32 = args.get(4).and_then(|height| height.parse().ok()).unwrap_or(900.);

    let root = std::env::temp_dir().join("athas-debugger-snapshot");
    std::fs::create_dir_all(root.join(".vscode"))?;
    std::fs::write(root.join("app.py"), PROGRAM)?;
    std::fs::write(
        root.join(".vscode/launch.json"),
        "{\n  // Debug the app\n  \"configurations\": [\n    { \"name\": \"Python: app.py\", \"type\": \"debugpy\", \"request\": \"launch\", \"program\": \"${workspaceFolder}/app.py\", },\n  ],\n}\n",
    )?;
    let source = root.join("app.py");

    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || gpui_platform::current_headless_renderer());
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        theme::init(cx, None, appearance, false);
        let store = cx.new(|_| BreakpointStore::new(None));
        store.update(cx, |store, cx| {
            store.toggle(&source, 5, cx);
            store.toggle(&source, 6, cx);
            let id = store.breakpoints_for(&source)[1].id;
            store.set_field(id, BreakpointField::Condition, Some("total > 5".into()), cx);
            store.toggle(&source, 11, cx);
            let id = store.breakpoints_for(&source)[2].id;
            store.set_field(id, BreakpointField::LogMessage, Some("compute returned {result}".into()), cx);
            store.toggle(&source, 199, cx);
            let other = root.join("lib").join("helpers.py");
            store.toggle(&other, 2, cx);
            let id = store.breakpoints_for(&other)[0].id;
            store.set_enabled(id, false, cx);
        });
        BreakpointStore::set_global(store, cx);
        Ok(())
    })?;

    let window = cx.open_window(size(px(width), px(height)), |window, cx| cx.new(|cx| DebuggerView::new(root.clone(), window, cx)))?;
    cx.allow_parking();

    // Kept alive until the picture is taken.
    let fake = FakeAdapter::start(source.clone());
    if scene == "paused" {
        cx.update(|cx| {
            window
                .update(cx, |view, _, cx| {
                    for expression in ["count * 2", "user", "missing"] {
                        view.add_watch(expression.into(), cx);
                    }
                    let config = view.selected_config().cloned().expect("launch.json");
                    let store = BreakpointStore::global(cx);
                    let session = cx.new(|cx| DebugSession::new(config, root.clone(), Some(fake.adapter()), store, cx));
                    view.attach_session(session, cx);
                })
                .ok();
        });
        for _ in 0..200 {
            cx.run_until_parked();
            let ready = cx.update(|cx| {
                window
                    .read_with(cx, |view, cx| {
                        view.session().is_some_and(|session| {
                            let session = session.read(cx);
                            session.status() == SessionStatus::Stopped && !session.scopes().is_empty()
                        })
                    })
                    .unwrap_or(false)
            });
            if ready {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        cx.update(|cx| {
            window
                .update(cx, |view, _, cx| {
                    view.evaluate_in_console("count * 2", cx);
                    view.evaluate_in_console("nope", cx);
                })
                .ok();
        });
    }

    for _ in 0..8 {
        cx.update_window(window.into(), |_, window, _| window.refresh())?;
        cx.run_until_parked();
        std::thread::sleep(Duration::from_millis(30));
    }
    let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}
