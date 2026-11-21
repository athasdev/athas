//! Renders a UI extension to a PNG with the GPU but without a window.
//!
//! `cargo run -p extensions_ui --example ui_extension_snapshot -- out.png [dark|light] [scene]`
//! Scenes: `view` (the sample extension's sidebar view), `clicked` (the same after its button
//! and form ran in the extension).

use std::sync::Arc;

use anyhow::{Context as _, Result};
use extension_host::view::Node;
use extension_host::HostManifest;
use extensions_ui::{ExtensionView, ExtensionViewSurface, ui_extensions};
use gpui::{AppContext, Context, Entity, HeadlessAppContext, IntoElement, Render, Window, div, prelude::*, px, size};
use serde_json::json;
use theme::{ActiveTheme, Appearance};

/// The sample extension's id; its contributions name themselves inside that namespace.
const EXTENSION_ID: &str = "athas.deploys";

const SAMPLE: &str = r#"
let deploys = (await api.storage.get("deploys")) ?? 3;
let target = "staging";
api.sidebar.registerView({
  id: "athas.deploys.deploys",
  title: "Deploys",
  icon: "rocket",
  render: () => api.ui.screen({ title: "Deploys", actions: [{ label: "Refresh", icon: "arrow-clockwise", action: api.ui.action("athas.deploys.refresh") }] },
    api.ui.row(
      api.ui.metric({ label: "Deploys today", value: deploys, detail: "+2", tone: "success" }),
      api.ui.metric({ label: "Failed checks", value: 1, detail: "1h", tone: "error" }),
    ),
    api.ui.sparkline({ label: "Build time", values: [42, 38, 51, 36, 33, 40, 29, 31], detail: "31s" }),
    api.ui.progress({ value: 64, label: "Rollout", detail: "64%" }),
    api.ui.callout({ title: "Staging is ahead of production", description: "3 commits are waiting for review.", tone: "info" }),
    api.ui.button({ label: "Deploy " + target, variant: "accent", onClick: async () => { deploys += 1; await api.storage.set("deploys", deploys); } }),
    api.ui.section("Recent",
      api.ui.activity({ items: [
        { title: "web#482 to staging", meta: "2m", state: "success" },
        { title: "api#119 to production", meta: "1h", state: "error", description: "Health check failed" },
        { title: "worker#77 to staging", meta: "3h", state: "running" },
      ] }),
    ),
    api.ui.table({ columns: ["Service", "Version", "Up"], rows: [["web", "1.8.2", "99.9%"], ["api", "2.1.0", "98.7%"]] }),
    api.ui.form({ submitLabel: "Save", onSubmit: async (values) => { target = values.target; } },
      api.ui.select({ name: "target", label: "Target", value: target, options: [{ label: "Staging", value: "staging" }, { label: "Production", value: "production" }] }),
      api.ui.toggle({ name: "notify", label: "Notify the team", checked: true }),
    ),
    api.ui.keyValue({ items: [{ label: "Region", value: "eu-west-1" }, { label: "Commit", value: "a1b2c3d", monospace: true }] }),
  ),
});
api.commands.register({ id: "athas.deploys.refresh", title: "Refresh deploys", run: () => api.views.invalidate("athas.deploys.deploys") });
"#;

struct ViewScene {
    view: Entity<ExtensionView>,
}

impl Render for ViewScene {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().size_full().bg(cx.theme().colors.surface).child(self.view.clone())
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "ui-extension.png".into());
    let appearance = match args.get(1).map(String::as_str) {
        Some("light") => Appearance::Light,
        _ => Appearance::Dark,
    };
    let scene = args.get(2).cloned().unwrap_or_else(|| "view".into());
    let data = tempfile::tempdir()?;
    let installed = tempfile::tempdir()?;

    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || gpui_platform::current_headless_renderer());
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        palette::init(cx);
        settings::init(cx, settings::Settings::default(), None);
        ui_extensions::init_with(cx, Some(data.path().to_path_buf()));
        extensions_ui::init(cx);
        extensions::init_with(cx, Some(installed.path().to_path_buf()), None);
        extensions::init_theme(cx, None, appearance, false);
        Ok(())
    })?;
    cx.allow_parking();

    let manifest = HostManifest {
        id: EXTENSION_ID.into(),
        name: "Deploys".into(),
        description: "Recent deploys, build times and a deploy button.".into(),
        ..Default::default()
    };
    let source = format!("export async function activate(api) {{\n{SAMPLE}\n}}\n");
    let host = cx.update(|cx| ui_extensions::host(cx));
    wait_future(&mut cx, host.load(manifest, Some(source))).map_err(anyhow::Error::msg)?;
    let extension_id = EXTENSION_ID.to_string();
    let view_id = format!("{extension_id}.deploys");

    let window: gpui::AnyWindowHandle = {
        let view = cx.update(|cx| cx.new(|cx| ExtensionView::for_extension(extension_id.clone(), view_id.clone(), ExtensionViewSurface::Sidebar, cx)));
        let width = std::env::var("SNAPSHOT_WIDTH").ok().and_then(|width| width.parse().ok()).unwrap_or(360.);
        let handle = cx.open_window(size(px(width), px(1080.)), |_, cx| cx.new(|_| ViewScene { view: view.clone() }))?;
        settle(&mut cx, handle.into())?;
        if scene == "clicked" {
            let node = cx.update(|cx| view.read(cx).node().cloned()).context("the view rendered")?;
            let Node::Screen { children, .. } = &node else { anyhow::bail!("expected a screen") };
            let host = cx.update(|cx| ui_extensions::host(cx));
            for child in children {
                if let Node::Button { action, .. } = child {
                    wait_future(&mut cx, host.execute_view_action(&extension_id, &view_id, &action.command, action.arguments([]))).map_err(anyhow::Error::msg)?;
                }
                if let Node::Form { on_submit, .. } = child {
                    let values = json!({ "target": "production", "notify": true });
                    wait_future(&mut cx, host.execute_view_action(&extension_id, &view_id, &on_submit.command, on_submit.arguments([values]))).map_err(anyhow::Error::msg)?;
                }
            }
        }
        handle.into()
    };
    settle(&mut cx, window)?;
    let image = cx.capture_screenshot(window).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}

fn settle(cx: &mut HeadlessAppContext, window: gpui::AnyWindowHandle) -> Result<()> {
    for _ in 0..8 {
        cx.update_window(window, |_, window, _| window.refresh())?;
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    Ok(())
}

/// Runs the app until `future` finishes.
fn wait_future<T>(cx: &mut HeadlessAppContext, future: impl std::future::Future<Output = T>) -> T {
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    let mut future = std::pin::pin!(future);
    loop {
        cx.run_until_parked();
        if let std::task::Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}
