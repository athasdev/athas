//! Inline edit (Cmd-K, `editor.inlineEdit`): a small prompt the editor floats over a selection.
//! The user says what to change, the replacement streams in with a diff against the selection,
//! and Accept hands it to the editor to apply.
//!
//! # For the editor
//!
//! - On `editor.inlineEdit` with a selection, build an [`InlineEditRequest`] (`path`,
//!   `language_id`, `selection_text`, `before` and `after` the selection) and embed
//!   `cx.new(|cx| InlineEditPrompt::new(request, window, cx))` under the selection's first line;
//!   focus it with `prompt.focus(window, cx)`.
//! - [`InlineEditEvent::Streaming`] carries the replacement so far, and
//!   [`InlineEditEvent::Proposal`] the finished proposal to preview in the buffer; [`InlineEditEvent::Accepted`] carries the final replacement (and [`InlineEdit`] with
//!   its line diff): replace the selection with it in one undoable edit, then drop the prompt.
//!   On [`InlineEditEvent::Dismissed`] drop the prompt and leave the buffer alone.
//! - If the buffer changed under the selection while the edit ran, map the range with
//!   [`rebase_range`]; `None` means the selection was edited and the result should be dropped.
//!
//! Ported from Athas's `inline-edit/hooks/use-inline-edit.ts`, `components/inline-edit-popover.tsx`
//! and `utils/inline-edit-rebase.ts`.

use std::ops::Range;

use std::sync::Arc;

use ai_providers::{InlineEditor, SecretStore};
use futures::StreamExt as _;
use ui::scale::px;
use gpui::{
    App, AppContext as _, ClickEvent, Context, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, ParentElement, Render, Styled,
    Subscription, Task, Window, div, prelude::*,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, TextInput, TextInputEvent, metrics, typography};

pub use ai_providers::InlineEditRequest;

use crate::diff::{self, DiffRow, LineKind};

/// Diff lines shown in the prompt at most.
const PREVIEW_LINES: usize = 14;
const INSTRUCTION_LIMIT: usize = 2000;
const DEFAULT_INSTRUCTION: &str = "Improve this code while preserving behavior.";

/// The instruction that revises a proposal (`composeInlineEditFollowUp`): the selection sent is the
/// previous proposal, and the original request stays, cut to fit.
/// Why the hosted endpoint or the user's own key may not be used (`use-inline-edit.ts`): hosted
/// edits need a signed-in account, and a managed organization can turn either path off.
const ACCOUNT_CHANGED: &str = "The active account or team changed. Try again.";

/// Who asks: the signed-in user and the intelligence scope (personal or a team), which must be
/// the same when the answer comes back as when the request went out.
fn identity(cx: &App) -> (Option<i64>, Option<String>) {
    let user = account::AccountStore::global(cx).and_then(|store| store.read(cx).user().map(|user| user.id));
    let scope = crate::intelligence_sync::global(cx).map(|sync| sync.read(cx).scope().to_string());
    (user, scope)
}

pub fn access_problem(hosted: bool, signed_in: bool, policy: Option<&account::api::EnterprisePolicy>) -> Option<&'static str> {
    if hosted && !signed_in {
        return Some("Sign in to use Athas AI.");
    }
    match policy {
        Some(policy) if hosted && !policy.ai_completion_enabled => Some("Inline edit is disabled by your organization policy."),
        Some(policy) if !hosted && !policy.allow_byok => Some("BYOK is disabled by your organization policy."),
        _ => None,
    }
}

pub fn compose_follow_up(previous: &str, follow_up: &str) -> String {
    let suffix = format!(" The selection is your previous proposal. Revise it: {follow_up}");
    let budget = INSTRUCTION_LIMIT.saturating_sub(suffix.chars().count() + 20);
    let previous = if previous.chars().count() > budget { format!("{}...", previous.chars().take(budget.saturating_sub(3)).collect::<String>()) } else { previous.to_string() };
    format!("Original request: {previous}.{suffix}").chars().take(INSTRUCTION_LIMIT).collect()
}

/// A finished inline edit: the selection, what replaces it, and the line diff between them.
#[derive(Clone, Debug, PartialEq)]
pub struct InlineEdit {
    pub original: String,
    pub replacement: String,
    pub hunks: Vec<crate::review::Hunk>,
}

impl InlineEdit {
    pub fn new(original: String, replacement: String) -> Self {
        let hunks = crate::review::hunks::compute(&original, &replacement);
        Self { original, replacement, hunks }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum InlineEditEvent {
    /// The replacement so far, while it streams.
    Streaming(String),
    /// The proposal to preview in the buffer, or `None` to stop previewing.
    Proposal(Option<String>),
    /// Apply this to the selection.
    Accepted(InlineEdit),
    /// Escape or Reject: leave the buffer as it is.
    Dismissed,
}

enum State {
    Idle,
    Running { partial: String, _task: Task<()> },
    Done(InlineEdit),
    Failed(String),
}

pub struct InlineEditPrompt {
    request: InlineEditRequest,
    secrets: Arc<dyn SecretStore>,
    input: Entity<TextInput>,
    state: State,
    /// The selection the edit started from; refining sends the proposal instead, but the diff
    /// and the accepted edit stay against this.
    original: String,
    /// What the proposal shown answers, as follow-ups build on it.
    proposal_instruction: Option<String>,
    /// The signed-in user and intelligence scope the running request started under.
    started_as: (Option<i64>, Option<String>),
    /// The model menu, while open.
    open_menu: Option<ui::OpenMenu>,
    _subscription: Subscription,
}

impl EventEmitter<InlineEditEvent> for InlineEditPrompt {}

impl Focusable for InlineEditPrompt {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}

impl InlineEditPrompt {
    pub fn new(request: InlineEditRequest, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| {
            let mut input = TextInput::new(window, cx).placeholder("Edit selection: describe the change…").leading_icon(IconName::Sparkle);
            if !request.instruction.is_empty() {
                input.set_text(request.instruction.clone(), cx);
            }
            input
        });
        let subscription = cx.subscribe(&input, |this, _, event: &TextInputEvent, cx| match event {
            TextInputEvent::Confirmed => this.confirm(cx),
            TextInputEvent::Cancelled => this.dismiss(cx),
            TextInputEvent::Changed(_) => cx.notify(),
            _ => {}
        });
        let original = request.selection_text.clone();
        Self { request, secrets: Arc::new(crate::ai_settings::KeychainRef), input, state: State::Idle, original, proposal_instruction: None, started_as: (None, None), open_menu: None, _subscription: subscription }
    }

    /// Reads API keys from `secrets` instead of the keychain (for headless renders and tests).
    pub fn with_secrets(mut self, secrets: Arc<dyn SecretStore>) -> Self {
        self.secrets = secrets;
        self
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        let handle = self.input.read(cx).focus_handle(cx);
        handle.focus(window, cx);
    }

    pub fn request(&self) -> &InlineEditRequest {
        &self.request
    }

    pub fn is_running(&self) -> bool {
        matches!(self.state, State::Running { .. })
    }

    /// Enter: run the instruction; with a proposal shown, refine it with what was typed, or
    /// accept it when nothing was.
    fn confirm(&mut self, cx: &mut Context<Self>) {
        let typed = self.input.read(cx).text().trim().to_string();
        match &self.state {
            State::Done(_) if typed.is_empty() => self.accept(cx),
            State::Done(_) => self.refine(cx),
            State::Running { .. } => {}
            _ => self.run(cx),
        }
    }

    /// Asks the AI settings' model for the replacement of the selection, streaming it in.
    pub fn run(&mut self, cx: &mut Context<Self>) {
        let typed = self.input.read(cx).text().trim().to_string();
        let instruction = if typed.is_empty() { DEFAULT_INSTRUCTION.to_string() } else { typed };
        self.request.selection_text = self.original.clone();
        self.request.instruction = instruction.clone();
        self.start(instruction, cx);
    }

    /// A follow-up on the proposal shown: the model revises its own proposal.
    pub fn refine(&mut self, cx: &mut Context<Self>) {
        let State::Done(edit) = &self.state else { return };
        let follow_up = self.input.read(cx).text().trim().to_string();
        if follow_up.is_empty() {
            return;
        }
        let previous = self.proposal_instruction.clone().unwrap_or_default();
        self.request.selection_text = edit.replacement.clone();
        self.request.instruction = compose_follow_up(&previous, &follow_up);
        self.start(format!("{previous}. Then: {follow_up}"), cx);
    }

    /// Runs the request as it stands again.
    pub fn retry(&mut self, cx: &mut Context<Self>) {
        let instruction = self.proposal_instruction.clone().unwrap_or_else(|| self.request.instruction.clone());
        self.start(instruction, cx);
    }

    fn start(&mut self, instruction: String, cx: &mut Context<Self>) {
        let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
        let provider = crate::intelligence::task_provider(&settings, "inline-edit");
        if provider.model_id.trim().is_empty() && provider.custom_model_id.trim().is_empty() {
            self.state = State::Failed("Select an inline edit model.".into());
            cx.notify();
            return;
        }
        let request = self.request.clone();
        let secrets = self.secrets.clone();
        self.started_as = identity(cx);
        let team_problem = crate::intelligence_sync::global(cx).and_then(|sync| {
            let sync = sync.read(cx);
            (sync.scope() != crate::intelligence_sync::PERSONAL && (sync.is_loading() || sync.error().is_some())).then_some("Team settings are unavailable. Select personal settings or reconnect.")
        });
        let (signed_in, policy) = account::AccountStore::global(cx).map_or((false, None), |store| {
            let store = store.read(cx);
            (store.is_signed_in(), store.subscription().and_then(|subscription| subscription.enterprise.policy.clone()).filter(|policy| policy.managed_mode))
        });
        let (partials_tx, mut partials) = futures::channel::mpsc::unbounded::<String>();
        let work = cx.background_spawn(async move {
            if let Some(problem) = team_problem {
                return Err(ai_providers::CompletionError::Failed(problem.into()));
            }
            let editor = InlineEditor::resolve(&provider, secrets.as_ref())?;
            access_problem(editor.connection().provider.is_hosted(), signed_in, policy.as_ref()).map_or(Ok(()), |problem| Err(ai_providers::CompletionError::Failed(problem.into())))?;
            editor
                .edit(&request, |text| {
                    let _ = partials_tx.unbounded_send(text.to_string());
                })
                .await
        });
        let timeout = cx.background_executor().timer(ai_providers::TextFeature::InlineEdit.timeout());
        let task = cx.spawn(async move |this, cx| {
            let mut work = std::pin::pin!(futures::FutureExt::fuse(work));
            let mut timeout = std::pin::pin!(futures::FutureExt::fuse(timeout));
            loop {
                futures::select! {
                    _ = timeout => {
                        let error = ai_providers::CompletionError::Failed(ai_providers::inline_edit::TIMED_OUT.into());
                        this.update(cx, |this, cx| this.finished(Err(error), instruction.clone(), cx)).ok();
                        return;
                    }
                    partial = partials.next() => {
                        let Some(partial) = partial else { continue };
                        let alive = this.update(cx, |this, cx| {
                            if let State::Running { partial: shown, .. } = &mut this.state {
                                *shown = partial.clone();
                            }
                            cx.emit(InlineEditEvent::Streaming(partial));
                            cx.notify();
                        });
                        if alive.is_err() {
                            return;
                        }
                    }
                    result = work => {
                        this.update(cx, |this, cx| this.finished(result, instruction.clone(), cx)).ok();
                        return;
                    }
                }
            }
        });
        self.state = State::Running { partial: String::new(), _task: task };
        cx.notify();
    }

    fn finished(&mut self, result: Result<String, ai_providers::CompletionError>, instruction: String, cx: &mut Context<Self>) {
        let result = if identity(cx) == self.started_as { result } else { Err(ai_providers::CompletionError::Failed(ACCOUNT_CHANGED.into())) };
        self.state = match result {
            Ok(replacement) if replacement.trim().is_empty() => State::Failed("The model returned nothing. Try another instruction.".into()),
            Ok(replacement) => State::Done(InlineEdit::new(self.original.clone(), replacement)),
            Err(error) => State::Failed(error.to_string()),
        };
        let proposal = match &self.state {
            State::Done(edit) => Some(edit.replacement.clone()),
            _ => None,
        };
        cx.emit(InlineEditEvent::Proposal(proposal));
        if matches!(self.state, State::Done(_)) {
            self.proposal_instruction = Some(instruction);
            self.input.update(cx, |input, cx| {
                input.set_text("", cx);
                input.set_placeholder("Refine, e.g. make it shorter…", cx);
            });
        }
        cx.notify();
    }

    pub fn accept(&mut self, cx: &mut Context<Self>) {
        if let State::Done(edit) = &self.state {
            cx.emit(InlineEditEvent::Accepted(edit.clone()));
        }
    }

    pub fn dismiss(&mut self, cx: &mut Context<Self>) {
        self.state = State::Idle;
        cx.emit(InlineEditEvent::Dismissed);
    }

    fn render_preview(&self, original: &str, replacement: &str, cx: &App) -> impl IntoElement + use<> {
        let colors = cx.theme().colors.clone();
        let theme = cx.theme().clone();
        let path = std::path::Path::new(&self.request.path);
        let (old_spans, new_spans) = (line_spans(path, original), line_spans(path, replacement));
        let rows = diff::diff_rows(original, replacement);
        let hidden = rows.len().saturating_sub(PREVIEW_LINES);
        let (mut old_line, mut new_line) = (0usize, 0usize);
        let mut spans_of = move |row: &DiffRow| -> Vec<(Range<usize>, editor::SyntaxKind)> {
            match row {
                DiffRow::Line { kind: LineKind::Removed, .. } => {
                    old_line += 1;
                    old_spans.get(old_line - 1).cloned().unwrap_or_default()
                }
                DiffRow::Line { kind: LineKind::Added, .. } => {
                    new_line += 1;
                    new_spans.get(new_line - 1).cloned().unwrap_or_default()
                }
                DiffRow::Line { kind: LineKind::Context, .. } => {
                    old_line += 1;
                    new_line += 1;
                    new_spans.get(new_line - 1).cloned().unwrap_or_default()
                }
                DiffRow::Skipped(count) => {
                    old_line += count;
                    new_line += count;
                    Vec::new()
                }
            }
        };
        let lines = rows.into_iter().take(PREVIEW_LINES).map(move |row| {
            let spans = spans_of(&row);
            match row {
            DiffRow::Line { kind, text } => {
                let (sign, bg, fg) = match kind {
                    LineKind::Added => ("+", Some(colors.git_added.opacity(0.14)), colors.foreground),
                    LineKind::Removed => ("-", Some(colors.git_deleted.opacity(0.14)), colors.foreground),
                    LineKind::Context => (" ", None, colors.muted_foreground),
                };
                div()
                    .flex()
                    .min_w_full()
                    .px(px(8.))
                    .when_some(bg, |this, bg| this.bg(bg))
                    .text_color(fg)
                    .whitespace_nowrap()
                    .child(div().w(px(14.)).flex_none().text_color(colors.subtle_foreground).child(sign))
                    .child(styled_code_line(&text, &spans, &theme))
                    .into_any_element()
            }
            DiffRow::Skipped(count) => div().px(px(8.)).text_color(colors.subtle_foreground).child(format!("⋯ {count} unchanged")).into_any_element(),
            }
        });
        div()
            .id("inline-edit-preview")
            .max_h(px(260.))
            .overflow_y_scroll()
            .rounded(metrics::radius_md())
            .border_1()
            .border_color(cx.theme().colors.border)
            .py(px(4.))
            .font_family(typography::MONO_FONT)
            .text_size(typography::text_caption())
            .line_height(px(17.))
            .child(div().flex().flex_col().min_w_full().children(lines))
            .when(hidden > 0, |this| this.child(div().px(px(8.)).text_color(cx.theme().colors.subtle_foreground).child(format!("{hidden} more lines"))))
    }
}

/// Syntax spans of each line of `text`, by `path`'s language, relative to the line.
type LineSpans = Vec<Vec<(Range<usize>, editor::SyntaxKind)>>;

/// The preview redraws on every keystroke and streamed chunk; the last few highlights are kept
/// so the same text is highlighted once.
fn line_spans(path: &std::path::Path, text: &str) -> LineSpans {
    use std::hash::{Hash, Hasher};
    thread_local! {
        static CACHE: std::cell::RefCell<std::collections::VecDeque<(u64, std::rc::Rc<LineSpans>)>> = Default::default();
    }
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (path, text).hash(&mut hasher);
    let key = hasher.finish();
    if let Some(spans) = CACHE.with(|cache| cache.borrow().iter().find(|(cached, _)| *cached == key).map(|(_, spans)| spans.clone())) {
        return (*spans).clone();
    }
    let spans = split_line_spans(editor::highlight_snippet(path, text), text);
    CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        cache.push_back((key, std::rc::Rc::new(spans.clone())));
        if cache.len() > 8 {
            cache.pop_front();
        }
    });
    spans
}

/// `spans` of `text` split per line, relative to the line.
pub(crate) fn split_line_spans(spans: Vec<(Range<usize>, editor::SyntaxKind)>, text: &str) -> Vec<Vec<(Range<usize>, editor::SyntaxKind)>> {
    let starts: Vec<usize> = std::iter::once(0).chain(text.match_indices('\n').map(|(at, _)| at + 1)).collect();
    let mut lines = vec![Vec::new(); starts.len()];
    for (range, kind) in spans {
        let index = starts.partition_point(|start| *start <= range.start).saturating_sub(1);
        let line_start = starts[index];
        let line_end = starts.get(index + 1).map_or(text.len(), |next| next - 1);
        let clipped = range.start.max(line_start)..range.end.min(line_end);
        if !clipped.is_empty() {
            lines[index].push((clipped.start - line_start..clipped.end - line_start, kind));
        }
    }
    lines
}

/// A code line in syntax colours, tabs shown as four spaces.
pub(crate) fn styled_code_line(text: &str, spans: &[(Range<usize>, editor::SyntaxKind)], theme: &theme::Theme) -> gpui::StyledText {
    gpui::StyledText::new(code_line_text(text)).with_highlights(code_line_highlights(text, spans, theme))
}

/// What a code line draws: a tab takes four columns.
pub(crate) fn code_line_text(text: &str) -> String {
    text.replace('\t', "    ")
}

/// The syntax colours of a code line, over the offsets of [`code_line_text`], so a caller that
/// has more to highlight (the transcript's selection) can add to them.
pub(crate) fn code_line_highlights(text: &str, spans: &[(Range<usize>, editor::SyntaxKind)], theme: &theme::Theme) -> Vec<(Range<usize>, gpui::HighlightStyle)> {
    let expanded = |offset: usize| text[..offset.min(text.len())].matches('\t').count() * 3 + offset.min(text.len());
    spans
        .iter()
        .filter(|(range, _)| text.is_char_boundary(range.start.min(text.len())) && text.is_char_boundary(range.end.min(text.len())))
        .map(|(range, kind)| (expanded(range.start)..expanded(range.end), gpui::HighlightStyle { color: Some(kind.color(theme)), ..Default::default() }))
        .collect()
}

/// Maps the `range` of `previous` (byte offsets) onto `next` when the change between the two did
/// not touch it; `None` when it did, so the result should not be applied.
pub fn rebase_range(previous: &str, next: &str, range: Range<usize>) -> Option<Range<usize>> {
    if previous == next {
        return Some(range);
    }
    let prefix = previous.bytes().zip(next.bytes()).take_while(|(a, b)| a == b).count();
    let max_suffix = previous.len().min(next.len()) - prefix;
    let suffix = previous.bytes().rev().zip(next.bytes().rev()).take(max_suffix).take_while(|(a, b)| a == b).count();
    let (changed_start, changed_end) = (prefix, previous.len() - suffix);
    let original = previous.get(range.clone())?;
    let delta = next.len() as isize - previous.len() as isize;
    let mut candidates = Vec::new();
    if changed_end <= range.start {
        candidates.push(((range.start as isize + delta) as usize)..((range.end as isize + delta) as usize));
    }
    if changed_start >= range.end {
        candidates.push(range.clone());
    }
    candidates.into_iter().find(|candidate| next.get(candidate.clone()) == Some(original))
}

impl Render for InlineEditPrompt {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let (status, preview): (Option<gpui::AnyElement>, Option<gpui::AnyElement>) = match &self.state {
            State::Idle => (None, None),
            State::Running { partial, .. } => (
                Some(div().text_color(colors.subtle_foreground).child("Editing…").into_any_element()),
                (!partial.is_empty()).then(|| self.render_preview(&self.original, partial, cx).into_any_element()),
            ),
            State::Done(edit) => {
                let (added, removed) = crate::review::hunks::count_lines(&edit.hunks);
                (
                    Some(
                        div()
                            .flex()
                            .gap(px(6.))
                            .child(div().text_color(colors.git_added).child(format!("+{added}")))
                            .child(div().text_color(colors.git_deleted).child(format!("−{removed}")))
                            .into_any_element(),
                    ),
                    Some(self.render_preview(&edit.original, &edit.replacement, cx).into_any_element()),
                )
            }
            State::Failed(error) => (
                Some(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .text_color(colors.destructive)
                        .child(Icon::new(IconName::WarningCircle).size(IconSize::XSmall).color(colors.destructive))
                        .child(error.clone())
                        .into_any_element(),
                ),
                None,
            ),
        };
        let done = matches!(self.state, State::Done(_));
        let refining = done && !self.input.read(cx).text().trim().is_empty();
        let running = self.is_running();
        let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
        let model_label = match crate::intelligence::task_connection(&settings, "inline-edit") {
            Some(_) => crate::intelligence::connection_label(&settings, "inline-edit", &crate::intelligence::connection_choices(cx)),
            None => {
                let provider = crate::builtin::provider_settings(&settings);
                let choices = crate::intelligence::connection_choices(cx);
                let value = format!("{}::{}", provider.provider_id, provider.model_id);
                choices.iter().find(|(id, _)| *id == value).map_or_else(
                    || {
                        let name = ai_providers::catalog::provider(&provider.provider_id).map_or(provider.provider_id.as_str(), |provider| provider.name);
                        let model = if provider.model_id == "auto" { "Automatic" } else { provider.model_id.as_str() };
                        format!("{name} · {model}")
                    },
                    |(_, name)| name.clone(),
                )
            }
        };
        let model_picker = Button::new("inline-edit-model", model_label)
            .variant(ButtonVariant::Ghost)
            .size(ButtonSize::XSmall)
            .regular_weight()
            .shrinkable()
            .trailing_icon(IconName::ChevronDown)
            .disabled(running)
            .tooltip("Inline edit model")
            .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                // Only providers with a key (or none needed) are offered, as the original's
                // picker lists them; the keychain is read off the main thread.
                let position = event.position();
                let secrets = this.secrets.clone();
                cx.spawn_in(window, async move |this, cx| {
                    let connected = cx.background_spawn(async move { crate::intelligence::connected_providers(secrets.as_ref()) }).await;
                    this.update_in(cx, |this, window, cx| {
                        let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
                        let entries = crate::intelligence::connection_entries(&settings, "inline-edit", &crate::intelligence::connection_choices(cx), |provider| crate::intelligence::is_connected(&connected, provider));
                        let menu = ui::OpenMenu::new("inline-edit-model", entries, position, gpui::Anchor::TopLeft, window, cx, |this, _| this.open_menu = None);
                        this.open_menu = Some(menu.searchable("Select a model…", "No matching models", cx));
                        cx.notify();
                    })
                    .ok();
                })
                .detach();
            }));
        div()
            .id("inline-edit")
            .key_context("InlineEdit")
            .w(px(520.))
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(8.))
            .rounded(metrics::radius_lg())
            .border_1()
            .border_color(colors.border)
            .bg(colors.overlay)
            .shadow(cx.theme().shadows.popover.clone())
            .font_family(typography::UI_FONT)
            .text_size(typography::text_sm())
            .text_color(colors.foreground)
            .child(self.input.clone())
            .children(preview)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .child(div().min_w_0().max_w(px(200.)).child(model_picker))
                    .children(status)
                    .child(div().flex_1())
                    .when(running, |this| {
                        this.child(
                            Button::new("inline-edit-stop", "Stop")
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::XSmall)
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                                    this.state = State::Idle;
                                    cx.notify();
                                })),
                        )
                    })
                    .when(!running, |this| {
                        this.child(
                            Button::new("inline-edit-dismiss", if done { "Reject" } else { "Cancel" })
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::XSmall)
                                .shortcut("⎋")
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.dismiss(cx))),
                        )
                    })
                    .when(done, |this| {
                        this.child(
                            Button::new("inline-edit-retry", "Retry")
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::XSmall)
                                .leading_icon(IconName::ArrowClockwise)
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.retry(cx))),
                        )
                        .when(refining, |this| {
                            this.child(
                                Button::new("inline-edit-refine", "Refine")
                                    .variant(ButtonVariant::Outline)
                                    .size(ButtonSize::XSmall)
                                    .shortcut("↩")
                                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.refine(cx))),
                            )
                        })
                        .child(
                            Button::new("inline-edit-accept", "Accept")
                                .variant(ButtonVariant::Accent)
                                .size(ButtonSize::XSmall)
                                .when(!refining, |this| this.shortcut("↩"))
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.accept(cx))),
                        )
                    })
                    .when(!done && !running, |this| {
                        this.child(
                            Button::new("inline-edit-run", "Edit")
                                .variant(ButtonVariant::Accent)
                                .size(ButtonSize::XSmall)
                                .shortcut("↩")
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.run(cx))),
                        )
                    }),
            )
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_move_with_edits_elsewhere_and_fail_on_edits_inside() {
        let previous = "aaa SELECT bbb";
        let range = 4..10;
        assert_eq!(rebase_range(previous, "xx aaa SELECT bbb", range.clone()), Some(7..13));
        assert_eq!(rebase_range(previous, "aaa SELECT bbbccc", range.clone()), Some(4..10));
        assert_eq!(rebase_range(previous, "aaa SELxECT bbb", range.clone()), None);
        assert_eq!(rebase_range(previous, previous, range.clone()), Some(range));
    }

    #[test]
    fn hosted_edits_need_an_account_and_policies_can_turn_either_path_off() {
        assert_eq!(access_problem(true, false, None), Some("Sign in to use Athas AI."));
        assert_eq!(access_problem(true, true, None), None);
        let policy = account::api::EnterprisePolicy { managed_mode: true, allow_byok: false, ai_completion_enabled: true, ..Default::default() };
        assert_eq!(access_problem(true, true, Some(&policy)), None);
        assert_eq!(access_problem(false, false, Some(&policy)), Some("BYOK is disabled by your organization policy."));
        let policy = account::api::EnterprisePolicy { managed_mode: true, allow_byok: true, ..Default::default() };
        assert_eq!(access_problem(true, true, Some(&policy)), Some("Inline edit is disabled by your organization policy."));
    }

    #[test]
    fn follow_ups_keep_the_original_request() {
        assert_eq!(compose_follow_up("Add types", "shorter"), "Original request: Add types. The selection is your previous proposal. Revise it: shorter");
        let long = "x".repeat(3000);
        let composed = compose_follow_up(&long, "shorter");
        assert!(composed.chars().count() <= INSTRUCTION_LIMIT);
        assert!(composed.ends_with("Revise it: shorter"));
    }

    #[test]
    fn finished_edits_carry_their_line_diff() {
        let edit = InlineEdit::new("fn a() {\n    1\n}".into(), "fn a() -> i32 {\n    1\n}".into());
        assert_eq!(edit.hunks.len(), 1);
        assert_eq!(edit.hunks[0].current_lines, ["fn a() -> i32 {"]);
    }
}
