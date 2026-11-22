//! Draws a GitHub page to a PNG without a window, from recorded data.
//!
//! `cargo run -p github_panel --example github_snapshot -- out.png <scene> [dark|light] [repo]`

use std::{path::PathBuf, sync::Arc};

use anyhow::{Context as _, Result};
use gpui::{AppContext, HeadlessAppContext, IntoElement, ParentElement, Render, Styled, div, px, size};
use theme::Appearance;

struct Host(gpui::AnyView);

impl Render for Host {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        div().size_full().child(self.0.clone())
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "github.png".into());
    let scene = args.get(1).cloned().unwrap_or_else(|| "pr".into());
    let appearance = if args.get(2).map(String::as_str) == Some("light") { Appearance::Light } else { Appearance::Dark };
    let root = PathBuf::from(args.get(3).cloned().unwrap_or_else(|| std::env::current_dir().unwrap().to_string_lossy().into_owned()));

    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || gpui_platform::current_headless_renderer());
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        theme::init(cx, None, appearance, false);
        Ok(())
    })?;
    let mut settle = None;
    let window = cx.open_window(size(px(1280.), px(820.)), |window, cx| {
        let (view, hook) = github_panel::snapshot::scene(&scene, root.clone(), window, cx).expect("unknown scene");
        settle = Some(hook);
        cx.new(|_| Host(view))
    })?;
    cx.allow_parking();
    for _ in 0..4 {
        cx.update_window(window.into(), |_, window, _| window.refresh())?;
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    if let Some(settle) = settle.take() {
        cx.update_window(window.into(), |_, window, cx| settle(window, cx))?;
    }
    for _ in 0..4 {
        cx.update_window(window.into(), |_, window, _| window.refresh())?;
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}
