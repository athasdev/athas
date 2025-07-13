use colored::Colorize as _;
use log::LevelFilter;
use tauri::{Runtime, plugin::TauriPlugin};
use tauri_plugin_log::Builder;

/// logs go to `~/Library/Logs/com.athas-code.app/Athas.log` on macOS
pub fn init<R: Runtime>(level: LevelFilter) -> TauriPlugin<R> {
    Builder::new()
        .level(LevelFilter::Warn) // external crates unrelated to "athas"
        .level_for("interceptor", level) // interceptor
        .level_for("athas_code", level) // athas
        .format(|cb, _, record| {
            use env_logger::fmt::style;
            let style = match record.level() {
                log::Level::Trace => style::AnsiColor::Cyan.on_default(),
                log::Level::Debug => style::AnsiColor::Blue.on_default(),
                log::Level::Info => style::AnsiColor::Green.on_default(),
                log::Level::Warn => style::AnsiColor::Yellow.on_default(),
                log::Level::Error => style::AnsiColor::Red
                    .on_default()
                    .effects(style::Effects::BOLD),
            };
            if cfg!(debug_assertions) {
                cb.finish(format_args!(
                    "[{style}{}{style:#}] [{}]: {}",
                    record.level(),
                    record.target(),
                    record.args()
                ));
            } else {
                cb.finish(format_args!(
                    "[{}] [{style}{}{style:#}] [{}]: {}",
                    chrono::Local::now()
                        .format("%I:%M:%S%p")
                        .to_string()
                        .yellow()
                        .dimmed(),
                    record.level(),
                    record.target(),
                    record.args()
                ));
            }
        })
        .build()
}
