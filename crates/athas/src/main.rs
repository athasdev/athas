// Release builds on Windows are GUI apps; a console window would stream logs and close the app with it.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use std::io::IsTerminal as _;

use gpui::App;

mod http;

fn main() {
    let started = std::time::Instant::now();
    if !std::io::stdin().is_terminal() {
        exec_path::inherit_login_path();
    }
    logging::init();
    // Before the application starts: the renderer reads the GPU override when it makes its first
    // window, and setting an environment variable is only sound while this thread is the only one.
    platform::gpu::apply_device_override();
    telemetry::install_panic_hook(telemetry::default_store_path());
    let argv: Vec<String> = std::env::args().collect();
    let primary = match platform::startup(&argv) {
        platform::Startup::HandedOver => return,
        platform::Startup::Primary(primary) => primary,
    };
    // Before any store loads: the first run after the Tauri app updated into this one.
    platform::tauri_import::run_once();
    let app = gpui_platform::application().with_assets(ui::Assets);
    primary.listen_for_urls(&app);
    app.run(move |cx: &mut App| {
        if let Err(error) = ui::load_fonts(cx) {
            eprintln!("athas: could not load fonts: {error:#}");
        }
        cx.set_http_client(http::ImageHttpClient::new());
        ui::init(cx);
        let settings_path = settings::default_path();
        settings::init(cx, settings::load(settings_path.clone(), settings::legacy_path()), settings_path);
        account::init(cx);
        telemetry::init(cx, telemetry::TelemetryConfig::new(account::urls(cx).api_base, env!("CARGO_PKG_VERSION")));
        extensions::init(cx);
        extensions::schedule_update_checks(cx);
        extensions_ui::init(cx);
        theme::init(cx, None, workbench::appearance_of(cx.window_appearance()), false);
        workbench::apply_theme(workbench::appearance_of(cx.window_appearance()), cx);
        collaboration::register_commands(cx);
        settings_ui::init(cx);
        platform::init(cx);
        workbench::init(cx);
        if let Some(path) = palette::frecency_store_path() {
            palette::use_frecency_store(path, cx);
        }
        if let Some(sessions) = terminal_view::TerminalSessions::default_location() {
            terminal_view::set_sessions_location(sessions, cx);
        }
        agent_ui::pull_request::install(agent_ui::pull_request::github_source(cx), cx);
        agent_ui::outside_sessions::enable_sidebar_listing(cx);

        logging::startup_milestone("bootstrap:complete");
        if !primary.start(cx) {
            eprintln!("athas: could not open a window");
            cx.quit();
            return;
        }
        logging::startup_milestone("workspace:ready");
        cx.activate(true);
        // On a frame the window really drew, not merely a deferred callback: a window that is
        // created but never presented — the GPU it drew on could not reach the display
        // (athasdev/athas#795) — used to report a first frame all the same, and the log said
        // Athas had started normally when no window had appeared.
        let window = cx.windows().into_iter().next();
        if let Some(window) = window {
            window
                .update(cx, move |_, window, _| {
                    // As soon as the window exists, not on its first frame: a window that never
                    // presents is the case this line is for, and it would never reach a frame.
                    platform::gpu::log_gpu(window);
                    window.on_next_frame(move |_, cx| {
                        logging::startup_milestone("workbench:first-frame");
                        telemetry::record_startup(cx, started.elapsed());
                    });
                })
                .ok();
        }
    });
}
