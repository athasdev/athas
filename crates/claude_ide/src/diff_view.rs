//! A change Claude Code proposed through `openDiff`, in a centre tab until the user accepts or
//! rejects it. Accepting answers Claude with the contents, which Claude then writes; rejecting or
//! closing the tab answers that the diff was rejected.
//!
//! Ported from `claude-ide-diff-review.ts` and `components/claude-diff-review-bar.tsx`.

use std::collections::HashMap;

use agent_ui::diff::{self, DiffRow, LineKind};
use ui::scale::px;
use gpui::{App, Context, FocusHandle, Focusable, Global, IntoElement, ParentElement, Render, SharedString, Styled, Window, div, prelude::*,};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonTone, ButtonVariant, IconName, PaneTitle, ScrollArea, typography};

use crate::tools::{DiffRequest, diff_answer};

pub(crate) struct PendingDiff {
    pub request: DiffRequest,
    pub old_text: String,
    pub respond: Box<dyn FnOnce(Vec<String>)>,
}

/// Diffs waiting on the user, by request id.
#[derive(Default)]
pub(crate) struct PendingDiffs(pub HashMap<String, PendingDiff>);

impl Global for PendingDiffs {}

pub(crate) fn add(diff: PendingDiff, cx: &mut App) {
    let id = diff.request.request_id.clone();
    let title = diff.request.tab_name.clone();
    cx.default_global::<PendingDiffs>().0.insert(id.clone(), diff);
    workbench_api::open_resource(cx, crate::RESOURCE_KIND, &id, &title);
}

/// Answers the diff (or drops it when `accepted` is `None`, as when Claude went away) and closes
/// its tab. False when nothing waits on `request_id`.
pub(crate) fn finish(request_id: &str, accepted: Option<bool>, cx: &mut App) -> bool {
    let Some(pending) = cx.try_global::<PendingDiffs>().is_some().then(|| cx.global_mut::<PendingDiffs>().0.remove(request_id)).flatten() else {
        return false;
    };
    if let Some(accepted) = accepted {
        (pending.respond)(diff_answer(&pending.request, accepted));
    }
    if let Some(bridge) = crate::bridge(cx) {
        bridge.close_resource(crate::RESOURCE_KIND, request_id, cx);
    }
    true
}

#[cfg(not(target_family = "wasm"))]
pub(crate) fn request_for_tab(tab_name: &str, cx: &App) -> Option<String> {
    cx.try_global::<PendingDiffs>()?.0.values().find(|diff| diff.request.tab_name == tab_name).map(|diff| diff.request.request_id.clone())
}

#[cfg(not(target_family = "wasm"))]
pub(crate) fn all_requests(cx: &App) -> Vec<String> {
    cx.try_global::<PendingDiffs>().map(|diffs| diffs.0.keys().cloned().collect()).unwrap_or_default()
}

/// `path` relative to the workspace root when it lies inside it, with forward slashes
/// (`toRelativeDisplayPath`).
pub(crate) fn relative_display_path(path: &std::path::Path, root: Option<&std::path::Path>) -> String {
    let normalize = |path: &std::path::Path| path.to_string_lossy().replace('\\', "/");
    let path = normalize(path);
    let Some(root) = root.map(normalize).filter(|root| !root.is_empty()) else { return path };
    let prefix = format!("{}/", root.trim_end_matches('/'));
    path.strip_prefix(&prefix).map_or_else(|| path.clone(), str::to_string)
}

pub struct ClaudeDiffView {
    request_id: String,
    path: Option<SharedString>,
    rows: Vec<DiffRow>,
    stats: (usize, usize),
    focus: FocusHandle,
}

impl ClaudeDiffView {
    pub fn new(request_id: String, _window: &mut Window, cx: &mut Context<Self>) -> Self {
        let root = crate::bridge(cx).and_then(|bridge| bridge.workspace_folders(cx).into_iter().next());
        let (path, rows) = match cx.try_global::<PendingDiffs>().and_then(|diffs| diffs.0.get(&request_id)) {
            Some(pending) => (
                Some(relative_display_path(&pending.request.new_file_path, root.as_deref()).into()),
                diff::diff_rows(&pending.old_text, &pending.request.new_contents),
            ),
            None => (None, Vec::new()),
        };
        let id = request_id.clone();
        cx.on_release(move |_, cx| {
            finish(&id, Some(false), cx);
        })
        .detach();
        let stats = diff::stats(&rows);
        Self { request_id, path, rows, stats, focus: cx.focus_handle() }
    }

    fn decide(&mut self, accepted: bool, cx: &mut Context<Self>) {
        finish(&self.request_id, Some(accepted), cx);
        self.path = None;
        cx.notify();
    }
}

impl Focusable for ClaudeDiffView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for ClaudeDiffView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let Some(path) = self.path.clone() else {
            return div()
                .track_focus(&self.focus)
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .bg(colors.background)
                .text_size(typography::text_sm())
                .text_color(colors.subtle_foreground)
                .child("Claude Code no longer waits on this change")
                .into_any_element();
        };
        let (added, removed) = self.stats;
        let rows = self.rows.iter().map(|row| match row {
            DiffRow::Line { kind, text } => {
                let (sign, bg, fg) = match kind {
                    LineKind::Added => ("+", Some(colors.git_added.opacity(0.14)), colors.foreground),
                    LineKind::Removed => ("-", Some(colors.git_deleted.opacity(0.14)), colors.foreground),
                    LineKind::Context => (" ", None, colors.muted_foreground),
                };
                div()
                    .flex()
                    .min_w_full()
                    .px(px(12.))
                    .when_some(bg, |this, bg| this.bg(bg))
                    .text_color(fg)
                    .whitespace_nowrap()
                    .child(div().w(px(16.)).flex_none().text_color(colors.subtle_foreground).child(sign))
                    .child(text.clone())
                    .into_any_element()
            }
            DiffRow::Skipped(count) => div()
                .px(px(12.))
                .py(px(2.))
                .text_color(colors.subtle_foreground)
                .child(format!("{count} unchanged lines"))
                .into_any_element(),
        });
        div()
            .track_focus(&self.focus)
            .size_full()
            .flex()
            .flex_col()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(px(40.))
                    .px(px(12.))
                    .border_b_1()
                    .border_color(colors.divider)
                    .child(PaneTitle::new("Claude Code proposes changes").icon(IconName::GitDiff).detail(path))
                    .child(div().text_size(typography::text_caption()).text_color(colors.git_added).child(format!("+{added}")))
                    .child(div().text_size(typography::text_caption()).text_color(colors.git_deleted).child(format!("-{removed}")))
                    .child(
                        Button::new("claude-diff-reject", "Reject")
                            .variant(ButtonVariant::Ghost)
                            .tone(ButtonTone::Danger)
                            .size(ButtonSize::Small)
                            .leading_icon(IconName::X)
                            .on_click(cx.listener(|this, _, _, cx| this.decide(false, cx))),
                    )
                    .child(
                        Button::new("claude-diff-accept", "Accept")
                            .variant(ButtonVariant::Ghost)
                            .tone(ButtonTone::Success)
                            .size(ButtonSize::Small)
                            .leading_icon(IconName::Check)
                            .on_click(cx.listener(|this, _, _, cx| this.decide(true, cx))),
                    ),
            )
            .child(
                ScrollArea::new("claude-diff-rows").child(
                    div().py(px(6.)).font_family(typography::MONO_FONT).text_size(typography::text_sm()).line_height(px(20.)).children(rows),
                ),
            )
            .into_any_element()
    }
}
