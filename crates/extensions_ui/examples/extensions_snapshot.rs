//! Renders the extension manager to a PNG with the GPU but without a window.
//!
//! `cargo run -p extensions_ui --example extensions_snapshot -- out.png [dark|light] [scene] [arg]`
//! Scenes: `catalog` (default), `category <kind>`, `search <query>`, `detail <extension id>`,
//! `icons` (the icon theme picker). A few data-only extensions are installed into a temporary
//! folder first, so badges and the installed state show.

use std::sync::Arc;

use anyhow::{Context as _, Result};
use extensions_ui::{ExtensionsView, IconThemePickerDelegate};
use gpui::{AppContext, Context, Entity, HeadlessAppContext, IntoElement, Render, Window, div, prelude::*, px, size};
use palette::Picker;
use theme::{ActiveTheme, Appearance};

struct PickerScene {
    picker: Entity<Picker<IconThemePickerDelegate>>,
}

impl Render for PickerScene {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let height = window.viewport_size().height;
        div()
            .size_full()
            .bg(cx.theme().colors.surface)
            .child(palette::modal_layer(self.picker.clone(), height, cx, |_, _| {}))
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "extensions.png".into());
    let appearance = match args.get(1).map(String::as_str) {
        Some("light") => Appearance::Light,
        _ => Appearance::Dark,
    };
    let scene = args.get(2).cloned().unwrap_or_else(|| "catalog".into());
    let argument = args.get(3).cloned().unwrap_or_default();
    let installed = tempfile::tempdir()?;
    let tools = tempfile::tempdir()?;

    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || gpui_platform::current_headless_renderer());
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        palette::init(cx);
        extensions_ui::init(cx);
        let mut settings = settings::Settings::default();
        if scene == "category" {
            settings.extensions_active_tab = argument.clone();
        }
        settings::init(cx, settings, None);
        extensions::init_with(cx, Some(installed.path().to_path_buf()), None);
        extensions::init_theme(cx, None, appearance, false);
        Ok(())
    })?;
    cx.allow_parking();
    for id in ["athas.rust", "athas.typescript", "athas.mcp.github", "athas.skill.debugging"] {
        let task = cx.update(|cx| extensions::install(id, cx));
        wait(&mut cx, task)?;
    }
    cx.update(|cx| extensions::set_enabled("athas.typescript", false, cx))?;
    // Set after the installs, so the tools of the installed languages are only checked.
    cx.update(|cx| extensions::set_tool_data_dir(Some(tools.path().to_path_buf()), cx));

    let window: gpui::AnyWindowHandle = if scene == "icons" {
        cx.open_window(size(px(900.), px(560.)), |window, cx| {
            let picker = cx.new(|cx| Picker::new(IconThemePickerDelegate::new(cx), window, cx));
            cx.new(|_| PickerScene { picker })
        })?
        .into()
    } else {
        let handle = cx.open_window(size(px(1100.), px(760.)), |window, cx| cx.new(|cx| ExtensionsView::new(window, cx)))?;
        cx.update(|cx| {
            handle
                .update(cx, |view, window, cx| match scene.as_str() {
                    "detail" => view.open_extension(&argument, cx),
                    "search" => view.search_for(&argument, window, cx),
                    _ => {}
                })
                .ok();
        });
        handle.into()
    };
    for _ in 0..4 {
        cx.update_window(window, |_, window, _| window.refresh())?;
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    let image = cx.capture_screenshot(window).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}

/// Runs the app until `task` finishes.
fn wait<T: 'static>(cx: &mut HeadlessAppContext, task: gpui::Task<T>) -> T {
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    let mut task = std::pin::pin!(task);
    loop {
        cx.run_until_parked();
        if let std::task::Poll::Ready(value) = task.as_mut().poll(&mut context) {
            return value;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}
