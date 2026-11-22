//! Presses every bound key in each surface of a real, headless app and reports which action ran.
//!
//! A binding can look right in the keymap and still do nothing: its key context may not be on the
//! focused element's chain, another binding may out-rank it, or no handler may be in the dispatch
//! path. Only pressing the key answers that, so this opens the windows the app opens, puts the
//! keyboard where a person would, and records what each keystroke actually dispatched.
//!
//! `cargo run -p workbench --example keymap_audit [-- command-id-substring]`

use std::{cell::RefCell, rc::Rc, sync::Arc};

use anyhow::Result;
use gpui::{AppContext as _, Context, Entity, HeadlessAppContext, Keystroke, Render, Window, div, prelude::*, px, size};
use theme::Appearance;

/// Commands a headless window cannot carry out, so pressing their key only panics the platform.
const SKIP: &[&str] = &["window.minimize.mac", "window.minimize.alt", "window.maximize", "window.toggleFullscreenMac", "window.quit"];

/// What one keystroke did in one surface.
struct Press {
    surface: &'static str,
    key: String,
    expected: String,
    ran: Option<String>,
}

/// Sits in a window and writes down the action each keystroke resolved to.
struct Recorder {
    seen: Rc<RefCell<Option<String>>>,
}

impl Render for Recorder {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}

fn boot() -> Result<HeadlessAppContext> {
    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || gpui_platform::current_headless_renderer());
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        settings::init(cx, settings::Settings::default(), None);
        extensions::init(cx);
        extensions_ui::ui_extensions::init_with(cx, None);
        extensions_ui::init(cx);
        theme::init(cx, None, Appearance::Dark, false);
        workbench::apply_theme(Appearance::Dark, cx);
        settings_ui::init(cx);
        workbench::init(cx);
        Ok(())
    })?;
    Ok(cx)
}

fn main() -> Result<()> {
    let only = std::env::args().skip(1).find(|arg| !arg.starts_with('-'));
    let mut cx = boot()?;
    cx.allow_parking();

    // Every key the defaults bind, with the command each one is meant to run.
    let bindings = keymap::effective_bindings("none", &[]);
    let mut presses: Vec<Press> = Vec::new();

    // The surfaces a person is in, and what holds the keyboard in each.
    let surfaces: Vec<(&'static str, Surface)> = vec![
        ("the workbench", Surface::Workbench),
        ("a settings window", Surface::Detached(workbench::DetachedContent::Settings)),
        ("an extensions window", Surface::Detached(workbench::DetachedContent::Extensions)),
        ("a terminal window", Surface::Detached(workbench::DetachedContent::Terminal { cwd: None })),
    ];

    for (name, surface) in surfaces {
        let seen: Rc<RefCell<Option<String>>> = Rc::default();
        let mut window = surface.open(&mut cx, seen.clone())?;
        for _ in 0..4 {
            cx.update_window(window, |_, window, _| window.refresh())?;
            cx.run_until_parked();
        }
        for binding in &bindings {
            if only.as_ref().is_some_and(|only| !binding.command.contains(only.as_str())) {
                continue;
            }
            // Window chrome asks the platform to minimize or zoom, which a headless window
            // cannot do; the keys reach it either way, so there is nothing to learn here.
            if SKIP.contains(&binding.command.as_str()) {
                continue;
            }
            let Some(keys) = keymap::to_gpui_keystrokes(&binding.key) else { continue };
            *seen.borrow_mut() = None;
            let dispatched = cx.update_window(window, |_, window, cx| {
                for chord in keys.split_whitespace() {
                    let Ok(keystroke) = Keystroke::parse_with_os(chord, cx.platform_info().os) else { return false };
                    window.dispatch_keystroke(keystroke, cx);
                }
                true
            });
            cx.run_until_parked();
            // A key that closes the window ends the surface: note it, open a fresh one and go on.
            let closed = dispatched.is_err() || cx.update_window(window, |_, _, _| ()).is_err();
            let ran = if closed { Some("<closed the window>".to_string()) } else { seen.borrow().clone() };
            presses.push(Press { surface: name, key: binding.key.clone(), expected: binding.command.clone(), ran });
            if closed {
                window = surface.open(&mut cx, seen.clone())?;
                for _ in 0..4 {
                    cx.update_window(window, |_, window, _| window.refresh())?;
                    cx.run_until_parked();
                }
            }
        }
    }

    // The macOS menu bar answers its own key equivalents before the window does, and runs the
    // menu's action wherever the keyboard is. Nothing here can press a menu key, so dispatch the
    // action the way AppKit does and check each surface does something sensible with it.
    for (name, surface) in [
        ("the workbench", Surface::Workbench),
        ("a settings window", Surface::Detached(workbench::DetachedContent::Settings)),
        ("an extensions window", Surface::Detached(workbench::DetachedContent::Extensions)),
    ] {
        for (key, action_name) in MENU_KEYS {
            let seen: Rc<RefCell<Option<String>>> = Rc::default();
            let window = surface.open(&mut cx, seen)?;
            for _ in 0..4 {
                cx.update_window(window, |_, window, _| window.refresh())?;
                cx.run_until_parked();
            }
            let dispatched = cx.update_window(window, |_, window, cx| {
                let Ok(action) = cx.build_action(action_name, None) else { return false };
                window.dispatch_action(action, cx);
                true
            });
            cx.run_until_parked();
            let closed = cx.update_window(window, |_, _, _| ()).is_err();
            let built = dispatched.unwrap_or(false);
            println!("menu {key:<16} {action_name:<26} {name} -> {}", if closed { "closed the window" } else if built { "stayed open" } else { "no such action" });
        }
    }

    // Zoom says it works on "the focused view": check which view actually moved, since a key
    // can resolve and dispatch and still change nothing a person can see.
    for (name, surface) in [
        ("the workbench", Surface::Workbench),
        ("a settings window", Surface::Detached(workbench::DetachedContent::Settings)),
        ("a terminal window", Surface::Detached(workbench::DetachedContent::Terminal { cwd: None })),
    ] {
        let seen: Rc<RefCell<Option<String>>> = Rc::default();
        let window = surface.open(&mut cx, seen)?;
        for _ in 0..4 {
            cx.update_window(window, |_, window, _| window.refresh())?;
            cx.run_until_parked();
        }
        for (key, label) in [("cmd+=", "zoom in"), ("cmd+-", "zoom out")] {
            let before = cx.update(|cx| (editor::zoom_level(cx), settings::get(cx).terminal_font_size));
            let keys = keymap::to_gpui_keystrokes(key).unwrap();
            cx.update_window(window, |_, window, cx| {
                for chord in keys.split_whitespace() {
                    if let Ok(keystroke) = Keystroke::parse_with_os(chord, cx.platform_info().os) {
                        window.dispatch_keystroke(keystroke, cx);
                    }
                }
            })?;
            cx.run_until_parked();
            let after = cx.update(|cx| (editor::zoom_level(cx), settings::get(cx).terminal_font_size));
            let moved = match (after.0 != before.0, after.1 != before.1) {
                (true, _) => "the editors",
                (_, true) => "the terminal font",
                _ => "NOTHING",
            };
            println!("zoom {key:<8} {label:<9} {name} -> {moved}");
        }
    }

    let mut dead = 0;
    for press in &presses {
        match &press.ran {
            Some(action) => println!("{:<22} {:<40} {} -> {action}", press.key, press.expected, press.surface),
            None => {
                dead += 1;
                println!("{:<22} {:<40} {} -> NOTHING", press.key, press.expected, press.surface);
            }
        }
    }
    println!("\n{dead} of {} presses ran nothing", presses.len());
    Ok(())
}

/// The actions the macOS menu bar claims a key equivalent for, with the key it takes and what
/// each surface should do with it. AppKit answers these before the window does, so the keymap's
/// context-specific binding beside them never runs; they have to mean the right thing wherever
/// the keyboard is.
pub const MENU_KEYS: &[(&str, &str)] = &[
    ("cmd+w", "workbench::CloseTab"),
    ("cmd+t", "workbench::NewSession"),
    ("cmd+n", "workbench::NewSession"),
    ("cmd+alt+left", "workbench::PreviousTab"),
    ("cmd+alt+right", "workbench::NextTab"),
];

enum Surface {
    Workbench,
    Detached(workbench::DetachedContent),
}

impl Surface {
    fn open(&self, cx: &mut HeadlessAppContext, seen: Rc<RefCell<Option<String>>>) -> Result<gpui::AnyWindowHandle> {
        let bounds = size(px(1280.), px(820.));
        let handle: gpui::AnyWindowHandle = match self {
            Surface::Workbench => cx.open_window(bounds, |window, cx| cx.new(|cx| workbench::Workbench::new(None, window, cx)))?.into(),
            Surface::Detached(content) => {
                let content = content.clone();
                cx.open_window(bounds, move |window, cx| cx.new(|cx| workbench::DetachedWindow::new(content, window, cx)))?.into()
            }
        };
        // A recorder in the same window hears every keystroke and the action it resolved to.
        cx.update_window(handle, |_, window, cx| {
            let recorder: Entity<Recorder> = cx.new(|cx| {
                cx.observe_keystrokes(move |this: &mut Recorder, event, _, _| {
                    *this.seen.borrow_mut() = event.action.as_ref().map(|action| action.name().to_string());
                })
                .detach();
                Recorder { seen }
            });
            std::mem::forget(recorder);
            window.refresh();
        })?;
        Ok(handle)
    }
}
