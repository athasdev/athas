//! Renders the Remote Connections dialog to a PNG without a window or a server.
//!
//! `cargo run -p remote --example remote_snapshot -- out.png [dark|light] [list|form|key|trust|password|browse]`

use std::{sync::Arc, time::Duration};

use anyhow::{Context as _, Result};
use gpui::{AppContext as _, HeadlessAppContext, div, prelude::*, px, size};
use remote::{Access, ConnectionsView, HostKeyChallenge, SavedConnection};
use theme::{ActiveTheme, Appearance};

struct Backdrop(gpui::Entity<ConnectionsView>);

impl gpui::Render for Backdrop {
    fn render(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        div().size_full().flex().justify_center().pt(px(24.)).bg(cx.theme().colors.background).child(self.0.clone())
    }
}

fn connection(id: &str, name: &str, host: &str, user: &str, port: u16, key: Option<&str>) -> SavedConnection {
    SavedConnection {
        id: id.into(),
        name: name.into(),
        host: host.into(),
        port,
        username: user.into(),
        access: if key.is_some() { Access::Sftp } else { Access::Ssh },
        key_path: key.map(str::to_string),
        remember_password: false,
        last_folder: None,
        last_connected: None,
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "remote.png".into());
    let appearance = if args.get(1).map(String::as_str) == Some("light") { Appearance::Light } else { Appearance::Dark };
    let scene = args.get(2).cloned().unwrap_or_else(|| "list".into());

    let saved = vec![
        connection("conn-build", "Build box", "build.example.com", "deploy", 22, None),
        connection("conn-gpu", "GPU server", "10.0.4.20", "ml", 2222, Some("~/.ssh/build_ed25519")),
        connection("conn-pi", "Raspberry Pi", "pi.local", "pi", 22, None),
    ];
    let hosts = vec!["staging".to_string(), "bastion".to_string()];

    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), gpui_platform::current_headless_renderer);
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        theme::init(cx, None, appearance, false);
        remote::init(cx);
        Ok(())
    })?;

    let height = if matches!(scene.as_str(), "form" | "key") { 720. } else { 520. };
    let window = cx.open_window(size(px(760.), px(height)), |window, cx| {
        let view = cx.new(|cx| {
            let mut view = ConnectionsView::with_connections(saved.clone(), hosts.clone(), window, cx);
            match scene.as_str() {
                "form" => view.show_form(None, window, cx),
                "key" => view.show_form(Some(saved[1].clone()), window, cx),
                "trust" => view.show_trust(
                    saved[0].clone(),
                    HostKeyChallenge {
                        host: "build.example.com".into(),
                        port: 22,
                        fingerprint: "SHA256:LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ".into(),
                    },
                    cx,
                ),
                "password" => view.show_password(saved[2].clone(), false, window, cx),
                "browse" => view.show_folders(
                    saved[0].clone(),
                    "/home/deploy".into(),
                    Some(["athas", "api-server", "dotfiles", "scratch", ".cache", ".config"].map(String::from).to_vec()),
                    window,
                    cx,
                ),
                _ => {}
            }
            view
        });
        cx.new(|_| Backdrop(view))
    })?;

    for _ in 0..6 {
        cx.update_window(window.into(), |_, window, _| window.refresh())?;
        cx.run_until_parked();
        std::thread::sleep(Duration::from_millis(30));
    }
    let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}
