//! Language intelligence in the editor (`features/editor/lsp` in Athas): the file's document in
//! its language server, diagnostics, hover, completion with snippets, signature help, go to
//! definition, references, rename, code actions, formatting, document highlights and inlay hints.

use std::{
    collections::HashSet,
    ops::Range,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use futures::future::{Either, select};
use ui::scale::px;
use gpui::{App, AppContext as _, Context, Entity, Focusable as _, Global, Modifiers, Pixels, Point, Subscription, Task, Window,};
use lsp_client::{
    DiagnosticsStore, Document, FileLocation, LanguageServer, LspStore, LspStoreEvent, OpenError, Severity,
    lsp,
    offset_to_position, offsets_to_range, position_to_offset, range_to_offsets, text_edits_to_offsets,
};
use ui::{InputAppearance, TextInput, TextInputEvent};

use crate::{
    Autoscroll, Editor, Status,
    buffer::{AppliedEdit, Bias, is_word_char, map_through},
    completion::{self, Candidate},
    document::Target,
    history::EditKind,
    markdown::{self, Block},
};

/// What an editor asks of the workbench: places to open and lists to show.
#[derive(Clone, Debug, PartialEq)]
pub enum LspEvent {
    /// Go to definition landed in another file. `line` and `column` are 1-based.
    OpenLocation { path: PathBuf, line: usize, column: usize },
    /// Find references: show these in the references view.
    References { title: String, locations: Vec<FileLocation> },
    /// Find references was sent and has not answered yet: show "Finding…" under `title`.
    FindingReferences { title: String },
    /// The text changed or the server became ready; outlines should fetch symbols again.
    SymbolsChanged,
}

/// The file's language server, for a status bar.
#[derive(Clone, Debug, PartialEq)]
pub enum LspStatus {
    /// Not a local text file, or still loading.
    Off,
    /// No server is known for the language.
    Unsupported,
    Starting(String),
    Ready(String),
    NotInstalled(String),
    Failed(String),
}

const HOVER_DELAY: Duration = Duration::from_millis(300);
const HIGHLIGHT_DELAY: Duration = Duration::from_millis(250);
/// How long the caret rests before the lightbulb asks for code actions (`REFRESH_DELAY_MS`).
const LIGHTBULB_DELAY: Duration = Duration::from_millis(250);
const INLAY_DELAY: Duration = Duration::from_millis(400);
const FORMAT_TIMEOUT: Duration = Duration::from_secs(3);
const RESOLVE_TIMEOUT: Duration = Duration::from_millis(700);
/// Inlay hints are fetched for whole files up to this size.
const MAX_INLAY_FILE: usize = 512 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct DiagnosticSpan {
    pub range: Range<usize>,
    pub severity: Severity,
    pub message: String,
    pub origin: Option<String>,
    pub raw: lsp::Diagnostic,
}

pub(crate) struct HoverState {
    /// The text the card is about; moving the mouse off it hides the card.
    pub range: Range<usize>,
    pub diagnostics: Vec<DiagnosticSpan>,
    pub blocks: Vec<Block>,
}

pub(crate) struct CompletionMenu {
    pub items: Vec<lsp::CompletionItem>,
    /// Indices into `items`, best match first.
    pub matches: Vec<usize>,
    pub selected: usize,
    /// Where the word being completed starts.
    pub start: usize,
    pub is_incomplete: bool,
}

/// The code actions offered for the caret's line, shown as a lightbulb at the start of the line.
pub(crate) struct Lightbulb {
    pub line: usize,
    pub actions: Vec<lsp::CodeActionOrCommand>,
}

impl Lightbulb {
    /// Quick fixes tint the bulb, as the original's warning tone.
    pub fn has_quick_fix(&self) -> bool {
        self.actions.iter().any(|action| matches!(action, lsp::CodeActionOrCommand::CodeAction(action) if action.kind.as_ref().is_some_and(|kind| kind.as_str().starts_with("quickfix"))))
    }
}

pub(crate) struct CodeActionMenu {
    pub actions: Vec<lsp::CodeActionOrCommand>,
    pub selected: usize,
    pub anchor: usize,
}

pub(crate) struct RenameState {
    pub input: Entity<TextInput>,
    pub range: Range<usize>,
    _subscription: Subscription,
}

pub(crate) struct SnippetSession {
    /// Each stop's ranges, in order; the last is where the caret ends.
    pub stops: Vec<Vec<Range<usize>>>,
    pub current: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct InlayHint {
    pub offset: usize,
    pub label: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum HighlightKind {
    Read,
    Write,
}

#[derive(Default)]
pub(crate) struct LspState {
    pub document: Option<Arc<Document>>,
    pub status: Option<LspStatus>,
    pub project_root: Option<PathBuf>,
    pub diagnostics: Vec<DiagnosticSpan>,
    diagnostics_generation: Option<u64>,
    pub hover: Option<HoverState>,
    /// Where the pending hover will show, to not restart its timer on every mouse move.
    hover_pending: Option<usize>,
    hover_task: Option<Task<()>>,
    pub popover_hovered: bool,
    pub completion: Option<CompletionMenu>,
    completion_task: Option<Task<()>>,
    resolve_task: Option<Task<()>>,
    pub signature: Option<lsp::SignatureHelp>,
    signature_line: usize,
    signature_task: Option<Task<()>>,
    pub highlights: Vec<(Range<usize>, HighlightKind)>,
    highlight_for: Option<(usize, usize)>,
    highlight_task: Option<Task<()>>,
    pub inlay_hints: Vec<InlayHint>,
    inlay_task: Option<Task<()>>,
    pub code_actions: Option<CodeActionMenu>,
    code_action_task: Option<Task<()>>,
    pub lightbulb: Option<Lightbulb>,
    lightbulb_for: Option<(Range<usize>, usize, Option<u64>)>,
    lightbulb_task: Option<Task<()>>,
    pub rename: Option<RenameState>,
    pub snippet: Option<SnippetSession>,
    /// The word under the mouse with the go-to-definition modifier held.
    pub link: Option<Range<usize>>,
    /// Where the mouse last moved over the text, to update the link when only a modifier changes.
    mouse_position: Option<Point<Pixels>>,
    link_fallback: Option<crate::document_links::LinkTarget>,
    pub(crate) request_task: Option<Task<()>>,
    subscriptions: Vec<Subscription>,
}

impl LspState {
    /// Whether a mouse move off the text matters (a hover pending or shown, a link drawn).
    pub(crate) fn wants_mouse_leave(&self) -> bool {
        self.hover_task.is_some() || self.hover.is_some() || self.link.is_some()
    }
}

/// Servers already reported missing, so each is named once per session.
#[derive(Default)]
struct ReportedServers(HashSet<String>);

impl Global for ReportedServers {}

impl Editor {
    /// The project the file belongs to, so its language server starts at the project root.
    pub fn set_project_root(&mut self, root: Option<PathBuf>, cx: &mut Context<Self>) {
        if self.lsp.project_root == root {
            return;
        }
        self.lsp.project_root = root;
        if self.status == Status::Ready {
            self.attach_lsp(cx);
        }
    }

    pub fn lsp_status(&self) -> LspStatus {
        self.lsp.status.clone().unwrap_or(LspStatus::Off)
    }

    /// The file's diagnostics as (severity, 1-based line, message), for a status bar or tests.
    pub fn diagnostic_summary(&self) -> Vec<(Severity, usize, String)> {
        let buffer = &self.document.buffer;
        self.lsp.diagnostics.iter().map(|diagnostic| (diagnostic.severity, buffer.line_of(diagnostic.range.start) + 1, diagnostic.message.clone())).collect()
    }

    /// Asks the server for the file's symbols, for the outline.
    pub fn request_document_symbols(&self) -> Option<impl Future<Output = anyhow::Result<Option<lsp::DocumentSymbolResponse>>> + use<>> {
        let document = self.lsp.document.as_ref()?;
        let server = document.server();
        if server.capabilities().is_some_and(|capabilities| capabilities.document_symbol_provider.is_none()) {
            return None;
        }
        Some(server.request::<lsp::request::DocumentSymbolRequest>(lsp::DocumentSymbolParams {
            text_document: document.identifier(),
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        }))
    }

    /// Opens the file in its language server, once it loaded (and again after a reload).
    pub(crate) fn attach_lsp(&mut self, cx: &mut Context<Self>) {
        self.lsp.document = None;
        self.lsp.diagnostics.clear();
        self.lsp.diagnostics_generation = None;
        self.lsp.inlay_hints.clear();
        if !crate::demo("lens") {
            self.code_lens.server.clear();
        }
        self.semantic.spans.clear();
        if self.status != Status::Ready || !self.fs.reaches_language_servers() || !self.path.has_root() || self.is_large_file() {
            self.lsp.status = Some(LspStatus::Off);
            return;
        }
        let store = LspStore::global(cx);
        if self.lsp.subscriptions.is_empty() {
            self.lsp.subscriptions.push(cx.subscribe(&store, |editor, _, event: &LspStoreEvent, cx| editor.store_event(event, cx)));
            self.lsp.subscriptions.push(cx.observe_global::<DiagnosticsStore>(|editor, cx| editor.refresh_diagnostics(cx)));
        }
        let rope = self.document.buffer.rope().clone();
        let path = self.path.clone();
        let root = self.lsp.project_root.clone();
        let opened = store.update(cx, |store, cx| store.open_document(&path, &rope, root.as_deref(), cx));
        match opened {
            Ok(document) => {
                let name = document.server().name().to_string();
                let ready = document.server().capabilities().is_some();
                self.lsp.status = Some(if ready { LspStatus::Ready(name) } else { LspStatus::Starting(name) });
                self.lsp.document = Some(document);
                self.document.buffer.record_changes(true);
                self.refresh_diagnostics(cx);
                if ready {
                    self.server_ready(cx);
                }
            }
            Err(OpenError::Unsupported) => self.lsp.status = Some(LspStatus::Unsupported),
            Err(OpenError::NotInstalled { server }) => {
                if cx.default_global::<ReportedServers>().0.insert(server.clone()) {
                    self.notice = Some(format!("Language server not installed: {server}. Install it from Athas's extensions or put it on PATH."));
                }
                self.lsp.status = Some(LspStatus::NotInstalled(server));
            }
            Err(OpenError::Failed { server, message }) => {
                if cx.default_global::<ReportedServers>().0.insert(server.clone()) {
                    self.notice = Some(format!("{server} could not start: {message}"));
                }
                self.lsp.status = Some(LspStatus::Failed(message));
            }
        }
        cx.notify();
    }

    fn server(&self) -> Option<&Arc<LanguageServer>> {
        self.lsp.document.as_ref().map(|document| document.server())
    }

    fn capabilities(&self) -> Option<&lsp::ServerCapabilities> {
        self.server()?.capabilities()
    }

    fn store_event(&mut self, event: &LspStoreEvent, cx: &mut Context<Self>) {
        let ours = |server: &usize| self.server().is_some_and(|ours| ours.id() == *server);
        match event {
            LspStoreEvent::EditDocument { path, edits } if *path == self.path => self.apply_lsp_edits(edits, cx),
            LspStoreEvent::ServerReady(server) if ours(server) => {
                let name = self.server().map(|server| server.name().to_string()).unwrap_or_default();
                self.lsp.status = Some(LspStatus::Ready(name));
                self.server_ready(cx);
                cx.notify();
            }
            LspStoreEvent::Refresh { server, method } if ours(server) && method.contains("inlayHint") => self.schedule_inlay_hints(cx),
            LspStoreEvent::ServerExited { server, name, error } if ours(server) => {
                self.lsp.document = None;
                self.lsp.status = Some(match error {
                    Some(error) => {
                        self.notice = Some(error.clone());
                        LspStatus::Failed(error.clone())
                    }
                    None => LspStatus::Failed(format!("{name} stopped")),
                });
                self.dismiss_lsp_popovers(cx);
                cx.notify();
            }
            LspStoreEvent::Retry if matches!(self.lsp.status, Some(LspStatus::NotInstalled(_) | LspStatus::Failed(_))) => {
                self.attach_lsp(cx)
            }
            // A server came up (often ours again, started by another file after a crash): an
            // editor its old server left detached opens its file again instead of staying dark.
            LspStoreEvent::ServerReady(_) if self.lsp.document.is_none() && matches!(self.lsp.status, Some(LspStatus::Failed(_))) => self.attach_lsp(cx),
            _ => {}
        }
    }

    fn server_ready(&mut self, cx: &mut Context<Self>) {
        self.schedule_inlay_hints(cx);
        self.fetch_code_lens(false, cx);
        self.fetch_semantic_tokens(false, cx);
        self.schedule_lsp_folds(false, cx);
        cx.emit(LspEvent::SymbolsChanged);
        self.run_demo(cx);
    }

    /// For headless snapshots: `ATHAS_EDITOR_LSP_DEMO=hover:LINE:COLUMN` (or `completion:…`,
    /// `signature:…`), 1-based, opens that popover once the server is ready, after
    /// `ATHAS_EDITOR_LSP_DEMO_DELAY_MS` (2000) for indexing.
    fn run_demo(&mut self, cx: &mut Context<Self>) {
        let Ok(demo) = std::env::var("ATHAS_EDITOR_LSP_DEMO") else { return };
        let mut parts = demo.split(':');
        let (Some(kind), Some(line), Some(column)) = (parts.next(), parts.next().and_then(|line| line.parse::<usize>().ok()), parts.next().and_then(|column| column.parse::<usize>().ok())) else {
            return;
        };
        let kind = kind.to_string();
        let delay = std::env::var("ATHAS_EDITOR_LSP_DEMO_DELAY_MS").ok().and_then(|ms| ms.parse().ok()).unwrap_or(2000);
        // A real-time wait: the snapshot's executor runs a simulated clock that timers never pass.
        let (done, wait) = futures::channel::oneshot::channel::<()>();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(delay));
            done.send(()).ok();
        });
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            wait.await.ok();
            this.update(cx, |editor, cx| {
                editor.fetch_inlay_hints(false, cx);
                editor.go_to_line(line, Some(column), cx);
                let caret = editor.caret();
                match kind.as_str() {
                    "hover" => {
                        editor.lsp.hover_pending = Some(caret);
                        editor.show_hover(caret, true, cx);
                    }
                    "completion" => editor.request_completions(None, cx),
                    "signature" => editor.request_signature_help(None, cx),
                    _ => {}
                }
            })
            .ok();
        }));
    }

    /// Reads the file's diagnostics from the store when they changed.
    fn refresh_diagnostics(&mut self, cx: &mut Context<Self>) {
        let store = cx.global::<DiagnosticsStore>();
        // This file's generation, not the store's: another file's report must not replace the
        // spans this editor moved through its edits with the server's older positions.
        let generation = store.generation_for(&self.path);
        if self.lsp.diagnostics_generation == Some(generation) {
            return;
        }
        self.lsp.diagnostics_generation = Some(generation);
        let rope = self.document.buffer.rope();
        self.lsp.diagnostics = store
            .for_path(&self.path)
            .into_iter()
            .map(|diagnostic| {
                let range = range_to_offsets(rope, diagnostic.range);
                DiagnosticSpan { range, severity: diagnostic.severity, origin: diagnostic.origin(), message: diagnostic.message, raw: diagnostic.raw }
            })
            .collect();
        self.schedule_lightbulb(cx);
        cx.notify();
    }

    /// After an edit: tells the server, and moves what is kept at offsets.
    pub(crate) fn lsp_buffer_changed(&mut self, changes: &[AppliedEdit], cx: &mut Context<Self>) {
        if changes.is_empty() {
            return;
        }
        if let Some(document) = &self.lsp.document {
            document.change(changes.iter().map(|change| change.lsp.clone()).collect(), self.document.buffer.rope());
        }
        let shift = |range: &mut Range<usize>, changes: &[AppliedEdit]| {
            range.start = map_through(range.start, changes, Bias::Right);
            range.end = map_through(range.end, changes, Bias::Left).max(range.start);
        };
        for diagnostic in &mut self.lsp.diagnostics {
            shift(&mut diagnostic.range, changes);
        }
        for hint in &mut self.lsp.inlay_hints {
            hint.offset = map_through(hint.offset, changes, Bias::Right);
        }
        self.code_lens_edited(changes);
        self.semantic_edited(changes);
        if let Some(snippet) = &mut self.lsp.snippet {
            for stop in &mut snippet.stops {
                for range in stop {
                    range.start = map_through(range.start, changes, Bias::Left);
                    range.end = map_through(range.end, changes, Bias::Right);
                }
            }
        }
        self.lsp.highlights.clear();
        self.lsp.highlight_for = None;
        self.lsp.hover = None;
        self.lsp.hover_task = None;
        self.lsp.hover_pending = None;
        self.lsp.code_actions = None;
        self.lsp.link = None;
        self.schedule_inlay_hints(cx);
        self.schedule_code_lens(cx);
        self.fetch_semantic_tokens(true, cx);
        self.schedule_lsp_folds(true, cx);
        if self.lsp.signature.is_some() {
            self.request_signature_help(None, cx);
        }
        cx.emit(LspEvent::SymbolsChanged);
    }

    /// Closes hover, menus and signature help. Returns whether anything was open.
    pub(crate) fn dismiss_lsp_popovers(&mut self, cx: &mut Context<Self>) -> bool {
        let lsp = &mut self.lsp;
        let open = lsp.hover.is_some() || lsp.completion.is_some() || lsp.code_actions.is_some() || lsp.signature.is_some() || lsp.rename.is_some();
        lsp.hover = None;
        lsp.hover_task = None;
        lsp.hover_pending = None;
        lsp.completion = None;
        lsp.completion_task = None;
        lsp.code_actions = None;
        lsp.signature = None;
        lsp.signature_task = None;
        lsp.rename = None;
        if open {
            cx.notify();
        }
        open
    }

    /// Escape: ends a snippet after the popovers closed.
    pub(crate) fn end_snippet(&mut self) -> bool {
        self.lsp.snippet.take().is_some()
    }

    fn position_params(&self, offset: usize) -> Option<lsp::TextDocumentPositionParams> {
        let document = self.lsp.document.as_ref()?;
        Some(lsp::TextDocumentPositionParams { text_document: document.identifier(), position: offset_to_position(self.document.buffer.rope(), offset) })
    }

    fn caret(&self) -> usize {
        self.document.newest_selection().head
    }

    // Hover.

    /// The mouse moved over the text without a button: hover cards and go-to-definition links.
    pub(crate) fn mouse_moved(&mut self, position: Point<Pixels>, modifiers: Modifiers, cx: &mut Context<Self>) {
        self.lsp.mouse_position = Some(position);
        let offset = self.hover_offset(position);
        self.set_link(offset, modifiers, cx);
        let Some(offset) = offset else {
            self.lsp.hover_task = None;
            self.lsp.hover_pending = None;
            return;
        };
        if let Some(hover) = &self.lsp.hover {
            if hover.range.start <= offset && offset <= hover.range.end {
                return;
            }
            self.lsp.hover = None;
            cx.notify();
        }
        let word = self.document.buffer.word_range_at(offset).unwrap_or(offset..offset);
        if self.lsp.hover_pending.is_some_and(|pending| word.contains(&pending) || pending == offset) {
            return;
        }
        self.lsp.hover_pending = Some(offset);
        self.lsp.hover_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(HOVER_DELAY).await;
            this.update(cx, |editor, cx| editor.show_hover(offset, false, cx)).ok();
        }));
    }

    /// The go-to-definition modifier was pressed or released with the mouse still over the text.
    pub(crate) fn link_modifiers_changed(&mut self, modifiers: Modifiers, cx: &mut Context<Self>) {
        let Some(position) = self.lsp.mouse_position else { return };
        let offset = self.hover_offset(position);
        self.set_link(offset, modifiers, cx);
    }

    fn set_link(&mut self, offset: Option<usize>, modifiers: Modifiers, cx: &mut Context<Self>) {
        let link = offset.filter(|_| self.definition_modifier(modifiers, cx)).and_then(|offset| {
            if let Some((range, _)) = self.document_link_at(offset, false) {
                return Some(range);
            }
            self.lsp
                .document
                .is_some()
                .then(|| self.document.buffer.word_range_at(offset))
                .flatten()
                .or_else(|| self.document_link_at(offset, true).map(|(range, _)| range))
        });
        if link != self.lsp.link {
            self.lsp.link = link;
            cx.notify();
        }
    }

    /// The mouse left the text (to the popover, the gutter, or away).
    pub(crate) fn mouse_left_text(&mut self, outside: bool, cx: &mut Context<Self>) {
        self.lsp.mouse_position = None;
        self.lsp.hover_task = None;
        self.lsp.hover_pending = None;
        if self.lsp.link.take().is_some() {
            cx.notify();
        }
        if outside && !self.lsp.popover_hovered && self.lsp.hover.take().is_some() {
            cx.notify();
        }
    }

    /// The offset under the mouse, when it is over a character (not past the end of a line).
    fn hover_offset(&self, position: Point<Pixels>) -> Option<usize> {
        let layout = self.layout.as_ref()?;
        let row = layout.rows.iter().find(|row| position.y >= row.top && position.y < row.top + layout.line_height)?;
        let x = position.x - layout.origin.x;
        if x < px(0.) || x > row.x_for(row.start + row.len, layout.char_width) {
            return None;
        }
        Some(row.offset_for_x(x))
    }

    pub(crate) fn definition_modifier(&self, modifiers: Modifiers, cx: &App) -> bool {
        if settings::get(cx).editor_multi_cursor_modifier == "ctrlCmd" { modifiers.alt } else { modifiers.platform }
    }

    /// Shows the hover card at `offset`: the diagnostics there and the server's hover.
    fn show_hover(&mut self, offset: usize, from_keyboard: bool, cx: &mut Context<Self>) {
        let diagnostics: Vec<DiagnosticSpan> = self
            .lsp
            .diagnostics
            .iter()
            .filter(|diagnostic| {
                let range = &diagnostic.range;
                (range.start <= offset && offset < range.end.max(range.start + 1)) || (range.is_empty() && offset == range.start)
            })
            .cloned()
            .collect();
        let word = self.document.buffer.word_range_at(offset);
        let supported = self.capabilities().is_some_and(|capabilities| {
            capabilities.hover_provider.as_ref().is_some_and(|provider| !matches!(provider, lsp::HoverProviderCapability::Simple(false)))
        });
        let request = supported.then(|| self.position_params(offset)).flatten().map(|params| {
            self.server().cloned().map(|server| server.request::<lsp::request::HoverRequest>(lsp::HoverParams { text_document_position_params: params, work_done_progress_params: Default::default() }))
        });
        let fallback_range = diagnostics
            .iter()
            .map(|diagnostic| diagnostic.range.clone())
            .chain(word.clone())
            .reduce(|a, b| a.start.min(b.start)..a.end.max(b.end))
            .unwrap_or(offset..offset + 1);
        let Some(Some(request)) = request else {
            if !diagnostics.is_empty() {
                self.lsp.hover = Some(HoverState { range: fallback_range, diagnostics, blocks: Vec::new() });
                cx.notify();
            }
            return;
        };
        let version = self.document.buffer.version();
        self.lsp.hover_task = Some(cx.spawn(async move |this, cx| {
            let response = request.await.ok().flatten();
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() != version || (!from_keyboard && editor.lsp.hover_pending != Some(offset)) {
                    return;
                }
                let rope = editor.document.buffer.rope();
                let mut range = fallback_range;
                let mut blocks = Vec::new();
                if let Some(hover) = response {
                    if let Some(hover_range) = hover.range {
                        let hover_range = range_to_offsets(rope, hover_range);
                        range = range.start.min(hover_range.start)..range.end.max(hover_range.end);
                    }
                    blocks = hover_blocks(hover.contents);
                }
                if blocks.is_empty() && diagnostics.is_empty() {
                    return;
                }
                editor.lsp.hover = Some(HoverState { range, diagnostics, blocks });
                cx.notify();
            })
            .ok();
        }));
    }

    pub(crate) fn show_hover_action(&mut self, _: &crate::ShowHover, _: &mut Window, cx: &mut Context<Self>) {
        let caret = self.caret();
        self.lsp.hover_pending = Some(caret);
        self.show_hover(caret, true, cx);
    }

    // Diagnostics navigation.

    fn jump_to_diagnostic(&mut self, forward: bool, cx: &mut Context<Self>) {
        let caret = self.caret();
        let diagnostics = &self.lsp.diagnostics;
        if diagnostics.is_empty() {
            return;
        }
        let target = if forward {
            diagnostics.iter().find(|diagnostic| diagnostic.range.start > caret).or(diagnostics.first())
        } else {
            diagnostics.iter().rev().find(|diagnostic| diagnostic.range.start < caret).or(diagnostics.last())
        };
        let Some(start) = target.map(|diagnostic| diagnostic.range.start) else { return };
        self.document.set_cursor(start);
        self.autoscroll = Some(Autoscroll::Center);
        self.lsp.hover_pending = Some(start);
        self.show_hover(start, true, cx);
        self.pause_blink(cx);
        cx.notify();
    }

    pub(crate) fn next_diagnostic(&mut self, _: &crate::NextDiagnostic, _: &mut Window, cx: &mut Context<Self>) {
        self.jump_to_diagnostic(true, cx);
    }

    pub(crate) fn previous_diagnostic(&mut self, _: &crate::PreviousDiagnostic, _: &mut Window, cx: &mut Context<Self>) {
        self.jump_to_diagnostic(false, cx);
    }

    // Completion.

    /// After typed text: completion and signature help, as the settings allow.
    pub(crate) fn lsp_typed(&mut self, text: &str, cx: &mut Context<Self>) {
        if self.lsp.document.is_none() {
            return;
        }
        let Some(last) = text.chars().last() else { return };
        let settings = settings::get(cx);
        let (auto_completion, parameter_hints) = (settings.auto_completion, settings.parameter_hints);
        let capabilities = self.capabilities().cloned();
        let completion_triggers: Vec<String> = capabilities
            .as_ref()
            .and_then(|capabilities| capabilities.completion_provider.as_ref())
            .and_then(|provider| provider.trigger_characters.clone())
            .unwrap_or_default();
        let is_trigger = completion_triggers.iter().any(|trigger| trigger.ends_with(last));
        if self.lsp.completion.is_some() {
            if is_word_char(last) {
                let incomplete = self.lsp.completion.as_ref().is_some_and(|menu| menu.is_incomplete);
                if incomplete {
                    self.request_completions(None, cx);
                } else {
                    self.refilter_completions(cx);
                }
            } else if is_trigger {
                self.request_completions(Some(last.to_string()), cx);
            } else {
                self.lsp.completion = None;
                self.lsp.completion_task = None;
            }
        } else if is_trigger {
            self.request_completions(Some(last.to_string()), cx);
        } else if auto_completion && is_word_char(last) && text.chars().count() == 1 {
            self.request_completions(None, cx);
        }

        if parameter_hints && let Some(provider) = capabilities.as_ref().and_then(|capabilities| capabilities.signature_help_provider.as_ref()) {
            let triggers = provider.trigger_characters.clone().unwrap_or_default();
            let retriggers = provider.retrigger_characters.clone().unwrap_or_default();
            if triggers.iter().any(|trigger| trigger.ends_with(last)) || (self.lsp.signature.is_some() && retriggers.iter().any(|trigger| trigger.ends_with(last))) {
                self.request_signature_help(Some(last.to_string()), cx);
            } else if last == ')' {
                self.lsp.signature = None;
            }
        }
    }

    /// Where the word before the caret starts.
    fn word_start(&self) -> usize {
        let caret = self.caret();
        caret - self.document.buffer.reversed_chars_at(caret).take_while(|ch| is_word_char(*ch)).map(char::len_utf8).sum::<usize>()
    }

    pub(crate) fn show_completions(&mut self, _: &crate::ShowCompletions, _: &mut Window, cx: &mut Context<Self>) {
        self.request_completions(None, cx);
    }

    fn request_completions(&mut self, trigger: Option<String>, cx: &mut Context<Self>) {
        let Some(server) = self.server().cloned() else { return };
        if server.capabilities().is_some_and(|capabilities| capabilities.completion_provider.is_none()) {
            return;
        }
        let caret = self.caret();
        let Some(params) = self.position_params(caret) else { return };
        let context = lsp::CompletionContext {
            trigger_kind: if trigger.is_some() { lsp::CompletionTriggerKind::TRIGGER_CHARACTER } else { lsp::CompletionTriggerKind::INVOKED },
            trigger_character: trigger,
        };
        let request = server.request::<lsp::request::Completion>(lsp::CompletionParams {
            text_document_position: params,
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
            context: Some(context),
        });
        self.lsp.completion_task = Some(cx.spawn(async move |this, cx| {
            let Ok(response) = request.await else { return };
            this.update(cx, |editor, cx| {
                let (items, is_incomplete) = match response {
                    Some(lsp::CompletionResponse::Array(items)) => (items, false),
                    Some(lsp::CompletionResponse::List(list)) => (list.items, list.is_incomplete),
                    None => (Vec::new(), false),
                };
                let start = editor.word_start();
                editor.lsp.completion = Some(CompletionMenu { items, matches: Vec::new(), selected: 0, start, is_incomplete });
                editor.refilter_completions(cx);
            })
            .ok();
        }));
    }

    fn refilter_completions(&mut self, cx: &mut Context<Self>) {
        let caret = self.caret();
        let start = self.word_start();
        let query = self.document.buffer.slice(start..caret);
        let Some(menu) = &mut self.lsp.completion else { return };
        if start != menu.start && caret < menu.start {
            self.lsp.completion = None;
            cx.notify();
            return;
        }
        menu.start = start;
        let candidates: Vec<Candidate> = menu
            .items
            .iter()
            .map(|item| Candidate { filter_text: item.filter_text.as_deref().unwrap_or(&item.label), sort_text: item.sort_text.as_deref().unwrap_or(&item.label) })
            .collect();
        menu.matches = completion::filter(&query, &candidates);
        menu.selected = menu.matches.iter().position(|index| menu.items[*index].preselect == Some(true)).unwrap_or(0);
        // A lone exact match of what is typed is not worth a menu.
        let exact = menu.matches.len() == 1 && menu.items[menu.matches[0]].label == query;
        if menu.matches.is_empty() || exact {
            self.lsp.completion = None;
        } else {
            self.resolve_selected_completion(cx);
        }
        cx.notify();
    }

    /// Fetches the documentation of the selected item when the server sends it lazily.
    fn resolve_selected_completion(&mut self, cx: &mut Context<Self>) {
        let resolves = self
            .capabilities()
            .and_then(|capabilities| capabilities.completion_provider.as_ref())
            .and_then(|provider| provider.resolve_provider)
            .unwrap_or(false);
        let Some(menu) = &self.lsp.completion else { return };
        let Some(&index) = menu.matches.get(menu.selected) else { return };
        let item = menu.items[index].clone();
        if !resolves || item.documentation.is_some() {
            return;
        }
        let Some(server) = self.server().cloned() else { return };
        let request = server.request::<lsp::request::ResolveCompletionItem>(item);
        self.lsp.resolve_task = Some(cx.spawn(async move |this, cx| {
            let Ok(resolved) = request.await else { return };
            this.update(cx, |editor, cx| {
                if let Some(menu) = &mut editor.lsp.completion
                    && let Some(item) = menu.items.get_mut(index)
                {
                    *item = resolved;
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    pub(crate) fn menu_move(&mut self, step: isize, cx: &mut Context<Self>) {
        if let Some(menu) = &mut self.lsp.code_actions {
            let len = menu.actions.len() as isize;
            menu.selected = (menu.selected as isize + step).rem_euclid(len.max(1)) as usize;
        } else if let Some(menu) = &mut self.lsp.completion {
            let len = menu.matches.len() as isize;
            menu.selected = (menu.selected as isize + step).rem_euclid(len.max(1)) as usize;
            self.resolve_selected_completion(cx);
        }
        cx.notify();
    }

    pub(crate) fn menu_confirm(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(menu) = &self.lsp.code_actions {
            let index = menu.selected;
            self.confirm_code_action(index, window, cx);
        } else if let Some(menu) = &self.lsp.completion {
            let index = menu.selected;
            self.confirm_completion(index, cx);
        }
    }

    /// Inserts the `index`th match, resolving extra edits (imports) first when the server
    /// sends them lazily.
    pub(crate) fn confirm_completion(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(menu) = self.lsp.completion.take() else { return };
        self.lsp.completion_task = None;
        let Some(item) = menu.matches.get(index).map(|index| menu.items[*index].clone()) else { return };
        let resolves = self
            .capabilities()
            .and_then(|capabilities| capabilities.completion_provider.as_ref())
            .and_then(|provider| provider.resolve_provider)
            .unwrap_or(false);
        let server = self.server().cloned();
        match server.filter(|_| resolves && item.additional_text_edits.is_none()) {
            Some(server) => {
                let request = server.request::<lsp::request::ResolveCompletionItem>(item.clone());
                let timer = cx.background_executor().timer(RESOLVE_TIMEOUT);
                self.lsp.completion_task = Some(cx.spawn(async move |this, cx| {
                    let resolved = match select(Box::pin(request), Box::pin(timer)).await {
                        Either::Left((Ok(resolved), _)) => resolved,
                        _ => item,
                    };
                    this.update(cx, |editor, cx| editor.insert_completion(resolved, cx)).ok();
                }));
            }
            None => self.insert_completion(item, cx),
        }
        cx.notify();
    }

    fn insert_completion(&mut self, item: lsp::CompletionItem, cx: &mut Context<Self>) {
        let rope = self.document.buffer.rope().clone();
        let caret = self.caret();
        let (range, new_text) = match &item.text_edit {
            Some(lsp::CompletionTextEdit::Edit(edit)) => {
                let range = range_to_offsets(&rope, edit.range);
                (range.start..range.end.max(caret), edit.new_text.clone())
            }
            Some(lsp::CompletionTextEdit::InsertAndReplace(edit)) => {
                let range = range_to_offsets(&rope, edit.insert);
                (range.start..range.end.max(caret), edit.new_text.clone())
            }
            None => (self.word_start()..caret, item.insert_text.clone().unwrap_or_else(|| item.label.clone())),
        };
        let snippet = if item.insert_text_format == Some(lsp::InsertTextFormat::SNIPPET) {
            completion::parse_snippet(&new_text)
        } else {
            completion::Snippet { stops: vec![vec![new_text.len()..new_text.len()]], text: new_text }
        };
        let mut edits: Vec<(Range<usize>, String)> = vec![(range.clone(), snippet.text.clone())];
        if let Some(additional) = &item.additional_text_edits {
            edits.extend(text_edits_to_offsets(&rope, additional).into_iter().filter(|(other, _)| other.end <= range.start || other.start >= range.end));
        }
        edits.sort_by_key(|(range, _)| range.start);
        // Where the inserted text starts once the edits before it moved it.
        let shift: isize = edits
            .iter()
            .filter(|(other, _)| other.end <= range.start && *other != range)
            .map(|(other, text)| text.len() as isize - other.len() as isize)
            .sum();
        let base = range.start.saturating_add_signed(shift);
        let stops: Vec<Vec<Range<usize>>> =
            snippet.stops.iter().map(|ranges| ranges.iter().map(|stop| base + stop.start..base + stop.end).collect()).collect();
        self.update_document(cx, |document| {
            let first = stops[0][0].clone();
            document.apply_edits(edits, vec![Target::Exact { anchor: first.start, head: first.end }], EditKind::Other);
            let mut selections = Vec::new();
            for range in &stops[0] {
                let mut selection = crate::selection::Selection::cursor(document.new_selection_id(), 0);
                selection.set_range(range.clone(), false);
                selections.push(selection);
            }
            document.set_selections(selections);
        });
        self.lsp.snippet = (stops.len() > 1).then_some(SnippetSession { stops, current: 0 });
        cx.notify();
    }

    pub(crate) fn snippet_step(&mut self, forward: bool, cx: &mut Context<Self>) {
        let Some(snippet) = &mut self.lsp.snippet else { return };
        let next = if forward { snippet.current + 1 } else { snippet.current.saturating_sub(1) };
        if next >= snippet.stops.len() {
            self.lsp.snippet = None;
            return;
        }
        snippet.current = next;
        let ranges = snippet.stops[next].clone();
        let last = next + 1 == snippet.stops.len();
        self.update_document(cx, |document| {
            let mut selections = Vec::new();
            for range in ranges {
                let mut selection = crate::selection::Selection::cursor(document.new_selection_id(), 0);
                selection.set_range(range, false);
                selections.push(selection);
            }
            document.set_selections(selections);
        });
        if last {
            self.lsp.snippet = None;
        }
    }

    // Signature help.

    pub(crate) fn show_signature_help(&mut self, _: &crate::ShowSignatureHelp, _: &mut Window, cx: &mut Context<Self>) {
        self.request_signature_help(None, cx);
    }

    fn request_signature_help(&mut self, trigger: Option<String>, cx: &mut Context<Self>) {
        let Some(server) = self.server().cloned() else { return };
        if server.capabilities().is_some_and(|capabilities| capabilities.signature_help_provider.is_none()) {
            return;
        }
        let caret = self.caret();
        let Some(params) = self.position_params(caret) else { return };
        let is_retrigger = self.lsp.signature.is_some();
        let context = lsp::SignatureHelpContext {
            trigger_kind: if trigger.is_some() { lsp::SignatureHelpTriggerKind::TRIGGER_CHARACTER } else { lsp::SignatureHelpTriggerKind::CONTENT_CHANGE },
            trigger_character: trigger,
            is_retrigger,
            active_signature_help: self.lsp.signature.clone(),
        };
        let request = server.request::<lsp::request::SignatureHelpRequest>(lsp::SignatureHelpParams {
            context: Some(context),
            text_document_position_params: params,
            work_done_progress_params: Default::default(),
        });
        let line = self.document.buffer.line_of(caret);
        self.lsp.signature_task = Some(cx.spawn(async move |this, cx| {
            let response = request.await.ok().flatten();
            this.update(cx, |editor, cx| {
                editor.lsp.signature = response.filter(|help| !help.signatures.is_empty());
                editor.lsp.signature_line = line;
                cx.notify();
            })
            .ok();
        }));
    }

    /// Signature help follows the caret's line; moving away closes it.
    pub(crate) fn caret_moved(&mut self, cx: &mut Context<Self>) {
        let caret = self.caret();
        if self.lsp.signature.is_some() && self.document.buffer.line_of(caret) != self.lsp.signature_line {
            self.lsp.signature = None;
            self.lsp.signature_task = None;
        }
        if let Some(menu) = &self.lsp.completion
            && (caret < menu.start || self.document.buffer.line_of(caret) != self.document.buffer.line_of(menu.start))
        {
            self.lsp.completion = None;
        }
        if let Some(snippet) = &self.lsp.snippet
            && !snippet.stops.iter().flatten().any(|range| range.start <= caret && caret <= range.end)
        {
            self.lsp.snippet = None;
        }
        self.schedule_document_highlights(cx);
        self.schedule_lightbulb(cx);
    }

    // Document highlights.

    fn schedule_document_highlights(&mut self, cx: &mut Context<Self>) {
        let caret = self.caret();
        let key = (caret, self.document.buffer.version());
        if self.lsp.highlight_for == Some(key) {
            return;
        }
        self.lsp.highlight_for = Some(key);
        if self.lsp.highlights.iter().any(|(range, _)| range.start <= caret && caret <= range.end) {
            return;
        }
        if !self.lsp.highlights.is_empty() {
            self.lsp.highlights.clear();
            cx.notify();
        }
        let supported = self.capabilities().is_some_and(|capabilities| capabilities.document_highlight_provider.as_ref().is_some_and(|provider| !matches!(provider, lsp::OneOf::Left(false))));
        if !supported || !settings::get(cx).highlight_occurrences || self.document.buffer.word_range_at(caret).is_none() {
            self.lsp.highlight_task = None;
            return;
        }
        let Some(server) = self.server().cloned() else { return };
        let Some(params) = self.position_params(caret) else { return };
        let request = server.request::<lsp::request::DocumentHighlightRequest>(lsp::DocumentHighlightParams {
            text_document_position_params: params,
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        });
        let version = self.document.buffer.version();
        self.lsp.highlight_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(HIGHLIGHT_DELAY).await;
            let Ok(Some(highlights)) = request.await else { return };
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() != version {
                    return;
                }
                let rope = editor.document.buffer.rope();
                editor.lsp.highlights = highlights
                    .into_iter()
                    .map(|highlight| {
                        let kind = if highlight.kind == Some(lsp::DocumentHighlightKind::WRITE) { HighlightKind::Write } else { HighlightKind::Read };
                        (range_to_offsets(rope, highlight.range), kind)
                    })
                    .collect();
                cx.notify();
            })
            .ok();
        }));
    }

    // Inlay hints.

    fn schedule_inlay_hints(&mut self, cx: &mut Context<Self>) {
        self.fetch_inlay_hints(true, cx);
    }

    fn fetch_inlay_hints(&mut self, debounce: bool, cx: &mut Context<Self>) {
        let enabled = settings::get(cx).inlay_hints;
        let supported = self.capabilities().is_some_and(|capabilities| capabilities.inlay_hint_provider.as_ref().is_some_and(|provider| !matches!(provider, lsp::OneOf::Left(false))));
        if !enabled || !supported || self.document.buffer.len() > MAX_INLAY_FILE {
            if !self.lsp.inlay_hints.is_empty() {
                self.lsp.inlay_hints.clear();
                cx.notify();
            }
            self.lsp.inlay_task = None;
            return;
        }
        let Some(document) = self.lsp.document.clone() else { return };
        let rope = self.document.buffer.rope().clone();
        let range = offsets_to_range(&rope, 0..rope.len_bytes());
        let version = self.document.buffer.version();
        self.lsp.inlay_task = Some(cx.spawn(async move |this, cx| {
            if debounce {
                cx.background_executor().timer(INLAY_DELAY).await;
            }
            let request = document.server().request::<lsp::request::InlayHintRequest>(lsp::InlayHintParams {
                text_document: document.identifier(),
                range,
                work_done_progress_params: Default::default(),
            });
            let Ok(hints) = request.await else { return };
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() != version {
                    return;
                }
                let rope = editor.document.buffer.rope();
                let mut hints: Vec<InlayHint> = hints
                    .unwrap_or_default()
                    .into_iter()
                    .map(|hint| {
                        let mut label = match hint.label {
                            lsp::InlayHintLabel::String(text) => text,
                            lsp::InlayHintLabel::LabelParts(parts) => parts.into_iter().map(|part| part.value).collect(),
                        };
                        if hint.padding_left == Some(true) {
                            label.insert(0, ' ');
                        }
                        if hint.padding_right == Some(true) {
                            label.push(' ');
                        }
                        InlayHint { offset: position_to_offset(rope, hint.position), label: label.replace('\n', " ") }
                    })
                    .collect();
                hints.sort_by_key(|hint| hint.offset);
                editor.lsp.inlay_hints = hints;
                cx.notify();
            })
            .ok();
        }));
    }

    // Navigation.

    pub(crate) fn go_to_definition(&mut self, _: &crate::GoToDefinition, window: &mut Window, cx: &mut Context<Self>) {
        let caret = self.caret();
        self.navigate::<lsp::request::GotoDefinition>(caret, window, cx);
    }

    pub(crate) fn go_to_type_definition(&mut self, _: &crate::GoToTypeDefinition, window: &mut Window, cx: &mut Context<Self>) {
        let caret = self.caret();
        self.navigate::<lsp::request::GotoTypeDefinition>(caret, window, cx);
    }

    pub(crate) fn go_to_implementation(&mut self, _: &crate::GoToImplementation, window: &mut Window, cx: &mut Context<Self>) {
        let caret = self.caret();
        self.navigate::<lsp::request::GotoImplementation>(caret, window, cx);
    }

    /// Cmd-click: open the web address clicked, or go to the definition of what was clicked
    /// (falling back to a quoted file path there). Returns whether there was anything to follow.
    pub(crate) fn definition_click(&mut self, offset: usize, window: &mut Window, cx: &mut Context<Self>) -> bool {
        self.lsp.link = None;
        if let Some((_, target)) = self.document_link_at(offset, false) {
            self.open_document_link(target, cx);
            return true;
        }
        let file = self.document_link_at(offset, true).map(|(_, target)| target);
        if self.lsp.document.is_some() && self.document.buffer.word_range_at(offset).is_some() {
            self.lsp.link_fallback = file;
            self.navigate::<lsp::request::GotoDefinition>(offset, window, cx);
            return true;
        }
        match file {
            Some(target) => {
                self.open_document_link(target, cx);
                true
            }
            None => false,
        }
    }

    fn navigate<R>(&mut self, offset: usize, _: &mut Window, cx: &mut Context<Self>)
    where
        R: lsp::request::Request<Params = lsp::GotoDefinitionParams, Result = Option<lsp::GotoDefinitionResponse>> + 'static,
    {
        let Some(server) = self.server().cloned() else {
            self.notice = Some(self.no_server_message());
            cx.notify();
            return;
        };
        let Some(params) = self.position_params(offset) else { return };
        let request = server.request::<R>(lsp::GotoDefinitionParams {
            text_document_position_params: params,
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        });
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            let response = request.await;
            this.update(cx, |editor, cx| {
                let fallback = editor.lsp.link_fallback.take();
                let targets: Vec<(lsp::Url, lsp::Range)> = match response {
                    Ok(Some(lsp::GotoDefinitionResponse::Scalar(location))) => vec![(location.uri, location.range)],
                    Ok(Some(lsp::GotoDefinitionResponse::Array(locations))) => locations.into_iter().map(|location| (location.uri, location.range)).collect(),
                    Ok(Some(lsp::GotoDefinitionResponse::Link(links))) => links.into_iter().map(|link| (link.target_uri, link.target_selection_range)).collect(),
                    _ => Vec::new(),
                };
                let locations: Vec<FileLocation> =
                    targets.iter().filter_map(|(uri, range)| Some(FileLocation { path: lsp_client::uri::to_path(uri)?, range: *range })).collect();
                if locations.is_empty()
                    && let Some((uri, range)) = targets.iter().find(|(uri, _)| crate::java_class::is_java_class_file_uri(uri))
                {
                    editor.open_java_class_file(uri.clone(), *range, cx);
                    return;
                }
                match locations.len() {
                    0 if let Some(target) = fallback => editor.open_document_link(target, cx),
                    0 => editor.notice = Some(format!("No {} found", R::METHOD.trim_start_matches("textDocument/").replace("typeDefinition", "type definition"))),
                    1 => editor.open_location(&locations[0], cx),
                    _ => {
                        let word = editor.document.buffer.word_range_at(offset).map(|range| editor.document.buffer.slice(range)).unwrap_or_default();
                        cx.emit(LspEvent::References { title: format!("Definitions of {word}"), locations });
                    }
                }
                cx.notify();
            })
            .ok();
        }));
    }

    /// Moves the caret to a location in this file, or asks the workbench to open another.
    pub fn open_location(&mut self, location: &FileLocation, cx: &mut Context<Self>) {
        if location.path == self.path {
            let rope = self.document.buffer.rope();
            let offset = position_to_offset(rope, location.range.start);
            self.document.set_cursor(offset);
            self.autoscroll = Some(Autoscroll::Center);
            self.pause_blink(cx);
            cx.notify();
        } else {
            cx.emit(LspEvent::OpenLocation { path: location.path.clone(), line: location.line(), column: location.column() });
        }
    }

    pub(crate) fn find_references(&mut self, _: &crate::FindReferences, _: &mut Window, cx: &mut Context<Self>) {
        let Some(server) = self.server().cloned() else {
            self.notice = Some(self.no_server_message());
            cx.notify();
            return;
        };
        let caret = self.caret();
        let Some(params) = self.position_params(caret) else { return };
        let word = self.document.buffer.word_range_at(caret).map(|range| self.document.buffer.slice(range)).unwrap_or_default();
        let request = server.request::<lsp::request::References>(lsp::ReferenceParams {
            text_document_position: params,
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
            context: lsp::ReferenceContext { include_declaration: true },
        });
        // The references view shows the search at once (`setLoading`), before the server answers.
        let title = format!("References to {word}");
        cx.emit(LspEvent::FindingReferences { title: title.clone() });
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            let response = request.await;
            this.update(cx, |editor, cx| {
                let locations: Vec<FileLocation> = response.ok().flatten().unwrap_or_default().iter().filter_map(FileLocation::from_lsp).collect();
                if locations.is_empty() {
                    editor.notice = Some(format!("No references to {word}"));
                    cx.notify();
                }
                // Even with none, so the view leaves "Finding…" for its empty state.
                cx.emit(LspEvent::References { title, locations });
            })
            .ok();
        }));
    }

    /// `editor.showCallHierarchy`: the callers and callees of the symbol at the caret, in the
    /// references view.
    pub(crate) fn show_call_hierarchy(&mut self, _: &crate::commands::ShowCallHierarchy, _: &mut Window, cx: &mut Context<Self>) {
        let Some(server) = self.server().cloned() else {
            self.notice = Some(self.no_server_message());
            cx.notify();
            return;
        };
        let Some(params) = self.position_params(self.caret()) else { return };
        let prepare = server.request::<lsp::request::CallHierarchyPrepare>(lsp::CallHierarchyPrepareParams {
            text_document_position_params: params,
            work_done_progress_params: Default::default(),
        });
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            let Some(root) = prepare.await.ok().flatten().and_then(|items| items.into_iter().next()) else {
                this.update(cx, |editor, cx| {
                    editor.notice = Some("No call hierarchy found at the cursor".into());
                    cx.notify();
                })
                .ok();
                return;
            };
            let incoming = server.request::<lsp::request::CallHierarchyIncomingCalls>(lsp::CallHierarchyIncomingCallsParams {
                item: root.clone(),
                work_done_progress_params: Default::default(),
                partial_result_params: Default::default(),
            });
            let outgoing = server.request::<lsp::request::CallHierarchyOutgoingCalls>(lsp::CallHierarchyOutgoingCallsParams {
                item: root.clone(),
                work_done_progress_params: Default::default(),
                partial_result_params: Default::default(),
            });
            let callers = incoming.await.ok().flatten().unwrap_or_default().into_iter().map(|call| call.from);
            let callees = outgoing.await.ok().flatten().unwrap_or_default().into_iter().map(|call| call.to);
            let locations = callers.chain(callees).filter_map(|item| hierarchy_location(&item.uri, item.selection_range)).collect();
            this.update(cx, |editor, cx| editor.show_hierarchy(format!("Calls of {}", root.name), locations, cx)).ok();
        }));
    }

    /// `editor.showTypeHierarchy`: the supertypes and subtypes of the type at the caret.
    pub(crate) fn show_type_hierarchy(&mut self, _: &crate::commands::ShowTypeHierarchy, _: &mut Window, cx: &mut Context<Self>) {
        let Some(server) = self.server().cloned() else {
            self.notice = Some(self.no_server_message());
            cx.notify();
            return;
        };
        let Some(params) = self.position_params(self.caret()) else { return };
        let prepare = server.request::<lsp::request::TypeHierarchyPrepare>(lsp::TypeHierarchyPrepareParams {
            text_document_position_params: params,
            work_done_progress_params: Default::default(),
        });
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            let Some(root) = prepare.await.ok().flatten().and_then(|items| items.into_iter().next()) else {
                this.update(cx, |editor, cx| {
                    editor.notice = Some("No type hierarchy found at the cursor".into());
                    cx.notify();
                })
                .ok();
                return;
            };
            let supertypes = server.request::<lsp::request::TypeHierarchySupertypes>(lsp::TypeHierarchySupertypesParams {
                item: root.clone(),
                work_done_progress_params: Default::default(),
                partial_result_params: Default::default(),
            });
            let subtypes = server.request::<lsp::request::TypeHierarchySubtypes>(lsp::TypeHierarchySubtypesParams {
                item: root.clone(),
                work_done_progress_params: Default::default(),
                partial_result_params: Default::default(),
            });
            let mut items = supertypes.await.ok().flatten().unwrap_or_default();
            items.extend(subtypes.await.ok().flatten().unwrap_or_default());
            let locations = items.iter().filter_map(|item| hierarchy_location(&item.uri, item.selection_range)).collect();
            this.update(cx, |editor, cx| editor.show_hierarchy(format!("Type hierarchy of {}", root.name), locations, cx)).ok();
        }));
    }

    fn show_hierarchy(&mut self, title: String, locations: Vec<FileLocation>, cx: &mut Context<Self>) {
        match locations.len() {
            0 => self.notice = Some(format!("No results for {}", title.to_lowercase())),
            1 => self.open_location(&locations[0], cx),
            _ => cx.emit(LspEvent::References { title, locations }),
        }
        cx.notify();
    }

    fn no_server_message(&self) -> String {
        match self.lsp_status() {
            LspStatus::NotInstalled(server) => format!("Language server not installed: {server}"),
            LspStatus::Failed(message) => message,
            LspStatus::Unsupported => "No language server for this file".into(),
            _ => "The language server is not running".into(),
        }
    }

    // Edits from the server.

    /// Applies text edits from the server to this buffer as one undo step.
    pub(crate) fn apply_lsp_edits(&mut self, edits: &[lsp::TextEdit], cx: &mut Context<Self>) {
        let converted = text_edits_to_offsets(self.document.buffer.rope(), edits);
        if converted.is_empty() {
            return;
        }
        self.update_document(cx, |document| {
            let targets = document.selections.iter().map(|selection| Target::Mapped { anchor: selection.anchor, head: selection.head }).collect();
            document.apply_outside_edits(converted, targets);
        });
    }

    fn apply_workspace_edit(&mut self, edit: &lsp::WorkspaceEdit, cx: &mut Context<Self>) {
        let store = LspStore::global(cx);
        // This file is open, so the store hands its edits back through `EditDocument`.
        if let Err(error) = store.update(cx, |store, cx| store.apply_workspace_edit(edit, cx)) {
            self.notice = Some(format!("Could not apply all edits: {error:#}"));
            cx.notify();
        }
    }

    // Rename.

    pub(crate) fn rename(&mut self, _: &crate::Rename, window: &mut Window, cx: &mut Context<Self>) {
        let Some(server) = self.server().cloned() else {
            self.notice = Some(self.no_server_message());
            cx.notify();
            return;
        };
        let caret = self.caret();
        let Some(range) = self.document.buffer.word_range_at(caret) else { return };
        let prepare = server
            .capabilities()
            .and_then(|capabilities| capabilities.rename_provider.as_ref())
            .is_some_and(|provider| matches!(provider, lsp::OneOf::Right(options) if options.prepare_provider == Some(true)));
        if !prepare {
            let name = self.document.buffer.slice(range.clone());
            self.open_rename(range, name, window, cx);
            return;
        }
        let Some(params) = self.position_params(caret) else { return };
        let request = server.request::<lsp::request::PrepareRenameRequest>(params);
        self.lsp.request_task = Some(cx.spawn_in(window, async move |this, cx| {
            let response = request.await;
            this.update_in(cx, |editor, window, cx| {
                let rope = editor.document.buffer.rope();
                let (range, name) = match response {
                    Ok(Some(lsp::PrepareRenameResponse::Range(lsp_range))) => {
                        let range = range_to_offsets(rope, lsp_range);
                        (range.clone(), editor.document.buffer.slice(range))
                    }
                    Ok(Some(lsp::PrepareRenameResponse::RangeWithPlaceholder { range, placeholder })) => (range_to_offsets(rope, range), placeholder),
                    Ok(Some(lsp::PrepareRenameResponse::DefaultBehavior { .. })) => (range.clone(), editor.document.buffer.slice(range.clone())),
                    Ok(None) => {
                        editor.notice = Some("This symbol cannot be renamed".into());
                        cx.notify();
                        return;
                    }
                    Err(error) => {
                        editor.notice = Some(format!("Cannot rename: {error:#}"));
                        cx.notify();
                        return;
                    }
                };
                editor.open_rename(range, name, window, cx);
            })
            .ok();
        }));
    }

    fn open_rename(&mut self, range: Range<usize>, name: String, window: &mut Window, cx: &mut Context<Self>) {
        let input = cx.new(|cx| {
            let mut input = TextInput::new(window, cx).appearance(InputAppearance::Bare);
            input.set_text(name, cx);
            input.select_all_text(cx);
            input
        });
        let subscription = cx.subscribe_in(&input, window, |editor, input, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Confirmed => {
                let name = input.read(cx).text().to_string();
                editor.confirm_rename(name, window, cx);
            }
            TextInputEvent::Cancelled | TextInputEvent::Blurred => {
                editor.lsp.rename = None;
                if matches!(event, TextInputEvent::Cancelled) {
                    window.focus(&editor.focus_handle, cx);
                }
                cx.notify();
            }
            _ => {}
        });
        let handle = input.read(cx).focus_handle(cx);
        window.focus(&handle, cx);
        self.lsp.rename = Some(RenameState { input, range, _subscription: subscription });
        cx.notify();
    }

    fn confirm_rename(&mut self, new_name: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(rename) = self.lsp.rename.take() else { return };
        window.focus(&self.focus_handle, cx);
        cx.notify();
        let old_name = self.document.buffer.slice(rename.range.clone());
        if new_name.trim().is_empty() || new_name == old_name {
            return;
        }
        let Some(server) = self.server().cloned() else { return };
        let Some(params) = self.position_params(rename.range.start) else { return };
        let request = server.request::<lsp::request::Rename>(lsp::RenameParams { text_document_position: params, new_name, work_done_progress_params: Default::default() });
        let version = self.document.buffer.version();
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            let response = request.await;
            this.update(cx, |editor, cx| match response {
                // Its ranges are for the text as it was asked about: typed since, they would land
                // on the wrong code.
                Ok(Some(_)) if editor.document.buffer.version() != version => {
                    editor.notice = Some("Rename skipped: the file changed while the language server worked. Rename again.".into());
                    cx.notify();
                }
                Ok(Some(edit)) => editor.apply_workspace_edit(&edit, cx),
                Ok(None) => {}
                Err(error) => {
                    editor.notice = Some(format!("Rename failed: {error:#}"));
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    // Code actions.

    /// A `textDocument/codeAction` request for the newest selection and the diagnostics it touches.
    fn code_action_request(&self, trigger: lsp::CodeActionTriggerKind) -> Option<impl Future<Output = anyhow::Result<Option<lsp::CodeActionResponse>>> + use<>> {
        let server = self.server()?;
        let document = self.lsp.document.as_ref()?;
        let selection = self.document.newest_selection().range();
        let line = self.document.buffer.line_of(selection.start);
        let diagnostics: Vec<lsp::Diagnostic> = self
            .lsp
            .diagnostics
            .iter()
            .filter(|diagnostic| {
                let buffer = &self.document.buffer;
                (diagnostic.range.start <= selection.end && diagnostic.range.end >= selection.start) || buffer.line_of(diagnostic.range.start) == line
            })
            .map(|diagnostic| diagnostic.raw.clone())
            .collect();
        Some(server.request::<lsp::request::CodeActionRequest>(lsp::CodeActionParams {
            text_document: document.identifier(),
            range: offsets_to_range(self.document.buffer.rope(), selection),
            context: lsp::CodeActionContext { diagnostics, only: None, trigger_kind: Some(trigger) },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        }))
    }

    pub(crate) fn code_actions(&mut self, _: &crate::CodeActions, _: &mut Window, cx: &mut Context<Self>) {
        if self.server().is_none() {
            self.notice = Some(self.no_server_message());
            cx.notify();
            return;
        }
        let Some(request) = self.code_action_request(lsp::CodeActionTriggerKind::INVOKED) else { return };
        let anchor = self.document.newest_selection().range().start;
        self.lsp.code_action_task = Some(cx.spawn(async move |this, cx| {
            let response = request.await;
            this.update(cx, |editor, cx| {
                let actions = enabled_actions(response.ok().flatten());
                if actions.is_empty() {
                    editor.notice = Some("No code actions here".into());
                } else {
                    editor.show_code_actions(actions, anchor);
                }
                cx.notify();
            })
            .ok();
        }));
    }

    fn show_code_actions(&mut self, actions: Vec<lsp::CodeActionOrCommand>, anchor: usize) {
        let selected = actions.iter().position(|action| matches!(action, lsp::CodeActionOrCommand::CodeAction(action) if action.is_preferred == Some(true))).unwrap_or(0);
        self.lsp.completion = None;
        self.lsp.code_actions = Some(CodeActionMenu { actions, selected, anchor });
    }

    /// Asks again for the caret line's code actions once the caret has rested; the lightbulb
    /// leaves at once when the caret moves to another line (`lsp-code-actions.tsx`).
    fn schedule_lightbulb(&mut self, cx: &mut Context<Self>) {
        if self.lsp.code_actions.is_some() {
            return;
        }
        let selection = self.document.newest_selection().range();
        let key = (selection.clone(), self.document.buffer.version(), self.lsp.diagnostics_generation);
        if self.lsp.lightbulb_for.as_ref() == Some(&key) {
            return;
        }
        self.lsp.lightbulb_for = Some(key);
        let line = self.document.buffer.line_of(self.caret());
        if self.lsp.lightbulb.as_ref().is_some_and(|bulb| bulb.line != line) {
            self.lsp.lightbulb = None;
            cx.notify();
        }
        let supported = self
            .capabilities()
            .is_some_and(|capabilities| capabilities.code_action_provider.as_ref().is_some_and(|provider| !matches!(provider, lsp::CodeActionProviderCapability::Simple(false))));
        if !supported {
            self.lsp.lightbulb_task = None;
            return;
        }
        let version = self.document.buffer.version();
        self.lsp.lightbulb_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(LIGHTBULB_DELAY).await;
            let Ok(Some((request, line))) = this.update(cx, |editor, _| editor.code_action_request(lsp::CodeActionTriggerKind::AUTOMATIC).map(|request| (request, editor.document.buffer.line_of(editor.caret())))) else {
                return;
            };
            let response = request.await;
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() != version {
                    return;
                }
                let actions = enabled_actions(response.ok().flatten());
                editor.lsp.lightbulb = (!actions.is_empty()).then_some(Lightbulb { line, actions });
                cx.notify();
            })
            .ok();
        }));
    }

    /// The lightbulb's menu, opened from its click.
    pub(crate) fn open_lightbulb(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(bulb) = self.lsp.lightbulb.as_ref() else { return };
        let (actions, anchor) = (bulb.actions.clone(), self.document.buffer.line_start(bulb.line));
        self.show_code_actions(actions, anchor);
        window.focus(&self.focus_handle, cx);
        cx.notify();
    }

    pub(crate) fn confirm_code_action(&mut self, index: usize, _: &mut Window, cx: &mut Context<Self>) {
        let Some(menu) = self.lsp.code_actions.take() else { return };
        cx.notify();
        let Some(action) = menu.actions.into_iter().nth(index) else { return };
        let Some(server) = self.server().cloned() else { return };
        let resolves = server
            .capabilities()
            .and_then(|capabilities| capabilities.code_action_provider.as_ref())
            .is_some_and(|provider| matches!(provider, lsp::CodeActionProviderCapability::Options(options) if options.resolve_provider == Some(true)));
        self.lsp.code_action_task = Some(cx.spawn(async move |this, cx| {
            let (edit, command) = match action {
                lsp::CodeActionOrCommand::Command(command) => (None, Some(command)),
                lsp::CodeActionOrCommand::CodeAction(action) => {
                    let action = if action.edit.is_none() && action.command.is_none() && resolves {
                        server.request::<lsp::request::CodeActionResolveRequest>(action.clone()).await.unwrap_or(action)
                    } else {
                        action
                    };
                    (action.edit, action.command)
                }
            };
            if let Some(edit) = edit {
                this.update(cx, |editor, cx| editor.apply_workspace_edit(&edit, cx)).ok();
            }
            if let Some(command) = command {
                // The server answers with `workspace/applyEdit` requests of its own.
                let result = server
                    .request::<lsp::request::ExecuteCommand>(lsp::ExecuteCommandParams {
                        command: command.command,
                        arguments: command.arguments.unwrap_or_default(),
                        work_done_progress_params: Default::default(),
                    })
                    .await;
                if let Err(error) = result {
                    this.update(cx, |editor, cx| {
                        editor.notice = Some(format!("{} failed: {error:#}", command.title));
                        cx.notify();
                    })
                    .ok();
                }
            }
        }));
    }

    // Formatting.

    fn formatting_request(&self) -> Option<impl Future<Output = anyhow::Result<Option<Vec<lsp::TextEdit>>>> + use<>> {
        let document = self.lsp.document.as_ref()?;
        let supported = document
            .server()
            .capabilities()
            .is_some_and(|capabilities| capabilities.document_formatting_provider.as_ref().is_some_and(|provider| !matches!(provider, lsp::OneOf::Left(false))));
        if !supported {
            return None;
        }
        Some(document.server().request::<lsp::request::Formatting>(lsp::DocumentFormattingParams {
            text_document: document.identifier(),
            options: lsp::FormattingOptions { tab_size: self.document.tab_size as u32, insert_spaces: !self.document.hard_tabs, ..Default::default() },
            work_done_progress_params: Default::default(),
        }))
    }

    pub(crate) fn format_document(&mut self, _: &crate::FormatDocument, _: &mut Window, cx: &mut Context<Self>) {
        let Some(request) = self.formatting_request() else {
            self.notice = Some(match self.lsp_status() {
                LspStatus::Ready(server) => format!("{server} cannot format this file"),
                _ => self.no_server_message(),
            });
            cx.notify();
            return;
        };
        let version = self.document.buffer.version();
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            let response = request.await;
            this.update(cx, |editor, cx| match response {
                Ok(Some(edits)) if editor.document.buffer.version() == version => editor.apply_lsp_edits(&edits, cx),
                Ok(_) => {}
                Err(error) => {
                    editor.notice = Some(format!("Formatting failed: {error:#}"));
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    /// Formats the newest selection with the server's range formatting, or the whole file when
    /// the server formats only documents.
    pub(crate) fn format_selection(&mut self, _: &crate::FormatSelection, window: &mut Window, cx: &mut Context<Self>) {
        let selection = self.document.newest_selection().range();
        if selection.is_empty() {
            self.notice = Some("Select text to format.".into());
            cx.notify();
            return;
        }
        let Some(document) = self.lsp.document.clone() else {
            self.format_document(&crate::FormatDocument, window, cx);
            return;
        };
        let supported = document
            .server()
            .capabilities()
            .is_some_and(|capabilities| capabilities.document_range_formatting_provider.as_ref().is_some_and(|provider| !matches!(provider, lsp::OneOf::Left(false))));
        if !supported {
            self.format_document(&crate::FormatDocument, window, cx);
            return;
        }
        let request = document.server().request::<lsp::request::RangeFormatting>(lsp::DocumentRangeFormattingParams {
            text_document: document.identifier(),
            range: offsets_to_range(self.document.buffer.rope(), selection),
            options: lsp::FormattingOptions { tab_size: self.document.tab_size as u32, insert_spaces: !self.document.hard_tabs, ..Default::default() },
            work_done_progress_params: Default::default(),
        });
        let version = self.document.buffer.version();
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            let response = request.await;
            this.update(cx, |editor, cx| match response {
                Ok(Some(edits)) if editor.document.buffer.version() == version => editor.apply_lsp_edits(&edits, cx),
                Ok(_) => {}
                Err(error) => {
                    editor.notice = Some(format!("Selection formatting failed: {error:#}"));
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    /// Format on save: formats first (when the server can, within a few seconds), then saves.
    /// Returns false when there is nothing to format with, so the caller saves at once.
    pub(crate) fn format_then_save(&mut self, cx: &mut Context<Self>) -> bool {
        if !settings::get(cx).format_on_save {
            return false;
        }
        #[cfg(not(target_family = "wasm"))]
        if self.fs.is_local()
            && let Some(plan) = extensions::formatter_for_path(&self.path, cx)
        {
            self.format_with_extension_then_save(plan, cx);
            return true;
        }
        let Some(request) = self.formatting_request() else { return false };
        let version = self.document.buffer.version();
        let timer = cx.background_executor().timer(FORMAT_TIMEOUT);
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            let response = match select(Box::pin(request), Box::pin(timer)).await {
                Either::Left((Ok(Some(edits)), _)) => edits,
                _ => Vec::new(),
            };
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() == version {
                    editor.apply_lsp_edits(&response, cx);
                }
                editor.save_now(cx);
            })
            .ok();
        }));
        true
    }

    /// The extension's formatter comes before the language server (`formatContent`); a failure
    /// saves the text as it is.
    #[cfg(not(target_family = "wasm"))]
    fn format_with_extension_then_save(&mut self, plan: extensions::FormatterPlan, cx: &mut Context<Self>) {
        let path = self.path.clone();
        let root = self.lsp.project_root.clone();
        let text = self.document.buffer.text();
        let version = self.document.buffer.version();
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            let response = cx.background_spawn(async move { plan.run(&path, &text, root.as_deref()) }).await;
            this.update(cx, |editor, cx| {
                if response.success && editor.document.buffer.version() == version {
                    editor.apply_formatted_text(&response.formatted_content.replace("\r\n", "\n"), cx);
                }
                editor.save_now(cx);
            })
            .ok();
        }));
    }

    /// Replaces the text with `formatted` as one undo step, editing only the span that changed so
    /// selections outside it stay put.
    #[cfg(not(target_family = "wasm"))]
    pub(crate) fn apply_formatted_text(&mut self, formatted: &str, cx: &mut Context<Self>) {
        let current = self.document.buffer.text();
        let Some((range, insert)) = changed_span(&current, formatted) else { return };
        self.update_document(cx, |document| {
            let targets = document.selections.iter().map(|selection| Target::Mapped { anchor: selection.anchor, head: selection.head }).collect();
            document.apply_edits(vec![(range, insert)], targets, EditKind::Other);
        });
    }

    /// Tells the server the file was written.
    pub(crate) fn lsp_saved(&self) {
        if let Some(document) = &self.lsp.document {
            document.saved(self.document.buffer.rope());
        }
    }
}

/// The byte range of `old` that differs from `new`, and what replaces it; `None` when equal.
#[cfg(not(target_family = "wasm"))]
pub(crate) fn changed_span(old: &str, new: &str) -> Option<(std::ops::Range<usize>, String)> {
    if old == new {
        return None;
    }
    let mut prefix = old.bytes().zip(new.bytes()).take_while(|(a, b)| a == b).count();
    while !old.is_char_boundary(prefix) || !new.is_char_boundary(prefix) {
        prefix -= 1;
    }
    let max_suffix = (old.len() - prefix).min(new.len() - prefix);
    let mut suffix = old.bytes().rev().zip(new.bytes().rev()).take(max_suffix).take_while(|(a, b)| a == b).count();
    while !old.is_char_boundary(old.len() - suffix) || !new.is_char_boundary(new.len() - suffix) {
        suffix -= 1;
    }
    Some((prefix..old.len() - suffix, new[prefix..new.len() - suffix].to_string()))
}

/// A hover's contents as markdown blocks.
fn hover_blocks(contents: lsp::HoverContents) -> Vec<Block> {
    let marked = |marked: lsp::MarkedString| match marked {
        lsp::MarkedString::String(text) => markdown::parse(&text),
        lsp::MarkedString::LanguageString(code) => vec![Block::Code { language: Some(code.language), code: code.value }],
    };
    match contents {
        lsp::HoverContents::Scalar(scalar) => marked(scalar),
        lsp::HoverContents::Array(items) => items.into_iter().flat_map(marked).collect(),
        lsp::HoverContents::Markup(markup) => match markup.kind {
            lsp::MarkupKind::Markdown => markdown::parse(&markup.value),
            lsp::MarkupKind::PlainText => vec![Block::Paragraph(markdown::Inline::plain(markup.value))],
        },
    }
}

/// Documentation (completion items, signatures) as markdown blocks.
pub(crate) fn documentation_blocks(documentation: &lsp::Documentation) -> Vec<Block> {
    match documentation {
        lsp::Documentation::String(text) => vec![Block::Paragraph(markdown::Inline::plain(text.clone()))],
        lsp::Documentation::MarkupContent(markup) => match markup.kind {
            lsp::MarkupKind::Markdown => markdown::parse(&markup.value),
            lsp::MarkupKind::PlainText => vec![Block::Paragraph(markdown::Inline::plain(markup.value.clone()))],
        },
    }
}

fn hierarchy_location(uri: &lsp::Url, range: lsp::Range) -> Option<FileLocation> {
    Some(FileLocation { path: lsp_client::uri::to_path(uri)?, range })
}

/// The actions a server offered, without the ones it marks disabled.
fn enabled_actions(response: Option<lsp::CodeActionResponse>) -> Vec<lsp::CodeActionOrCommand> {
    response.unwrap_or_default().into_iter().filter(|action| !matches!(action, lsp::CodeActionOrCommand::CodeAction(action) if action.disabled.is_some())).collect()
}

#[cfg(test)]
mod format_tests {
    use super::changed_span;

    #[test]
    fn changed_span_covers_only_the_difference() {
        assert_eq!(changed_span("same", "same"), None);
        assert_eq!(changed_span("fn a(){}\n", "fn a() {}\n"), Some((6..6, " ".into())));
        assert_eq!(changed_span("let x=1;", "let x = 1;"), Some((5..6, " = ".into())));
        assert_eq!(changed_span("é1", "é2"), Some((2..3, "2".into())));
        assert_eq!(changed_span("aa", "a"), Some((1..2, String::new())));
    }
}

#[cfg(test)]
mod lightbulb_tests {
    use super::{Lightbulb, enabled_actions, lsp};

    fn action(title: &str, kind: Option<&str>, disabled: bool) -> lsp::CodeActionOrCommand {
        lsp::CodeActionOrCommand::CodeAction(lsp::CodeAction {
            title: title.into(),
            kind: kind.map(|kind| lsp::CodeActionKind::from(kind.to_string())),
            disabled: disabled.then(|| lsp::CodeActionDisabled { reason: "not here".into() }),
            ..Default::default()
        })
    }

    #[test]
    fn disabled_actions_are_dropped_and_quick_fixes_tint_the_bulb() {
        let actions = enabled_actions(Some(vec![
            action("Extract function", Some("refactor.extract"), false),
            action("Inline", Some("refactor.inline"), true),
            lsp::CodeActionOrCommand::Command(lsp::Command { title: "Organize imports".into(), command: "organize".into(), arguments: None }),
        ]));
        assert_eq!(actions.len(), 2);
        assert!(!Lightbulb { line: 0, actions: actions.clone() }.has_quick_fix());
        let mut with_fix = actions;
        with_fix.push(action("Import HashMap", Some("quickfix"), false));
        assert!(Lightbulb { line: 3, actions: with_fix }.has_quick_fix());
        assert!(enabled_actions(None).is_empty());
    }
}
