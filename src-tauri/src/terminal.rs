use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{Result, anyhow};
use portable_pty::{Child, CommandBuilder, PtyPair, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use unicode_width::UnicodeWidthStr;
use uuid::Uuid;
use vt100::{Cell, Color as VtColor, Parser};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "$type")]
pub enum TerminalKind {
    #[serde(rename = "local")]
    Local {
        #[serde(rename = "workingDirectory")]
        working_directory: Option<String>,
        shell: Option<String>,
    },
    #[serde(rename = "ssh")]
    Ssh {
        host: String,
        username: String,
        port: Option<u16>,
    },
    #[serde(rename = "git-bash")]
    GitBash {
        #[serde(rename = "workingDirectory")]
        working_directory: Option<String>,
    },
    #[serde(rename = "wsl")]
    Wsl {
        distribution: Option<String>,
        #[serde(rename = "workingDirectory")]
        working_directory: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
    pub kind: TerminalKind,
    #[serde(rename = "workingDir")]
    pub working_dir: Option<String>,
    #[serde(rename = "shellCommand")]
    pub shell_command: Option<String>,
    pub environment: Option<HashMap<String, String>>,
    pub lines: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Color {
    Default,
    Black,
    Red,
    Green,
    Yellow,
    Blue,
    Magenta,
    Cyan,
    White,
    BrightBlack,
    BrightRed,
    BrightGreen,
    BrightYellow,
    BrightBlue,
    BrightMagenta,
    BrightCyan,
    BrightWhite,
    Extended(u8),
    Rgb(u8, u8, u8),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineItem {
    pub lexeme: String,
    pub width: u16,
    pub is_underline: bool,
    pub is_bold: bool,
    pub is_italic: bool,
    pub background_color: Option<Color>,
    pub foreground_color: Option<Color>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TerminalEvent {
    #[serde(rename = "newLines")]
    NewLines { lines: Vec<Vec<LineItem>> },
    #[serde(rename = "patch")]
    Patch {
        line: u16,
        col: u16,
        items: Vec<LineItem>,
    },
    #[serde(rename = "cursorMove")]
    CursorMove { line: u16, col: u16 },
    #[serde(rename = "scroll")]
    Scroll {
        direction: ScrollDirection,
        amount: u16,
    },
    #[serde(rename = "screenUpdate")]
    ScreenUpdate {
        screen: Vec<Vec<LineItem>>,
        cursor_line: u16,
        cursor_col: u16,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScrollDirection {
    Up,
    Down,
}

pub struct TerminalConnection {
    pub id: String,
    pub config: TerminalConfig,
    pub pty_pair: PtyPair,
    pub child: Box<dyn Child + Send + Sync>,
    pub app_handle: AppHandle,
    pub terminal_state: Arc<Mutex<TerminalState>>,
    pub writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
}

impl TerminalConnection {
    pub fn new(id: String, config: TerminalConfig, app_handle: AppHandle) -> Result<Self> {
        let pty_system = portable_pty::native_pty_system();

        let pty_pair = pty_system.openpty(PtySize {
            rows: config.lines,
            cols: config.cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let cmd = Self::build_command(&config)?;
        let child = pty_pair.slave.spawn_command(cmd)?;
        let terminal_state = Arc::new(Mutex::new(TerminalState::new(config.lines, config.cols)));
        let writer = Arc::new(Mutex::new(Some(pty_pair.master.take_writer()?)));

        Ok(Self {
            id,
            config,
            pty_pair,
            child,
            app_handle,
            terminal_state,
            writer,
        })
    }

    fn build_command(config: &TerminalConfig) -> Result<CommandBuilder> {
        let mut cmd = match &config.kind {
            TerminalKind::Local {
                working_directory,
                shell,
            } => {
                let default_shell = if cfg!(target_os = "windows") {
                    "cmd.exe".to_string()
                } else {
                    // Try to get default shell from environment
                    std::env::var("SHELL").unwrap_or_else(|_| {
                        // Fallback priority: zsh (macOS default) -> bash -> sh
                        if std::path::Path::new("/bin/zsh").exists() {
                            "/bin/zsh".to_string()
                        } else if std::path::Path::new("/bin/bash").exists() {
                            "/bin/bash".to_string()
                        } else {
                            "/bin/sh".to_string()
                        }
                    })
                };
                let shell_path = shell.as_deref().unwrap_or(&default_shell);

                let mut cmd = CommandBuilder::new(shell_path);

                if let Some(working_dir) =
                    working_directory.as_ref().or(config.working_dir.as_ref())
                {
                    cmd.cwd(working_dir);
                }

                // Set up proper terminal environment for TUI apps
                cmd.env("TERM", "xterm-256color");
                cmd.env("COLORTERM", "truecolor");

                // Additional environment variables for better TUI support
                cmd.env("TERM_PROGRAM", "athas-text");
                cmd.env("TERM_PROGRAM_VERSION", "1.0.0");

                // Better shell integration
                cmd.env("SHELL", shell_path);

                // Force color output for common tools
                cmd.env("FORCE_COLOR", "1");
                cmd.env("CLICOLOR", "1");
                cmd.env("CLICOLOR_FORCE", "1");

                // Git color configuration
                cmd.env("GIT_TERMINAL_PROMPT", "1");

                // Ensure proper locale settings
                if std::env::var("LC_ALL").is_err() && std::env::var("LANG").is_err() {
                    cmd.env("LANG", "en_US.UTF-8");
                }
                cmd.env("LC_CTYPE", "en_US.UTF-8");

                // Better readline support
                cmd.env("INPUTRC", "/etc/inputrc");

                // Use login shell like ariana-ide does
                if !cfg!(target_os = "windows") {
                    cmd.arg("-l"); // Login shell for all shells
                }

                cmd
            }
            TerminalKind::Ssh {
                host,
                username,
                port,
            } => {
                let mut cmd = CommandBuilder::new("ssh");
                cmd.arg("-p");
                cmd.arg(port.unwrap_or(22).to_string());
                cmd.arg("-t"); // Force pseudo-terminal
                cmd.arg(format!("{}@{}", username, host));
                cmd.env("TERM", "xterm-256color");
                cmd
            }
            TerminalKind::GitBash {
                working_directory: _,
            } => {
                #[cfg(target_os = "windows")]
                {
                    let git_bash_paths = [
                        "C:\\Program Files\\Git\\bin\\bash.exe",
                        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
                        "C:\\Git\\bin\\bash.exe",
                    ];

                    let mut cmd_builder = None;
                    for path in &git_bash_paths {
                        if std::path::Path::new(path).exists() {
                            cmd_builder = Some(CommandBuilder::new(path));
                            break;
                        }
                    }

                    let mut cmd = cmd_builder.ok_or_else(|| anyhow!("Git Bash not found"))?;
                    cmd.arg("--login");
                    cmd.arg("-i");

                    if let Some(working_dir) = config.working_dir.as_ref() {
                        cmd.cwd(working_dir);
                    }

                    cmd.env("TERM", "xterm-256color");
                    cmd
                }
                #[cfg(not(target_os = "windows"))]
                {
                    return Err(anyhow!("Git Bash is only available on Windows"));
                }
            }
            TerminalKind::Wsl {
                distribution: _,
                working_directory: _,
            } => {
                #[cfg(target_os = "windows")]
                {
                    let mut cmd = CommandBuilder::new("wsl");

                    if let Some(dist_name) = distribution {
                        cmd.arg("-d");
                        cmd.arg(dist_name);
                    }

                    if let Some(wd) = config.working_dir.as_ref() {
                        cmd.arg("--cd");
                        cmd.arg(wd);
                    }

                    cmd.env("TERM", "xterm-256color");
                    cmd
                }
                #[cfg(not(target_os = "windows"))]
                {
                    return Err(anyhow!("WSL is only available on Windows"));
                }
            }
        };

        if let Some(shell_command) = &config.shell_command {
            cmd.arg("-c");
            cmd.arg(shell_command);
        }

        if let Some(env_vars) = &config.environment {
            for (key, value) in env_vars {
                cmd.env(key, value);
            }
        }

        Ok(cmd)
    }

    pub fn start_io_loop(&mut self) -> Result<()> {
        let mut reader = self.pty_pair.master.try_clone_reader()?;
        let app_handle = self.app_handle.clone();
        let connection_id = self.id.clone();
        let terminal_state = self.terminal_state.clone();

        // Use the shared writer
        let writer_for_responses = self.writer.clone();

        thread::spawn(move || {
            let mut buffer = [0u8; 4096];

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = &buffer[..n];

                        // Optional: Debug logging for raw PTY output
                        // log::debug!("Raw PTY data ({}): {:?}", n, String::from_utf8_lossy(data));

                        let (events, responses) = {
                            let mut state = terminal_state.lock().unwrap();
                            let events = state.process_input(data);
                            let responses = state.take_pending_responses();
                            (events, responses)
                        };

                        // CRITICAL: Send responses back to PTY immediately for TUI apps
                        if !responses.is_empty() {
                            if let Ok(mut writer_guard) = writer_for_responses.try_lock() {
                                if let Some(ref mut writer) = writer_guard.as_mut() {
                                    for response in responses {
                                        if let Err(e) = writer.write_all(response.as_bytes()) {
                                            log::error!("Failed to write response to PTY: {}", e);
                                            break;
                                        }
                                        if let Err(e) = writer.flush() {
                                            log::error!("Failed to flush response to PTY: {}", e);
                                            break;
                                        }
                                    }
                                }
                            }
                        }

                        for event in events {
                            if let Err(e) = app_handle
                                .emit(&format!("terminal-event-{}", connection_id), &event)
                            {
                                log::error!("Failed to emit terminal event: {}", e);
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("Error reading from PTY: {}", e);
                        break;
                    }
                }
            }

            let _ = app_handle.emit(&format!("terminal-disconnect-{}", connection_id), ());
        });

        Ok(())
    }

    pub fn send_input(&mut self, data: &str) -> Result<()> {
        if let Ok(mut writer_guard) = self.writer.try_lock() {
            if let Some(ref mut writer) = writer_guard.as_mut() {
                writer.write_all(data.as_bytes())?;
                writer.flush()?;
            }
        }
        Ok(())
    }

    pub fn resize(&mut self, lines: u16, cols: u16) -> Result<()> {
        self.pty_pair.master.resize(PtySize {
            rows: lines,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        self.config.lines = lines;
        self.config.cols = cols;

        {
            let mut state = self.terminal_state.lock().unwrap();
            state.resize(lines, cols);
        }

        Ok(())
    }
}

// Terminal state using vt100 parser for proper ANSI/VT handling
pub struct TerminalState {
    parser: Parser,
    rows: u16,
    cols: u16,
}

impl TerminalState {
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: Parser::new(rows.into(), cols.into(), 10000), // 10k lines of scrollback
            rows,
            cols,
        }
    }

    pub fn process_input(&mut self, data: &[u8]) -> Vec<TerminalEvent> {
        if data.is_empty() {
            return vec![];
        }

        // Handle UTF-8 validation like ariana-ide does
        let valid_up_to = match std::str::from_utf8(data) {
            Ok(_) => data.len(),
            Err(e) => e.valid_up_to(),
        };
        let (valid, _) = data.split_at(valid_up_to);
        if !valid.is_empty() {
            self.parser.process(valid);
        }

        self.build_screen_events()
    }

    fn build_screen_events(&self) -> Vec<TerminalEvent> {
        let screen = self.parser.screen();
        let (cursor_line, cursor_col) = screen.cursor_position().into();

        let mut lines = Vec::with_capacity(self.rows as usize);
        for row in 0..self.rows {
            let mut line_items = Vec::with_capacity(self.cols as usize);
            let mut visual_col: u16 = 0;

            for col in 0..self.cols {
                let item = cell_to_item(screen.cell(row, col).cloned(), visual_col);
                visual_col += item.width;
                line_items.push(item);
            }
            lines.push(line_items);
        }

        vec![TerminalEvent::ScreenUpdate {
            screen: lines,
            cursor_line: cursor_line as u16,
            cursor_col: cursor_col as u16,
        }]
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.set_size(rows.into(), cols.into());
        self.rows = rows;
        self.cols = cols;
    }

    pub fn take_pending_responses(&mut self) -> Vec<String> {
        // vt100 handles responses internally, so we don't need to manage them
        Vec::new()
    }
}

// Convert vt100 cell to LineItem
fn cell_to_item(opt: Option<Cell>, col: u16) -> LineItem {
    let (mut txt, bold, italic, underline, fg, bg) = if let Some(c) = opt {
        (
            c.contents().to_string(),
            c.bold(),
            c.italic(),
            c.underline(),
            vt_color_to_color(Some(c.fgcolor())),
            vt_color_to_color(Some(c.bgcolor())),
        )
    } else {
        (" ".to_owned(), false, false, false, None, None)
    };

    // Handle tabs
    const TAB_WIDTH: usize = 8;
    if txt == "\t" {
        let tab_width = TAB_WIDTH - (col as usize % TAB_WIDTH);
        txt = " ".repeat(tab_width);
    }

    LineItem {
        width: UnicodeWidthStr::width(txt.as_str()) as u16,
        lexeme: txt,
        is_bold: bold,
        is_italic: italic,
        is_underline: underline,
        foreground_color: fg,
        background_color: bg,
    }
}

// Convert vt100 color to our Color enum
fn vt_color_to_color(opt: Option<VtColor>) -> Option<Color> {
    match opt {
        Some(VtColor::Idx(i)) if i < 8 => Some(ansi_color_to_color(i as u16)),
        Some(VtColor::Idx(i)) if i < 16 => Some(ansi_bright_color_to_color((i - 8) as u16)),
        Some(VtColor::Idx(i)) => Some(Color::Extended(i)),
        Some(VtColor::Rgb(r, g, b)) => Some(Color::Rgb(r, g, b)),
        Some(VtColor::Default) => None,
        None => None,
    }
}

fn ansi_color_to_color(code: u16) -> Color {
    match code {
        0 => Color::Black,
        1 => Color::Red,
        2 => Color::Green,
        3 => Color::Yellow,
        4 => Color::Blue,
        5 => Color::Magenta,
        6 => Color::Cyan,
        7 => Color::White,
        _ => Color::White,
    }
}

fn ansi_bright_color_to_color(code: u16) -> Color {
    match code {
        0 => Color::BrightBlack,
        1 => Color::BrightRed,
        2 => Color::BrightGreen,
        3 => Color::BrightYellow,
        4 => Color::BrightBlue,
        5 => Color::BrightMagenta,
        6 => Color::BrightCyan,
        7 => Color::BrightWhite,
        _ => Color::BrightWhite,
    }
}

#[derive(Default)]
pub struct TerminalManager {
    connections: Arc<Mutex<HashMap<String, TerminalConnection>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_connection(
        &self,
        config: TerminalConfig,
        app_handle: AppHandle,
    ) -> Result<String> {
        let connection_id = Uuid::new_v4().to_string();
        let mut connection = TerminalConnection::new(connection_id.clone(), config, app_handle)?;

        connection.start_io_loop()?;

        {
            let mut connections = self.connections.lock().unwrap();
            connections.insert(connection_id.clone(), connection);
        }

        Ok(connection_id)
    }

    pub fn send_data(&self, connection_id: &str, data: &str) -> Result<()> {
        let mut connections = self.connections.lock().unwrap();
        if let Some(connection) = connections.get_mut(connection_id) {
            connection.send_input(data)
        } else {
            Err(anyhow!("Terminal connection not found"))
        }
    }

    pub fn resize_terminal(&self, connection_id: &str, lines: u16, cols: u16) -> Result<()> {
        let mut connections = self.connections.lock().unwrap();
        if let Some(connection) = connections.get_mut(connection_id) {
            connection.resize(lines, cols)
        } else {
            Err(anyhow!("Terminal connection not found"))
        }
    }

    pub fn close_connection(&self, connection_id: &str) -> Result<()> {
        let mut connections = self.connections.lock().unwrap();
        if let Some(mut connection) = connections.remove(connection_id) {
            let _ = connection.child.kill();
            let _ = connection.child.wait();
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct AppState {}

impl AppState {}
