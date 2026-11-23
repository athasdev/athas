//! One terminal: Alacritty's emulator fed by a PTY backend, plus what the shell reports about
//! itself (title, working directory, running command).

use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Instant,
};

use alacritty_terminal::{
    Term,
    event::{Event as AlacEvent, EventListener, WindowSize},
    grid::{Dimensions, Scroll},
    index::{Column, Direction, Line, Point as AlacPoint, Side},
    selection::{Selection, SelectionType},
    sync::FairMutex,
    term::{
        Config, TermMode,
        cell::Flags,
        search::{Match, RegexIter, RegexSearch},
    },
    vte::{
        self,
        ansi::{ClearMode, Color, CursorShape, CursorStyle, Handler, NamedColor, Processor, Rgb, StdSyncHandler},
    },
};
use anyhow::Result;
use futures::channel::mpsc::{UnboundedReceiver, UnboundedSender, unbounded};

use crate::{
    colors::{Palette, hsla_to_rgb},
    keys::paste_bytes,
    pty::{self, Pty, PtyIo, PtySize},
    shell::ShellCommand,
};

/// xterm's search addon stops counting here.
const MAX_SEARCH_MATCHES: usize = 1000;

/// What the settings ask of the emulator.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct TermOptions {
    pub scrollback: usize,
    pub cursor_shape: CursorShape,
    pub cursor_blink: bool,
}

impl TermOptions {
    pub fn from_settings(settings: &settings::Settings) -> Self {
        let cursor_shape = match settings.terminal_cursor_style.as_str() {
            "block" => CursorShape::Block,
            "underline" => CursorShape::Underline,
            _ => CursorShape::Beam,
        };
        Self {
            scrollback: settings.terminal_scrollback.clamp(0., 1_000_000.) as usize,
            cursor_shape,
            cursor_blink: settings.terminal_cursor_blink,
        }
    }

    fn config(&self) -> Config {
        Config {
            scrolling_history: self.scrollback,
            default_cursor_style: CursorStyle { shape: self.cursor_shape, blinking: self.cursor_blink },
            ..Config::default()
        }
    }
}

impl Default for TermOptions {
    fn default() -> Self {
        Self { scrollback: 10_000, cursor_shape: CursorShape::Beam, cursor_blink: true }
    }
}

/// The find bar's toggles.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

/// The pattern the emulator's regex search runs for a query.
pub(crate) fn search_pattern(query: &str, options: SearchOptions) -> String {
    let body = if options.regex { query.to_string() } else { escape_regex(query) };
    let body = if options.whole_word { format!("(?-u:\\b)(?:{body})(?-u:\\b)") } else { body };
    format!("{}{body}", if options.case_sensitive { "(?-i)" } else { "(?i)" })
}

fn escape_regex(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        if "\\.+*?()|[]{}^$#&-~".contains(character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

/// What the PTY threads tell the terminal's view.
pub(crate) enum TerminalEvent {
    /// New output to draw.
    Wakeup,
    Alacritty(AlacEvent),
    /// A shell integration report, with the line it came on (counted from the top of the
    /// scrollback).
    Shell(ShellMark, i64),
    Exited(crate::pty::ExitStatus),
}

/// What the shell integration scripts report (OSC 7 and OSC 133), and progress reports (OSC 9;4).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ShellMark {
    WorkingDirectory(PathBuf),
    PromptStarted,
    CommandStarted,
    CommandFinished(Option<i32>),
    /// `OSC 9;4;state;value`, the value already clamped to 0–100 (absent when not given).
    Progress { state: u8, value: Option<u8> },
}

/// A program's progress report (`TerminalProgress`): 1 sets, 2 errors, 3 is indeterminate,
/// 4 pauses. A report of 0 clears it, so the terminal keeps none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TerminalProgress {
    pub state: u8,
    pub value: u8,
}

/// The progress after a report, as xterm's progress addon applies it: setting needs a value,
/// errors and pauses keep the last value when they bring none, indeterminate always keeps it.
pub(crate) fn apply_progress(current: Option<TerminalProgress>, state: u8, value: Option<u8>) -> Option<TerminalProgress> {
    let last = current.map_or(0, |progress| progress.value);
    match state {
        0 => None,
        1 => match value {
            Some(value) => Some(TerminalProgress { state, value }),
            None => current,
        },
        2 | 4 => Some(TerminalProgress { state, value: value.unwrap_or(last) }),
        3 => Some(TerminalProgress { state, value: last }),
        _ => current,
    }
}

/// The emulator's size: its grid plus the scrollback.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GridSize {
    pub columns: usize,
    pub lines: usize,
}

impl Dimensions for GridSize {
    fn total_lines(&self) -> usize {
        self.lines
    }

    fn screen_lines(&self) -> usize {
        self.lines
    }

    fn columns(&self) -> usize {
        self.columns
    }
}

/// Something a program asked for and is waiting on: the cursor position or the device
/// attributes (`PtyWrite`, already written out by the emulator), a palette colour, or the size of
/// the text area.
enum Answer {
    Bytes(Vec<u8>),
    Color(usize, Arc<dyn Fn(Rgb) -> String + Sync + Send>),
    TextAreaSize(Arc<dyn Fn(WindowSize) -> String + Sync + Send>),
}

/// The queries a chunk of output asked, and what they are answered with.
///
/// Answers go back on the thread that read the output, as soon as the emulator lets go of the
/// grid, and in the order they were asked. Both matter: a program that asks for a colour reads
/// the answer with a timeout of a few milliseconds, which a round trip through the UI thread
/// misses, and one that asks for a colour and then for its device attributes takes the
/// attributes coming back first as "no colour is coming". Either way the answer arrives after
/// the program has given up, and the shell it returns to shows `rgb:dbdb/d7d7/caca` on its
/// prompt as if the user had typed it.
pub(crate) struct Queries {
    pending: Mutex<Vec<Answer>>,
    state: Mutex<QueryState>,
}

/// What a query is answered with: the theme's colours (the view keeps them current) and the size
/// the PTY was last given.
struct QueryState {
    palette: Palette,
    size: PtySize,
}

impl Queries {
    fn new(palette: Palette, size: PtySize) -> Self {
        Self { pending: Mutex::new(Vec::new()), state: Mutex::new(QueryState { palette, size }) }
    }

    pub fn set_palette(&self, palette: Palette) {
        self.state.lock().unwrap().palette = palette;
    }

    fn set_size(&self, size: PtySize) {
        self.state.lock().unwrap().size = size;
    }

    fn push(&self, answer: Answer) {
        self.pending.lock().unwrap().push(answer);
    }

    /// Writes out what the output just parsed asked for. Called with the grid locked, so the
    /// colours a program set itself (OSC 4/10/11) are the ones it gets back.
    fn answer(&self, term: &Term<Listener>, input: &mpsc::Sender<Vec<u8>>) {
        let pending = std::mem::take(&mut *self.pending.lock().unwrap());
        if pending.is_empty() {
            return;
        }
        let state = self.state.lock().unwrap();
        for answer in pending {
            let bytes = match answer {
                Answer::Bytes(bytes) => bytes,
                Answer::Color(index, format) => {
                    let overrides = term.colors();
                    let color = match index {
                        0..=255 => state.palette.resolve(Color::Indexed(index as u8), overrides),
                        256 => state.palette.resolve(Color::Named(NamedColor::Foreground), overrides),
                        257 => state.palette.resolve(Color::Named(NamedColor::Background), overrides),
                        _ => state.palette.resolve(Color::Named(NamedColor::Cursor), overrides),
                    };
                    format(hsla_to_rgb(color)).into_bytes()
                }
                Answer::TextAreaSize(format) => {
                    let size = state.size;
                    format(WindowSize {
                        num_lines: size.rows,
                        num_cols: size.cols,
                        cell_width: size.cell_width,
                        cell_height: size.cell_height,
                    })
                    .into_bytes()
                }
            };
            input.send(bytes).ok();
        }
    }
}

#[derive(Clone)]
pub(crate) struct Listener {
    events: UnboundedSender<TerminalEvent>,
    queries: Arc<Queries>,
}

impl EventListener for Listener {
    fn send_event(&self, event: AlacEvent) {
        match event {
            // Queries are answered where the output was read, in the order they were asked.
            AlacEvent::PtyWrite(text) => self.queries.push(Answer::Bytes(text.into_bytes())),
            AlacEvent::ColorRequest(index, format) => self.queries.push(Answer::Color(index, format)),
            AlacEvent::TextAreaSizeRequest(format) => self.queries.push(Answer::TextAreaSize(format)),
            AlacEvent::Wakeup | AlacEvent::MouseCursorDirty | AlacEvent::CursorBlinkingChange => {}
            event => {
                self.events.unbounded_send(TerminalEvent::Alacritty(event)).ok();
            }
        }
    }
}

pub(crate) type TermLock = Arc<FairMutex<Term<Listener>>>;

pub(crate) struct Terminal {
    pub term: TermLock,
    pty: Box<dyn Pty>,
    input: mpsc::Sender<Vec<u8>>,
    /// Set by the reader thread when it asks for a redraw, cleared once the view has it.
    pub wakeup_pending: Arc<AtomicBool>,
    /// What the emulator answers a program's queries with.
    queries: Arc<Queries>,
    size: PtySize,
    shell_name: String,
    /// The title the program set (OSC 0/2).
    pub title: Option<String>,
    pub cwd: PathBuf,
    pub process_name: Option<String>,
    pub command_running: bool,
    command_started_at: Option<web_time::Instant>,
    /// How long the last finished command ran.
    pub last_command_duration: Option<std::time::Duration>,
    /// The name the user gave the tab.
    pub custom_name: Option<String>,
    /// The command a run action typed in, which names the tab before the program sets a title.
    pub initial_command: Option<String>,
    pub commands: CommandMarks,
    pub progress: Option<TerminalProgress>,
}

/// Where each command's prompt and output start, from the shell integration's OSC 133 marks
/// (`TerminalShellIntegration`). Lines count from the top of the scrollback.
#[derive(Clone, Debug, Default)]
pub(crate) struct CommandMarks {
    commands: Vec<CommandRecord>,
    pending: Option<CommandRecord>,
}

#[derive(Clone, Debug, PartialEq)]
struct CommandRecord {
    prompt: i64,
    output: Option<i64>,
    running: bool,
    exit_code: Option<i32>,
}

impl CommandMarks {
    pub fn record(&mut self, mark: &ShellMark, line: i64) {
        match mark {
            ShellMark::PromptStarted => match self.pending.as_mut() {
                Some(pending) if pending.output.is_none() => pending.prompt = line,
                _ => self.pending = Some(CommandRecord { prompt: line, output: None, running: true, exit_code: None }),
            },
            ShellMark::CommandStarted => {
                let mut command = self.pending.take().unwrap_or(CommandRecord { prompt: line, output: None, running: true, exit_code: None });
                command.output = Some(line);
                command.running = true;
                self.commands.push(command);
            }
            ShellMark::CommandFinished(code) => {
                if let Some(command) = self.commands.last_mut().filter(|command| command.running) {
                    command.running = false;
                    command.exit_code = *code;
                }
            }
            ShellMark::WorkingDirectory(_) | ShellMark::Progress { .. } => {}
        }
    }

    pub fn clear(&mut self) {
        self.commands.clear();
        self.pending = None;
    }

    fn prompts(&self) -> impl Iterator<Item = i64> + '_ {
        self.commands.iter().map(|command| command.prompt)
    }
}

impl Terminal {
    pub fn spawn_command(
        command: &ShellCommand,
        options: TermOptions,
        palette: Palette,
    ) -> Result<(Self, UnboundedReceiver<TerminalEvent>)> {
        Self::spawn_configured(command.name(), command.cwd.clone(), options, palette, |size, io| pty::spawn(command, size, io))
    }

    /// A terminal on the process `spawn` starts, such as a shell on a remote server.
    pub fn spawn_configured(
        shell_name: String,
        cwd: PathBuf,
        options: TermOptions,
        palette: Palette,
        spawn: impl FnOnce(PtySize, PtyIo) -> Result<Box<dyn Pty>>,
    ) -> Result<(Self, UnboundedReceiver<TerminalEvent>)> {
        let (events_tx, events_rx) = unbounded();
        let (input_tx, input_rx) = mpsc::channel();
        let size = PtySize { rows: 24, cols: 80, cell_width: 8, cell_height: 16 };

        let config = options.config();
        let queries = Arc::new(Queries::new(palette, size));
        let listener = Listener { events: events_tx.clone(), queries: queries.clone() };
        let grid = GridSize { columns: size.cols as usize, lines: size.rows as usize };
        let term = Arc::new(FairMutex::new(Term::new(config, &grid, listener)));
        let wakeup_pending = Arc::new(AtomicBool::new(false));

        let io = PtyIo {
            input: input_rx,
            output: Box::new(output_processor(
                term.clone(),
                events_tx.clone(),
                wakeup_pending.clone(),
                queries.clone(),
                input_tx.clone(),
            )),
            exited: Box::new(move |status| {
                events_tx.unbounded_send(TerminalEvent::Exited(status)).ok();
            }),
        };
        let pty = spawn(size, io)?;

        let terminal = Self {
            term,
            pty,
            input: input_tx,
            wakeup_pending,
            queries,
            size,
            shell_name,
            title: None,
            cwd,
            process_name: None,
            command_running: false,
            command_started_at: None,
            last_command_duration: None,
            custom_name: None,
            initial_command: None,
            commands: CommandMarks::default(),
            progress: None,
        };
        Ok((terminal, events_rx))
    }

    pub fn shell_name(&self) -> String {
        self.shell_name.clone()
    }

    pub fn write(&self, bytes: impl Into<Vec<u8>>) {
        self.input.send(bytes.into()).ok();
    }

    /// Typed input: scrolls back to the prompt, as every terminal does.
    /// Shows `bytes` as if the process had printed them.
    pub(crate) fn write_output(&self, bytes: &[u8]) {
        let mut term = self.term.lock();
        Processor::<StdSyncHandler>::new().advance(&mut *term, bytes);
        self.queries.answer(&term, &self.input);
    }

    pub fn input(&self, bytes: impl Into<Vec<u8>>) {
        self.term.lock().scroll_display(Scroll::Bottom);
        self.write(bytes);
    }

    pub fn paste(&self, text: &str) {
        let mode = self.mode();
        self.input(paste_bytes(text, mode));
    }

    pub fn mode(&self) -> TermMode {
        *self.term.lock().mode()
    }

    pub fn resize(&mut self, size: PtySize) {
        if size == self.size {
            return;
        }
        self.size = size;
        self.queries.set_size(size);
        self.term.lock().resize(GridSize { columns: size.cols as usize, lines: size.rows as usize });
        self.pty.resize(size);
    }

    pub fn scroll(&self, lines: i32) {
        self.term.lock().scroll_display(Scroll::Delta(lines));
    }

    pub fn set_options(&self, options: TermOptions) {
        self.term.lock().set_options(options.config());
    }

    /// The colours a program's palette query is answered with; the view sets them again whenever
    /// the theme changes.
    pub(crate) fn set_palette(&self, palette: Palette) {
        self.queries.set_palette(palette);
    }

    /// Every match of `query` in the scrollback and screen, oldest first; `None` when the pattern
    /// does not compile.
    pub fn search(&self, query: &str, options: SearchOptions) -> Option<Vec<Match>> {
        let mut regex = RegexSearch::new(&search_pattern(query, options)).ok()?;
        let term = self.term.lock();
        let start = AlacPoint::new(term.topmost_line(), Column(0));
        let end = AlacPoint::new(term.bottommost_line(), term.last_column());
        Some(RegexIter::new(start, end, Direction::Right, &term, &mut regex).take(MAX_SEARCH_MATCHES).collect())
    }

    /// Selects `found` and scrolls it into view, as the search addon does with its match.
    pub fn reveal_match(&self, found: &Match) {
        let mut term = self.term.lock();
        let mut selection = Selection::new(SelectionType::Simple, *found.start(), Side::Left);
        selection.update(*found.end(), Side::Right);
        term.selection = Some(selection);
        let screen = term.screen_lines() as i32;
        let offset = term.grid().display_offset() as i32;
        let line = found.start().line.0;
        if line < -offset || line >= screen - offset {
            let target = (screen / 2 - line).clamp(0, term.grid().history_size() as i32);
            term.scroll_display(Scroll::Delta(target - offset));
        }
    }

    pub fn clear_selection(&self) {
        self.term.lock().selection = None;
    }

    /// Selects the word under `point` (right-click with `terminalRightClickSelectsWord`).
    pub fn select_word(&self, point: AlacPoint) {
        let mut term = self.term.lock();
        let mut selection = Selection::new(SelectionType::Semantic, point, Side::Left);
        selection.update(point, Side::Right);
        term.selection = Some(selection);
    }

    /// The text of a screen line and the OSC 8 link of each cell, by viewport row.
    pub fn viewport_line(&self, row: usize) -> Option<(String, Vec<Option<String>>)> {
        let term = self.term.lock();
        if row >= term.screen_lines() {
            return None;
        }
        let line = Line(row as i32 - term.grid().display_offset() as i32);
        let mut text = String::new();
        let mut hyperlinks = Vec::new();
        for column in 0..term.columns() {
            let cell = &term.grid()[line][Column(column)];
            if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                text.push(' ');
            } else {
                text.push(if cell.c == '\t' { ' ' } else { cell.c });
            }
            hyperlinks.push(cell.hyperlink().map(|link| link.uri().to_string()));
        }
        Some((text, hyperlinks))
    }

    /// The line the cursor is on, counted from the top of the scrollback.
    fn cursor_absolute_line(term: &Term<Listener>) -> i64 {
        term.grid().history_size() as i64 + term.grid().cursor.point.line.0 as i64
    }

    fn to_line(term: &Term<Listener>, absolute: i64) -> Option<Line> {
        let line = absolute - term.grid().history_size() as i64;
        (line >= -(term.grid().history_size() as i64) && line < term.screen_lines() as i64).then_some(Line(line as i32))
    }

    /// The text from the start of the last command's output to the next prompt
    /// (`getLastCommandOutput`); `None` without shell integration.
    pub fn last_command_output(&self) -> Option<String> {
        let marks = &self.commands;
        let index = marks.commands.iter().rposition(|command| command.output.is_some())?;
        let command = &marks.commands[index];
        let term = self.term.lock();
        let start = Self::to_line(&term, command.output?)?;
        let next_prompt = marks.commands.get(index + 1).map(|next| next.prompt).or(marks.pending.as_ref().map(|pending| pending.prompt));
        let end = match next_prompt.and_then(|prompt| Self::to_line(&term, prompt)) {
            Some(line) => line.0,
            None if command.running => term.grid().cursor.point.line.0,
            None => term.screen_lines() as i32,
        };
        let mut lines: Vec<String> = (start.0..end).map(|line| row_text(&term, Line(line))).collect();
        while lines.last().is_some_and(|line| line.is_empty()) {
            lines.pop();
        }
        Some(lines.join("\n"))
    }

    /// Scrolls the prompt before (`-1`) or after (`1`) the top of the view to the top
    /// (`scrollToPreviousCommand` / `scrollToNextCommand`).
    pub fn scroll_to_command(&self, direction: i32) -> bool {
        let mut term = self.term.lock();
        let history = term.grid().history_size() as i64;
        let top = history - term.grid().display_offset() as i64;
        let target = if direction < 0 {
            self.commands.prompts().filter(|prompt| *prompt >= 0 && *prompt < top).last()
        } else {
            self.commands.prompts().find(|prompt| *prompt > top)
        };
        match target {
            Some(prompt) => {
                let offset = (history - prompt).clamp(0, history) as i32;
                let current = term.grid().display_offset() as i32;
                term.scroll_display(Scroll::Delta(offset - current));
                true
            }
            None => {
                if direction > 0 {
                    term.scroll_display(Scroll::Bottom);
                }
                false
            }
        }
    }

    /// The scrollback and screen as plain text, wrapped rows joined (`getTerminalExportText`).
    pub fn export_text(&self) -> String {
        let term = self.term.lock();
        let mut lines: Vec<String> = Vec::new();
        let mut continues = false;
        for line in term.topmost_line().0..=term.bottommost_line().0 {
            let line = Line(line);
            let text = row_text(&term, line);
            let wraps = term.grid()[line][term.last_column()].flags.contains(Flags::WRAPLINE);
            if continues && let Some(last) = lines.last_mut() {
                last.push_str(&text);
            } else {
                lines.push(text);
            }
            continues = wraps;
        }
        let mut lines: Vec<String> = lines.into_iter().map(|line| line.trim_end().to_string()).collect();
        while lines.last().is_some_and(|line| line.is_empty()) {
            lines.pop();
        }
        lines.join("\n")
    }

    pub fn set_focused(&self, focused: bool) {
        let mut term = self.term.lock();
        term.is_focused = focused;
        if term.mode().contains(TermMode::FOCUS_IN_OUT) {
            self.write(if focused { b"\x1b[I".to_vec() } else { b"\x1b[O".to_vec() });
        }
    }

    pub fn start_selection(&self, point: AlacPoint, side: Side, kind: SelectionType) {
        self.term.lock().selection = Some(Selection::new(kind, point, side));
    }

    pub fn update_selection(&self, point: AlacPoint, side: Side) {
        if let Some(selection) = self.term.lock().selection.as_mut() {
            selection.update(point, side);
        }
    }

    pub fn select_all(&self) {
        let mut term = self.term.lock();
        let start = AlacPoint::new(term.topmost_line(), Column(0));
        let end = AlacPoint::new(term.bottommost_line(), term.last_column());
        let mut selection = Selection::new(SelectionType::Simple, start, Side::Left);
        selection.update(end, Side::Right);
        term.selection = Some(selection);
    }

    pub fn selection_text(&self) -> Option<String> {
        self.term.lock().selection_to_string().filter(|text| !text.is_empty())
    }

    /// Clears the scrollback and the screen above the prompt, keeping the line being typed
    /// (cmd-K). Adapted from Zed's `InternalEvent::Clear` (GPL-3.0-or-later, Zed Industries).
    pub fn clear(&mut self) {
        let mut term = self.term.lock();
        term.clear_screen(ClearMode::Saved);
        let cursor = term.grid().cursor.point;
        term.grid_mut().reset_region(..cursor.line);

        let columns = term.columns();
        let line: Vec<_> = (0..columns).map(|column| term.grid()[cursor.line][Column(column)].clone()).collect();
        for (column, cell) in line.into_iter().enumerate() {
            term.grid_mut()[Line(0)][Column(column)] = cell;
        }
        term.grid_mut().cursor.point = AlacPoint::new(Line(0), cursor.column);
        if term.screen_lines() > 1 {
            term.grid_mut().reset_region(Line(1)..);
        }
        term.selection = None;
        drop(term);
        self.commands.clear();
    }

    pub fn update_process_name(&mut self) -> bool {
        let name = self.pty.foreground_process_name();
        let changed = name != self.process_name;
        self.process_name = name;
        changed
    }

    /// The tab's label: a useful title the program set, else the program in the foreground,
    /// else the folder, as Athas's `getTerminalDisplayName` picks it.
    pub fn display_title(&self) -> String {
        if let Some(name) = self.custom_name.as_deref().filter(|name| !name.trim().is_empty()) {
            return name.to_string();
        }
        if let Some(title) = self.title.as_deref().and_then(normalize_title).filter(|title| is_useful_title(title)) {
            return title.to_string();
        }
        if let Some(process) = self.process_name.as_deref().map(|name| name.trim_start_matches('-'))
            && !process.is_empty()
            && process != self.shell_name
            && process != "login"
        {
            return process.to_string();
        }
        if let Some(command) = self.initial_command.as_deref().and_then(command_label) {
            return command;
        }
        directory_label(&self.cwd).unwrap_or_else(|| self.shell_name.clone())
    }

    pub fn handle_shell_mark(&mut self, mark: ShellMark, line: i64) {
        self.commands.record(&mark, line);
        match mark {
            ShellMark::WorkingDirectory(cwd) => self.cwd = cwd,
            ShellMark::Progress { state, value } => self.progress = apply_progress(self.progress, state, value),
            ShellMark::PromptStarted => {}
            ShellMark::CommandStarted => {
                self.command_running = true;
                self.command_started_at = Some(web_time::Instant::now());
            }
            ShellMark::CommandFinished(_) => {
                self.command_running = false;
                self.last_command_duration = self.command_started_at.take().map(|started| started.elapsed());
            }
        }
    }
}

/// Feeds PTY output to the emulator on the reader thread and asks the view to redraw. While a
/// wakeup is pending, later output joins it, so a flood of output costs one frame.
fn output_processor(
    term: TermLock,
    events: UnboundedSender<TerminalEvent>,
    wakeup_pending: Arc<AtomicBool>,
    queries: Arc<Queries>,
    input: mpsc::Sender<Vec<u8>>,
) -> impl FnMut(&[u8]) + Send {
    let mut processor = Processor::<StdSyncHandler>::new();
    let mut parser = vte::Parser::new();
    let mut marks = ShellMarks::default();
    move |bytes| {
        let mut found = Vec::new();
        {
            let mut term = term.lock();
            // Output up to each mark reaches the emulator first, so the mark gets the line the
            // cursor was on when the shell sent it.
            let mut fed = 0;
            for index in 0..bytes.len() {
                parser.advance(&mut marks, &bytes[index..=index]);
                for mark in marks.marks.drain(..) {
                    processor.advance(&mut *term, &bytes[fed..=index]);
                    fed = index + 1;
                    found.push((mark, Terminal::cursor_absolute_line(&term)));
                }
            }
            processor.advance(&mut *term, &bytes[fed..]);
            // A synchronized update that never ended is flushed after its timeout.
            if processor.sync_timeout().sync_timeout().is_some_and(|deadline| deadline <= Instant::now()) {
                processor.stop_sync(&mut *term);
            }
            // Still holding the grid: what these bytes asked for goes back before the program
            // that asked gives up on it.
            queries.answer(&term, &input);
        }
        for (mark, line) in found {
            events.unbounded_send(TerminalEvent::Shell(mark, line)).ok();
        }
        if !wakeup_pending.swap(true, Ordering::AcqRel) {
            events.unbounded_send(TerminalEvent::Wakeup).ok();
        }
    }
}

/// Picks the OSC 7 and OSC 133 reports out of the output; Alacritty ignores them.
#[derive(Default)]
struct ShellMarks {
    marks: Vec<ShellMark>,
}

impl vte::Perform for ShellMarks {
    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        if let Some(mark) = parse_shell_mark(params) {
            self.marks.push(mark);
        }
    }
}

fn parse_shell_mark(params: &[&[u8]]) -> Option<ShellMark> {
    match *params.first()? {
        b"7" => {
            let url = params[1..].join(&b';');
            working_directory_from_url(std::str::from_utf8(&url).ok()?).map(ShellMark::WorkingDirectory)
        }
        b"133" => match *params.get(1)? {
            b"A" => Some(ShellMark::PromptStarted),
            b"C" => Some(ShellMark::CommandStarted),
            b"D" => {
                let code = params.get(2).and_then(|code| std::str::from_utf8(code).ok()?.parse().ok());
                Some(ShellMark::CommandFinished(code))
            }
            _ => None,
        },
        b"9" if params.get(1) == Some(&&b"4"[..]) && params.len() <= 4 => {
            let number = |param: Option<&&[u8]>| -> Option<i64> { std::str::from_utf8(param?).ok()?.parse().ok() };
            let state = number(params.get(2)).unwrap_or(0);
            if !(0..=4).contains(&state) {
                return None;
            }
            let value = number(params.get(3)).filter(|value| *value >= 0).map(|value| value.min(100) as u8);
            Some(ShellMark::Progress { state: state as u8, value })
        }
        _ => None,
    }
}

/// The folder in an OSC 7 `file://host/path` report.
fn working_directory_from_url(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("file://")?;
    let path = &rest[rest.find('/')?..];
    Some(PathBuf::from(percent_decode(path)?))
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

/// A title as Athas shows it: trimmed, and dropped when it carries control characters or the
/// fragments of a broken escape sequence.
fn normalize_title(title: &str) -> Option<&str> {
    let title = title.trim();
    let control = title.chars().any(|character| character.is_control() || character == '\u{fffd}');
    (!title.is_empty() && !control && !has_leaked_escape(title)).then_some(title)
}

/// Athas's `/\[(?:\?[0-9;]*|[0-9;]*)[JKhlm]/` and `/\](?:0|1|2);/`: what is left of a CSI or OSC
/// sequence whose escape byte got lost.
fn has_leaked_escape(title: &str) -> bool {
    let bytes = title.as_bytes();
    bytes.iter().enumerate().any(|(index, byte)| match byte {
        b'[' => {
            let rest = &bytes[index + 1..];
            let rest = rest.strip_prefix(b"?").unwrap_or(rest);
            let parameters = rest.iter().take_while(|byte| byte.is_ascii_digit() || **byte == b';').count();
            rest.get(parameters).is_some_and(|end| b"JKhlm".contains(end))
        }
        b']' => matches!(bytes.get(index + 1..index + 3), Some([b'0' | b'1' | b'2', b';'])),
        _ => false,
    })
}

fn row_text(term: &Term<Listener>, line: Line) -> String {
    let row = &term.grid()[line];
    let mut text = String::new();
    for column in 0..term.columns() {
        let cell = &row[Column(column)];
        if cell.flags.intersects(Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER) {
            continue;
        }
        text.push(if cell.c == '\t' { ' ' } else { cell.c });
        if let Some(zero_width) = cell.zerowidth() {
            text.extend(zero_width);
        }
    }
    text.trim_end().to_string()
}

/// `getCommandLabel`: the program a command runs, without its folder.
fn command_label(command: &str) -> Option<String> {
    let first = command.split_whitespace().next()?;
    let name = first.rsplit(['/', '\\']).next().unwrap_or(first);
    (!name.is_empty()).then(|| name.to_string())
}

/// Long titles and prompt-style titles (`user@host: ~/src`) say less than the folder does.
fn is_useful_title(title: &str) -> bool {
    title.chars().count() <= 28 && !title.contains('@') && !title.contains('/') && !title.contains('\\')
}

fn directory_label(path: &std::path::Path) -> Option<String> {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).or_else(|| {
        let path = path.to_string_lossy();
        (!path.is_empty()).then(|| path.into_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marks(bytes: &[u8]) -> Vec<ShellMark> {
        let mut parser = vte::Parser::new();
        let mut marks = ShellMarks::default();
        parser.advance(&mut marks, bytes);
        marks.marks
    }

    #[cfg(unix)]
    #[test]
    fn exit_status_reaches_the_view() {
        let wait = |code: &str| {
            let command = crate::shell::program_command("/bin/sh".into(), vec!["-c".into(), format!("exit {code}")]);
            let (_terminal, mut events) =
                Terminal::spawn_command(&command, TermOptions::default(), crate::colors::test_palette()).unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                match events.try_recv() {
                    Ok(TerminalEvent::Exited(status)) => return status,
                    Ok(_) => {}
                    Err(_) if std::time::Instant::now() > deadline => panic!("no exit"),
                    Err(_) => std::thread::sleep(std::time::Duration::from_millis(10)),
                }
            }
        };
        let failed = wait("3");
        assert_eq!(failed.code, Some(3));
        assert!(!failed.is_clean());
        assert_eq!(failed.describe(), "Terminal process exited unexpectedly (exit code 3).");
        assert!(wait("0").is_clean());
        let signalled = crate::pty::ExitStatus { code: None, signal: Some("SIGKILL".into()) };
        assert_eq!(signalled.describe(), "Terminal process exited unexpectedly (signal SIGKILL).");
    }

    /// A program asks for the background colour and then for the device attributes, the way a
    /// program checks whether an answer is coming at all. Both answers go back, in that order:
    /// the attributes arriving first reads as "no colour is coming", and the colour then lands on
    /// the shell's prompt as typed input.
    #[test]
    fn colour_queries_are_answered_in_order() {
        let (events_tx, _events) = unbounded();
        let (input_tx, input_rx) = mpsc::channel();
        let size = PtySize { rows: 24, cols: 80, cell_width: 7, cell_height: 15 };
        let queries = Arc::new(Queries::new(crate::colors::test_palette(), size));
        let grid = GridSize { columns: size.cols as usize, lines: size.rows as usize };
        let listener = Listener { events: events_tx, queries: queries.clone() };
        let mut term = Term::new(Config::default(), &grid, listener);

        Processor::<StdSyncHandler>::new().advance(&mut term, b"\x1b]11;?\x1b\\\x1b[c\x1b[14t");
        assert!(input_rx.try_recv().is_err(), "nothing goes out while the emulator still has the grid");

        queries.answer(&term, &input_tx);
        let answer = |bytes: Vec<u8>| String::from_utf8(bytes).unwrap();
        assert_eq!(answer(input_rx.try_recv().unwrap()), "\x1b]11;rgb:1a1a/1a1a/1a1a\x1b\\");
        assert_eq!(answer(input_rx.try_recv().unwrap()), "\x1b[?6c");
        assert_eq!(answer(input_rx.try_recv().unwrap()), "\x1b[4;360;560t");
        assert!(input_rx.try_recv().is_err());
    }

    #[test]
    fn reads_shell_integration_reports() {
        assert_eq!(
            marks(b"\x1b]7;file://mac.local/Users/me/My%20Project\x07"),
            vec![ShellMark::WorkingDirectory("/Users/me/My Project".into())]
        );
        assert_eq!(
            marks(b"out\x1b]133;C\x07more\x1b]133;D;130\x1b\\\x1b]133;A\x07"),
            vec![ShellMark::CommandStarted, ShellMark::CommandFinished(Some(130)), ShellMark::PromptStarted]
        );
        assert_eq!(marks(b"\x1b]0;title\x07\x1b]133;D\x07"), vec![ShellMark::CommandFinished(None)]);
    }

    #[test]
    fn reads_progress_reports() {
        assert_eq!(marks(b"\x1b]9;4;1;42\x07"), vec![ShellMark::Progress { state: 1, value: Some(42) }]);
        assert_eq!(marks(b"\x1b]9;4;1;250\x1b\\"), vec![ShellMark::Progress { state: 1, value: Some(100) }]);
        assert_eq!(marks(b"\x1b]9;4;3\x07"), vec![ShellMark::Progress { state: 3, value: None }]);
        assert_eq!(marks(b"\x1b]9;4;0;0\x07"), vec![ShellMark::Progress { state: 0, value: Some(0) }]);
        assert!(marks(b"\x1b]9;4;7;1\x07").is_empty());
        assert!(marks(b"\x1b]9;4;1;2;3\x07").is_empty());
        assert!(marks(b"\x1b]9;hello\x07").is_empty());

        let set = apply_progress(None, 1, Some(40));
        assert_eq!(set, Some(TerminalProgress { state: 1, value: 40 }));
        assert_eq!(apply_progress(set, 2, None), Some(TerminalProgress { state: 2, value: 40 }));
        assert_eq!(apply_progress(set, 4, Some(70)), Some(TerminalProgress { state: 4, value: 70 }));
        assert_eq!(apply_progress(set, 3, Some(90)), Some(TerminalProgress { state: 3, value: 40 }));
        assert_eq!(apply_progress(set, 1, None), set);
        assert_eq!(apply_progress(set, 0, None), None);
    }

    #[test]
    fn reports_split_across_reads() {
        let mut parser = vte::Parser::new();
        let mut marks = ShellMarks::default();
        parser.advance(&mut marks, b"\x1b]7;file://h/tm");
        assert!(marks.marks.is_empty());
        parser.advance(&mut marks, b"p\x07");
        assert_eq!(marks.marks, vec![ShellMark::WorkingDirectory("/tmp".into())]);
    }

    #[test]
    fn command_marks() {
        let mut marks = CommandMarks::default();
        marks.record(&ShellMark::PromptStarted, 0);
        marks.record(&ShellMark::PromptStarted, 1);
        marks.record(&ShellMark::CommandStarted, 2);
        marks.record(&ShellMark::CommandFinished(Some(1)), 5);
        marks.record(&ShellMark::PromptStarted, 5);
        assert_eq!(marks.commands, vec![CommandRecord { prompt: 1, output: Some(2), running: false, exit_code: Some(1) }]);
        assert_eq!(marks.pending.as_ref().map(|pending| pending.prompt), Some(5));
    }

    #[test]
    fn search_patterns() {
        let plain = SearchOptions::default();
        assert_eq!(search_pattern("a.b", plain), "(?i)a\\.b");
        assert_eq!(search_pattern("a.b", SearchOptions { regex: true, case_sensitive: true, ..plain }), "(?-i)a.b");
        assert_eq!(search_pattern("x", SearchOptions { whole_word: true, ..plain }), "(?i)(?-u:\\b)(?:x)(?-u:\\b)");
        assert!(RegexSearch::new(&search_pattern("x", SearchOptions { whole_word: true, ..plain })).is_ok());
        assert!(RegexSearch::new(&search_pattern("([", plain)).is_ok());
        assert_eq!(command_label("/usr/bin/npm run dev").as_deref(), Some("npm"));
    }

    #[test]
    fn titles() {
        assert_eq!(normalize_title("  vim  "), Some("vim"));
        assert_eq!(normalize_title("bad\u{7}"), None);
        assert_eq!(normalize_title("[?2004h"), None);
        assert_eq!(normalize_title("x[0m"), None);
        assert_eq!(normalize_title("]2;vim"), None);
        assert_eq!(normalize_title("[1] build"), Some("[1] build"));
        assert!(is_useful_title("npm run dev"));
        assert!(!is_useful_title("me@mac: ~/src"));
        assert!(!is_useful_title("~/src/athas"));
        assert_eq!(directory_label(std::path::Path::new("/Users/me/athas")).as_deref(), Some("athas"));
        assert_eq!(directory_label(std::path::Path::new("/")).as_deref(), Some("/"));
    }
}
