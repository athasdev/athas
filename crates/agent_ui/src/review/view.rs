//! The "Review changes" centre view (kind `agent-review`, id = session id): every unreviewed hunk
//! a session's agent wrote, grouped by file, with keep and reject per hunk, per file and for
//! everything. It sits beside the editor as a tab, so files stay open while the review is.
//!
//! Drawn after Athas's `components/chat/agent-edits-review.tsx`.

use ui::WithScrollbar as _;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use gpui::{
    AnyElement, App, ClickEvent, Context, FocusHandle, Focusable, IntoElement, KeyBinding, ParentElement, Render, Styled, Subscription,
    Task, Window, div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, metrics, pane_header, typography};

use super::{
    FileReview, Hunk, KeepAgentHunk, KeepAllAgentChanges, RejectAgentHunk, RejectAllAgentChanges, ReviewAction, ReviewEvent,
    hunks::{self, PreviewLine},
};
use crate::diff::LineKind;

gpui::actions!(ai, [NextAgentHunk, PreviousAgentHunk]);

const CONTEXT_LINES: usize = 2;
const KEY_CONTEXT: &str = "AgentReview";

pub(crate) fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-y", KeepAgentHunk, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-n", RejectAgentHunk, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-shift-y", KeepAllAgentChanges, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-shift-n", RejectAllAgentChanges, Some(KEY_CONTEXT)),
        KeyBinding::new("down", NextAgentHunk, Some(KEY_CONTEXT)),
        KeyBinding::new("j", NextAgentHunk, Some(KEY_CONTEXT)),
        KeyBinding::new("up", PreviousAgentHunk, Some(KEY_CONTEXT)),
        KeyBinding::new("k", PreviousAgentHunk, Some(KEY_CONTEXT)),
    ]);
}

pub struct ReviewView {
    session: String,
    title: String,
    files: Vec<FileReview>,
    root: Option<PathBuf>,
    /// The hunk Cmd-Y and Cmd-N act on: file and hunk index.
    selected: Option<(usize, usize)>,
    collapsed: HashSet<PathBuf>,
    notice: Option<String>,
    working: Option<Task<()>>,
    focus: FocusHandle,
    _subscription: Subscription,
}

impl Focusable for ReviewView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl ReviewView {
    /// The review of `session`'s changes; `title` names the session in the header.
    pub fn new(session: String, title: String, cx: &mut Context<Self>) -> Self {
        let events = super::events(cx);
        let subscription = cx.subscribe(&events, |this: &mut Self, _, event: &ReviewEvent, cx| {
            if event.session == this.session {
                this.reload(cx);
            }
        });
        let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
        let mut this = Self {
            session,
            title,
            files: Vec::new(),
            root: None,
            selected: None,
            collapsed: HashSet::new(),
            notice: None,
            working: None,
            focus: cx.focus_handle(),
            _subscription: subscription,
        };
        this.reload(cx);
        this
    }

    /// The review for a session id alone: the title comes from its saved transcript.
    pub fn for_session(session: String, cx: &mut Context<Self>) -> Self {
        let title = crate::persistence::sessions_dir()
            .and_then(|dir| crate::persistence::load(&dir, &session))
            .map(|transcript| crate::history::transcript_title(&transcript))
            .unwrap_or_else(|| "Agent session".to_string());
        Self::new(session, title, cx)
    }

    pub fn session(&self) -> &str {
        &self.session
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        self.files = super::files(&self.session);
        self.root = common_root(self.files.iter().map(|file| file.path.as_path()));
        let total: usize = self.files.iter().map(|file| file.hunks.len()).sum();
        self.selected = match self.selected {
            _ if total == 0 => None,
            Some((file, hunk)) if self.files.get(file).is_some_and(|candidate| hunk < candidate.hunks.len()) => Some((file, hunk)),
            Some((file, _)) if file < self.files.len() => Some((file, 0)),
            _ => Some((0, 0)),
        };
        cx.notify();
    }

    fn run(&mut self, action: ReviewAction, cx: &mut Context<Self>) {
        let task = super::apply(self.session.clone(), action, cx);
        self.working = Some(cx.spawn(async move |this, cx| {
            let outcome = task.await;
            this.update(cx, |this, cx| {
                this.working = None;
                this.notice = (!outcome.notices.is_empty()).then(|| outcome.notices.join(". "));
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    fn selected_hunk(&self) -> Option<(PathBuf, Hunk)> {
        let (file, hunk) = self.selected?;
        let file = self.files.get(file)?;
        Some((file.path.clone(), file.hunks.get(hunk)?.clone()))
    }

    fn keep_selected(&mut self, _: &KeepAgentHunk, _: &mut Window, cx: &mut Context<Self>) {
        if let Some((path, hunk)) = self.selected_hunk() {
            self.run(ReviewAction::KeepHunk { path, hunk }, cx);
        }
    }

    fn reject_selected(&mut self, _: &RejectAgentHunk, _: &mut Window, cx: &mut Context<Self>) {
        if let Some((path, hunk)) = self.selected_hunk() {
            self.run(ReviewAction::RejectHunk { path, hunk }, cx);
        }
    }

    fn keep_all(&mut self, _: &KeepAllAgentChanges, _: &mut Window, cx: &mut Context<Self>) {
        self.run(ReviewAction::KeepAll, cx);
    }

    fn reject_all(&mut self, _: &RejectAllAgentChanges, _: &mut Window, cx: &mut Context<Self>) {
        self.run(ReviewAction::RejectAll, cx);
    }

    fn flat(&self) -> Vec<(usize, usize)> {
        self.files.iter().enumerate().flat_map(|(file, review)| (0..review.hunks.len()).map(move |hunk| (file, hunk))).collect()
    }

    fn step(&mut self, forward: bool, cx: &mut Context<Self>) {
        let flat = self.flat();
        if flat.is_empty() {
            return;
        }
        let position = self.selected.and_then(|selected| flat.iter().position(|candidate| *candidate == selected));
        let next = match (position, forward) {
            (None, _) => 0,
            (Some(position), true) => (position + 1).min(flat.len() - 1),
            (Some(position), false) => position.saturating_sub(1),
        };
        self.selected = Some(flat[next]);
        cx.notify();
    }

    fn open(path: PathBuf, line: Option<u32>, cx: &mut App) {
        workbench_api::open_file(cx, path, line);
    }

    fn render_line(line: &PreviewLine, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let (sign, bg, fg) = match line.kind {
            LineKind::Added => ("+", Some(colors.git_added.opacity(0.14)), colors.foreground),
            LineKind::Removed => ("-", Some(colors.git_deleted.opacity(0.14)), colors.foreground),
            LineKind::Context => (" ", None, colors.muted_foreground),
        };
        let number = line.new_line.or(line.old_line).map(|number| number.to_string()).unwrap_or_default();
        div()
            .flex()
            .min_w_full()
            .when_some(bg, |this, bg| this.bg(bg))
            .text_color(fg)
            .whitespace_nowrap()
            .child(div().w(px(40.)).flex_none().pr(px(8.)).text_right().text_color(colors.subtle_foreground).child(number))
            .child(div().w(px(14.)).flex_none().text_color(colors.subtle_foreground).child(sign))
            .child(line.text.replace('\t', "    "))
            .into_any_element()
    }

    fn render_hunk(&self, file_index: usize, hunk_index: usize, file: &FileReview, hunk: &Hunk, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let selected = self.selected == Some((file_index, hunk_index));
        let id = file_index * 10_000 + hunk_index;
        let lines = hunks::preview(&file.current, hunk, CONTEXT_LINES);
        let (keep_path, reject_path, open_path) = (file.path.clone(), file.path.clone(), file.path.clone());
        let (keep_hunk, reject_hunk) = (hunk.clone(), hunk.clone());
        let line = hunk.line();
        let summary = match (hunk.base_lines.len(), hunk.current_lines.len()) {
            (0, added) => format!("Line {line} · {added} added"),
            (removed, 0) => format!("Line {line} · {removed} removed"),
            (removed, added) => format!("Line {line} · {added} added, {removed} removed"),
        };
        div()
            .id(("review-hunk", id))
            .w_full()
            .rounded(metrics::RADIUS_LG)
            .border_1()
            .border_color(if selected { colors.primary } else { colors.border })
            .overflow_hidden()
            .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                this.selected = Some((file_index, hunk_index));
                window.focus(&this.focus, cx);
                cx.notify();
            }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .h(px(30.))
                    .px(px(8.))
                    .bg(colors.raised)
                    .border_b_1()
                    .border_color(colors.border)
                    .child(
                        div()
                            .id(("hunk-line", id))
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(typography::TEXT_CAPTION)
                            .text_color(colors.muted_foreground)
                            .hover(|style| style.text_color(colors.foreground))
                            .on_click(move |_, _, cx| Self::open(open_path.clone(), Some(line), cx))
                            .child(summary),
                    )
                    .child(
                        Button::new(("reject-hunk", id), "Reject")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::XSmall)
                            .leading_icon(IconName::X)
                            .when(selected, |button| button.shortcut("⌘N"))
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                                this.run(ReviewAction::RejectHunk { path: reject_path.clone(), hunk: reject_hunk.clone() }, cx)
                            })),
                    )
                    .child(
                        Button::new(("keep-hunk", id), "Keep")
                            .variant(ButtonVariant::Default)
                            .size(ButtonSize::XSmall)
                            .leading_icon(IconName::Check)
                            .when(selected, |button| button.shortcut("⌘Y"))
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                                this.run(ReviewAction::KeepHunk { path: keep_path.clone(), hunk: keep_hunk.clone() }, cx)
                            })),
                    ),
            )
            .child(
                div()
                    .id(("hunk-lines", id))
                    .overflow_x_scroll()
                    .py(px(4.))
                    .font_family(typography::MONO_FONT)
                    .text_size(typography::TEXT_CAPTION)
                    .line_height(px(17.))
                    .child(div().flex().flex_col().min_w_full().children(lines.iter().map(|line| Self::render_line(line, cx)))),
            )
            .into_any_element()
    }

    fn render_file(&self, index: usize, file: &FileReview, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let collapsed = self.collapsed.contains(&file.path);
        let toggle_path = file.path.clone();
        let (keep_path, reject_path, open_path) = (file.path.clone(), file.path.clone(), file.path.clone());
        let first_line = file.hunks.first().map(Hunk::line);
        let path = super::display_path(&file.path, self.root.as_deref());
        let hunks: Vec<AnyElement> = if collapsed {
            Vec::new()
        } else {
            file.hunks.iter().enumerate().map(|(hunk_index, hunk)| self.render_hunk(index, hunk_index, file, hunk, cx)).collect()
        };
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(6.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .h(px(30.))
                    .child(
                        div()
                            .id(("review-file", index))
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .flex_1()
                            .min_w_0()
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                                if !this.collapsed.remove(&toggle_path) {
                                    this.collapsed.insert(toggle_path.clone());
                                }
                                cx.notify();
                            }))
                            .child(Icon::new(if collapsed { IconName::ChevronRight } else { IconName::ChevronDown }).size(IconSize::XSmall).color(colors.subtle_foreground))
                            .child(Icon::new(IconName::FileCode).size(IconSize::XSmall).color(colors.subtle_foreground))
                            .child(div().min_w_0().truncate().font_weight(typography::MEDIUM).child(path))
                            .when(file.created, |this| {
                                this.child(
                                    div()
                                        .px(px(5.))
                                        .rounded(metrics::RADIUS)
                                        .bg(colors.success_soft)
                                        .text_size(typography::TEXT_CAPTION)
                                        .text_color(colors.success)
                                        .child("New"),
                                )
                            })
                            .child(
                                div()
                                    .flex()
                                    .gap(px(4.))
                                    .text_size(typography::TEXT_CAPTION)
                                    .child(div().text_color(colors.git_added).child(format!("+{}", file.added)))
                                    .child(div().text_color(colors.git_deleted).child(format!("−{}", file.removed))),
                            ),
                    )
                    .child(
                        Button::icon(("open-file", index), IconName::OpenExternal)
                            .size(ButtonSize::XSmall)
                            .tooltip("Open file")
                            .on_click(move |_, _, cx| Self::open(open_path.clone(), first_line, cx)),
                    )
                    .child(
                        Button::new(("reject-file", index), "Reject file")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::XSmall)
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.run(ReviewAction::RejectFile(reject_path.clone()), cx))),
                    )
                    .child(
                        Button::new(("keep-file", index), "Keep file")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::XSmall)
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.run(ReviewAction::KeepFile(keep_path.clone()), cx))),
                    ),
            )
            .children(hunks)
            .into_any_element()
    }
}

/// The deepest folder every path is in, for shorter rows.
fn common_root<'a>(paths: impl Iterator<Item = &'a Path>) -> Option<PathBuf> {
    let mut root: Option<PathBuf> = None;
    for path in paths {
        let parent = path.parent()?.to_path_buf();
        root = Some(match root {
            None => parent,
            Some(root) => root.ancestors().find(|ancestor| parent.starts_with(ancestor))?.to_path_buf(),
        });
    }
    root.filter(|root| root.components().count() > 1)
}

impl Render for ReviewView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let (added, removed) = self.files.iter().fold((0, 0), |(added, removed), file| (added + file.added, removed + file.removed));
        let count = self.files.len();
        let empty = self.files.is_empty();
        let body = if empty {
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .child(
                    EmptyState::new("No agent changes to review")
                        .message("Files the agent edits show up here until you keep or reject its changes.")
                        .icon(IconName::GitDiff),
                )
                .into_any_element()
        } else {
            let files: Vec<AnyElement> = self.files.iter().enumerate().map(|(index, file)| self.render_file(index, file, cx)).collect();
            div()
                .id("review-files")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .scrollbar(window, cx)
                .child(div().w_full().flex().justify_center().px(px(16.)).py(px(12.)).child(div().w_full().max_w(px(900.)).flex().flex_col().gap(px(18.)).children(files)))
                .into_any_element()
        };
        div()
            .id("agent-review")
            .key_context(KEY_CONTEXT)
            .track_focus(&self.focus)
            .on_action(cx.listener(Self::keep_selected))
            .on_action(cx.listener(Self::reject_selected))
            .on_action(cx.listener(Self::keep_all))
            .on_action(cx.listener(Self::reject_all))
            .on_action(cx.listener(|this, _: &NextAgentHunk, _, cx| this.step(true, cx)))
            .on_action(cx.listener(|this, _: &PreviousAgentHunk, _, cx| this.step(false, cx)))
            .size_full()
            .flex()
            .flex_col()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_size(typography::TEXT_BASE)
            .text_color(colors.foreground)
            .child(
                pane_header(cx)
                    .gap(px(8.))
                    .child(Icon::new(IconName::GitDiff).size(IconSize::Small).color(colors.muted_foreground))
                    .child(div().font_weight(typography::MEDIUM).flex_none().child("Review changes"))
                    .child(div().min_w_0().whitespace_nowrap().truncate().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child(self.title.clone()))
                    .child(div().flex_1())
                    .when(!empty, |this| {
                        this.child(
                            div()
                                .flex()
                                .flex_none()
                                .gap(px(6.))
                                .text_size(typography::TEXT_SM)
                                .text_color(colors.subtle_foreground)
                                .child(format!("{count} {}", if count == 1 { "file" } else { "files" }))
                                .child(div().text_color(colors.git_added).child(format!("+{added}")))
                                .child(div().text_color(colors.git_deleted).child(format!("−{removed}"))),
                        )
                        .child(
                            Button::new("reject-all", "Reject all")
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::Small)
                                .disabled(self.working.is_some())
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.run(ReviewAction::RejectAll, cx))),
                        )
                        .child(
                            Button::new("keep-all", "Keep all")
                                .variant(ButtonVariant::Accent)
                                .size(ButtonSize::Small)
                                .disabled(self.working.is_some())
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.run(ReviewAction::KeepAll, cx))),
                        )
                    }),
            )
            .when_some(self.notice.clone(), |this, notice| {
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .px(metrics::PANE_INSET)
                        .py(px(6.))
                        .bg(colors.warning_soft)
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.foreground)
                        .child(Icon::new(IconName::Warning).size(IconSize::XSmall).color(colors.warning))
                        .child(div().flex_1().min_w_0().child(notice)),
                )
            })
            .child(body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_are_shown_relative_to_the_files_common_folder() {
        let paths = [PathBuf::from("/code/app/src/a.rs"), PathBuf::from("/code/app/tests/b.rs")];
        assert_eq!(common_root(paths.iter().map(PathBuf::as_path)), Some(PathBuf::from("/code/app")));
        assert_eq!(common_root([Path::new("/a.rs")].into_iter()), None);
    }
}
