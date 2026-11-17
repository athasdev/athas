//! One terminal on screen: keyboard and mouse input, clipboard, links, the bell, cursor blinking
//! and the events the panel listens to (title changes, exit).

use std::{ops::Range, path::PathBuf, sync::atomic::Ordering, time::Duration};

use alacritty_terminal::{
    event::{Event as AlacEvent, WindowSize},
    grid::Dimensions,
    index::{Column, Line, Point as AlacPoint, Side},
    selection::SelectionType,
    term::TermMode,
    vte::ansi::{Color, NamedColor},
};
use futures::{StreamExt as _, channel::mpsc::UnboundedReceiver};
use gpui::{
    Anchor, App, Bounds, ClipboardItem, Context, EventEmitter, ExternalPaths, FocusHandle, Focusable, InputHandler,
    IntoElement, KeyDownEvent, MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, Point, Render, ScrollEvent,
    Subscription, Task, TouchPhase, UTF16Selection, WeakEntity, Window, anchored, deferred, div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{IconName, MenuEntry, MenuItem, OpenMenu, typography};

use crate::{
    colors::{Palette, hsla_to_rgb},
    element::TerminalElement,
    find::FindState,
    keys::to_esc_str,
    links::{Link, LinkTarget, find_links},
    mouse::{self, MouseAction, MouseButton, alternate_scroll_bytes, reports_motion, reports_mouse},
    pty::PtySize,
    terminal::{TermOptions, Terminal, TerminalEvent},
    terminal_settings,
};

const CURSOR_BLINK_INTERVAL: Duration = Duration::from_millis(530);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_secs(1);
const COPY_ON_SELECT_DELAY: Duration = Duration::from_millis(100);
/// Pastes of this many lines, or this many characters, ask first (`terminal.tsx`).
const MULTILINE_PASTE_LINE_THRESHOLD: usize = 5;
const LARGE_PASTE_CHAR_THRESHOLD: usize = 1000;
const BELL_FLASH: Duration = Duration::from_millis(200);
const BELL_MIN_INTERVAL: Duration = Duration::from_millis(120);
const SEARCH_REFRESH_DELAY: Duration = Duration::from_millis(200);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TerminalViewEvent {
    TitleChanged,
    Exited,
    CloseRequested,
    /// The terminal took focus, by click or keyboard.
    Focused,
    /// The shell integration saw a prompt start.
    PromptShown,
    /// A command the shell integration saw finished, with its exit code.
    CommandFinished(Option<i32>),
}

/// Where the grid sits and how big its cells are, from the last layout.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GridLayout {
    pub origin: Point<Pixels>,
    pub cell_width: Pixels,
    pub line_height: Pixels,
    pub columns: usize,
    pub lines: usize,
}

enum Drag {
    Select,
    Report(MouseButton),
}

/// The link under the mouse, by viewport row and columns.
#[derive(Clone, Debug)]
pub(crate) struct HoveredLink {
    pub row: usize,
    pub columns: Range<usize>,
    pub link: Link,
    pub position: Point<Pixels>,
}

pub(crate) struct TerminalView {
    pub(crate) terminal: Terminal,
    focus_handle: FocusHandle,
    pub(crate) layout: Option<GridLayout>,
    title: String,
    /// The project folder relative file links resolve against.
    root: Option<PathBuf>,
    drag: Option<Drag>,
    last_motion_cell: Option<(usize, usize)>,
    scroll_remainder: Pixels,
    pub(crate) cursor_blink_visible: bool,
    blink_epoch: usize,
    pub(crate) marked_text: Option<String>,
    pub(crate) find: Option<FindState>,
    pub(crate) hovered_link: Option<HoveredLink>,
    hover_cell: Option<(usize, usize)>,
    pub(crate) bell_visible: bool,
    bell_epoch: usize,
    last_bell: Option<web_time::Instant>,
    copy_epoch: usize,
    context_menu: Option<OpenMenu>,
    /// "Paste Into Terminal": a long or multi-line paste waits for this confirmation.
    paste_confirm: Option<(gpui::Entity<ui::AlertDialog>, Subscription)>,
    _subscriptions: Vec<Subscription>,
    _tasks: Vec<Task<()>>,
}

impl EventEmitter<TerminalViewEvent> for TerminalView {}

impl Focusable for TerminalView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl TerminalView {
    pub fn new(
        terminal: Terminal,
        mut events: UnboundedReceiver<TerminalEvent>,
        root: Option<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let focus_handle = cx.focus_handle();
        let mut subscriptions = vec![
            cx.on_focus(&focus_handle, window, |this, _, cx| {
                this.terminal.set_focused(true);
                this.reset_blink(cx);
                cx.emit(TerminalViewEvent::Focused);
            }),
            cx.on_blur(&focus_handle, window, |this, _, cx| {
                this.terminal.set_focused(false);
                this.stop_blink();
                cx.notify();
            }),
        ];
        if cx.has_global::<settings::SettingsStore>() {
            subscriptions.push(cx.observe_global::<settings::SettingsStore>(|this, cx| {
                this.terminal.set_options(TermOptions::from_settings(settings::get(cx)));
                cx.notify();
            }));
        }

        let event_pump = cx.spawn(async move |this, cx| {
            while let Some(event) = events.next().await {
                let mut batch = vec![event];
                while let Ok(event) = events.try_recv() {
                    batch.push(event);
                }
                let handled = this.update(cx, |view, cx| {
                    for event in batch {
                        view.handle_event(event, cx);
                    }
                });
                if handled.is_err() {
                    break;
                }
            }
        });
        let process_poll = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(PROCESS_POLL_INTERVAL).await;
                let polled = this.update(cx, |view, cx| {
                    if view.terminal.update_process_name() {
                        view.update_title(cx);
                    }
                });
                if polled.is_err() {
                    break;
                }
            }
        });

        let title = terminal.display_title();
        let view = Self {
            terminal,
            focus_handle,
            layout: None,
            title,
            root,
            drag: None,
            last_motion_cell: None,
            scroll_remainder: px(0.),
            cursor_blink_visible: true,
            blink_epoch: 0,
            marked_text: None,
            find: None,
            hovered_link: None,
            hover_cell: None,
            bell_visible: false,
            bell_epoch: 0,
            last_bell: None,
            copy_epoch: 0,
            context_menu: None,
            paste_confirm: None,
            _subscriptions: subscriptions,
            _tasks: vec![event_pump, process_poll],
        };
        view.terminal.set_focused(false);
        view
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn set_root(&mut self, root: Option<PathBuf>) {
        self.root = root;
    }

    /// The name the user gave the tab; `None` goes back to the automatic one.
    pub fn set_custom_name(&mut self, name: Option<String>, cx: &mut Context<Self>) {
        self.terminal.custom_name = name;
        self.update_title(cx);
    }

    fn update_title(&mut self, cx: &mut Context<Self>) {
        let title = self.terminal.display_title();
        if title != self.title {
            self.title = title;
            cx.emit(TerminalViewEvent::TitleChanged);
        }
    }

    fn handle_event(&mut self, event: TerminalEvent, cx: &mut Context<Self>) {
        match event {
            TerminalEvent::Wakeup => {
                self.terminal.wakeup_pending.store(false, Ordering::Release);
                if self.hovered_link.take().is_some() {
                    self.hover_cell = None;
                }
                self.schedule_search_refresh(cx);
                cx.notify();
            }
            TerminalEvent::Shell(mark, line) => {
                let finished = match mark {
                    crate::terminal::ShellMark::CommandFinished(code) => Some(code),
                    _ => None,
                };
                let prompt = mark == crate::terminal::ShellMark::PromptStarted;
                let progress = self.terminal.progress;
                self.terminal.handle_shell_mark(mark, line);
                self.terminal.update_process_name();
                self.update_title(cx);
                if self.terminal.progress != progress {
                    cx.emit(TerminalViewEvent::TitleChanged);
                }
                if let Some(code) = finished {
                    cx.emit(TerminalViewEvent::CommandFinished(code));
                }
                if prompt {
                    cx.emit(TerminalViewEvent::PromptShown);
                }
            }
            TerminalEvent::Exited(status) if status.is_clean() => cx.emit(TerminalViewEvent::Exited),
            TerminalEvent::Exited(status) => {
                // The terminal stays, saying how its process ended.
                let message = format!("\r\n\x1b[33m{}\x1b[0m\r\n\x1b[90mOpen a new terminal tab or close this one manually.\x1b[0m\r\n", status.describe());
                self.terminal.write_output(message.as_bytes());
                cx.notify();
            }
            TerminalEvent::Alacritty(event) => self.handle_alacritty_event(event, cx),
        }
    }

    fn handle_alacritty_event(&mut self, event: AlacEvent, cx: &mut Context<Self>) {
        match event {
            AlacEvent::Title(title) => {
                self.terminal.title = Some(title);
                self.update_title(cx);
            }
            AlacEvent::ResetTitle => {
                self.terminal.title = None;
                self.update_title(cx);
            }
            AlacEvent::Bell => self.ring_bell(cx),
            AlacEvent::ClipboardStore(_, text) => cx.write_to_clipboard(ClipboardItem::new_string(text)),
            AlacEvent::ClipboardLoad(_, format) => {
                let text = cx.read_from_clipboard().and_then(|item| item.text()).unwrap_or_default();
                self.terminal.write(format(&text));
            }
            AlacEvent::ColorRequest(index, format) => {
                let palette = Palette::from_theme(cx.theme());
                let color = {
                    let term = self.terminal.term.lock();
                    let overrides = term.colors();
                    match index {
                        0..=255 => palette.resolve(Color::Indexed(index as u8), overrides),
                        256 => palette.resolve(Color::Named(NamedColor::Foreground), overrides),
                        257 => palette.resolve(Color::Named(NamedColor::Background), overrides),
                        _ => palette.resolve(Color::Named(NamedColor::Cursor), overrides),
                    }
                };
                self.terminal.write(format(hsla_to_rgb(color)));
            }
            AlacEvent::TextAreaSizeRequest(format) => {
                if let Some(layout) = self.layout {
                    self.terminal.write(format(WindowSize {
                        num_lines: layout.lines as u16,
                        num_cols: layout.columns as u16,
                        cell_width: f32::from(layout.cell_width) as u16,
                        cell_height: f32::from(layout.line_height) as u16,
                    }));
                }
            }
            _ => {}
        }
    }

    /// `ringTerminalBell`: a flash or the system sound, as `terminalBell` asks; rings in quick
    /// succession collapse into one.
    fn ring_bell(&mut self, cx: &mut Context<Self>) {
        let mode = terminal_settings(cx).terminal_bell.clone();
        if mode == "off" {
            return;
        }
        let now = web_time::Instant::now();
        if self.last_bell.is_some_and(|last| now.duration_since(last) < BELL_MIN_INTERVAL) {
            return;
        }
        self.last_bell = Some(now);
        if mode != "visual" {
            if let Some(window) = cx.active_window() {
                window.update(cx, |_, window, _| window.play_system_bell()).ok();
            }
            return;
        }
        self.bell_visible = true;
        self.bell_epoch += 1;
        let epoch = self.bell_epoch;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(BELL_FLASH).await;
            this.update(cx, |view, cx| {
                if view.bell_epoch == epoch {
                    view.bell_visible = false;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    /// Called from layout: sizes the PTY to the space the grid got.
    pub(crate) fn set_layout(&mut self, layout: GridLayout) {
        self.layout = Some(layout);
        self.terminal.resize(PtySize {
            rows: layout.lines as u16,
            cols: layout.columns as u16,
            cell_width: f32::from(layout.cell_width) as u16,
            cell_height: f32::from(layout.line_height) as u16,
        });
    }

    fn reset_blink(&mut self, cx: &mut Context<Self>) {
        self.cursor_blink_visible = true;
        self.blink_epoch += 1;
        if !terminal_settings(cx).terminal_cursor_blink {
            cx.notify();
            return;
        }
        let epoch = self.blink_epoch;
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(CURSOR_BLINK_INTERVAL).await;
                let blinking = this.update(cx, |view, cx| {
                    if view.blink_epoch != epoch {
                        return false;
                    }
                    view.cursor_blink_visible = !view.cursor_blink_visible;
                    cx.notify();
                    true
                });
                if !blinking.unwrap_or(false) {
                    break;
                }
            }
        })
        .detach();
        cx.notify();
    }

    fn stop_blink(&mut self) {
        self.blink_epoch += 1;
        self.cursor_blink_visible = true;
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        window.focus(&self.focus_handle, cx);
    }

    // Keyboard and clipboard.

    fn key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if !self.focus_handle.is_focused(window) {
            return;
        }
        let keystroke = &event.keystroke;
        let modifiers = &keystroke.modifiers;
        let key = keystroke.key.as_str();

        if key == "escape" && self.find.is_some() && !modifiers.modified() {
            self.close_find(window, cx);
            cx.stop_propagation();
            return;
        }

        // The panel switches tabs on ctrl-pageup and ctrl-pagedown.
        if modifiers.control && !modifiers.alt && !modifiers.shift && matches!(key, "pageup" | "pagedown") {
            return;
        }

        let command = if cfg!(target_os = "macos") {
            modifiers.platform && !modifiers.control && !modifiers.alt && !modifiers.shift
        } else {
            modifiers.control && modifiers.shift && !modifiers.alt && !modifiers.platform
        };
        if command {
            let handled = match key {
                "c" => {
                    self.copy(cx);
                    true
                }
                "v" => {
                    self.paste(window, cx);
                    true
                }
                "k" if cfg!(target_os = "macos") => {
                    self.clear(cx);
                    true
                }
                _ => false,
            };
            if handled {
                cx.stop_propagation();
                return;
            }
        }

        if event.prefer_character_input && keystroke.key_char.is_some() {
            return;
        }

        let mode = self.terminal.mode();
        let option_as_meta = !cfg!(target_os = "macos") || terminal_settings(cx).terminal_mac_option_is_meta;
        if let Some(bytes) = to_esc_str(keystroke, mode, option_as_meta) {
            self.terminal.input(bytes.as_bytes());
            self.reset_blink(cx);
            cx.stop_propagation();
        }
    }

    /// Text from the keyboard and the IME.
    fn commit_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.marked_text = None;
        self.terminal.input(text.as_bytes());
        self.reset_blink(cx);
    }

    pub fn copy(&mut self, cx: &mut Context<Self>) {
        if let Some(text) = self.terminal.selection_text() {
            cx.write_to_clipboard(ClipboardItem::new_string(text));
        }
    }

    /// `pasteIntoTerminal`: five lines or more, or a thousand characters, are confirmed first
    /// since they may run several commands.
    pub fn paste(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) else { return };
        if text.is_empty() {
            return;
        }
        let lines = text.replace("\r\n", "\n").split('\n').count();
        if lines < MULTILINE_PASTE_LINE_THRESHOLD && text.chars().count() < LARGE_PASTE_CHAR_THRESHOLD {
            self.terminal.paste(&text);
            self.reset_blink(cx);
            return;
        }
        let view = cx.weak_entity();
        let dialog = ui::AlertDialog::confirm(
            "Paste Into Terminal",
            format!("Paste {lines} lines into the terminal? This may execute multiple commands."),
            ui::ConfirmOptions { confirm_label: "Paste".into(), cancel_label: "Cancel".into(), destructive: false },
            move |_, cx| {
                view.update(cx, |view, cx| {
                    view.terminal.paste(&text);
                    view.reset_blink(cx);
                })
                .ok();
            },
            cx,
        );
        let subscription = cx.subscribe_in(&dialog, window, |this, _, _: &gpui::DismissEvent, window, cx| {
            this.paste_confirm = None;
            window.focus(&this.focus_handle, cx);
            cx.notify();
        });
        window.focus(&dialog.focus_handle(cx), cx);
        self.paste_confirm = Some((dialog, subscription));
        cx.notify();
    }

    pub fn clear(&mut self, cx: &mut Context<Self>) {
        self.terminal.clear();
        cx.notify();
    }

    pub fn select_all(&mut self, cx: &mut Context<Self>) {
        self.terminal.select_all();
        cx.notify();
    }

    /// `copyLastCommandOutput`, with the toasts Athas shows when there is nothing to copy.
    pub fn copy_last_command_output(&mut self, cx: &mut Context<Self>) {
        let id = Some("terminal-copy-output".into());
        let (kind, message, description) = match self.terminal.last_command_output() {
            None => (
                notifications::NotificationKind::Info,
                "No command output to copy",
                Some("Enable shell integration to track command output.".into()),
            ),
            Some(output) if output.is_empty() => (notifications::NotificationKind::Info, "The last command produced no output", None),
            Some(output) => {
                cx.write_to_clipboard(ClipboardItem::new_string(output));
                (notifications::NotificationKind::Success, "Copied last command output", None)
            }
        };
        notifications::notify(cx, kind, notifications::NotificationCategory::Athas, message, description, id);
    }

    pub fn navigate_command(&mut self, direction: i32, cx: &mut Context<Self>) {
        self.terminal.scroll_to_command(direction);
        cx.notify();
    }

    /// Types dropped files' paths at the prompt, quoted for the shell (`formatDroppedPathsForTerminal`).
    fn drop_paths(&mut self, paths: &ExternalPaths, window: &mut Window, cx: &mut Context<Self>) {
        let raw: Vec<String> = paths.paths().iter().map(|path| path.to_string_lossy().into_owned()).collect();
        let text = format_dropped_paths(&raw, quote_style(&self.terminal));
        if text.is_empty() {
            return;
        }
        self.terminal.input(text.into_bytes());
        window.focus(&self.focus_handle, cx);
    }

    // Mouse.

    /// The viewport cell under `position`, clamped to the grid, the side of the cell it is on,
    /// and the grid point (which counts lines from the top of the screen, minus the scrollback
    /// being shown).
    fn grid_position(&self, position: Point<Pixels>) -> Option<(usize, usize, Side, AlacPoint)> {
        let layout = self.layout?;
        let x = f32::from((position.x - layout.origin.x).max(px(0.))) / f32::from(layout.cell_width);
        let y = f32::from((position.y - layout.origin.y).max(px(0.))) / f32::from(layout.line_height);
        let column = (x as usize).min(layout.columns.saturating_sub(1));
        let line = (y as usize).min(layout.lines.saturating_sub(1));
        // Past the last column the pointer is on the right of the last cell, so a drag there
        // takes the line's last character too.
        let side = if (x as usize) >= layout.columns || x.fract() > 0.5 { Side::Right } else { Side::Left };
        let display_offset = self.terminal.term.lock().grid().display_offset() as i32;
        let point = AlacPoint::new(Line(line as i32 - display_offset), Column(column));
        Some((line, column, side, point))
    }

    fn report_mouse(&self, line: usize, column: usize, button: MouseButton, action: MouseAction, modifiers: &gpui::Modifiers) {
        if let Some(bytes) = mouse::mouse_report(line, column, button, action, modifiers, self.terminal.mode()) {
            self.terminal.write(bytes);
        }
    }

    /// The link at a viewport cell: an OSC 8 hyperlink, else an address or a file path in the
    /// line's text.
    fn link_at(&self, row: usize, column: usize) -> Option<(Range<usize>, Link)> {
        let (text, hyperlinks) = self.terminal.viewport_line(row)?;
        if let Some(uri) = hyperlinks.get(column).cloned().flatten() {
            let start = (0..=column).rev().take_while(|index| hyperlinks[*index].as_deref() == Some(uri.as_str())).last().unwrap_or(column);
            let end = (column..hyperlinks.len()).take_while(|index| hyperlinks[*index].as_deref() == Some(uri.as_str())).last().unwrap_or(column) + 1;
            let target = match crate::links::parse_file_links(&uri, self.root.as_deref()).into_iter().next() {
                Some(file) if uri.to_ascii_lowercase().starts_with("file://") => file.target,
                _ => LinkTarget::Url(uri.clone()),
            };
            return Some((start..end, Link { start, end, text: uri, target }));
        }
        find_links(&text, self.root.as_deref())
            .into_iter()
            .find(|link| (link.start..link.end).contains(&column))
            .map(|link| (link.start..link.end, link))
    }

    fn open_link(&self, link: &Link, cx: &mut App) {
        match &link.target {
            LinkTarget::Url(url) => {
                let lower = url.to_ascii_lowercase();
                if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:") {
                    cx.open_url(url);
                }
            }
            LinkTarget::File { path, line, column } => {
                workbench_api::request(cx, workbench_api::OpenRequest::File { path: path.clone(), line: *line, column: *column });
                cx.refresh_windows();
            }
        }
    }

    pub(crate) fn mouse_down(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus_handle, cx);
        let Some((line, column, side, point)) = self.grid_position(event.position) else { return };
        let mode = self.terminal.mode();
        let link_modifier = if cfg!(target_os = "macos") { event.modifiers.platform } else { event.modifiers.control };

        if event.button == gpui::MouseButton::Left
            && link_modifier
            && let Some((_, link)) = self.link_at(line, column)
        {
            self.open_link(&link, cx);
            return;
        }

        if reports_mouse(mode, &event.modifiers) && !(cfg!(target_os = "macos") && event.modifiers.alt) {
            let button = match event.button {
                gpui::MouseButton::Left => MouseButton::Left,
                gpui::MouseButton::Middle => MouseButton::Middle,
                gpui::MouseButton::Right => MouseButton::Right,
                _ => return,
            };
            self.report_mouse(line, column, button, MouseAction::Press, &event.modifiers);
            self.drag = Some(Drag::Report(button));
            return;
        }

        match event.button {
            gpui::MouseButton::Left => {
                if event.modifiers.alt && event.click_count == 1 && self.move_cursor_to(line, column, cx) {
                    return;
                }
                let has_selection = self.terminal.term.lock().selection.is_some();
                if event.modifiers.shift && has_selection {
                    self.terminal.update_selection(point, side);
                } else {
                    let kind = match event.click_count {
                        0 | 1 => SelectionType::Simple,
                        2 => SelectionType::Semantic,
                        _ => SelectionType::Lines,
                    };
                    self.terminal.start_selection(point, side, kind);
                }
                self.drag = Some(Drag::Select);
                cx.notify();
            }
            gpui::MouseButton::Right => {
                if terminal_settings(cx).terminal_right_click_selects_word {
                    self.terminal.select_word(point);
                }
                self.deploy_context_menu(event.position, window, cx);
            }
            _ => {}
        }
    }

    /// `altClickMovesCursor`: alt-click on the prompt sends the arrow keys that walk the cursor
    /// there, as xterm does outside full-screen programs.
    fn move_cursor_to(&mut self, line: usize, column: usize, cx: &mut Context<Self>) -> bool {
        if !terminal_settings(cx).terminal_alt_click_moves_cursor {
            return false;
        }
        let (mode, cursor, columns, offset) = {
            let term = self.terminal.term.lock();
            (*term.mode(), term.grid().cursor.point, term.columns(), term.grid().display_offset())
        };
        if mode.contains(TermMode::ALT_SCREEN) || offset != 0 {
            return false;
        }
        let from = cursor.line.0 as i64 * columns as i64 + cursor.column.0 as i64;
        let to = line as i64 * columns as i64 + column as i64;
        let app_cursor = mode.contains(TermMode::APP_CURSOR);
        let arrow = match (to > from, app_cursor) {
            (true, true) => "\x1bOC",
            (true, false) => "\x1b[C",
            (false, true) => "\x1bOD",
            (false, false) => "\x1b[D",
        };
        let count = (to - from).unsigned_abs() as usize;
        if count > 0 {
            self.terminal.input(arrow.repeat(count).into_bytes());
        }
        true
    }

    pub(crate) fn mouse_move(&mut self, event: &MouseMoveEvent, hovered: bool, cx: &mut Context<Self>) {
        let Some((line, column, side, point)) = self.grid_position(event.position) else { return };
        match &self.drag {
            Some(Drag::Select) => {
                self.terminal.update_selection(point, side);
                cx.notify();
            }
            Some(Drag::Report(button)) => {
                let button = *button;
                if reports_motion(self.terminal.mode(), true) && self.last_motion_cell != Some((line, column)) {
                    self.last_motion_cell = Some((line, column));
                    self.report_mouse(line, column, button, MouseAction::Motion, &event.modifiers);
                }
            }
            None => {
                let mode = self.terminal.mode();
                if hovered
                    && reports_mouse(mode, &event.modifiers)
                    && reports_motion(mode, false)
                    && self.last_motion_cell != Some((line, column))
                {
                    self.last_motion_cell = Some((line, column));
                    self.report_mouse(line, column, MouseButton::None, MouseAction::Motion, &event.modifiers);
                }
                self.update_hovered_link(hovered.then_some((line, column)), event.position, cx);
            }
        }
    }

    fn update_hovered_link(&mut self, cell: Option<(usize, usize)>, position: Point<Pixels>, cx: &mut Context<Self>) {
        if cell == self.hover_cell {
            if let Some(hovered) = self.hovered_link.as_mut() {
                hovered.position = position;
                cx.notify();
            }
            return;
        }
        self.hover_cell = cell;
        let hovered = cell.and_then(|(row, column)| {
            let (columns, link) = self.link_at(row, column)?;
            Some(HoveredLink { row, columns, link, position })
        });
        if hovered.is_some() || self.hovered_link.is_some() {
            self.hovered_link = hovered;
            cx.notify();
        }
    }

    /// Shows the tooltip for the first link on screen, for headless snapshots.
    pub(crate) fn hover_first_link(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(layout) = self.layout else { return false };
        for row in 0..layout.lines {
            let Some((text, _)) = self.terminal.viewport_line(row) else { continue };
            if let Some(link) = find_links(&text, self.root.as_deref()).into_iter().find(|link| !link.text.starts_with("echo")) {
                let x = layout.origin.x + layout.cell_width * (link.start as f32 + 1.5);
                let y = layout.origin.y + layout.line_height * (row as f32 + 0.8);
                self.hover_cell = Some((row, link.start));
                self.hovered_link = Some(HoveredLink { row, columns: link.start..link.end, link, position: Point::new(x, y) });
                cx.notify();
                return true;
            }
        }
        false
    }

    pub(crate) fn mouse_up(&mut self, event: &MouseUpEvent, cx: &mut Context<Self>) {
        match self.drag.take() {
            Some(Drag::Report(button)) => {
                if let Some((line, column, ..)) = self.grid_position(event.position) {
                    self.report_mouse(line, column, button, MouseAction::Release, &event.modifiers);
                }
            }
            Some(Drag::Select) => {
                {
                    let mut term = self.terminal.term.lock();
                    if term.selection.as_ref().is_some_and(|selection| selection.is_empty()) {
                        term.selection = None;
                    }
                }
                self.schedule_copy_on_select(cx);
                cx.notify();
            }
            None => {}
        }
    }

    /// `terminalCopyOnSelect`: a finished selection goes to the clipboard shortly after.
    fn schedule_copy_on_select(&mut self, cx: &mut Context<Self>) {
        self.copy_epoch += 1;
        if !terminal_settings(cx).terminal_copy_on_select {
            return;
        }
        let epoch = self.copy_epoch;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(COPY_ON_SELECT_DELAY).await;
            this.update(cx, |view, cx| {
                if view.copy_epoch == epoch
                    && let Some(text) = view.terminal.selection_text()
                {
                    cx.write_to_clipboard(ClipboardItem::new_string(text));
                }
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn scroll_wheel(&mut self, event: &ScrollEvent, cx: &mut Context<Self>) {
        let Some(layout) = self.layout else { return };
        if event.touch_phase == TouchPhase::Started {
            self.scroll_remainder = px(0.);
        }
        self.scroll_remainder += event.delta.pixel_delta(layout.line_height).y;
        let lines = (self.scroll_remainder / layout.line_height) as i32;
        if lines == 0 {
            return;
        }
        self.scroll_remainder -= layout.line_height * lines as f32;

        let mode = self.terminal.mode();
        if reports_mouse(mode, &event.modifiers) {
            if let Some((line, column, ..)) = self.grid_position(event.position) {
                let button = if lines > 0 { MouseButton::WheelUp } else { MouseButton::WheelDown };
                for _ in 0..lines.unsigned_abs() {
                    self.report_mouse(line, column, button, MouseAction::Press, &event.modifiers);
                }
            }
        } else if mode.contains(TermMode::ALT_SCREEN | TermMode::ALTERNATE_SCROLL) && !event.modifiers.shift {
            self.terminal.write(alternate_scroll_bytes(lines, mode));
        } else {
            self.terminal.scroll(lines);
            self.hovered_link = None;
            self.hover_cell = None;
            cx.notify();
        }
    }

    fn deploy_context_menu(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.weak_entity();
        let item = |label: &'static str, icon: IconName, action: fn(&mut Self, &mut Context<Self>)| {
            let this = this.clone();
            MenuItem::new(label).icon(icon).on_select(move |window, cx| {
                this.update(cx, |view, cx| {
                    action(view, cx);
                    window.focus(&view.focus_handle, cx);
                })
                .ok();
            })
        };
        let has_selection = self.terminal.selection_text().is_some();
        let entries: Vec<MenuEntry> = vec![
            item("Copy", IconName::Copy, Self::copy).shortcut(shortcut("C")).disabled(!has_selection).into(),
            {
                let this = this.clone();
                MenuItem::new("Paste")
                    .icon(IconName::Clipboard)
                    .shortcut(shortcut("V"))
                    .on_select(move |window, cx| {
                        this.update(cx, |view, cx| {
                            window.focus(&view.focus_handle, cx);
                            view.paste(window, cx);
                        })
                        .ok();
                    })
                    .into()
            },
            item("Select All", IconName::SelectAll, Self::select_all).into(),
            MenuEntry::Separator,
            item("Clear Terminal", IconName::Broom, Self::clear).shortcut(shortcut("K")).into(),
            item("Close Terminal", IconName::X, |_, cx| cx.emit(TerminalViewEvent::CloseRequested)).into(),
        ];
        self.context_menu = Some(OpenMenu::new("terminal-context", entries, position, Anchor::TopLeft, window, cx, |this: &mut Self, _| {
            this.context_menu = None
        }));
        cx.notify();
    }

    pub(crate) fn schedule_search_refresh(&mut self, cx: &mut Context<Self>) {
        let Some(find) = self.find.as_mut() else { return };
        if find.refresh_pending || find.query(cx).is_empty() {
            return;
        }
        find.refresh_pending = true;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(SEARCH_REFRESH_DELAY).await;
            this.update(cx, |view, cx| {
                if let Some(find) = view.find.as_mut() {
                    find.refresh_pending = false;
                    view.refresh_search(cx);
                }
            })
            .ok();
        })
        .detach();
    }

    fn render_link_tooltip(&self, cx: &App) -> Option<impl IntoElement + use<>> {
        let hovered = self.hovered_link.as_ref()?;
        let theme = cx.theme();
        Some(
            deferred(
                anchored().position(hovered.position + Point::new(px(12.), px(12.))).snap_to_window_with_margin(px(8.)).child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(2.))
                        .max_w(px(512.))
                        .px(px(8.))
                        .py(px(4.))
                        .rounded(ui::metrics::RADIUS_MD)
                        .bg(theme.colors.surface)
                        .shadow(theme.shadows.popover.clone())
                        .font_family(typography::UI_FONT)
                        .text_size(typography::TEXT_SM)
                        .text_color(theme.colors.foreground)
                        .child(div().font_family(typography::MONO_FONT).truncate().child(hovered.link.label()))
                        .child(div().text_color(theme.colors.subtle_foreground).child(hovered.link.hint())),
                ),
            )
            .with_priority(1),
        )
    }
}

fn shortcut(key: &str) -> String {
    if cfg!(target_os = "macos") { format!("⌘{key}") } else { format!("Ctrl+Shift+{key}") }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QuoteStyle {
    Posix,
    PowerShell,
    Cmd,
}

/// `getTerminalQuoteStyle`: POSIX quoting everywhere but Windows' own shells.
fn quote_style(terminal: &Terminal) -> QuoteStyle {
    if !cfg!(windows) {
        return QuoteStyle::Posix;
    }
    match terminal.shell_name().as_str() {
        "powershell" | "pwsh" => QuoteStyle::PowerShell,
        "bash" | "nu" | "wsl" => QuoteStyle::Posix,
        _ => QuoteStyle::Cmd,
    }
}

fn quote_path(path: &str, style: QuoteStyle) -> String {
    let plain = |extra: &str| path.chars().all(|c| c.is_ascii_alphanumeric() || "_.:\\/-".contains(c) || extra.contains(c));
    match style {
        QuoteStyle::Cmd if plain("") => path.to_string(),
        QuoteStyle::Cmd => format!("\"{}\"", path.replace('"', "")),
        QuoteStyle::PowerShell if plain("") => path.to_string(),
        QuoteStyle::PowerShell => {
            let mut quoted = String::from("'");
            for character in path.chars() {
                if matches!(character, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
                    quoted.push(character);
                }
                quoted.push(character);
            }
            quoted.push('\'');
            quoted
        }
        QuoteStyle::Posix if path.chars().all(|c| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c)) => path.to_string(),
        QuoteStyle::Posix => format!("'{}'", path.replace('\'', "'\\''")),
    }
}

/// `formatDroppedPathsForTerminal`: each path once, quoted, with a trailing space; paths with a
/// line break are left out, since pasting one would run the prompt.
fn format_dropped_paths(raw: &[String], style: QuoteStyle) -> String {
    let mut seen = Vec::new();
    for entry in raw {
        for path in entry.split('\n').map(|path| path.trim_end_matches('\r').trim()) {
            if !path.is_empty() && !path.contains('\r') && !seen.iter().any(|existing: &String| existing == path) {
                seen.push(path.to_string());
            }
        }
    }
    if seen.is_empty() {
        return String::new();
    }
    let mut text = seen.iter().map(|path| quote_path(path, style)).collect::<Vec<_>>().join(" ");
    text.push(' ');
    text
}

impl Render for TerminalView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let focused = self.focus_handle.is_focused(window);
        let find_bar = self.render_find_bar(window, cx);
        let tooltip = self.render_link_tooltip(cx);
        let bell = self.bell_visible.then(|| div().absolute().inset_0().bg(cx.theme().colors.foreground.opacity(0.12)));
        div()
            .id("terminal")
            .relative()
            .track_focus(&self.focus_handle)
            .key_context("Terminal")
            .on_key_down(cx.listener(Self::key_down))
            .on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(|this, _: &MouseDownEvent, window, cx| window.focus(&this.focus_handle, cx)),
            )
            .on_drop(cx.listener(Self::drop_paths))
            .flex()
            .flex_1()
            .min_h_0()
            .size_full()
            // `pt-1 pl-5` around the original's `xterm-container`.
            .pl(px(20.))
            .pt(px(4.))
            .child(TerminalElement::new(cx.entity(), self.focus_handle.clone(), focused))
            .children(bell)
            .children(find_bar)
            .children(tooltip)
            .children(self.context_menu.as_ref().map(|menu| menu.render()))
            .children(self.paste_confirm.as_ref().map(|(dialog, _)| {
                let scrim = cx.theme().colors.scrim;
                deferred(div().id("terminal-paste-confirm").absolute().inset_0().bg(scrim).flex().items_center().justify_center().occlude().child(dialog.clone())).with_priority(2)
            }))
    }
}

/// Text input for the terminal: typed characters and IME composition. Keys with escape sequences
/// are handled in `key_down` before the platform gets here. Adapted from Zed's
/// `TerminalInputHandler` (GPL-3.0-or-later, Zed Industries).
pub(crate) struct TerminalInputHandler {
    pub view: WeakEntity<TerminalView>,
    pub cursor_bounds: Option<Bounds<Pixels>>,
}

impl InputHandler for TerminalInputHandler {
    fn selected_text_range(&mut self, _: bool, _: &mut Window, _: &mut App) -> Option<UTF16Selection> {
        Some(UTF16Selection { range: 0..0, reversed: false })
    }

    fn marked_text_range(&mut self, _: &mut Window, cx: &mut App) -> Option<Range<usize>> {
        let view = self.view.upgrade()?;
        let marked = view.read(cx).marked_text.as_ref()?;
        Some(0..marked.encode_utf16().count())
    }

    fn text_for_range(&mut self, _: Range<usize>, _: &mut Option<Range<usize>>, _: &mut Window, _: &mut App) -> Option<String> {
        None
    }

    fn replace_text_in_range(&mut self, _: Option<Range<usize>>, text: &str, window: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| view.commit_text(text, cx)).ok();
        window.invalidate_character_coordinates();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        new_text: &str,
        _: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut App,
    ) {
        self.view
            .update(cx, |view, cx| {
                view.marked_text = (!new_text.is_empty()).then(|| new_text.to_string());
                cx.notify();
            })
            .ok();
    }

    fn unmark_text(&mut self, _: &mut Window, cx: &mut App) {
        self.view
            .update(cx, |view, cx| {
                view.marked_text = None;
                cx.notify();
            })
            .ok();
    }

    fn bounds_for_range(&mut self, range_utf16: Range<usize>, _: &mut Window, cx: &mut App) -> Option<Bounds<Pixels>> {
        let mut bounds = self.cursor_bounds?;
        let cell_width = self.view.upgrade()?.read(cx).layout?.cell_width;
        bounds.origin.x += cell_width * range_utf16.start as f32;
        Some(bounds)
    }

    fn character_index_for_point(&mut self, _: Point<Pixels>, _: &mut Window, _: &mut App) -> Option<usize> {
        None
    }

    fn apple_press_and_hold_enabled(&mut self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_dropped_paths() {
        let raw = vec!["/tmp/a.txt\n/tmp/my file.txt".to_string(), "/tmp/a.txt".to_string(), "/tmp/it's".to_string()];
        assert_eq!(format_dropped_paths(&raw, QuoteStyle::Posix), "/tmp/a.txt '/tmp/my file.txt' '/tmp/it'\\''s' ");
        assert_eq!(quote_path("C:\\a b\\c", QuoteStyle::Cmd), "\"C:\\a b\\c\"");
        assert_eq!(quote_path("C:\\it's", QuoteStyle::PowerShell), "'C:\\it''s'");
        assert_eq!(format_dropped_paths(&[], QuoteStyle::Posix), "");
    }
}
