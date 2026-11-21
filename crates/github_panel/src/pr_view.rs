//! A pull request in the centre (`github-pr-viewer.tsx`): its summary and actions, then
//! Overview (description, activity, reviewers, checks, labels), Changes (files and their diffs)
//! and Checks.

use ui::TooltipExt as _;
use std::{path::PathBuf, rc::Rc, sync::Arc};

use crate::gh::{Label, PullRequestComment, PullRequestDetails, PullRequestFile};
use chrono::Utc;
use gpui::{
    Anchor, AnyElement, App, ClickEvent, Context, DismissEvent, Entity, FocusHandle, Focusable, IntoElement, Render, SharedString,
    Subscription, Window, div, list, prelude::*, px, relative,
};
use multibuffer::{Entry, Header, Multibuffer, OpenHandler, Section};
use theme::{ActiveTheme, ThemeColors};
use ui::{
    Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, MenuEntry, MenuItem, MenuSize, OpenMenu, TextInput, TextInputEvent, WithScrollbar, metrics,
    typography,
};

use crate::{
    diff::{self, FileDiff, FileStatus, LineKind},
    editor::{self, AssigneePicker, ConfirmHost, Confirmation, EditorEvent, LabelPicker, MarkdownEditor, PickerEvent, Popover},
    markdown::{self, Block},
    menus::{self, MenuHost, below},
    model::{self, Commit, PrStatus, ReviewerState, TimelineEvent, Tone},
    mutation::{self, MergeMethod, Mutation, Outcome, ReviewEvent},
    store::{self, Metadata},
    widgets::{self, Summary, badge, event_row, fill_message, label_chip, meta_chip, rail, section, timeline, timeline_marker, tone_color, user_chip},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tab {
    Overview,
    Changes,
    Checks,
}

/// Details, comments and their Markdown, parsed off the UI thread.
struct Page {
    details: PullRequestDetails,
    repository_url: String,
    body: Vec<Block>,
    commits: Vec<Commit>,
    comments: Option<Vec<(PullRequestComment, Vec<Block>)>>,
    review_bodies: Vec<Vec<Block>>,
    comments_error: Option<String>,
}

struct Changes {
    files: Vec<PullRequestFile>,
    diffs: Vec<FileDiff>,
}

/// The card that opens in the activity for a review or a merge (`github-pr-inline-action.tsx`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActionKind {
    Approve,
    RequestChanges,
    Merge,
}

impl ActionKind {
    fn key(self) -> &'static str {
        match self {
            ActionKind::Approve => "approve",
            ActionKind::RequestChanges => "request-changes",
            ActionKind::Merge => "merge",
        }
    }

    fn title(self) -> &'static str {
        match self {
            ActionKind::Approve => "Approve pull request",
            ActionKind::RequestChanges => "Request changes",
            ActionKind::Merge => "Merge pull request",
        }
    }

    fn submit_label(self) -> &'static str {
        match self {
            ActionKind::Approve => "Approve",
            ActionKind::RequestChanges => "Request changes",
            ActionKind::Merge => "Merge",
        }
    }

    fn placeholder(self) -> &'static str {
        match self {
            ActionKind::RequestChanges => "Describe the requested changes...",
            _ => "Optional review note...",
        }
    }
}

struct InlineAction {
    kind: ActionKind,
    editor: Entity<MarkdownEditor>,
    method: MergeMethod,
    _subscription: Subscription,
}

/// GitHub's PR page lists checks this many at a time before "Show more".
/// The commit view's resource kind (`git_diff::COMMIT_KIND`); its id is `repo|sha`.
pub(crate) const COMMIT_KIND: &str = "git-commit";
const COLLAPSED_CHECKS: usize = 5;

pub struct PullRequestView {
    root: PathBuf,
    number: i64,
    focus_handle: FocusHandle,
    page: Option<Arc<Page>>,
    error: Option<SharedString>,
    loading: bool,
    /// A load was asked for while one ran (a comment posted during a refresh): it runs again
    /// once that one is back, so the result shows the change.
    reload_queued: bool,
    changes: Option<Arc<Changes>>,
    changes_error: Option<SharedString>,
    loading_changes: bool,
    tab: Tab,
    show_all_checks: bool,
    busy: Option<&'static str>,
    notice: Option<(SharedString, Tone)>,
    open_menu: Option<OpenMenu>,
    files: Multibuffer<Self>,
    current_user: Option<String>,
    metadata: Option<Arc<Metadata>>,
    metadata_error: Option<SharedString>,
    /// The change being sent: `edit`, `comment`, `comment-<id>`, `close` or an action's key.
    mutation: Option<String>,
    title_input: Option<(Entity<TextInput>, Subscription)>,
    body_editor: Option<(Entity<MarkdownEditor>, Subscription)>,
    comment_editor: Option<(i64, Entity<MarkdownEditor>, Subscription)>,
    composer: Entity<MarkdownEditor>,
    composer_error: Option<SharedString>,
    inline_action: Option<InlineAction>,
    popover: Option<Popover>,
    confirmation: Option<Confirmation>,
    _subscriptions: Vec<Subscription>,
}

impl ConfirmHost for PullRequestView {
    fn confirmation_slot(&mut self) -> &mut Option<Confirmation> {
        &mut self.confirmation
    }
}

impl Focusable for PullRequestView {
    fn focus_handle(&self, _: &App) -> gpui::FocusHandle {
        self.focus_handle.clone()
    }
}

impl MenuHost for PullRequestView {
    fn menu_slot(&mut self) -> &mut Option<OpenMenu> {
        &mut self.open_menu
    }
}

fn page_key(root: &std::path::Path, number: i64) -> String {
    format!("{}|pr|{number}", root.display())
}

fn changes_key(root: &std::path::Path, number: i64) -> String {
    format!("{}|pr-changes|{number}", root.display())
}

/// Blocking: details, then comments; the page still opens when comments fail.
fn fetch_page(path: String, number: i64, token: String) -> Result<Page, String> {
    let details = crate::gh::github_get_pr_details(path.clone(), number, Some(token.clone()))?;
    let (comments, comments_error) = match crate::gh::github_get_pr_comments(path, number, Some(token)) {
        Ok(comments) => (Some(comments), None),
        Err(error) => (None, Some(error)),
    };
    Ok(build_page(details, comments, comments_error))
}

fn build_page(details: PullRequestDetails, comments: Option<Vec<PullRequestComment>>, comments_error: Option<String>) -> Page {
    let repository_url = repository_url(&details.url);
    let parse = |source: &str| markdown::parse(source, Some(&repository_url));
    Page {
        body: parse(&details.body),
        commits: model::commits(&details),
        review_bodies: details.reviews.iter().map(|review| parse(&review.body)).collect(),
        comments: comments.map(|comments| comments.into_iter().map(|comment| { let body = parse(&comment.body); (comment, body) }).collect()),
        comments_error,
        repository_url,
        details,
    }
}

/// `https://github.com/o/r/pull/12` → `https://github.com/o/r`.
pub(crate) fn repository_url(url: &str) -> String {
    match url.rsplit_once("/pull/").or_else(|| url.rsplit_once("/issues/")).or_else(|| url.rsplit_once("/actions/runs/")) {
        Some((repo, _)) => repo.to_string(),
        None => url.to_string(),
    }
}

impl PullRequestView {
    pub fn new(root: PathBuf, number: i64, tab: Option<&str>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let page = store::get::<Page>(&page_key(&root, number), cx);
        let changes = store::get::<Changes>(&changes_key(&root, number), cx);
        let repository_url = page.as_ref().map(|page| page.repository_url.clone());
        let composer = cx.new(|cx| MarkdownEditor::new("pr-composer", "Write a comment…", 3, repository_url, cx));
        let subscriptions = vec![cx.subscribe(&composer, |this, _, event: &EditorEvent, cx| match event {
            EditorEvent::Submit => this.submit_comment(cx),
            EditorEvent::Changed => {
                this.composer_error = None;
                cx.notify();
            }
            EditorEvent::Cancel => {}
        })];
        let mut view = Self {
            root,
            number,
            focus_handle: cx.focus_handle(),
            page,
            error: None,
            loading: false,
            reload_queued: false,
            changes,
            changes_error: None,
            loading_changes: false,
            tab: match tab {
                Some("files") => Tab::Changes,
                Some("checks") => Tab::Checks,
                _ => Tab::Overview,
            },
            show_all_checks: false,
            busy: None,
            notice: None,
            open_menu: None,
            files: Multibuffer::new("pr-files", true, |this: &mut Self| &mut this.files, window, cx),
            current_user: None,
            metadata: None,
            metadata_error: None,
            mutation: None,
            title_input: None,
            body_editor: None,
            comment_editor: None,
            composer,
            composer_error: None,
            inline_action: None,
            popover: None,
            confirmation: None,
            _subscriptions: subscriptions,
        };
        view.load(cx);
        view.load_metadata(cx);
        let user = store::current_user(cx);
        cx.spawn(async move |this, cx| {
            let user = user.await;
            this.update(cx, |this, cx| {
                this.current_user = user;
                cx.notify();
            })
            .ok();
        })
        .detach();
        view
    }

    fn load_metadata(&mut self, cx: &mut Context<Self>) {
        let cached = store::load_metadata(cx, self.path(), |this, result, cx| {
            match result {
                Ok(metadata) => {
                    this.metadata = Some(metadata);
                    this.metadata_error = None;
                }
                Err(error) => this.metadata_error = Some(error.into()),
            }
            cx.notify();
        });
        if self.metadata.is_none() {
            self.metadata = cached;
        }
    }

    /// Sends one change; nothing else can start until it answers. A change that worked tells the
    /// sidebar to re-read its lists.
    fn run(&mut self, key: impl Into<String>, mutation: Mutation, cx: &mut Context<Self>, apply: impl FnOnce(&mut Self, Result<Outcome, String>, &mut Context<Self>) + 'static) {
        if self.mutation.is_some() {
            return;
        }
        self.mutation = Some(key.into());
        cx.notify();
        store::mutate(cx, self.path(), mutation, move |this, result, cx| {
            this.mutation = None;
            if result.is_ok() {
                store::bump(cx);
            }
            apply(this, result, cx);
            cx.notify();
        });
    }

    /// Shows details GitHub sent back after a change, keeping the comments already loaded.
    fn apply_details(&mut self, details: PullRequestDetails, cx: &mut Context<Self>) {
        let (comments, comments_error) = match &self.page {
            Some(page) => (page.comments.as_ref().map(|comments| comments.iter().map(|(comment, _)| comment.clone()).collect()), page.comments_error.clone()),
            None => (None, None),
        };
        let page = Arc::new(build_page(details, comments, comments_error));
        store::put(page_key(&self.root, self.number), page.clone(), cx);
        self.page = Some(page);
        cx.notify();
    }

    fn update_pr(&mut self, title: Option<String>, body: Option<String>, labels: Option<Vec<String>>, assignees: Option<Vec<String>>, cx: &mut Context<Self>) {
        let Some(page) = self.page.clone() else { return };
        let change = mutation::update_pr(&page.details, title, body, labels, assignees);
        self.run("edit", change, cx, |this, result, cx| match result {
            Ok(Outcome::Pr(details)) => {
                this.title_input = None;
                this.body_editor = None;
                this.apply_details(*details, cx);
            }
            Ok(_) => this.load(cx),
            Err(error) => this.set_notice(error, Tone::Error, cx),
        });
    }

    fn start_title_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(page) = self.page.clone() else { return };
        let input = cx.new(|cx| {
            let mut input = TextInput::new(window, cx);
            input.set_text(page.details.title.clone(), cx);
            input.select_all_text(cx);
            input
        });
        let subscription = cx.subscribe(&input, |this, _, event: &TextInputEvent, cx| match event {
            TextInputEvent::Confirmed | TextInputEvent::Blurred => this.save_title(cx),
            TextInputEvent::Cancelled => {
                this.title_input = None;
                cx.notify();
            }
            _ => {}
        });
        window.focus(&input.focus_handle(cx), cx);
        self.title_input = Some((input, subscription));
        cx.notify();
    }

    fn save_title(&mut self, cx: &mut Context<Self>) {
        let (Some((input, _)), Some(page)) = (&self.title_input, &self.page) else { return };
        let title = input.read(cx).text().trim().to_string();
        if title.is_empty() || title == page.details.title {
            self.title_input = None;
            cx.notify();
            return;
        }
        self.update_pr(Some(title), None, None, None, cx);
    }

    fn start_body_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(page) = self.page.clone() else { return };
        let editor = cx.new(|cx| {
            let mut editor = MarkdownEditor::new("pr-body-editor", "Write a description...", 10, Some(page.repository_url.clone()), cx);
            editor.set_text(&page.details.body, cx);
            editor
        });
        let subscription = cx.subscribe(&editor, |this, _, event: &EditorEvent, cx| match event {
            EditorEvent::Submit => this.save_body(cx),
            EditorEvent::Cancel => {
                this.body_editor = None;
                cx.notify();
            }
            EditorEvent::Changed => {}
        });
        window.focus(&editor.focus_handle(cx), cx);
        self.body_editor = Some((editor, subscription));
        cx.notify();
    }

    fn save_body(&mut self, cx: &mut Context<Self>) {
        let (Some((editor, _)), Some(page)) = (&self.body_editor, &self.page) else { return };
        let body = editor.read(cx).text(cx);
        if body == page.details.body {
            self.body_editor = None;
            cx.notify();
            return;
        }
        self.update_pr(None, Some(body), None, None, cx);
    }

    fn submit_comment(&mut self, cx: &mut Context<Self>) {
        let body = self.composer.read(cx).text(cx).trim().to_string();
        if body.is_empty() || self.mutation.is_some() {
            return;
        }
        self.composer_error = None;
        self.composer.update(cx, |editor, cx| editor.set_disabled(true, cx));
        self.run("comment", Mutation::AddPrComment { number: self.number, body }, cx, |this, result, cx| {
            this.composer.update(cx, |editor, cx| editor.set_disabled(false, cx));
            match result {
                Ok(_) => {
                    this.composer.update(cx, |editor, cx| {
                        editor.set_text("", cx);
                    });
                    this.load(cx);
                }
                Err(error) => this.composer_error = Some(error.into()),
            }
        });
    }

    fn start_comment_edit(&mut self, id: i64, body: String, window: &mut Window, cx: &mut Context<Self>) {
        let repository_url = self.page.as_ref().map(|page| page.repository_url.clone());
        let editor = cx.new(|cx| {
            let mut editor = MarkdownEditor::new(format!("pr-comment-editor-{id}"), "Edit comment...", 6, repository_url, cx);
            editor.set_text(&body, cx);
            editor
        });
        let subscription = cx.subscribe(&editor, move |this, _, event: &EditorEvent, cx| match event {
            EditorEvent::Submit => this.save_comment(cx),
            EditorEvent::Cancel => {
                this.comment_editor = None;
                cx.notify();
            }
            EditorEvent::Changed => cx.notify(),
        });
        window.focus(&editor.focus_handle(cx), cx);
        self.comment_editor = Some((id, editor, subscription));
        cx.notify();
    }

    fn save_comment(&mut self, cx: &mut Context<Self>) {
        let Some((id, editor, _)) = &self.comment_editor else { return };
        let (id, body) = (*id, editor.read(cx).text(cx));
        if body.trim().is_empty() {
            return;
        }
        self.run(format!("comment-{id}"), Mutation::EditComment { id, body }, cx, |this, result, cx| match result {
            Ok(_) => {
                this.comment_editor = None;
                this.load(cx);
            }
            Err(error) => this.set_notice(error, Tone::Error, cx),
        });
    }

    fn delete_comment(&mut self, id: i64, window: &mut Window, cx: &mut Context<Self>) {
        editor::confirm(self, "Delete comment", "Delete this comment permanently?", "Delete", true, window, cx, move |this, _, cx| {
            this.run(format!("comment-{id}"), Mutation::DeleteComment { id }, cx, |this, result, cx| match result {
                Ok(_) => this.load(cx),
                Err(error) => this.set_notice(error, Tone::Error, cx),
            });
        });
    }

    fn open_inline_action(&mut self, kind: ActionKind, window: &mut Window, cx: &mut Context<Self>) {
        self.show_tab(Tab::Overview, cx);
        let editor = cx.new(|cx| MarkdownEditor::new(format!("pr-action-{}", kind.key()), kind.placeholder(), 6, self.page.as_ref().map(|page| page.repository_url.clone()), cx));
        let subscription = cx.subscribe(&editor, |this, _, event: &EditorEvent, cx| match event {
            EditorEvent::Submit => this.submit_inline_action(cx),
            EditorEvent::Cancel => {
                this.inline_action = None;
                cx.notify();
            }
            EditorEvent::Changed => cx.notify(),
        });
        if kind != ActionKind::Merge {
            window.focus(&editor.focus_handle(cx), cx);
        }
        self.inline_action = Some(InlineAction { kind, editor, method: MergeMethod::Squash, _subscription: subscription });
        cx.notify();
    }

    fn inline_action_ready(&self, cx: &App) -> bool {
        let Some(action) = &self.inline_action else { return false };
        match action.kind {
            ActionKind::Merge => true,
            ActionKind::Approve => true,
            ActionKind::RequestChanges => mutation::review_ready(ReviewEvent::RequestChanges, &action.editor.read(cx).text(cx)),
        }
    }

    fn submit_inline_action(&mut self, cx: &mut Context<Self>) {
        let Some(action) = &self.inline_action else { return };
        if !self.inline_action_ready(cx) {
            return;
        }
        let number = self.number;
        let body = action.editor.read(cx).text(cx);
        let change = match action.kind {
            ActionKind::Approve => Mutation::SubmitReview { number, event: ReviewEvent::Approve, body },
            ActionKind::RequestChanges => Mutation::SubmitReview { number, event: ReviewEvent::RequestChanges, body },
            ActionKind::Merge => Mutation::Merge { number, method: action.method },
        };
        self.run(action.kind.key(), change, cx, |this, result, cx| match result {
            Ok(outcome) => {
                this.inline_action = None;
                match outcome {
                    Outcome::Pr(details) => this.apply_details(*details, cx),
                    _ => this.load(cx),
                }
            }
            Err(error) => this.set_notice(error, Tone::Error, cx),
        });
    }

    fn close_pull_request(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.mutation.is_some() {
            return;
        }
        editor::confirm(self, "Close pull request", "Close this pull request without merging it?", "Close PR", true, window, cx, |this, _, cx| {
            let number = this.number;
            this.run("close", Mutation::ClosePr { number }, cx, |this, result, cx| match result {
                Ok(Outcome::Pr(details)) => this.apply_details(*details, cx),
                Ok(_) => this.load(cx),
                Err(error) => this.set_notice(error, Tone::Error, cx),
            });
        });
    }

    /// The repository's labels plus any on the pull request that the list missed.
    fn available_labels(&self) -> Vec<Label> {
        let mut labels: Vec<Label> = self.metadata.as_ref().map(|metadata| metadata.labels.clone()).unwrap_or_default();
        if let Some(page) = &self.page {
            for label in &page.details.labels {
                if !labels.iter().any(|candidate| candidate.name == label.name) {
                    labels.push(label.clone());
                }
            }
        }
        labels
    }

    fn open_label_picker(&mut self, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(page) = self.page.clone() else { return };
        if self.popover.take().is_some_and(|popover| popover.key == "labels") {
            cx.notify();
            return;
        }
        let selected = page.details.labels.iter().map(|label| label.name.clone()).collect();
        let loading = self.metadata.is_none();
        let picker = cx.new(|cx| LabelPicker::new(self.available_labels(), selected, loading, window, cx));
        let subscriptions = vec![
            cx.subscribe(&picker, |this, _, PickerEvent::Changed(labels): &PickerEvent, cx| this.update_pr(None, None, Some(labels.clone()), None, cx)),
            cx.subscribe(&picker, |this, _, _: &DismissEvent, cx| {
                this.popover = None;
                cx.notify();
            }),
        ];
        self.popover = Some(Popover::new("labels", picker.into(), editor::popover_position(event), subscriptions));
        cx.notify();
    }

    fn open_assignee_picker(&mut self, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(page) = self.page.clone() else { return };
        if self.popover.take().is_some_and(|popover| popover.key == "assignees") {
            cx.notify();
            return;
        }
        let value = page.details.assignees.iter().map(|user| user.login.clone()).collect();
        let picker = cx.new(|cx| AssigneePicker::new(value, window, cx));
        let subscriptions = vec![
            cx.subscribe(&picker, |this, _, PickerEvent::Changed(assignees): &PickerEvent, cx| this.update_pr(None, None, None, Some(assignees.clone()), cx)),
            cx.subscribe(&picker, |this, _, _: &DismissEvent, cx| {
                this.popover = None;
                cx.notify();
            }),
        ];
        self.popover = Some(Popover::new("assignees", picker.into(), editor::popover_position(event), subscriptions));
        cx.notify();
    }

    fn comment_menu(&self, comment: &PullRequestComment, can_manage: bool, cx: &Context<Self>) -> Vec<MenuEntry> {
        let mut entries = Vec::new();
        if can_manage {
            let (id, body) = (comment.id, comment.body.clone());
            entries.push(menus::item("Edit", cx, move |this, window, cx| this.start_comment_edit(id, body.clone(), window, cx)).icon(IconName::PencilLine).into());
        }
        if !comment.url.is_empty() {
            entries.push(menus::link("Open on GitHub", comment.url.clone()).icon(IconName::OpenExternal).into());
            entries.push(menus::copy("Copy link", comment.url.clone()).icon(IconName::Link).into());
        }
        if can_manage {
            let id = comment.id;
            entries.push(menus::item("Delete", cx, move |this, window, cx| this.delete_comment(id, window, cx)).icon(IconName::Trash).destructive().into());
        }
        entries
    }

    fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        if self.loading {
            self.reload_queued = true;
            return;
        }
        self.loading = true;
        cx.notify();
        let (path, number) = (self.path(), self.number);
        store::fetch(cx, move |token| fetch_page(path, number, token), |this, result, cx| {
            this.loading = false;
            if std::mem::take(&mut this.reload_queued) {
                this.load(cx);
                return;
            }
            match result {
                Ok(page) => {
                    let page = Arc::new(page);
                    store::put(page_key(&this.root, this.number), page.clone(), cx);
                    // Small pull requests load their diff ahead of the Changes tab, as Athas does.
                    let small = page.details.changed_files <= 12;
                    this.page = Some(page);
                    this.error = None;
                    if small || this.tab == Tab::Changes {
                        this.load_changes(cx);
                    }
                }
                Err(error) => this.error = Some(error.into()),
            }
            cx.notify();
        });
    }

    fn load_changes(&mut self, cx: &mut Context<Self>) {
        if self.loading_changes {
            return;
        }
        self.loading_changes = true;
        cx.notify();
        let (path, number) = (self.path(), self.number);
        store::fetch(
            cx,
            move |token| {
                let files = crate::gh::github_get_pr_files(path.clone(), number, Some(token.clone()))?;
                let diff = crate::gh::github_get_pr_diff(path, number, Some(token))?;
                Ok(Changes { files, diffs: diff::parse(&diff) })
            },
            |this, result, cx| {
                this.loading_changes = false;
                match result {
                    Ok(changes) => {
                        let changes = Arc::new(changes);
                        store::put(changes_key(&this.root, this.number), changes.clone(), cx);
                        this.changes = Some(changes);
                        this.changes_error = None;
                    }
                    Err(error) => this.changes_error = Some(error.into()),
                }
                cx.notify();
            },
        );
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.load(cx);
        if self.tab == Tab::Changes || self.changes.is_some() {
            self.load_changes(cx);
        }
    }

    fn show_tab(&mut self, tab: Tab, cx: &mut Context<Self>) {
        self.tab = tab;
        if tab == Tab::Changes && self.changes.is_none() {
            self.load_changes(cx);
        }
        cx.notify();
    }

    fn set_notice(&mut self, message: impl Into<SharedString>, tone: Tone, cx: &mut Context<Self>) {
        self.notice = Some((message.into(), tone));
        cx.notify();
    }

    fn checkout(&mut self, cx: &mut Context<Self>) {
        if self.busy.is_some() {
            return;
        }
        self.busy = Some("checkout");
        cx.notify();
        let (path, number) = (self.path(), self.number);
        store::fetch(cx, move |token| crate::gh::github_checkout_pr(path, number, Some(token)), move |this, result, cx| {
            this.busy = None;
            match result {
                Ok(()) => this.set_notice(format!("Checked out PR #{number}"), Tone::Success, cx),
                Err(error) => this.set_notice(error, Tone::Error, cx),
            }
        });
    }

    fn actions_menu(&self, page: &Page, cx: &Context<Self>) -> Vec<MenuEntry> {
        let details = &page.details;
        let status = PrStatus::of_details(details);
        let closed = matches!(status, PrStatus::Closed | PrStatus::Merged);
        let busy = self.mutation.is_some();
        vec![
            menus::item("Checkout branch", cx, |this, _, cx| this.checkout(cx)).icon(IconName::GitBranch).disabled(self.busy.is_some()).into(),
            menus::item("Approve", cx, |this, window, cx| this.open_inline_action(ActionKind::Approve, window, cx)).icon(IconName::CheckCircle).disabled(closed || busy).into(),
            menus::item("Request changes", cx, |this, window, cx| this.open_inline_action(ActionKind::RequestChanges, window, cx)).icon(IconName::Xcircle).disabled(closed || busy).into(),
            menus::item("Close pull request", cx, |this, window, cx| this.close_pull_request(window, cx)).icon(IconName::X).disabled(closed || busy).into(),
            menus::item(if self.loading { "Refreshing…" } else { "Refresh" }, cx, |this, _, cx| this.refresh(cx)).icon(IconName::ArrowClockwise).disabled(self.loading).into(),
            MenuEntry::Separator,
            menus::link("Open on GitHub", details.url.clone()).icon(IconName::OpenExternal).into(),
            menus::copy_named("Copy link", "PR link", details.url.clone()).icon(IconName::Link).into(),
            menus::copy("Copy branch name", details.head_ref.clone()).icon(IconName::GitBranch).into(),
        ]
    }

    fn render_summary(&self, page: &Page, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let pr = &page.details;
        let now = Utc::now();
        let status = PrStatus::of_details(pr);
        let icon = match status {
            PrStatus::Merged => Icon::new(IconName::GitMerge),
            _ => Icon::new(IconName::GitPullRequest),
        }
        .size(IconSize::Custom(px(20.)))
        .color(tone_color(status.tone(), colors));
        let merge = model::merge_status(status, pr.merge_state_status.as_deref(), pr.mergeable.as_deref(), pr.review_decision.as_deref());
        let merge_button = if merge.ready {
            Button::new("pr-merge", if self.mutation.as_deref() == Some("merge") { "Merging…" } else { "Merge" })
                .leading_icon(IconName::GitMerge)
                .variant(ButtonVariant::Accent)
                .size(ButtonSize::Small)
                .disabled(self.mutation.is_some())
                .on_click(cx.listener(|this, _, window, cx| this.open_inline_action(ActionKind::Merge, window, cx)))
        } else {
            let icon = match status {
                PrStatus::Merged => IconName::GitMerge,
                PrStatus::Closed => IconName::Xcircle,
                PrStatus::Draft => IconName::CircleDot,
                PrStatus::Open if merge.text == "Checking mergeability" => IconName::Clock,
                PrStatus::Open => IconName::WarningCircle,
            };
            Button::new("pr-merge-status", merge.text).leading_icon(icon).size(ButtonSize::Small).disabled(true).tooltip(merge.text)
        };
        let actions = vec![
            merge_button.into_any_element(),
            Button::icon("pr-open-browser", IconName::OpenExternal)
                .size(ButtonSize::Small)
                .tooltip("Open on GitHub")
                .on_click({
                    let url = pr.url.clone();
                    move |_, _, cx| cx.open_url(&url)
                })
                .into_any_element(),
            Button::icon("pr-actions", IconName::Dots)
                .size(ButtonSize::Small)
                .active(menus::is_open(&self.open_menu, "pr-actions"))
                .tooltip("Pull request actions")
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                    let Some(page) = this.page.clone() else { return };
                    let entries = this.actions_menu(&page, cx);
                    menus::show(this, "pr-actions", entries, below(event), Anchor::TopRight, window, cx);
                }))
                .into_any_element(),
        ];
        let branch_url = |branch: &str| Some(format!("{}/tree/{branch}", page.repository_url));
        let meta = vec![
            meta_chip("pr-number", None, format!("#{}", pr.number), Some(pr.url.clone()), false, colors).into_any_element(),
            user_chip("pr-author", &pr.author.login, colors).into_any_element(),
            div()
                .flex()
                .items_center()
                .gap(px(4.))
                .min_w_0()
                .child(meta_chip("pr-head", Some(IconName::GitBranch), pr.head_ref.clone(), branch_url(&pr.head_ref), true, colors))
                .child(Icon::new(IconName::ArrowRight).size(IconSize::XSmall).color(colors.subtle_foreground))
                .child(meta_chip("pr-base", None, pr.base_ref.clone(), branch_url(&pr.base_ref), true, colors))
                .into_any_element(),
            div().child(format!("Opened {}", model::time_ago(&pr.created_at, now))).into_any_element(),
            div().child(format!("Updated {}", model::time_ago(&pr.updated_at, now))).into_any_element(),
        ];
        let mut badges = vec![badge(status.label(), status.tone(), colors).into_any_element()];
        if self.loading {
            badges.push(widgets::caption("Refreshing…", colors).into_any_element());
        }
        Summary { icon: icon.into_any_element(), title: self.render_title(&pr.title, colors, cx), badges, description: None, meta, actions, aside: None }.render(colors).into_any_element()
    }

    fn render_title(&self, title: &str, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        if let Some((input, _)) = &self.title_input {
            return div().w(px(560.)).min_w_0().text_size(typography::TEXT_BASE).child(input.clone()).into_any_element();
        }
        editable_title("pr-title", title, colors).on_click(cx.listener(|this, _, window, cx| this.start_title_edit(window, cx))).into_any_element()
    }

    fn render_tabs(&self, page: &Page, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let pr = &page.details;
        let tab = |id: &'static str, label: &str, icon: IconName, which: Tab, cx: &mut Context<Self>| {
            Button::new(id, label.to_string())
                .leading_icon(icon)
                .variant(ButtonVariant::Tab)
                .size(ButtonSize::Small)
                .active(self.tab == which)
                .on_click(cx.listener(move |this, _, _, cx| this.show_tab(which, cx)))
        };
        let checks = pr.status_checks.len();
        div()
            .flex()
            .items_center()
            .gap(px(2.))
            .py(px(4.))
            .ml(px(-8.))
            .child(tab("pr-tab-overview", "Overview", IconName::Info, Tab::Overview, cx))
            .child(
                Button::new("pr-tab-commits", format!("Commits {}", page.commits.len()))
                    .leading_icon(IconName::GitCommit)
                    .trailing_icon(IconName::ChevronDown)
                    .variant(ButtonVariant::Tab)
                    .size(ButtonSize::Small)
                    .active(menus::is_open(&self.open_menu, "pr-commits"))
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                        let entries = this.commits_menu();
                        if menus::is_open(&this.open_menu, "pr-commits") {
                            this.open_menu = None;
                            cx.notify();
                            return;
                        }
                        let menu = OpenMenu::sized("pr-commits", entries, MenuSize::Panel, below(event), Anchor::TopLeft, window, cx, |this: &mut Self, _| this.open_menu = None).searchable("Search commits", "No commits match", cx);
                        this.open_menu = Some(menu);
                        cx.notify();
                    })),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .child(tab("pr-tab-changes", "Changes", IconName::Files, Tab::Changes, cx))
                    .child(widgets::mono_numbers(pr.additions, pr.deletions, colors).mr(px(6.))),
            )
            .child(tab("pr-tab-checks", &if checks > 0 { format!("Checks {checks}") } else { "Checks".to_string() }, IconName::ListChecks, Tab::Checks, cx))
            .child(widgets::caption(model::plural(pr.changed_files as usize, "file"), colors).ml_auto())
    }

    /// The pull request's commits, each opening its diff from the local repository (`pr-commits-dropdown.tsx`).
    fn commits_menu(&self) -> Vec<MenuEntry> {
        let Some(page) = self.page.as_ref() else { return Vec::new() };
        if page.commits.is_empty() {
            return vec![MenuItem::new("No commits").disabled(true).into()];
        }
        let now = Utc::now();
        let repo = self.root.clone();
        page.commits
            .iter()
            .map(|commit| {
                let (repo, sha, title) = (repo.clone(), commit.sha.clone(), format!("{} {}", model::short_sha(&commit.sha), commit.headline));
                let author = if commit.author.is_empty() { "Unknown" } else { commit.author.as_str() };
                MenuItem::new(commit.headline.clone())
                    .icon(IconName::GitCommit)
                    .description(format!("{author} · {}", model::time_ago(&commit.authored_at, now)))
                    .trailing_text(model::short_sha(&commit.sha).to_string())
                    .keywords(format!("{} {}", commit.sha, commit.author))
                    .on_select(move |_, cx| workbench_api::open_resource(cx, COMMIT_KIND, &format!("{}|{sha}", repo.to_string_lossy()), &title))
                    .into()
            })
            .collect()
    }

    fn render_overview(&self, page: &Page, colors: &ThemeColors, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let (description, edit) = self.render_description(page, colors, cx);
        let main = div()
            .flex()
            .flex_col()
            .gap(px(32.))
            .flex_1()
            .min_w_0()
            .child(section("Description", edit, description, colors))
            .child(section("Activity", None, self.render_activity(page, colors, cx), colors));
        let content = div().flex().items_start().gap(px(40.)).child(main).child(self.render_sidebar(page, colors, cx));
        div()
            .id("pr-overview")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .pt(px(24.))
            .pb(px(32.))
            .child(rail(content))
            .scrollbar(window, cx)
            .into_any_element()
    }

    fn render_description(&self, page: &Page, colors: &ThemeColors, cx: &mut Context<Self>) -> (AnyElement, Option<AnyElement>) {
        if let Some((editor, _)) = &self.body_editor {
            let body = div()
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(editor.clone())
                .child(editor::save_row(
                    "pr-body",
                    self.mutation.as_deref() == Some("edit"),
                    true,
                    "Save",
                    cx.listener(|this, _, _, cx| {
                        this.body_editor = None;
                        cx.notify();
                    }),
                    cx.listener(|this, _, _, cx| this.save_body(cx)),
                ))
                .into_any_element();
            return (body, None);
        }
        let body = if page.body.is_empty() {
            div()
                .id("pr-body-empty")
                .text_size(typography::TEXT_SM)
                .italic()
                .text_color(colors.subtle_foreground)
                .child("No description provided")
                .on_click(cx.listener(|this, _, window, cx| this.start_body_edit(window, cx)))
                .into_any_element()
        } else {
            markdown::render(&page.body, "pr-body", cx)
        };
        let edit = Button::icon("pr-body-edit", IconName::PencilLine)
            .size(ButtonSize::XSmall)
            .tooltip("Edit description")
            .disabled(self.mutation.is_some())
            .on_click(cx.listener(|this, _, window, cx| this.start_body_edit(window, cx)))
            .into_any_element();
        (body, Some(edit))
    }

    fn render_inline_action(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let action = self.inline_action.as_ref()?;
        let theme = cx.theme().clone();
        let busy = self.mutation.as_deref() == Some(action.kind.key());
        let body = if action.kind == ActionKind::Merge {
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(4.))
                .children(MergeMethod::ALL.map(|method| {
                    Button::new(SharedString::from(format!("pr-merge-{}", method.api_value())), method.label())
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .active(action.method == method)
                        .disabled(busy)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(action) = &mut this.inline_action {
                                action.method = method;
                                cx.notify();
                            }
                        }))
                }))
                .into_any_element()
        } else {
            action.editor.clone().into_any_element()
        };
        Some(
            div()
                .pl(px(36.))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .p(px(12.))
                        .rounded(metrics::RADIUS_LG)
                        .border_1()
                        .border_color(colors.divider)
                        .bg(colors.surface)
                        .shadow(theme.shadows.raised.clone())
                        .child(div().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.foreground).child(action.kind.title()))
                        .child(body)
                        .child(editor::save_row(
                            "pr-action",
                            busy,
                            self.inline_action_ready(cx),
                            action.kind.submit_label(),
                            cx.listener(|this, _, _, cx| {
                                this.inline_action = None;
                                cx.notify();
                            }),
                            cx.listener(|this, _, _, cx| this.submit_inline_action(cx)),
                        )),
                )
                .into_any_element(),
        )
    }

    fn render_activity(&self, page: &Page, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let pr = &page.details;
        let now = Utc::now();
        let comments: Vec<PullRequestComment> = page.comments.as_ref().map(|comments| comments.iter().map(|(comment, _)| comment.clone()).collect()).unwrap_or_default();
        let events = model::pr_timeline(pr, &page.commits, &comments);
        let time = |at: &str| div().flex_none().child(model::time_ago(at, now)).into_any_element();
        let strong = |text: &str| div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(text.to_string()).into_any_element();
        let plain = |text: String| div().child(text).into_any_element();
        let mut items: Vec<AnyElement> = Vec::new();
        for (index, (at, event)) in events.iter().enumerate() {
            let item = match event {
                TimelineEvent::Opened { commit_count } => event_row(
                    Icon::new(IconName::GitPullRequest).size(IconSize::Small).color(colors.success),
                    vec![
                        strong(&pr.author.login),
                        plain(if *commit_count > 0 { format!("opened this pull request with {}", model::plural(*commit_count, "commit")) } else { "opened this pull request".into() }),
                        time(at),
                    ],
                    colors,
                )
                .into_any_element(),
                TimelineEvent::Commit(commit) => {
                    let url = commit.url.clone();
                    let accent = colors.accent;
                    event_row(
                        Icon::new(IconName::GitCommit).size(IconSize::Small).color(colors.subtle_foreground),
                        vec![
                            div()
                                .id(SharedString::from(format!("pr-commit-{index}")))
                                .flex()
                                .flex_1()
                                .min_w_0()
                                .items_center()
                                .gap(px(6.))
                                .mx(px(-6.))
                                .px(px(6.))
                                .rounded(metrics::RADIUS_MD)
                                .hover(move |style| style.bg(accent))
                                .child(strong(&commit.author))
                                .child("committed")
                                .child(div().min_w_0().truncate().text_color(colors.muted_foreground).child(commit.headline.clone()))
                                .child(div().flex_none().font_family(typography::MONO_FONT).text_size(typography::TEXT_CAPTION).child(model::short_sha(&commit.sha).to_string()))
                                .child(time(at))
                                .when(!url.is_empty(), |this| this.on_click(move |_, _, cx| cx.open_url(&url)))
                                .into_any_element(),
                        ],
                        colors,
                    )
                    .into_any_element()
                }
                TimelineEvent::Review(review) => {
                    let (icon, tone, label) = match review.state.as_str() {
                        "APPROVED" => (IconName::CheckCircle, Tone::Success, "approved these changes"),
                        "CHANGES_REQUESTED" => (IconName::Xcircle, Tone::Error, "requested changes"),
                        _ => (IconName::ChatBubbleText, Tone::Muted, "reviewed"),
                    };
                    let marker = Icon::new(icon).size(IconSize::Small).color(tone_color(tone, colors));
                    let body = pr.reviews.iter().position(|candidate| std::ptr::eq(candidate, *review)).and_then(|index| page.review_bodies.get(index));
                    match body.filter(|body| !body.is_empty()) {
                        Some(body) => comment_item(&format!("pr-review-{index}"), marker.into_any_element(), &review.login, label, at, None, body, None, None, colors, cx),
                        None => event_row(marker, vec![strong(&review.login), plain(label.into()), time(at)], colors).into_any_element(),
                    }
                }
                TimelineEvent::Comment(comment) => {
                    let body = page.comments.as_ref().and_then(|comments| comments.iter().find(|(candidate, _)| candidate.id == comment.id && candidate.created_at == comment.created_at)).map(|(_, body)| body);
                    let edited = comment.updated_at != comment.created_at && !comment.updated_at.is_empty();
                    let marker = widgets::avatar(&comment.author.login, 24.).into_any_element();
                    let can_manage = mutation::can_manage(self.current_user.as_deref(), &comment.author.login);
                    let menu_key = format!("pr-comment-menu-{}", comment.id);
                    let menu = (can_manage || !comment.url.is_empty()).then(|| {
                        let comment = (*comment).clone();
                        let key = menu_key.clone();
                        Button::icon(SharedString::from(menu_key.clone()), IconName::Dots)
                            .size(ButtonSize::XSmall)
                            .tooltip("Comment actions")
                            .active(menus::is_open(&self.open_menu, &menu_key))
                            .disabled(self.mutation.as_deref() == Some(format!("comment-{}", comment.id).as_str()))
                            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                                let entries = this.comment_menu(&comment, can_manage, cx);
                                menus::show(this, &key, entries, below(event), Anchor::TopRight, window, cx);
                            }))
                            .into_any_element()
                    });
                    let editor = self.comment_editor.as_ref().filter(|(id, _, _)| *id == comment.id).map(|(id, editor, _)| {
                        let id = *id;
                        let busy = self.mutation.as_deref() == Some(format!("comment-{id}").as_str());
                        let can_save = !editor.read(cx).text(cx).trim().is_empty();
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .child(editor.clone())
                            .child(editor::save_row(
                                &format!("pr-comment-edit-{id}"),
                                busy,
                                can_save,
                                "Save",
                                cx.listener(|this, _, _, cx| {
                                    this.comment_editor = None;
                                    cx.notify();
                                }),
                                cx.listener(|this, _, _, cx| this.save_comment(cx)),
                            ))
                            .into_any_element()
                    });
                    comment_item(
                        &format!("pr-comment-{index}"),
                        marker,
                        &comment.author.login,
                        if edited { "commented · edited" } else { "commented" },
                        at,
                        Some(comment.url.clone()),
                        body.map(Vec::as_slice).unwrap_or_default(),
                        menu,
                        editor,
                        colors,
                        cx,
                    )
                }
                TimelineEvent::Merged => event_row(
                    Icon::new(IconName::GitMerge).size(IconSize::Small).color(colors.merged),
                    match &pr.merged_by {
                        Some(user) => vec![strong(&user.login), plain("merged this pull request".into()), time(at)],
                        None => vec![plain("Merged".into()), time(at)],
                    },
                    colors,
                )
                .into_any_element(),
                TimelineEvent::Closed => {
                    event_row(Icon::new(IconName::Xcircle).size(IconSize::Small).color(colors.destructive), vec![plain("Closed without merging".into()), time(at)], colors).into_any_element()
                }
            };
            items.push(item);
        }
        if page.comments.is_none() && page.comments_error.is_none() {
            items.push(event_row(Icon::new(IconName::Clock).size(IconSize::Small).color(colors.subtle_foreground), vec![plain("Loading activity".into())], colors).into_any_element());
        }
        let mut activity = div().flex().flex_col().gap(px(16.)).child(timeline(items, colors));
        if let Some(error) = &page.comments_error {
            activity = activity.child(div().text_size(typography::TEXT_SM).text_color(colors.destructive).child(error.clone()));
        }
        let can_comment = self.mutation.is_none() && !self.composer.read(cx).text(cx).trim().is_empty();
        activity
            .children(self.render_inline_action(colors, cx))
            .child(editor::composer(
                "pr-composer",
                &self.composer,
                self.current_user.as_deref(),
                self.mutation.as_deref() == Some("comment"),
                can_comment,
                self.composer_error.clone(),
                cx.listener(|this, _, _, cx| this.submit_comment(cx)),
                colors,
            ))
            .into_any_element()
    }

    fn render_sidebar(&self, page: &Page, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let pr = &page.details;
        let reviewers = model::reviewers(pr);
        let review_badge = model::review_decision_badge(pr.review_decision.as_deref()).map(|(label, tone)| badge(label, tone, colors).into_any_element());
        let review_body = if reviewers.is_empty() {
            div().text_color(colors.subtle_foreground).child("No reviewers").into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .children(reviewers.iter().enumerate().map(|(index, reviewer)| {
                    let (icon, color) = match reviewer.state {
                        ReviewerState::Requested => (IconName::Clock, colors.subtle_foreground),
                        ReviewerState::Approved => (IconName::CheckCircle, colors.success),
                        ReviewerState::ChangesRequested => (IconName::Xcircle, colors.destructive),
                        ReviewerState::Commented => (IconName::ChatBubbleText, colors.subtle_foreground),
                    };
                    let label = reviewer.state.label();
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(8.))
                        .text_color(colors.foreground)
                        .child(user_chip(SharedString::from(format!("pr-reviewer-{index}")), &reviewer.login, colors))
                        .child(
                            div()
                                .id(SharedString::from(format!("pr-reviewer-state-{index}")))
                                .child(Icon::new(icon).size(IconSize::Small).color(color))
                                .anchored_tooltip({ let tip: SharedString = (label).into(); move || ui::Tooltip::new(tip.clone()) }),
                        )
                }))
                .into_any_element()
        };
        let checks = self.render_checks_list(page, true, colors, cx);
        let busy = self.mutation.is_some();
        let assignee_action = (!pr.assignees.is_empty()).then(|| {
            Button::icon("pr-assignees-edit", IconName::User)
                .size(ButtonSize::XSmall)
                .tooltip("Edit assignees")
                .disabled(busy)
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_assignee_picker(event, window, cx)))
                .into_any_element()
        });
        let label_action = (!pr.labels.is_empty()).then(|| {
            Button::icon("pr-labels-edit", IconName::Tag)
                .size(ButtonSize::XSmall)
                .tooltip("Edit labels")
                .disabled(busy)
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_label_picker(event, window, cx)))
                .into_any_element()
        });
        let assignees = if pr.assignees.is_empty() {
            div().flex().ml(px(-8.)).child(add_button("pr-assignees-add", "Add assignees", busy).on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_assignee_picker(event, window, cx)))).into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .text_color(colors.foreground)
                .children(pr.assignees.iter().enumerate().map(|(index, user)| user_chip(SharedString::from(format!("pr-assignee-{index}")), &user.login, colors)))
                .into_any_element()
        };
        let labels = if pr.labels.is_empty() {
            div().flex().ml(px(-8.)).child(add_button("pr-labels-add", "Add labels", busy).on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_label_picker(event, window, cx)))).into_any_element()
        } else {
            div().flex().flex_wrap().gap(px(4.)).children(pr.labels.iter().map(|label| label_chip(&label.name, &label.color, colors))).into_any_element()
        };
        let mut sidebar = div()
            .flex()
            .flex_col()
            .gap(px(24.))
            .w(px(240.))
            .flex_none()
            .children(self.metadata_error.clone().map(|error| metadata_error("pr-metadata-retry", error, colors).on_click(cx.listener(|this, _, _, cx| this.load_metadata(cx)))))
            .child(section("Review", review_badge, review_body, colors))
            .child(section("Checks", None, checks, colors))
            .child(section("Assignees", assignee_action, assignees, colors))
            .child(section("Labels", label_action, labels, colors));
        if !pr.linked_issues.is_empty() {
            let primary = colors.primary;
            sidebar = sidebar.child(section(
                "Linked issues",
                None,
                div().flex().flex_wrap().gap(px(8.)).children(pr.linked_issues.iter().map(|issue| {
                    let url = issue.url.clone();
                    div()
                        .id(SharedString::from(format!("pr-linked-{}", issue.number)))
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .text_color(primary)
                        .child(Icon::new(IconName::CircleDot).size(IconSize::XSmall).color(colors.subtle_foreground))
                        .child(format!("#{}", issue.number))
                        .on_click(move |_, _, cx| crate::links::open(cx, &url))
                })),
                colors,
            ));
        }
        sidebar.into_any_element()
    }

    /// The checks, failed first; collapsed to a few in the sidebar.
    fn render_checks_list(&self, page: &Page, collapse: bool, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let pr = &page.details;
        let Some((summary, tone)) = model::checks_summary(&pr.status_checks) else {
            let text = if pr.mergeable.as_deref() == Some("CONFLICTING") { "Has conflicts" } else { "No checks reported" };
            return div().text_color(colors.subtle_foreground).child(text).into_any_element();
        };
        let sorted = model::sorted_checks(&pr.status_checks);
        let limit = if collapse && !self.show_all_checks { COLLAPSED_CHECKS } else { sorted.len() };
        let hidden = sorted.len().saturating_sub(limit);
        let accent = colors.accent;
        let hover = colors.foreground;
        div()
            .flex()
            .flex_col()
            .gap(px(2.))
            .child(div().mb(px(4.)).text_color(tone_color(tone, colors)).child(summary))
            .children(sorted.into_iter().take(limit).enumerate().map(|(index, check)| {
                let state = model::check_state(check);
                let url = check.details_url.clone();
                let name = check.name.clone().unwrap_or_else(|| "Check".to_string());
                let tooltip = check.workflow_name.as_ref().map(|workflow| format!("{workflow} / {name}")).unwrap_or_else(|| name.clone());
                div()
                    .id(SharedString::from(format!("pr-check-{collapse}-{index}")))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(px(28.))
                    .mx(px(-6.))
                    .px(px(6.))
                    .rounded(metrics::RADIUS_MD)
                    .text_color(colors.muted_foreground)
                    .hover(move |style| style.bg(accent).text_color(hover))
                    .child(widgets::run_status_icon(&state, IconSize::Small, colors))
                    .child(div().flex_1().min_w_0().truncate().child(name))
                    .when(!collapse, |this| {
                        this.children(check.workflow_name.clone().map(|workflow| widgets::caption(workflow, colors).flex_none()))
                            .child(widgets::caption(state.label.clone(), colors).flex_none().w(px(90.)).text_right())
                    })
                    .anchored_tooltip({ let tip: SharedString = (tooltip).into(); move || ui::Tooltip::new(tip.clone()) })
                    .when_some(url, |this, url| this.on_click(move |_, _, cx| crate::links::open(cx, &url)))
            }))
            .when(collapse && (hidden > 0 || self.show_all_checks), |this| {
                this.child(
                    div().mt(px(4.)).child(
                        Button::new("pr-checks-more", if self.show_all_checks { "Show fewer".to_string() } else { format!("Show {hidden} more") })
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.show_all_checks = !this.show_all_checks;
                                cx.notify();
                            })),
                    ),
                )
            })
            .into_any_element()
    }

    fn render_checks_tab(&self, page: &Page, colors: &ThemeColors, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        div()
            .id("pr-checks")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .pt(px(24.))
            .pb(px(32.))
            .child(rail(div().text_size(typography::TEXT_SM).child(self.render_checks_list(page, false, colors, cx))))
            .scrollbar(window, cx)
            .into_any_element()
    }

    fn render_changes(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let Some(changes) = self.changes.clone() else {
            return match &self.changes_error {
                Some(error) => fill_message(
                    error.clone(),
                    None,
                    Some(Button::new("pr-changes-retry", "Retry").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| this.load_changes(cx))).into_any_element()),
                    colors,
                )
                .into_any_element(),
                None => fill_message("Loading diff…", None, None, colors).into_any_element(),
            };
        };
        if changes.diffs.is_empty() && changes.files.is_empty() {
            return fill_message("No file changes", None, None, colors).into_any_element();
        }
        let count = changes.diffs.len();
        let state = self.files.list().clone();
        let body = ui::with_scrollbar(
            list(state.clone(), cx.processor(|this, index: usize, _window, cx| this.render_file_entry(index, cx))).flex_1().size_full(),
            ui::Scrollbar::list("pr-files-scrollbar", &state),
        )
        .size_full()
        .into_any_element();
        let sticky = self.files.sticky_section().map(|file| self.render_file_header(file, cx));
        let header = Header {
            icon: None,
            title: div().child("Changed files").into_any_element(),
            detail: Some(div().child(model::plural(count, "file")).into_any_element()),
            actions: Vec::new(),
        };
        self.files.render(Some(header), body, sticky, None, cx)
    }

    /// One section per changed file (`pr-files-panel`), kept in step with the loaded changes.
    fn sync_file_sections(&mut self) {
        let Some(changes) = self.changes.clone() else { return };
        let sections = changes
            .diffs
            .iter()
            .map(|file| {
                let (additions, deletions) = file_counts(&changes, file);
                let mut metadata = Vec::new();
                if additions > 0 {
                    metadata.push((SharedString::from(format!("+{additions}")), multibuffer::Tone::Added));
                }
                if deletions > 0 {
                    metadata.push((SharedString::from(format!("-{deletions}")), multibuffer::Tone::Deleted));
                }
                let mut trailing = metadata.clone();
                if let Some(old) = &file.old_path {
                    trailing.insert(0, (format!("from {old}").into(), multibuffer::Tone::Subtle));
                }
                Section {
                    key: file.path.clone().into(),
                    path: file.path.clone().into(),
                    icon_path: None,
                    tone: match file.status {
                        FileStatus::Added => multibuffer::Tone::Added,
                        FileStatus::Deleted => multibuffer::Tone::Deleted,
                        FileStatus::Renamed => multibuffer::Tone::Renamed,
                        _ => multibuffer::Tone::Modified,
                    },
                    metadata,
                    trailing,
                    rows: if file.binary || file.lines.is_empty() { 1 } else { file.lines.len() },
                }
            })
            .collect();
        self.files.set_sections(sections, false);
    }

    fn render_file_entry(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        match self.files.entry(index) {
            Some(Entry::Header(file)) => self.render_file_header(file, cx),
            Some(Entry::Row(file, line)) => self.render_diff_row(file, line, cx),
            _ => div().into_any_element(),
        }
    }

    /// A changed file's header; its name opens the file in the project unless the pull request
    /// deletes it.
    fn render_file_header(&self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let Some(file) = self.changes.as_ref().and_then(|changes| changes.diffs.get(index)) else { return div().into_any_element() };
        let open: Option<OpenHandler<Self>> = (file.status != FileStatus::Deleted).then(|| {
            let path = safe_repo_path(&self.root, &file.path);
            Rc::new(move |_: &mut Self, _: &mut Window, cx: &mut Context<Self>| match &path {
                Some(path) => workbench_api::open_file(cx, path.clone(), None),
                None => {
                    notifications::notify(cx, notifications::NotificationKind::Error, notifications::NotificationCategory::GitHub, "Invalid file path in diff.", None, None);
                }
            }) as OpenHandler<Self>
        });
        self.files.render_header(index, Vec::new(), open, cx)
    }

    fn render_diff_row(&self, file: usize, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(file) = self.changes.as_ref().and_then(|changes| changes.diffs.get(file)) else { return div().into_any_element() };
        let notice = |text: &str| div().flex().items_center().justify_center().h(px(56.)).text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child(text.to_string()).into_any_element();
        if file.binary {
            return notice("Binary file not shown");
        }
        let Some(line) = file.lines.get(index) else { return notice("No diff hunks available for this file.") };
        let number = |value: Option<u32>| div().w(px(44.)).flex_none().pr(px(8.)).text_right().text_color(colors.subtle_foreground).children(value.map(|value| value.to_string()));
        let (bg, sign, fg) = match line.kind {
            LineKind::Added => (Some(colors.git_added.opacity(0.12)), "+", colors.foreground),
            LineKind::Removed => (Some(colors.git_deleted.opacity(0.12)), "-", colors.foreground),
            LineKind::Hunk => (Some(colors.info_soft), "", colors.subtle_foreground),
            LineKind::Note => (None, "", colors.subtle_foreground),
            LineKind::Context => (None, " ", colors.foreground),
        };
        let sign_color = match line.kind {
            LineKind::Added => colors.git_added,
            LineKind::Removed => colors.git_deleted,
            _ => colors.subtle_foreground,
        };
        div()
            .flex()
            .items_center()
            .h(px(20.))
            .w_full()
            .overflow_hidden()
            .font_family(typography::MONO_FONT)
            .text_size(typography::TEXT_SM)
            .line_height(relative(1.5))
            .whitespace_nowrap()
            .when_some(bg, |this, bg| this.bg(bg))
            .child(number(line.old))
            .child(number(line.new))
            .child(div().w(px(16.)).flex_none().text_color(sign_color).child(sign))
            .child(div().pr(px(16.)).text_color(fg).child(if line.text.is_empty() { " ".to_string() } else { line.text.replace('\t', "    ") }))
            .into_any_element()
    }

    fn render_notice(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (message, tone) = self.notice.clone()?;
        let theme = cx.theme().clone();
        Some(
            div()
                .absolute()
                .bottom(px(16.))
                .right(px(16.))
                .max_w(px(420.))
                .flex()
                .items_start()
                .gap(px(8.))
                .p(px(10.))
                .rounded(metrics::RADIUS_LG)
                .bg(colors.overlay)
                .shadow(theme.shadows.popover.clone())
                .text_size(typography::TEXT_SM)
                .child(Icon::new(if tone == Tone::Error { IconName::WarningCircle } else { IconName::CheckCircle }).size(IconSize::Small).color(tone_color(tone, colors)))
                .child(div().flex_1().min_w_0().text_color(colors.foreground).child(message))
                .child(Button::icon("pr-notice-close", IconName::X).size(ButtonSize::XSmall).on_click(cx.listener(|this, _, _, cx| {
                    this.notice = None;
                    cx.notify();
                })))
                .into_any_element(),
        )
    }
}

/// GitHub's own counts when it reported the file, else the diff's.
fn file_counts(changes: &Changes, file: &FileDiff) -> (usize, usize) {
    changes
        .files
        .iter()
        .find(|candidate| candidate.path == file.path)
        .map(|candidate| (candidate.additions.max(0) as usize, candidate.deletions.max(0) as usize))
        .unwrap_or_else(|| diff::counts(file))
}

/// A comment or a review with a body: its header row on the timeline, then the Markdown, or the
/// editor while it is being edited. `menu` shows while the pointer is over the comment.
#[allow(clippy::too_many_arguments)]
pub(crate) fn comment_item(
    id: &str,
    marker: AnyElement,
    login: &str,
    action: &str,
    at: &str,
    url: Option<String>,
    body: &[Block],
    menu: Option<AnyElement>,
    editor: Option<AnyElement>,
    colors: &ThemeColors,
    cx: &App,
) -> AnyElement {
    let now = Utc::now();
    let hover = colors.foreground;
    let group = SharedString::from(format!("{id}-group"));
    div()
        .group(group.clone())
        .flex()
        .flex_col()
        .gap(px(4.))
        .min_w_0()
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(12.))
                .child(timeline_marker(marker, colors))
                .child(
                    div()
                        .flex()
                        .flex_1()
                        .flex_wrap()
                        .items_center()
                        .gap_x(px(6.))
                        .min_w_0()
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.subtle_foreground)
                        .child(div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(login.to_string()))
                        .child(action.to_string())
                        .child(
                            div()
                                .id(SharedString::from(format!("{id}-time")))
                                .child(model::time_ago(at, now))
                                .when_some(url.filter(|url| !url.is_empty()), |this, url| this.hover(move |style| style.text_color(hover)).on_click(move |_, _, cx| cx.open_url(&url))),
                        ),
                )
                .when_some(menu, |this, menu| this.child(div().flex_none().opacity(0.).group_hover(group.clone(), |style| style.opacity(1.)).child(menu)))
        )
        .child(div().pl(px(36.)).min_w_0().child(match editor {
            Some(editor) => editor,
            None if body.is_empty() => div().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("No description provided").into_any_element(),
            None => markdown::render(body, id, cx),
        }))
        .into_any_element()
}

impl Render for PullRequestView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_file_sections();
        let colors = cx.theme().colors.clone();
        let container = div()
            .id("pr-view")
            .track_focus(&self.focus_handle)
            .relative()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_color(colors.foreground);
        let Some(page) = self.page.clone() else {
            let body = match &self.error {
                Some(error) => fill_message(
                    format!("PR #{}", self.number),
                    Some(error.clone()),
                    Some(Button::new("pr-retry", "Retry").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| this.load(cx))).into_any_element()),
                    &colors,
                ),
                None => fill_message(format!("Loading pull request #{}…", self.number), None, None, &colors),
            };
            return container.child(body);
        };
        let content = match self.tab {
            Tab::Overview => self.render_overview(&page, &colors, window, cx),
            Tab::Changes => self.render_changes(&colors, cx),
            Tab::Checks => self.render_checks_tab(&page, &colors, window, cx),
        };
        container
            .child(div().flex_none().pt(px(20.)).pb(px(8.)).child(rail(self.render_summary(&page, &colors, cx))))
            .when_some(self.error.clone(), |this, error| {
                this.child(rail(div().pb(px(6.)).text_size(typography::TEXT_SM).text_color(colors.destructive).child(error)))
            })
            .child(div().flex_none().border_b_1().border_color(colors.divider).child(rail(self.render_tabs(&page, &colors, cx))))
            .child(div().flex().flex_col().flex_1().min_h_0().child(content))
            .children(self.render_notice(&colors, cx))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
            .children(self.popover.as_ref().map(|popover| popover.render()))
            .children(self.confirmation.as_ref().map(|confirmation| confirmation.render(cx)))
    }
}

/// A title that turns into a field when clicked (`GitHubInlineTitle`).
pub(crate) fn editable_title(id: &'static str, title: &str, colors: &ThemeColors) -> gpui::Stateful<gpui::Div> {
    let accent = colors.accent;
    div()
        .id(id)
        .min_w_0()
        .px(px(4.))
        .ml(px(-4.))
        .rounded(metrics::RADIUS_MD)
        .truncate()
        .hover(move |style| style.bg(accent))
        .anchored_tooltip({ let tip: SharedString = ("Edit title").into(); move || ui::Tooltip::new(tip.clone()) })
        .child(title.to_string())
}

/// "Add labels" and "Add assignees" in an empty sidebar section.
pub(crate) fn add_button(id: &'static str, label: &'static str, disabled: bool) -> Button {
    Button::new(id, label).leading_icon(IconName::Plus).variant(ButtonVariant::Ghost).size(ButtonSize::Small).disabled(disabled)
}

/// Why the labels and milestones could not be read, with Retry (`GitHubMetadataError`).
pub(crate) fn metadata_error(id: &'static str, error: SharedString, colors: &ThemeColors) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .flex()
        .flex_col()
        .gap(px(4.))
        .p(px(8.))
        .rounded(metrics::RADIUS_MD)
        .bg(colors.destructive_soft)
        .text_size(typography::TEXT_SM)
        .text_color(colors.destructive)
        .child(div().font_weight(typography::MEDIUM).child("Labels and milestones are unavailable"))
        .child(div().text_color(colors.muted_foreground).child(error))
        .child(div().font_weight(typography::MEDIUM).child("Retry"))
}

#[cfg(feature = "snapshot")]
impl PullRequestView {
    pub(crate) fn seed(root: &std::path::Path, details: PullRequestDetails, comments: Vec<PullRequestComment>, cx: &mut App) {
        store::put(page_key(root, details.number), Arc::new(build_page(details, Some(comments), None)), cx);
    }

    /// Puts the page in one of the states the snapshot example draws.
    pub(crate) fn snapshot(&mut self, state: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.error = None;
        self.metadata_error = None;
        self.current_user = Some("mehmet".into());
        match state {
            "composer" => self.composer.update(cx, |editor, cx| editor.set_text("Looks good — one nit on the **tab order**.", cx)),
            "approve" => self.open_inline_action(ActionKind::RequestChanges, window, cx),
            "merge" => self.open_inline_action(ActionKind::Merge, window, cx),
            "edit" => {
                self.start_title_edit(window, cx);
                self.start_body_edit(window, cx);
            }
            "comment-edit" => {
                if let Some((comment, _)) = self.page.clone().and_then(|page| page.comments.as_ref().and_then(|comments| comments.first().cloned())) {
                    self.start_comment_edit(comment.id, comment.body, window, cx);
                }
            }
            "labels" => {
                let picker = cx.new(|cx| LabelPicker::new(self.available_labels(), vec!["port".into()], false, window, cx));
                self.popover = Some(Popover::new("labels", picker.into(), gpui::point(px(1210.), px(430.)), Vec::new()));
            }
            "assignees" => {
                let picker = cx.new(|cx| AssigneePicker::new(vec!["mehmet".into(), "ana".into()], window, cx));
                self.popover = Some(Popover::new("assignees", picker.into(), gpui::point(px(1210.), px(380.)), Vec::new()));
            }
            "commits" => {
                let entries = self.commits_menu();
                let menu = OpenMenu::sized("pr-commits", entries, MenuSize::Panel, gpui::point(px(330.), px(250.)), Anchor::TopLeft, window, cx, |this: &mut Self, _| this.open_menu = None)
                    .searchable("Search commits", "No commits match", cx);
                self.open_menu = Some(menu);
            }
            "close" => self.close_pull_request(window, cx),
            "comment-menu" => {
                if let Some((comment, _)) = self.page.clone().and_then(|page| page.comments.as_ref().and_then(|comments| comments.first().cloned())) {
                    let entries = self.comment_menu(&comment, true, cx);
                    menus::show(self, "comment-menu", entries, gpui::point(px(760.), px(520.)), Anchor::TopRight, window, cx);
                }
            }
            "actions" => {
                if let Some(page) = self.page.clone() {
                    let entries = self.actions_menu(&page, cx);
                    menus::show(self, "pr-actions", entries, gpui::point(px(1240.), px(60.)), Anchor::TopRight, window, cx);
                }
            }
            _ => {}
        }
        cx.notify();
    }
}

/// `resolveSafeRepoFilePath`: a diff's path inside the repository, or `None` for one that is
/// absolute, climbs out (`..`), names `.`, carries a drive letter or a NUL.
fn safe_repo_path(root: &std::path::Path, path: &str) -> Option<std::path::PathBuf> {
    let normalized = path.replace('\\', "/");
    if normalized.is_empty() || normalized.contains('\0') || normalized.starts_with('/') {
        return None;
    }
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return None;
    }
    let mut joined = root.to_path_buf();
    for part in normalized.split('/').filter(|part| !part.is_empty()) {
        if part == "." || part == ".." {
            return None;
        }
        joined.push(part);
    }
    (joined != root).then_some(joined)
}

#[cfg(test)]
mod safe_path_tests {
    use std::path::Path;

    #[test]
    fn rejects_paths_leaving_the_repository() {
        let root = Path::new("/repo");
        assert_eq!(super::safe_repo_path(root, "src/a.rs").as_deref(), Some(Path::new("/repo/src/a.rs")));
        for bad in ["../etc/passwd", "a/../../b", "/etc/passwd", "C:/x", "./a", "a\0b", ""] {
            assert!(super::safe_repo_path(root, bad).is_none(), "{bad}");
        }
    }
}

impl PullRequestView {
    /// The author's login and the pull request's state, once loaded (detached title bars).
    pub(crate) fn chrome(&self) -> Option<(String, String, model::Tone)> {
        let details = &self.page.as_ref()?.details;
        let status = PrStatus::of_details(details);
        Some((details.author.login.clone(), status.label().to_string(), status.tone()))
    }
}
