//! Dev servers a session's commands started (`session-panel/services/{dev-server-urls,
//! dev-server-auto-open,session-panel-runtime}.ts`): local addresses found in command output are
//! checked until they answer, then the session's browser opens on the first one, once per session.
//! A live server is checked again every few seconds so its row goes once the process stops.

use std::{
    collections::{HashMap, HashSet},
    net::ToSocketAddrs as _,
    time::Duration,
};

use gpui::{AppContext as _, Context, Task};

use crate::{
    SessionView, SessionViewEvent,
    thread::{Entry, ToolContent, ToolKind, ToolStatus},
};

/// Waits between reachability checks: dev servers print their address just before they listen.
pub const PROBE_DELAYS: [Duration; 5] =
    [Duration::ZERO, Duration::from_millis(750), Duration::from_millis(1500), Duration::from_millis(3000), Duration::from_millis(5000)];
/// How often a server marked live is checked.
pub const LIVENESS_INTERVAL: Duration = Duration::from_secs(10);
/// Waits after a change in the transcript before scanning it.
pub const SCAN_DELAY: Duration = Duration::from_millis(400);
/// Waits before looking for the port of a dev server that printed no address.
pub const PORT_PROBE_DELAYS: [Duration; 4] =
    [Duration::from_millis(1500), Duration::from_millis(3000), Duration::from_millis(6000), Duration::from_millis(12_000)];
/// How long after a keystroke the user still counts as typing.
pub const TYPING_IDLE: Duration = Duration::from_millis(1500);
const TYPING_RECHECK: Duration = Duration::from_millis(400);

/// When the user last typed text anywhere in the app, so the browser does not open (and shift the
/// layout) under their keystrokes (`createTypingTracker`).
#[derive(Default)]
struct TypingTracker {
    last_keystroke: Option<web_time::Instant>,
}

impl gpui::Global for TypingTracker {}

/// Starts noting keystrokes that type text; [`init`](crate::init) calls it.
pub fn track_typing(cx: &mut gpui::App) {
    if cx.has_global::<TypingTracker>() {
        return;
    }
    cx.set_global(TypingTracker::default());
    cx.observe_keystrokes(|event, _, cx| {
        let modifiers = &event.keystroke.modifiers;
        let types_text = event.keystroke.key_char.is_some() || event.keystroke.key == "backspace";
        if types_text && !modifiers.platform && !modifiers.control {
            cx.global_mut::<TypingTracker>().last_keystroke = Some(web_time::Instant::now());
        }
    })
    .detach();
}

pub fn is_user_typing(cx: &gpui::App) -> bool {
    cx.try_global::<TypingTracker>().and_then(|tracker| tracker.last_keystroke).is_some_and(|at| at.elapsed() < TYPING_IDLE)
}

/// Ports dev servers commonly listen on, tried when a long-running command names none.
pub const COMMON_DEV_PORTS: [u16; 8] = [5173, 3000, 8080, 4321, 8000, 4200, 5000, 1420];

const URL_TAIL_STOP: &[char] = &['"', '\'', '`', '<', '>', '(', ')', '[', ']', '{', '}', '\\'];

/// Local server addresses in `text`, such as Vite's "Local: http://localhost:5173/", with
/// 0.0.0.0 and [::] read as localhost, each once.
pub fn extract_local_server_urls(text: &str) -> Vec<String> {
    let clean = strip_escapes(text);
    let lower = clean.to_ascii_lowercase();
    let mut urls = Vec::new();
    let mut from = 0;
    while let Some(found) = lower[from..].find("http") {
        let start = from + found;
        from = start + 4;
        if start > 0 && lower.as_bytes()[start - 1].is_ascii_alphanumeric() {
            continue;
        }
        let rest = &clean[start..];
        let scheme_len = if lower[start..].starts_with("https://") {
            8
        } else if lower[start..].starts_with("http://") {
            7
        } else {
            continue;
        };
        let end = rest.find(|ch: char| ch.is_whitespace() || URL_TAIL_STOP.contains(&ch)).unwrap_or(rest.len());
        let candidate = rest[..end].trim_end_matches(['.', ',', ';', ':', '!', '?']);
        if let Some(url) = normalize(candidate, scheme_len)
            && !urls.contains(&url)
        {
            urls.push(url);
        }
    }
    urls
}

fn normalize(candidate: &str, scheme_len: usize) -> Option<String> {
    let scheme = &candidate[..scheme_len];
    let rest = &candidate[scheme_len..];
    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, ""),
    };
    let (host, port) = authority.rsplit_once(':')?;
    let host = host.to_ascii_lowercase();
    if port.len() < 2 || port.len() > 5 || !port.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let port: u32 = port.parse().ok()?;
    if port == 0 || port > 65535 {
        return None;
    }
    let local_name = host.strip_suffix(".localhost").is_some_and(|name| !name.is_empty() && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'));
    let host = match host.as_str() {
        "localhost" | "127.0.0.1" => host.clone(),
        "0.0.0.0" | "[::]" | "[::1]" => "localhost".to_string(),
        _ if local_name => host.clone(),
        _ => return None,
    };
    let path = if path.is_empty() { "/" } else { path };
    Some(format!("{}{host}:{port}{path}", scheme.to_ascii_lowercase()))
}

/// The port of a local server address, or `None` when it is not on this computer.
pub fn local_server_port(address: &str) -> Option<u16> {
    let lower = address.to_ascii_lowercase();
    let (rest, default) = if let Some(rest) = lower.strip_prefix("http://") {
        (rest, 80)
    } else if let Some(rest) = lower.strip_prefix("https://") {
        (rest, 443)
    } else {
        return None;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) if !host.ends_with('[') && !port.contains(']') => (host, port.parse::<u16>().ok()?),
        _ => (authority, default),
    };
    let local = host == "localhost" || host.ends_with(".localhost") || host == "127.0.0.1" || host == "0.0.0.0" || host == "[::1]";
    (local && port > 0).then_some(port)
}

/// The port a command names, such as `--port 3000`, `-p 3000` or `PORT=3000`.
pub fn command_port(command: &str) -> Option<u16> {
    let words: Vec<&str> = command.split_whitespace().collect();
    let parse = |text: &str| {
        let digits: String = text.chars().take_while(char::is_ascii_digit).collect();
        (2..=5).contains(&digits.len()).then(|| digits.parse::<u16>().ok()).flatten().filter(|port| *port > 0)
    };
    for (index, word) in words.iter().enumerate() {
        if let Some(value) = word.strip_prefix("--port=").or_else(|| word.strip_prefix("PORT=")) {
            return parse(value);
        }
        if (*word == "--port" || *word == "-p")
            && let Some(next) = words.get(index + 1)
        {
            return parse(next);
        }
    }
    let at = command.find("localhost:")?;
    parse(&command[at + "localhost:".len()..])
}

/// Whether a command starts something that keeps running: a dev server or a watcher.
pub fn is_long_running_command(command: &str) -> bool {
    if crate::shell_command::is_long_running_command(command) {
        return true;
    }
    let command = &crate::shell_command::clean_command(command);
    let words: Vec<&str> = command.split_whitespace().collect();
    let has = |word: &str| words.contains(&word);
    let runner = matches!(words.first().copied(), Some("npm" | "pnpm" | "yarn" | "bun" | "deno" | "npx" | "bunx"));
    (runner && (has("dev") || has("start") || has("serve") || has("preview") || has("watch")))
        || words.first().is_some_and(|first| matches!(*first, "vite" | "next" | "astro" | "nuxt" | "webpack-dev-server" | "http-server" | "live-server"))
        || command.contains("runserver")
        || command.contains("http.server")
        || (has("cargo") && (has("watch") || has("leptos")))
        || command.contains("rails s")
        || command.contains("rails server")
        || command.contains("flask run")
        || command.contains("uvicorn")
}

/// Whether something listens at `url`'s port on this computer.
pub fn is_reachable(url: &str) -> bool {
    let Some(port) = local_server_port(url) else { return false };
    let Ok(addresses) = ("localhost", port).to_socket_addrs() else { return false };
    addresses.into_iter().any(|address| std::net::TcpStream::connect_timeout(&address, Duration::from_millis(400)).is_ok())
}

/// Tool calls in the last this many entries are scanned; older ones were scanned already.
const SCANNED_ENTRIES: usize = 12;

/// What a session's watch for dev servers has seen.
#[derive(Default)]
pub(crate) struct DevServerWatch {
    /// Output lengths already scanned, by tool call id.
    scanned: HashMap<String, usize>,
    /// Addresses being checked or found answering.
    considered: HashSet<String>,
    /// Long-running commands whose port is being looked for.
    probed: HashSet<String>,
    /// The server found answering last.
    pub live: Option<String>,
    scan: Option<Task<()>>,
    tasks: Vec<Task<()>>,
    liveness: Option<Task<()>>,
}

impl SessionView {
    /// After the transcript changed: looks for server addresses in command output soon.
    pub(crate) fn schedule_dev_server_scan(&mut self, cx: &mut Context<Self>) {
        if self.dev_servers.scan.is_some() {
            return;
        }
        self.dev_servers.scan = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(SCAN_DELAY).await;
            this.update(cx, |this, cx| {
                this.dev_servers.scan = None;
                this.scan_dev_servers(cx);
            })
            .ok();
        }));
    }

    fn scan_dev_servers(&mut self, cx: &mut Context<Self>) {
        let start = self.transcript.entries.len().saturating_sub(SCANNED_ENTRIES);
        let mut found = Vec::new();
        let mut long_running = Vec::new();
        for entry in &self.transcript.entries[start..] {
            let Entry::ToolCall(call) = entry else { continue };
            let command = call.command();
            if call.kind != ToolKind::Execute && command.is_none() {
                continue;
            }
            if let Some(command) = &command
                && matches!(call.status, ToolStatus::Pending | ToolStatus::InProgress)
                && is_long_running_command(command)
                && !self.dev_servers.probed.contains(&call.id)
            {
                long_running.push((call.id.clone(), command.clone()));
            }
            let mut text = call.terminal_output.clone().unwrap_or_default();
            for content in &call.content {
                match content {
                    ToolContent::Text { text: output } => {
                        text.push('\n');
                        text.push_str(output);
                    }
                    ToolContent::Terminal { terminal_id } => {
                        if let Some(snapshot) = self.terminal_output(terminal_id) {
                            text.push('\n');
                            text.push_str(&snapshot.output);
                        }
                    }
                    ToolContent::Diff { .. } => {}
                }
            }
            if self.dev_servers.scanned.get(&call.id) == Some(&text.len()) {
                continue;
            }
            self.dev_servers.scanned.insert(call.id.clone(), text.len());
            found.extend(extract_local_server_urls(&text));
        }
        for url in found {
            self.consider_dev_server(url, cx);
        }
        for (id, command) in long_running {
            self.dev_servers.probed.insert(id);
            self.probe_command_port(command, cx);
        }
    }

    /// A long-running command printed no address yet: tries the port it names, else common ones.
    fn probe_command_port(&mut self, command: String, cx: &mut Context<Self>) {
        let ports: Vec<u16> = command_port(&command).map_or_else(|| COMMON_DEV_PORTS.to_vec(), |port| vec![port]);
        let task = cx.spawn(async move |this, cx| {
            for delay in PORT_PROBE_DELAYS {
                cx.background_executor().timer(delay).await;
                if this.read_with(cx, |this, _| this.dev_servers.live.is_some()).unwrap_or(true) {
                    return;
                }
                let ports = ports.clone();
                let open = cx.background_spawn(async move { ports.into_iter().find(|port| is_reachable(&format!("http://localhost:{port}/"))) }).await;
                if let Some(port) = open {
                    this.update(cx, |this, cx| this.consider_dev_server(format!("http://localhost:{port}/"), cx)).ok();
                    return;
                }
            }
        });
        self.dev_servers.tasks.push(task);
    }

    /// Checks `url` until it answers, then marks it live and opens the browser for the session's
    /// first server.
    fn consider_dev_server(&mut self, url: String, cx: &mut Context<Self>) {
        if !self.dev_servers.considered.insert(url.clone()) {
            return;
        }
        let task = cx.spawn(async move |this, cx| {
            let mut answered = false;
            for delay in PROBE_DELAYS {
                if !delay.is_zero() {
                    cx.background_executor().timer(delay).await;
                }
                let probe = url.clone();
                if cx.background_spawn(async move { is_reachable(&probe) }).await {
                    answered = true;
                    break;
                }
            }
            if !answered {
                this.update(cx, |this, _| this.dev_servers.considered.remove(&url)).ok();
                return;
            }
            let open = this
                .update(cx, |this, cx| {
                    this.dev_servers.live = Some(url.clone());
                    this.watch_live_server(cx);
                    !this.transcript.browser_auto_opened
                })
                .unwrap_or(false);
            if open {
                while cx.update(|cx| is_user_typing(cx)) {
                    cx.background_executor().timer(TYPING_RECHECK).await;
                }
            }
            this.update(cx, |this, cx| {
                let open = open && !this.transcript.browser_auto_opened;
                if open {
                    this.transcript.browser_auto_opened = true;
                    this.schedule_save(cx);
                }
                cx.emit(SessionViewEvent::DevServer { url, open });
                cx.notify();
            })
            .ok();
        });
        self.dev_servers.tasks.push(task);
    }

    fn watch_live_server(&mut self, cx: &mut Context<Self>) {
        if self.dev_servers.liveness.is_some() {
            return;
        }
        self.dev_servers.liveness = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(LIVENESS_INTERVAL).await;
                let Ok(Some(url)) = this.read_with(cx, |this, _| this.dev_servers.live.clone()) else { return };
                let probe = url.clone();
                if cx.background_spawn(async move { is_reachable(&probe) }).await {
                    continue;
                }
                this.update(cx, |this, cx| {
                    if this.dev_servers.live.as_deref() == Some(url.as_str()) {
                        this.dev_servers.live = None;
                        this.dev_servers.considered.remove(&url);
                        this.dev_servers.liveness = None;
                        cx.emit(SessionViewEvent::DevServerStopped(url.clone()));
                        cx.notify();
                    }
                })
                .ok();
                return;
            }
        }));
    }

    /// The dev server the session's commands started, while it answers.
    pub fn live_dev_server(&self) -> Option<&str> {
        self.dev_servers.live.as_deref()
    }
}

/// Terminal text without colour escapes and carriage-return rewrites.
fn strip_escapes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            } else if chars.peek() == Some(&']') {
                for next in chars.by_ref() {
                    if next == '\u{7}' {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_local_addresses_once() {
        let text = "  \u{1b}[32m➜\u{1b}[0m  Local:   \u{1b}[36mhttp://localhost:\u{1b}[1m5173\u{1b}[22m/\u{1b}[39m\n  Network: http://192.168.1.4:5173/\nready on http://0.0.0.0:3000, also http://LOCALHOST:5173/.";
        assert_eq!(extract_local_server_urls(text), vec!["http://localhost:5173/", "http://localhost:3000/"]);
        assert_eq!(extract_local_server_urls("see https://app.localhost:8443/admin?x=1)"), vec!["https://app.localhost:8443/admin?x=1"]);
        assert!(extract_local_server_urls("http://example.com:8080/").is_empty());
        assert!(extract_local_server_urls("http://localhost:9/").is_empty());
    }

    #[test]
    fn ports_of_addresses_and_commands() {
        assert_eq!(local_server_port("http://localhost:5173/"), Some(5173));
        assert_eq!(local_server_port("http://127.0.0.1/"), Some(80));
        assert_eq!(local_server_port("https://example.com:443/"), None);
        assert_eq!(command_port("vite --port 4000"), Some(4000));
        assert_eq!(command_port("PORT=3001 npm start"), Some(3001));
        assert_eq!(command_port("python -m http.server -p 8000"), Some(8000));
        assert_eq!(command_port("npm run dev"), None);
        assert!(is_long_running_command("bun run dev"));
        assert!(is_long_running_command("python manage.py runserver"));
        assert!(!is_long_running_command("cargo test"));
    }
}
