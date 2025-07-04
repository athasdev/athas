use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{anyhow, Result};
use portable_pty::{Child, CommandBuilder, PtyPair, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

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
                    // Try to detect user's preferred shell
                    std::env::var("SHELL")
                        .or_else(|_| std::env::var("BASH"))
                        .or_else(|_| std::env::var("ZSH"))
                        .unwrap_or_else(|_| {
                            // Fallback: try common shell locations
                            for shell in ["/bin/zsh", "/usr/bin/zsh", "/bin/bash", "/usr/bin/bash", "/bin/sh"] {
                                if std::path::Path::new(shell).exists() {
                                    return shell.to_string();
                                }
                            }
                            
                            "/bin/bash".to_string()
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

                // Force interactive shell
                if !cfg!(target_os = "windows") {
                    if shell_path.contains("bash") {
                        cmd.arg("-i"); // Interactive mode for bash
                        cmd.arg("-l"); // Login shell for proper profile loading
                    } else if shell_path.contains("zsh") {
                        cmd.arg("-i"); // Interactive mode for zsh
                        cmd.arg("-l"); // Login shell for proper profile loading
                    } else if shell_path.contains("fish") {
                        cmd.arg("-i"); // Interactive mode for fish
                        cmd.arg("-l"); // Login shell for proper profile loading
                    } else if shell_path.contains("dash") {
                        cmd.arg("-i"); // Interactive mode for dash
                    } else if shell_path.contains("ksh") {
                        cmd.arg("-i"); // Interactive mode for ksh
                    } else if shell_path.contains("tcsh") || shell_path.contains("csh") {
                        cmd.arg("-i"); // Interactive mode for csh/tcsh
                    }
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
            TerminalKind::GitBash { working_directory: _ } => {
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
            TerminalKind::Wsl { distribution, working_directory: _ } => {
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
                                            println!("Failed to write response to PTY: {}", e);
                                            break;
                                        }
                                        if let Err(e) = writer.flush() {
                                            println!("Failed to flush response to PTY: {}", e);
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
                                println!("Failed to emit terminal event: {}", e);
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        println!("Error reading from PTY: {}", e);
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

// Terminal state with ANSI parsing (simplified version for space)
pub struct TerminalState {
    screen_buffer: Vec<Vec<LineItem>>,
    cursor_line: u16,
    cursor_col: u16,
    screen_rows: u16,
    screen_cols: u16,
    pending_responses: Vec<String>,
}

impl TerminalState {
    pub fn new(rows: u16, cols: u16) -> Self {
        let mut screen_buffer = Vec::with_capacity(rows as usize);
        for _ in 0..rows {
            screen_buffer.push(Vec::new());
        }

        Self {
            screen_buffer,
            cursor_line: 0,
            cursor_col: 0,
            screen_rows: rows,
            screen_cols: cols,
            pending_responses: Vec::new(),
        }
    }

    pub fn process_input(&mut self, data: &[u8]) -> Vec<TerminalEvent> {
        let text = String::from_utf8_lossy(data);

        let mut i = 0;
        let chars: Vec<char> = text.chars().collect();

        while i < chars.len() {
            let ch = chars[i];
            match ch {
                '\n' => {
                    self.cursor_line = (self.cursor_line + 1).min(self.screen_rows - 1);
                    self.cursor_col = 0;
                }
                '\r' => self.cursor_col = 0,
                '\x1b' => {
                    // Handle escape sequences - critical for TUI apps
                    if i + 1 < chars.len() && chars[i + 1] == '[' {
                        // CSI sequence
                        let mut j = i + 2;
                        let mut params = String::new();

                        // Collect parameters
                        while j < chars.len() && !chars[j].is_ascii_alphabetic() {
                            params.push(chars[j]);
                            j += 1;
                        }

                        if j < chars.len() {
                            let cmd = chars[j];
                            self.handle_csi_sequence(&params, cmd);
                            i = j;
                        }
                    } else if i + 1 < chars.len() && chars[i + 1] == ']' {
                        // OSC sequence - find terminator
                        let mut j = i + 2;
                        while j < chars.len() && chars[j] != '\x07' && chars[j] != '\x1b' {
                            j += 1;
                        }
                        i = j;
                    }
                }
                c if !c.is_control() => {
                    self.write_char_at_cursor(c);
                    self.cursor_col += 1;
                    if self.cursor_col >= self.screen_cols {
                        self.cursor_col = 0;
                        self.cursor_line = (self.cursor_line + 1).min(self.screen_rows - 1);
                    }
                }
                _ => {}
            }
            i += 1;
        }

        vec![TerminalEvent::ScreenUpdate {
            screen: self.get_screen_lines(),
            cursor_line: self.cursor_line,
            cursor_col: self.cursor_col,
        }]
    }

    fn handle_csi_sequence(&mut self, params: &str, cmd: char) {
        match cmd {
            'c' => {
                // Device Attributes query - TUI apps use this
                if params.is_empty() || params == "0" {
                    // Primary device attributes
                    self.pending_responses.push("\x1b[?1;2c".to_string());
                }
            }
            'n' => {
                // Device Status Report
                if let Ok(param) = params.parse::<u16>() {
                    match param {
                        5 => {
                            // Status report - terminal OK
                            self.pending_responses.push("\x1b[0n".to_string());
                        }
                        6 => {
                            // Cursor position report
                            self.pending_responses.push(format!(
                                "\x1b[{};{}R",
                                self.cursor_line + 1,
                                self.cursor_col + 1
                            ));
                        }
                        _ => {}
                    }
                }
            }
            'H' | 'f' => {
                // Cursor position
                let parts: Vec<&str> = params.split(';').collect();
                let row = parts.first().and_then(|s| s.parse().ok()).unwrap_or(1);
                let col = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
                self.cursor_line = (row - 1).min(self.screen_rows - 1);
                self.cursor_col = (col - 1).min(self.screen_cols - 1);
            }
            'A' => {
                // Cursor up
                let amount = params.parse().unwrap_or(1);
                self.cursor_line = self.cursor_line.saturating_sub(amount);
            }
            'B' => {
                // Cursor down
                let amount = params.parse().unwrap_or(1);
                self.cursor_line = (self.cursor_line + amount).min(self.screen_rows - 1);
            }
            'C' => {
                // Cursor right
                let amount = params.parse().unwrap_or(1);
                self.cursor_col = (self.cursor_col + amount).min(self.screen_cols - 1);
            }
            'D' => {
                // Cursor left
                let amount = params.parse().unwrap_or(1);
                self.cursor_col = self.cursor_col.saturating_sub(amount);
            }
            'J' => {
                // Clear screen
                let mode = params.parse().unwrap_or(0);
                match mode {
                    0 => self.clear_from_cursor_to_end(),
                    1 => self.clear_from_start_to_cursor(),
                    2 => self.clear_screen(),
                    _ => {}
                }
            }
            'K' => {
                // Clear line
                let mode = params.parse().unwrap_or(0);
                match mode {
                    0 => self.clear_line_from_cursor(),
                    1 => self.clear_line_to_cursor(),
                    2 => self.clear_current_line(),
                    _ => {}
                }
            }
            'm' => {
                // SGR (Select Graphic Rendition) - text formatting and colors
                if params.is_empty() {
                    // Reset all formatting
                    // Note: We'll apply this to future text, current implementation doesn't track state
                } else {
                    let codes: Vec<&str> = params.split(';').collect();
                    for code in codes {
                        match code.parse::<u8>() {
                            Ok(0) => {
                                // Reset all attributes
                            }
                            Ok(1) => {
                                // Bold
                            }
                            Ok(2) => {
                                // Dim
                            }
                            Ok(3) => {
                                // Italic
                            }
                            Ok(4) => {
                                // Underline
                            }
                            Ok(22) => {
                                // Bold off
                            }
                            Ok(23) => {
                                // Italic off
                            }
                            Ok(24) => {
                                // Underline off
                            }
                            Ok(30..=37) => {
                                // Foreground colors (black to white)
                            }
                            Ok(38) => {
                                // Extended foreground color (256 color or RGB)
                            }
                            Ok(39) => {
                                // Default foreground color
                            }
                            Ok(40..=47) => {
                                // Background colors (black to white)
                            }
                            Ok(48) => {
                                // Extended background color (256 color or RGB)
                            }
                            Ok(49) => {
                                // Default background color
                            }
                            Ok(90..=97) => {
                                // Bright foreground colors
                            }
                            Ok(100..=107) => {
                                // Bright background colors
                            }
                            _ => {
                                // Ignore unknown codes
                            }
                        }
                    }
                }
            }
            'S' => {
                // Scroll up
                let amount = params.parse().unwrap_or(1);
                self.scroll_up(amount);
            }
            'T' => {
                // Scroll down
                let amount = params.parse().unwrap_or(1);
                self.scroll_down(amount);
            }
            'P' => {
                // Delete characters
                let amount = params.parse().unwrap_or(1);
                self.delete_characters(amount);
            }
            '@' => {
                // Insert characters
                let amount = params.parse().unwrap_or(1);
                self.insert_characters(amount);
            }
            'L' => {
                // Insert lines
                let amount = params.parse().unwrap_or(1);
                self.insert_lines(amount);
            }
            'M' => {
                // Delete lines
                let amount = params.parse().unwrap_or(1);
                self.delete_lines(amount);
            }
            'X' => {
                // Erase characters
                let amount = params.parse().unwrap_or(1);
                self.erase_characters(amount);
            }
            'r' => {
                // Set scrolling region
                let parts: Vec<&str> = params.split(';').collect();
                let top = parts.first().and_then(|s| s.parse().ok()).unwrap_or(1) - 1;
                let bottom = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(self.screen_rows) - 1;
                self.set_scrolling_region(top, bottom);
            }
            's' => {
                // Save cursor position
                self.save_cursor();
            }
            'u' => {
                // Restore cursor position
                self.restore_cursor();
            }
            'h' => {
                // Set mode - handle common modes
                if let Some(mode) = params.strip_prefix("?") {
                    match mode {
                        "25" => {
                            // Show cursor (DECTCEM)
                        }
                        "1000" => {
                            // Enable mouse tracking
                        }
                        "1002" => {
                            // Enable cell motion mouse tracking
                        }
                        "1049" => {
                            // Enable alternative screen buffer
                        }
                        _ => {}
                    }
                }
            }
            'l' => {
                // Reset mode - handle common modes
                if let Some(mode) = params.strip_prefix("?") {
                    match mode {
                        "25" => {
                            // Hide cursor (DECTCEM)
                        }
                        "1000" => {
                            // Disable mouse tracking
                        }
                        "1002" => {
                            // Disable cell motion mouse tracking
                        }
                        "1049" => {
                            // Disable alternative screen buffer
                        }
                        _ => {}
                    }
                }
            }
            _ => {
                // Unknown sequence - log for debugging only in development
                #[cfg(debug_assertions)]
                println!("Unknown CSI sequence: ESC[{}{}", params, cmd);
            }
        }
    }

    fn clear_screen(&mut self) {
        for line in &mut self.screen_buffer {
            line.clear();
        }
        self.cursor_line = 0;
        self.cursor_col = 0;
    }

    fn clear_from_cursor_to_end(&mut self) {
        // Clear from cursor to end of screen
        if let Some(line) = self.screen_buffer.get_mut(self.cursor_line as usize) {
            line.truncate(self.cursor_col as usize);
        }

        for i in (self.cursor_line + 1) as usize..self.screen_buffer.len() {
            self.screen_buffer[i].clear();
        }
    }

    fn clear_from_start_to_cursor(&mut self) {
        // Clear from start to cursor
        for i in 0..self.cursor_line as usize {
            if let Some(line) = self.screen_buffer.get_mut(i) {
                line.clear();
            }
        }

        if let Some(line) = self.screen_buffer.get_mut(self.cursor_line as usize) {
            for j in 0..=self.cursor_col as usize {
                if j < line.len() {
                    line[j] = LineItem {
                        lexeme: " ".to_string(),
                        width: 1,
                        is_underline: false,
                        is_bold: false,
                        is_italic: false,
                        background_color: None,
                        foreground_color: None,
                    };
                }
            }
        }
    }

    fn clear_line_from_cursor(&mut self) {
        if let Some(line) = self.screen_buffer.get_mut(self.cursor_line as usize) {
            line.truncate(self.cursor_col as usize);
        }
    }

    fn clear_line_to_cursor(&mut self) {
        if let Some(line) = self.screen_buffer.get_mut(self.cursor_line as usize) {
            for j in 0..=self.cursor_col as usize {
                if j < line.len() {
                    line[j] = LineItem {
                        lexeme: " ".to_string(),
                        width: 1,
                        is_underline: false,
                        is_bold: false,
                        is_italic: false,
                        background_color: None,
                        foreground_color: None,
                    };
                }
            }
        }
    }

    fn clear_current_line(&mut self) {
        if let Some(line) = self.screen_buffer.get_mut(self.cursor_line as usize) {
            line.clear();
        }
    }

    fn write_char_at_cursor(&mut self, ch: char) {
        while self.screen_buffer.len() <= self.cursor_line as usize {
            self.screen_buffer.push(Vec::new());
        }

        let line = &mut self.screen_buffer[self.cursor_line as usize];
        while line.len() <= self.cursor_col as usize {
            line.push(LineItem {
                lexeme: " ".to_string(),
                width: 1,
                is_underline: false,
                is_bold: false,
                is_italic: false,
                background_color: None,
                foreground_color: None,
            });
        }

        line[self.cursor_col as usize] = LineItem {
            lexeme: ch.to_string(),
            width: 1,
            is_underline: false,
            is_bold: false,
            is_italic: false,
            background_color: None,
            foreground_color: None,
        };
    }

    fn get_screen_lines(&self) -> Vec<Vec<LineItem>> {
        let mut result = Vec::with_capacity(self.screen_rows as usize);
        for row in 0..self.screen_rows {
            if let Some(line) = self.screen_buffer.get(row as usize) {
                result.push(line.clone());
            } else {
                result.push(Vec::new());
            }
        }
        result
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.screen_rows = rows;
        self.screen_cols = cols;
        self.cursor_line = self.cursor_line.min(rows - 1);
        self.cursor_col = self.cursor_col.min(cols - 1);
    }

    pub fn take_pending_responses(&mut self) -> Vec<String> {
        std::mem::take(&mut self.pending_responses)
    }
    
    // Additional ANSI sequence implementations
    fn scroll_up(&mut self, amount: u16) {
        let amount = amount.min(self.screen_rows) as usize;
        for _ in 0..amount {
            self.screen_buffer.remove(0);
            self.screen_buffer.push(Vec::new());
        }
    }
    
    fn scroll_down(&mut self, amount: u16) {
        let amount = amount.min(self.screen_rows) as usize;
        for _ in 0..amount {
            self.screen_buffer.pop();
            self.screen_buffer.insert(0, Vec::new());
        }
    }
    
    fn delete_characters(&mut self, amount: u16) {
        if let Some(line) = self.screen_buffer.get_mut(self.cursor_line as usize) {
            let start = self.cursor_col as usize;
            let end = (start + amount as usize).min(line.len());
            line.drain(start..end);
        }
    }
    
    fn insert_characters(&mut self, amount: u16) {
        if let Some(line) = self.screen_buffer.get_mut(self.cursor_line as usize) {
            let pos = self.cursor_col as usize;
            for _ in 0..amount {
                line.insert(pos, LineItem {
                    lexeme: " ".to_string(),
                    width: 1,
                    is_underline: false,
                    is_bold: false,
                    is_italic: false,
                    background_color: None,
                    foreground_color: None,
                });
            }
        }
    }
    
    fn insert_lines(&mut self, amount: u16) {
        let line_idx = self.cursor_line as usize;
        for _ in 0..amount {
            if line_idx < self.screen_buffer.len() {
                self.screen_buffer.insert(line_idx, Vec::new());
            }
        }
        // Remove lines from bottom to maintain screen size
        while self.screen_buffer.len() > self.screen_rows as usize {
            self.screen_buffer.pop();
        }
    }
    
    fn delete_lines(&mut self, amount: u16) {
        let line_idx = self.cursor_line as usize;
        for _ in 0..amount {
            if line_idx < self.screen_buffer.len() {
                self.screen_buffer.remove(line_idx);
                self.screen_buffer.push(Vec::new());
            }
        }
    }
    
    fn erase_characters(&mut self, amount: u16) {
        if let Some(line) = self.screen_buffer.get_mut(self.cursor_line as usize) {
            let start = self.cursor_col as usize;
            let end = (start + amount as usize).min(line.len());
            for i in start..end {
                if i < line.len() {
                    line[i] = LineItem {
                        lexeme: " ".to_string(),
                        width: 1,
                        is_underline: false,
                        is_bold: false,
                        is_italic: false,
                        background_color: None,
                        foreground_color: None,
                    };
                }
            }
        }
    }
    
    fn set_scrolling_region(&mut self, _top: u16, _bottom: u16) {
        // For now, just acknowledge the scrolling region
        // Full implementation would require tracking the scrolling region
    }
    
    fn save_cursor(&mut self) {
        // Store cursor position - for now we'll just acknowledge it
        // Full implementation would require storing cursor state
    }
    
    fn restore_cursor(&mut self) {
        // Restore cursor position - for now we'll just acknowledge it
        // Full implementation would require restoring cursor state
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

// Tauri commands
#[tauri::command]
pub async fn create_terminal_connection(
    config: TerminalConfig,
    terminal_manager: State<'_, Arc<TerminalManager>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    terminal_manager
        .create_connection(config, app_handle)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_terminal_data(
    connection_id: String,
    data: String,
    terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
    terminal_manager
        .send_data(&connection_id, &data)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resize_terminal(
    connection_id: String,
    lines: u16,
    cols: u16,
    terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
    terminal_manager
        .resize_terminal(&connection_id, lines, cols)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_terminal_connection(
    connection_id: String,
    terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
    terminal_manager
        .close_connection(&connection_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_terminal_ctrl_c(
    connection_id: String,
    terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
    terminal_manager
        .send_data(&connection_id, "\x03") // Ctrl+C
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_terminal_ctrl_d(
    connection_id: String,
    terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
    terminal_manager
        .send_data(&connection_id, "\x04") // Ctrl+D
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_available_terminal_types() -> Vec<String> {
    #[cfg(target_os = "windows")]
    let mut types = vec!["local".to_string(), "ssh".to_string()];
    #[cfg(not(target_os = "windows"))]
    let types = vec!["local".to_string(), "ssh".to_string()];

    #[cfg(target_os = "windows")]
    {
        // Check for Git Bash
        let git_bash_paths = [
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
            "C:\\Git\\bin\\bash.exe",
        ];

        for path in &git_bash_paths {
            if std::path::Path::new(path).exists() {
                types.push("git-bash".to_string());
                break;
            }
        }

        // Check for WSL
        if std::process::Command::new("wsl")
            .arg("--status")
            .output()
            .is_ok()
        {
            types.push("wsl".to_string());
        }
    }

    types
}
