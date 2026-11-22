//! A commit's details: message, author, dates, parents and the files it changed. Clicking a file
//! opens its diff at the commit; a parent opens that commit.

use std::path::PathBuf;

use ui::scale::px;
use gpui::{AnyElement, App, ClipboardItem, Context, EventEmitter, FocusHandle, Focusable, Render, SharedString, Window, div, prelude::*,};
use theme::{ActiveTheme, ThemeColors};
use ui::{Avatar, Button, ButtonSize, Icon, IconName, IconSize, metrics, typography};

use crate::{
    git::{self, ChangedFile, CommitDetails},
    target::{DiffTarget, short_hash},
    widgets::{diff_numbers, fill_message, status_color},
};

enum State {
    Loading,
    Failed(SharedString),
    Ready(CommitDetails),
}

pub struct CommitView {
    root: PathBuf,
    commit: String,
    focus_handle: FocusHandle,
    state: State,
}

impl EventEmitter<()> for CommitView {}

impl Focusable for CommitView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl CommitView {
    pub fn new(root: PathBuf, commit: String, _window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut view = Self { root, commit, focus_handle: cx.focus_handle(), state: State::Loading };
        view.load(cx);
        view
    }

    pub fn details(&self) -> Option<&CommitDetails> {
        match &self.state {
            State::Ready(details) => Some(details),
            _ => None,
        }
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        let (root, commit) = (self.root.clone(), self.commit.clone());
        let task = cx.background_spawn(async move { git::commit_details(&root, &commit) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.state = match result {
                    Ok(details) => State::Ready(details),
                    Err(error) => State::Failed(format!("{error:#}").into()),
                };
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn open_file_diff(&self, hash: &str, path: &str, cx: &mut App) {
        crate::open_diff(cx, Some(&self.root), &DiffTarget::CommitFile { commit: hash.to_string(), path: path.to_string() });
    }

    fn render_header(&self, details: &CommitDetails, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let author = &details.author;
        let now = git::now();
        let hash = details.hash.clone();
        let full = details.hash.clone();
        let committed_by_other = details.committer.name != author.name || details.committer.email != author.email;
        div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .px(px(24.))
            .pt(px(20.))
            .pb(px(16.))
            .border_b_1()
            .border_color(colors.divider)
            .child(div().text_size(typography::text_lg()).font_weight(typography::SEMIBOLD).text_color(colors.foreground).child(details.summary.clone()))
            .when(!details.body.is_empty(), |this| {
                this.child(
                    div()
                        .text_size(typography::text_sm())
                        .text_color(colors.muted_foreground)
                        .font_family(typography::MONO_FONT)
                        .children(details.body.lines().map(|line| div().min_h(px(16.)).child(line.to_string()))),
                )
            })
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(8.))
                    .text_size(typography::text_sm())
                    .text_color(colors.subtle_foreground)
                    .child(Avatar::new(&author.name).size(px(18.)).image(crate::avatar::author_avatar(&author.email, cx)))
                    .child(div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(author.name.clone()))
                    .child(format!("<{}>", author.email))
                    .child("·")
                    .child(format!("{} ({})", git::relative_time(author.time, now), git::format_time(author.time, author.offset_minutes)))
                    .when(committed_by_other, |this| this.child("·").child(format!("committed by {}", details.committer.name))),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(6.))
                    .text_size(typography::text_sm())
                    .text_color(colors.subtle_foreground)
                    .child(Icon::new(IconName::GitCommit).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .child(div().font_family(typography::MONO_FONT).text_color(colors.foreground).child(hash))
                    .child(
                        Button::icon("commit-copy-hash", IconName::Copy)
                            .size(ButtonSize::XSmall)
                            .tooltip("Copy commit hash")
                            .on_click(move |_, _, cx| cx.write_to_clipboard(ClipboardItem::new_string(full.clone()))),
                    )
                    .when(!details.parents.is_empty(), |this| {
                        this.child(div().ml(px(8.)).child(if details.parents.len() > 1 { "Parents" } else { "Parent" }))
                    })
                    .children(details.parents.iter().enumerate().map(|(index, parent)| {
                        let (parent, root) = (parent.clone(), self.root.clone());
                        let hover = colors.foreground;
                        div()
                            .id(("commit-parent", index))
                            .font_family(typography::MONO_FONT)
                            .text_color(colors.primary)
                            .hover(move |style| style.text_color(hover))
                            .child(short_hash(&parent).to_string())
                            .on_click(move |_, _, cx| crate::open_commit(cx, Some(&root), &parent, None))
                    }))
                    .child(
                        div().ml_auto().child(
                            Button::new("commit-open-diff", "View full diff")
                                .leading_icon(IconName::GitDiff)
                                .size(ButtonSize::Small)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if let Some(details) = this.details() {
                                        let target = DiffTarget::Commit { commit: details.hash.clone() };
                                        crate::open_diff(cx, Some(&this.root), &target);
                                    }
                                })),
                        ),
                    ),
            )
    }

    fn render_file(&self, index: usize, file: &ChangedFile, hash: &str, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let (name, dir) = match file.path.rsplit_once('/') {
            Some((dir, name)) => (name.to_string(), dir.to_string()),
            None => (file.path.clone(), String::new()),
        };
        let accent = colors.accent;
        let (hash, path) = (hash.to_string(), file.path.clone());
        div()
            .id(("commit-file", index))
            .flex()
            .items_center()
            .gap(px(8.))
            .h(metrics::list_row())
            .px(px(8.))
            .rounded(metrics::radius_md())
            .text_size(typography::text_sm())
            .hover(move |style| style.bg(accent))
            .child(
                div()
                    .flex_none()
                    .w(px(14.))
                    .font_family(typography::MONO_FONT)
                    .font_weight(typography::MEDIUM)
                    .text_color(status_color(file.status, colors))
                    .child(file.status.letter()),
            )
            .child(multibuffer::file_icon(&name, multibuffer::Tone::Subtle, cx))
            .child(div().flex_none().text_color(colors.foreground).child(name))
            .child(div().min_w_0().truncate().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(match &file.old_path {
                Some(old) => format!("{dir} ← {old}"),
                None => dir,
            }))
            .child(div().ml_auto().flex().flex_none().items_center().gap(px(8.)).when(file.binary, |this| {
                this.child(div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child("binary"))
            }).children(diff_numbers(file.additions, file.deletions, colors)))
            .on_click(cx.listener(move |this, _, _, cx| this.open_file_diff(&hash, &path, cx)))
            .into_any_element()
    }
}

impl Render for CommitView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let container = div()
            .id("git-commit-view")
            .track_focus(&self.focus_handle)
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_color(colors.foreground);
        let details = match &self.state {
            State::Loading => return container.child(fill_message("Loading commit…", None, IconName::GitCommit, None)),
            State::Failed(error) => return container.child(fill_message(format!("Could not read {}", short_hash(&self.commit)), Some(error.clone()), IconName::WarningCircle, None)),
            State::Ready(details) => details.clone(),
        };
        let (additions, deletions) = details.totals();
        let files: Vec<AnyElement> = details.files.iter().enumerate().map(|(index, file)| self.render_file(index, file, &details.hash, &colors, cx)).collect();
        container.child(self.render_header(&details, &colors, cx)).child(
            div()
                .id("commit-files")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .px(px(16.))
                .py(px(12.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .h(metrics::list_row())
                        .px(px(8.))
                        .text_size(typography::text_sm())
                        .font_weight(typography::MEDIUM)
                        .text_color(colors.muted_foreground)
                        .child(format!("{} changed", if details.files.len() == 1 { "1 file".to_string() } else { format!("{} files", details.files.len()) }))
                        .children(diff_numbers(additions, deletions, &colors)),
                )
                .children(files)
                .when(details.files.is_empty(), |this| {
                    this.child(div().px(px(8.)).py(px(12.)).text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("No files changed"))
                }),
        )
    }
}
