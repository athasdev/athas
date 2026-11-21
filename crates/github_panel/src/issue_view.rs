//! An issue in the centre (`github-issue-viewer.tsx`): summary with close, reopen and lock,
//! the editable title and description, activity with the comment box, and the type, milestone,
//! assignees and labels in the sidebar.

use ui::WithScrollbar as _;
use std::{path::PathBuf, sync::Arc};

use crate::gh::{IssueComment, IssueDetails, Label};
use chrono::Utc;
use gpui::{
    Anchor, AnyElement, App, ClickEvent, Context, DismissEvent, Entity, FocusHandle, Focusable, IntoElement, Render, SharedString, Subscription, Window, div, prelude::*, px,
};
use theme::{ActiveTheme, ThemeColors};
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, MenuEntry, OpenMenu, Select, SelectEvent, SelectOption, SelectVariant, SelectWidth, TextInput, TextInputEvent, typography};

use crate::{
    editor::{self, AssigneePicker, ConfirmHost, Confirmation, EditorEvent, LabelPicker, MarkdownEditor, PickerEvent, Popover},
    markdown::{self, Block},
    menus::{self, MenuHost, below},
    model::{self, IssueEvent, Tone},
    mutation::{self, IssueChange, IssueState, LOCK_REASONS, Mutation, Outcome},
    pr_view::{add_button, comment_item, editable_title, metadata_error, repository_url},
    store::{self, Metadata},
    widgets::{Summary, badge, event_row, fill_message, label_chip, meta_chip, rail, section, timeline, tone_color, user_chip},
};

struct Page {
    issue: IssueDetails,
    body: Vec<Block>,
    comments: Vec<Vec<Block>>,
}

fn build_page(issue: IssueDetails) -> Page {
    let repo = repository_url(&issue.url);
    let parse = |source: &str| markdown::parse(source, Some(&repo));
    Page { body: parse(&issue.body), comments: issue.comments.iter().map(|comment| parse(&comment.body)).collect(), issue }
}

pub struct IssueView {
    root: PathBuf,
    number: i64,
    focus_handle: FocusHandle,
    page: Option<Arc<Page>>,
    error: Option<SharedString>,
    loading: bool,
    open_menu: Option<OpenMenu>,
    current_user: Option<String>,
    metadata: Option<Arc<Metadata>>,
    metadata_error: Option<SharedString>,
    /// The change being sent: `edit`, `state`, `lock`, `new-comment` or `comment-<id>`.
    mutation: Option<String>,
    notice: Option<SharedString>,
    title_input: Option<(Entity<TextInput>, Subscription)>,
    body_editor: Option<(Entity<MarkdownEditor>, Subscription)>,
    comment_editor: Option<(i64, Entity<MarkdownEditor>, Subscription)>,
    composer: Entity<MarkdownEditor>,
    composer_error: Option<SharedString>,
    type_select: Entity<Select>,
    milestone_select: Entity<Select>,
    popover: Option<Popover>,
    confirmation: Option<Confirmation>,
    _subscriptions: Vec<Subscription>,
}

impl Focusable for IssueView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl MenuHost for IssueView {
    fn menu_slot(&mut self) -> &mut Option<OpenMenu> {
        &mut self.open_menu
    }
}

impl ConfirmHost for IssueView {
    fn confirmation_slot(&mut self) -> &mut Option<Confirmation> {
        &mut self.confirmation
    }
}

fn page_key(root: &std::path::Path, number: i64) -> String {
    format!("{}|issue|{number}", root.display())
}

fn type_options(metadata: Option<&Metadata>) -> Vec<SelectOption> {
    let mut options = vec![SelectOption::new("none", "No type")];
    options.extend(metadata.into_iter().flat_map(|metadata| metadata.issue_types.iter().map(|kind| SelectOption::new(kind.name.clone(), kind.name.clone()))));
    options
}

fn milestone_options(metadata: Option<&Metadata>) -> Vec<SelectOption> {
    let mut options = vec![SelectOption::new("none", "No milestone")];
    options.extend(metadata.into_iter().flat_map(|metadata| metadata.milestones.iter().map(|milestone| SelectOption::new(milestone.number.to_string(), milestone.title.clone()))));
    options
}

impl IssueView {
    pub fn new(root: PathBuf, number: i64, _window: &mut Window, cx: &mut Context<Self>) -> Self {
        let page = store::get::<Page>(&page_key(&root, number), cx);
        let metadata = store::get::<Metadata>(&store::metadata_key(&root.to_string_lossy()), cx);
        let repository_url = page.as_ref().map(|page| repository_url(&page.issue.url));
        let composer = cx.new(|cx| MarkdownEditor::new("issue-composer", "Leave a comment...", 3, repository_url, cx));
        let type_value = page.as_ref().and_then(|page| page.issue.issue_type.as_ref().map(|kind| kind.name.clone())).unwrap_or_else(|| "none".into());
        let milestone_value = page.as_ref().and_then(|page| page.issue.milestone.as_ref().map(|milestone| milestone.number.to_string())).unwrap_or_else(|| "none".into());
        let type_select = cx.new(|cx| Select::new(type_options(metadata.as_deref()), type_value, cx).variant(SelectVariant::Ghost).width(SelectWidth::Full));
        let milestone_select = cx.new(|cx| Select::new(milestone_options(metadata.as_deref()), milestone_value, cx).variant(SelectVariant::Ghost).width(SelectWidth::Full));
        let subscriptions = vec![
            cx.subscribe(&composer, |this, _, event: &EditorEvent, cx| match event {
                EditorEvent::Submit => this.submit_comment(cx),
                EditorEvent::Changed => {
                    this.composer_error = None;
                    cx.notify();
                }
                EditorEvent::Cancel => {}
            }),
            cx.subscribe(&type_select, |this, _, event: &SelectEvent, cx| {
                if let SelectEvent::Changed(value) = event {
                    let kind = (value.as_ref() != "none").then(|| value.to_string());
                    this.update_issue(IssueChange { issue_type: Some(kind), ..Default::default() }, cx);
                }
            }),
            cx.subscribe(&milestone_select, |this, _, event: &SelectEvent, cx| {
                if let SelectEvent::Changed(value) = event {
                    this.update_issue(IssueChange { milestone: Some(value.parse().ok()), ..Default::default() }, cx);
                }
            }),
        ];
        let mut view = Self {
            root,
            number,
            focus_handle: cx.focus_handle(),
            page,
            error: None,
            loading: false,
            open_menu: None,
            current_user: None,
            metadata,
            metadata_error: None,
            mutation: None,
            notice: None,
            title_input: None,
            body_editor: None,
            comment_editor: None,
            composer,
            composer_error: None,
            type_select,
            milestone_select,
            popover: None,
            confirmation: None,
            _subscriptions: subscriptions,
        };
        if let Some(page) = view.page.clone() {
            view.configure_composer(&page.issue, cx);
        }
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

    fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        if self.loading {
            return;
        }
        self.loading = true;
        cx.notify();
        let (path, number) = (self.path(), self.number);
        store::fetch(cx, move |token| Ok(build_page(crate::gh::github_get_issue_details(path, number, Some(token))?)), |this, result, cx| {
            this.loading = false;
            match result {
                Ok(page) => {
                    this.set_page(page, cx);
                    this.error = None;
                }
                Err(error) => this.error = Some(error.into()),
            }
            cx.notify();
        });
    }

    fn load_metadata(&mut self, cx: &mut Context<Self>) {
        store::load_metadata(cx, self.path(), |this, result, cx| {
            match result {
                Ok(metadata) => {
                    this.type_select.update(cx, |select, cx| select.set_options(type_options(Some(&metadata)), cx));
                    this.milestone_select.update(cx, |select, cx| select.set_options(milestone_options(Some(&metadata)), cx));
                    this.metadata = Some(metadata);
                    this.metadata_error = None;
                }
                Err(error) => this.metadata_error = Some(error.into()),
            }
            cx.notify();
        });
    }

    fn set_page(&mut self, page: Page, cx: &mut Context<Self>) {
        let type_value = page.issue.issue_type.as_ref().map(|kind| kind.name.clone()).unwrap_or_else(|| "none".into());
        let milestone_value = page.issue.milestone.as_ref().map(|milestone| milestone.number.to_string()).unwrap_or_else(|| "none".into());
        self.type_select.update(cx, |select, cx| select.set_value(type_value, cx));
        self.milestone_select.update(cx, |select, cx| select.set_value(milestone_value, cx));
        self.configure_composer(&page.issue, cx);
        let page = Arc::new(page);
        store::put(page_key(&self.root, self.number), page.clone(), cx);
        self.page = Some(page);
        cx.notify();
    }

    fn configure_composer(&self, issue: &IssueDetails, cx: &mut Context<Self>) {
        let repository = repository_url(&issue.url);
        let (locked, busy) = (issue.locked, self.mutation.is_some());
        self.composer.update(cx, |editor, cx| {
            editor.set_repository_url(Some(repository));
            editor.set_placeholder(if locked { "This conversation is locked" } else { "Leave a comment..." }, cx);
            if !busy {
                editor.set_disabled(locked, cx);
            }
        });
    }

    fn set_notice(&mut self, message: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.notice = Some(message.into());
        cx.notify();
    }

    /// Sends one change; nothing else can start until it answers.
    fn run(&mut self, key: impl Into<String>, mutation: Mutation, cx: &mut Context<Self>, apply: impl FnOnce(&mut Self, Outcome, &mut Context<Self>) + 'static) -> bool {
        if self.mutation.is_some() {
            return false;
        }
        self.mutation = Some(key.into());
        cx.notify();
        store::mutate(cx, self.path(), mutation, move |this, result, cx| {
            this.mutation = None;
            match result {
                Ok(outcome) => {
                    store::bump(cx);
                    apply(this, outcome, cx);
                }
                Err(error) => this.set_notice(error, cx),
            }
            cx.notify();
        });
        true
    }

    fn apply_issue(&mut self, outcome: Outcome, cx: &mut Context<Self>) {
        match outcome {
            Outcome::Issue(issue) => self.set_page(build_page(*issue), cx),
            _ => self.load(cx),
        }
    }

    fn update_issue(&mut self, change: IssueChange, cx: &mut Context<Self>) {
        let Some(page) = self.page.clone() else { return };
        self.run("edit", mutation::update_issue(&page.issue, change), cx, |this, outcome, cx| {
            this.title_input = None;
            this.body_editor = None;
            this.apply_issue(outcome, cx);
        });
    }

    fn set_state(&mut self, state: IssueState, cx: &mut Context<Self>) {
        let number = self.number;
        self.run("state", Mutation::SetIssueState { number, state }, cx, |this, outcome, cx| this.apply_issue(outcome, cx));
    }

    fn set_lock(&mut self, reason: Option<&'static str>, cx: &mut Context<Self>) {
        let number = self.number;
        let change = match reason {
            Some(reason) => Mutation::Lock { number, reason: reason.to_string() },
            None => Mutation::Unlock { number },
        };
        self.run("lock", change, cx, |this, _, cx| this.load(cx));
    }

    fn start_title_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(page) = self.page.clone() else { return };
        let input = cx.new(|cx| {
            let mut input = TextInput::new(window, cx);
            input.set_text(page.issue.title.clone(), cx);
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
        if title.is_empty() || title == page.issue.title {
            self.title_input = None;
            cx.notify();
            return;
        }
        self.update_issue(IssueChange { title: Some(title), ..Default::default() }, cx);
    }

    fn start_body_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(page) = self.page.clone() else { return };
        let editor = cx.new(|cx| {
            let mut editor = MarkdownEditor::new("issue-body-editor", "Write a description...", 10, Some(repository_url(&page.issue.url)), cx);
            editor.set_text(&page.issue.body, cx);
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
        if body == page.issue.body {
            self.body_editor = None;
            cx.notify();
            return;
        }
        self.update_issue(IssueChange { body: Some(body), ..Default::default() }, cx);
    }

    /// Replaces the issue's comments with `comments`, as GitHub now has them.
    fn with_comments(&mut self, edit: impl FnOnce(&mut Vec<IssueComment>), cx: &mut Context<Self>) {
        let Some(page) = self.page.clone() else { return };
        let mut issue = page.issue.clone();
        edit(&mut issue.comments);
        self.set_page(build_page(issue), cx);
    }

    fn submit_comment(&mut self, cx: &mut Context<Self>) {
        let body = self.composer.read(cx).text(cx);
        if body.trim().is_empty() || self.page.as_ref().is_some_and(|page| page.issue.locked) || self.mutation.is_some() {
            return;
        }
        self.composer_error = None;
        let number = self.number;
        self.mutation = Some("new-comment".into());
        self.composer.update(cx, |editor, cx| editor.set_disabled(true, cx));
        cx.notify();
        store::mutate(cx, self.path(), Mutation::AddIssueComment { number, body }, |this, result, cx| {
            this.mutation = None;
            let locked = this.page.as_ref().is_some_and(|page| page.issue.locked);
            this.composer.update(cx, |editor, cx| editor.set_disabled(locked, cx));
            match result {
                Ok(outcome) => {
                    store::bump(cx);
                    this.composer.update(cx, |editor, cx| {
                        editor.set_text("", cx);
                    });
                    match outcome {
                        Outcome::IssueComment(comment) => this.with_comments(|comments| comments.push(comment), cx),
                        _ => this.load(cx),
                    }
                }
                Err(error) => this.composer_error = Some(error.into()),
            }
            cx.notify();
        });
    }

    fn start_comment_edit(&mut self, id: i64, body: String, window: &mut Window, cx: &mut Context<Self>) {
        let repository = self.page.as_ref().map(|page| repository_url(&page.issue.url));
        let editor = cx.new(|cx| {
            let mut editor = MarkdownEditor::new(format!("issue-comment-editor-{id}"), "Edit comment...", 6, repository, cx);
            editor.set_text(&body, cx);
            editor
        });
        let subscription = cx.subscribe(&editor, |this, _, event: &EditorEvent, cx| match event {
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
        self.run(format!("comment-{id}"), Mutation::EditComment { id, body }, cx, move |this, outcome, cx| {
            this.comment_editor = None;
            match outcome {
                Outcome::IssueComment(comment) => this.with_comments(
                    |comments| {
                        if let Some(existing) = comments.iter_mut().find(|candidate| candidate.id == id) {
                            *existing = comment;
                        }
                    },
                    cx,
                ),
                _ => this.load(cx),
            }
        });
    }

    fn delete_comment(&mut self, id: i64, window: &mut Window, cx: &mut Context<Self>) {
        editor::confirm(self, "Delete comment", "Delete this comment permanently?", "Delete", true, window, cx, move |this, _, cx| {
            this.run(format!("comment-{id}"), Mutation::DeleteComment { id }, cx, move |this, _, cx| this.with_comments(|comments| comments.retain(|comment| comment.id != id), cx));
        });
    }

    fn available_labels(&self) -> Vec<Label> {
        let mut labels: Vec<Label> = self.metadata.as_ref().map(|metadata| metadata.labels.clone()).unwrap_or_default();
        if let Some(page) = &self.page {
            for label in &page.issue.labels {
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
        let selected = page.issue.labels.iter().map(|label| label.name.clone()).collect();
        let loading = self.metadata.is_none();
        let picker = cx.new(|cx| LabelPicker::new(self.available_labels(), selected, loading, window, cx));
        let subscriptions = vec![
            cx.subscribe(&picker, |this, _, PickerEvent::Changed(labels): &PickerEvent, cx| {
                this.update_issue(IssueChange { labels: Some(labels.clone()), ..Default::default() }, cx)
            }),
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
        let value = page.issue.assignees.iter().map(|user| user.login.clone()).collect();
        let picker = cx.new(|cx| AssigneePicker::new(value, window, cx));
        let subscriptions = vec![
            cx.subscribe(&picker, |this, _, PickerEvent::Changed(assignees): &PickerEvent, cx| {
                this.update_issue(IssueChange { assignees: Some(assignees.clone()), ..Default::default() }, cx)
            }),
            cx.subscribe(&picker, |this, _, _: &DismissEvent, cx| {
                this.popover = None;
                cx.notify();
            }),
        ];
        self.popover = Some(Popover::new("assignees", picker.into(), editor::popover_position(event), subscriptions));
        cx.notify();
    }

    fn actions_menu(&self, page: &Page, cx: &Context<Self>) -> Vec<MenuEntry> {
        let issue = &page.issue;
        let busy = self.mutation.is_some();
        let mut entries: Vec<MenuEntry> = Vec::new();
        if model::issue_is_open(&issue.state) {
            entries.push(menus::item("Close as not planned", cx, |this, _, cx| this.set_state(IssueState::NotPlanned, cx)).icon(IconName::MinusCircle).disabled(busy).into());
        }
        if issue.locked {
            entries.push(menus::item("Unlock conversation", cx, |this, _, cx| this.set_lock(None, cx)).icon(IconName::LockOpen).disabled(busy).into());
        } else {
            for (index, (reason, label)) in LOCK_REASONS.iter().enumerate() {
                let item = menus::item(*label, cx, move |this, _, cx| this.set_lock(Some(reason), cx)).disabled(busy);
                entries.push(if index == 0 { item.icon(IconName::Lock) } else { item }.into());
            }
        }
        entries.push(MenuEntry::Separator);
        entries.push(menus::item(if self.loading { "Refreshing…" } else { "Refresh" }, cx, |this, _, cx| this.load(cx)).icon(IconName::ArrowClockwise).disabled(self.loading).into());
        entries.push(menus::link("Open on GitHub", issue.url.clone()).icon(IconName::OpenExternal).into());
        entries.push(menus::copy_named("Copy link", "Issue link", issue.url.clone()).icon(IconName::Link).into());
        entries
    }

    fn comment_menu(&self, comment: &IssueComment, can_manage: bool, cx: &Context<Self>) -> Vec<MenuEntry> {
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

    fn render_summary(&self, page: &Page, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let issue = &page.issue;
        let now = Utc::now();
        let open = model::issue_is_open(&issue.state);
        let tone = model::issue_tone(&issue.state, issue.state_reason.as_deref());
        let state_label = match (open, issue.state_reason.as_deref()) {
            (true, _) => "Open".to_string(),
            (false, Some(reason)) if !reason.is_empty() => format!("Closed as {}", reason.to_lowercase().replace('_', " ")),
            (false, _) => "Closed".to_string(),
        };
        let mut badges = vec![badge(state_label, tone, colors).into_any_element()];
        if issue.locked {
            let label = issue.active_lock_reason.clone().filter(|reason| !reason.is_empty()).map(|reason| format!("Locked as {}", reason.replace('_', " "))).unwrap_or_else(|| "Locked".to_string());
            badges.push(badge(label, Tone::Warning, colors).into_any_element());
        }
        let state_busy = self.mutation.as_deref() == Some("state");
        let state_button = if open {
            Button::new("issue-close", if state_busy { "Closing…" } else { "Close" })
                .leading_icon(IconName::CheckCircle)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .disabled(self.mutation.is_some())
                .on_click(cx.listener(|this, _, _, cx| this.set_state(IssueState::Completed, cx)))
        } else {
            Button::new("issue-reopen", if state_busy { "Reopening…" } else { "Reopen" })
                .leading_icon(IconName::CircleDot)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .disabled(self.mutation.is_some())
                .on_click(cx.listener(|this, _, _, cx| this.set_state(IssueState::Reopened, cx)))
        };
        let actions = vec![
            state_button.into_any_element(),
            Button::icon("issue-actions", IconName::Dots)
                .size(ButtonSize::Small)
                .active(menus::is_open(&self.open_menu, "issue-actions"))
                .tooltip("Issue actions")
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                    let Some(page) = this.page.clone() else { return };
                    let entries = this.actions_menu(&page, cx);
                    menus::show(this, "issue-actions", entries, below(event), Anchor::TopRight, window, cx);
                }))
                .into_any_element(),
        ];
        let mut meta = vec![
            meta_chip("issue-number", None, format!("#{}", issue.number), Some(issue.url.clone()), false, colors).into_any_element(),
            user_chip("issue-author", &issue.author.login, colors).text_color(colors.foreground).into_any_element(),
            div().child(format!("Opened {}", model::time_ago(&issue.created_at, now))).into_any_element(),
            div().child(format!("Updated {}", model::time_ago(&issue.updated_at, now))).into_any_element(),
        ];
        if self.loading {
            meta.push(crate::widgets::caption("Refreshing…", colors).into_any_element());
        }
        if let Some(closed) = &issue.closed_at {
            meta.push(div().child(format!("Closed {}", model::time_ago(closed, now))).into_any_element());
        }
        if let Some(user) = &issue.closed_by {
            meta.push(div().flex().items_center().gap(px(4.)).child("Closed by").child(user_chip("issue-closed-by", &user.login, colors)).into_any_element());
        }
        meta.push(div().child(model::plural(issue.comments.len(), "comment")).into_any_element());
        let icon = Icon::new(IconName::CircleDot).size(IconSize::Custom(px(20.))).color(tone_color(tone, colors));
        let title = match &self.title_input {
            Some((input, _)) => div().w(px(560.)).min_w_0().text_size(typography::TEXT_BASE).child(input.clone()).into_any_element(),
            None => editable_title("issue-title", &issue.title, colors).on_click(cx.listener(|this, _, window, cx| this.start_title_edit(window, cx))).into_any_element(),
        };
        Summary { icon: icon.into_any_element(), title, badges, description: None, meta, actions, aside: None }.render(colors).into_any_element()
    }

    fn render_description(&self, page: &Page, colors: &ThemeColors, cx: &mut Context<Self>) -> (AnyElement, Option<AnyElement>) {
        if let Some((editor, _)) = &self.body_editor {
            let body = div()
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(editor.clone())
                .child(editor::save_row(
                    "issue-body",
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
                .id("issue-body-empty")
                .text_size(typography::TEXT_SM)
                .italic()
                .text_color(colors.subtle_foreground)
                .child("No description provided")
                .on_click(cx.listener(|this, _, window, cx| this.start_body_edit(window, cx)))
                .into_any_element()
        } else {
            markdown::render(&page.body, "issue-body", cx)
        };
        let edit = Button::icon("issue-body-edit", IconName::PencilLine)
            .size(ButtonSize::XSmall)
            .tooltip("Edit description")
            .disabled(self.mutation.is_some())
            .on_click(cx.listener(|this, _, window, cx| this.start_body_edit(window, cx)))
            .into_any_element();
        (body, Some(edit))
    }

    fn render_activity(&self, page: &Page, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let issue = &page.issue;
        let now = Utc::now();
        let strong = |text: &str| div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(text.to_string()).into_any_element();
        let time = |at: &str| div().child(model::time_ago(at, now)).into_any_element();
        let mut items: Vec<AnyElement> = Vec::new();
        for (index, (at, event)) in model::issue_timeline(issue).into_iter().enumerate() {
            items.push(match event {
                IssueEvent::Opened => event_row(
                    Icon::new(IconName::CircleDot).size(IconSize::Small).color(colors.success),
                    vec![strong(&issue.author.login), div().child("opened this issue").into_any_element(), time(&at)],
                    colors,
                )
                .into_any_element(),
                IssueEvent::Comment(comment) => {
                    let body = issue.comments.iter().position(|candidate| std::ptr::eq(candidate, comment)).and_then(|index| page.comments.get(index));
                    let edited = comment.updated_at != comment.created_at && !comment.updated_at.is_empty();
                    let can_manage = mutation::can_manage(self.current_user.as_deref(), &comment.author.login);
                    let busy = self.mutation.as_deref() == Some(format!("comment-{}", comment.id).as_str());
                    let menu_key = format!("issue-comment-menu-{}", comment.id);
                    let menu = (can_manage || !comment.url.is_empty()).then(|| {
                        let comment = comment.clone();
                        let key = menu_key.clone();
                        Button::icon(SharedString::from(menu_key.clone()), IconName::Dots)
                            .size(ButtonSize::XSmall)
                            .tooltip("Comment actions")
                            .active(menus::is_open(&self.open_menu, &menu_key))
                            .disabled(busy)
                            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                                let entries = this.comment_menu(&comment, can_manage, cx);
                                menus::show(this, &key, entries, below(event), Anchor::TopRight, window, cx);
                            }))
                            .into_any_element()
                    });
                    let editor = self.comment_editor.as_ref().filter(|(id, _, _)| *id == comment.id).map(|(id, editor, _)| {
                        let can_save = !editor.read(cx).text(cx).trim().is_empty();
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .child(editor.clone())
                            .child(editor::save_row(
                                &format!("issue-comment-edit-{id}"),
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
                        &format!("issue-comment-{index}"),
                        crate::widgets::avatar(&comment.author.login, 24.).into_any_element(),
                        &comment.author.login,
                        if edited { "commented · edited" } else { "commented" },
                        &at,
                        Some(comment.url.clone()),
                        body.map(Vec::as_slice).unwrap_or_default(),
                        menu,
                        editor,
                        colors,
                        cx,
                    )
                }
                IssueEvent::Closed => {
                    let tone = model::issue_tone(&issue.state, issue.state_reason.as_deref());
                    let mut words = Vec::new();
                    if let Some(user) = &issue.closed_by {
                        words.push(strong(&user.login));
                    }
                    let verb = if tone == Tone::Muted { "closed this as not planned" } else { "closed this as completed" };
                    words.push(div().child(if issue.closed_by.is_some() { verb.to_string() } else { "Closed".to_string() }).into_any_element());
                    words.push(time(&at));
                    event_row(Icon::new(IconName::CheckCircle).size(IconSize::Small).color(tone_color(tone, colors)), words, colors).into_any_element()
                }
            });
        }
        let locked = issue.locked;
        let can_comment = !locked && self.mutation.is_none() && !self.composer.read(cx).text(cx).trim().is_empty();
        div()
            .flex()
            .flex_col()
            .gap(px(20.))
            .child(timeline(items, colors))
            .when(issue.comments.is_empty(), |this| this.child(div().pl(px(36.)).text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("No comments yet")))
            .child(editor::composer(
                "issue-composer",
                &self.composer,
                self.current_user.as_deref(),
                self.mutation.as_deref() == Some("new-comment"),
                can_comment,
                self.composer_error.clone(),
                cx.listener(|this, _, _, cx| this.submit_comment(cx)),
                colors,
            ))
            .into_any_element()
    }

    fn render_sidebar(&self, page: &Page, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let issue = &page.issue;
        let busy = self.mutation.is_some();
        let assignees = if issue.assignees.is_empty() {
            div().flex().ml(px(-8.)).child(add_button("issue-assignees-add", "Add assignees", busy).on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_assignee_picker(event, window, cx)))).into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .text_color(colors.foreground)
                .children(issue.assignees.iter().enumerate().map(|(index, user)| user_chip(SharedString::from(format!("issue-assignee-{index}")), &user.login, colors)))
                .into_any_element()
        };
        let assignee_action = (!issue.assignees.is_empty()).then(|| {
            Button::icon("issue-assignees-edit", IconName::User)
                .size(ButtonSize::XSmall)
                .tooltip("Edit assignees")
                .disabled(busy)
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_assignee_picker(event, window, cx)))
                .into_any_element()
        });
        let labels = if issue.labels.is_empty() {
            div().flex().ml(px(-8.)).child(add_button("issue-labels-add", "Add labels", busy).on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_label_picker(event, window, cx)))).into_any_element()
        } else {
            div().flex().flex_wrap().gap(px(4.)).children(issue.labels.iter().map(|label| label_chip(&label.name, &label.color, colors))).into_any_element()
        };
        let label_action = (!issue.labels.is_empty()).then(|| {
            Button::icon("issue-labels-edit", IconName::Tag)
                .size(ButtonSize::XSmall)
                .tooltip("Edit labels")
                .disabled(busy)
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_label_picker(event, window, cx)))
                .into_any_element()
        });
        let milestone_action = issue.milestone.as_ref().map(|milestone| {
            let url = format!("{}/milestone/{}", repository_url(&issue.url), milestone.number);
            Button::icon("issue-milestone-open", IconName::OpenExternal).size(ButtonSize::XSmall).tooltip("Open milestone on GitHub").on_click(move |_, _, cx| cx.open_url(&url)).into_any_element()
        });
        div()
            .flex()
            .flex_col()
            .gap(px(24.))
            .w(px(240.))
            .flex_none()
            .children(self.metadata_error.clone().map(|error| metadata_error("issue-metadata-retry", error, colors).on_click(cx.listener(|this, _, _, cx| this.load_metadata(cx)))))
            .child(section("Type", None, div().ml(px(-8.)).child(self.type_select.clone()), colors))
            .child(section("Milestone", milestone_action, div().ml(px(-8.)).child(self.milestone_select.clone()), colors))
            .child(section("Assignees", assignee_action, assignees, colors))
            .child(section("Labels", label_action, labels, colors))
            .into_any_element()
    }

    fn render_notice(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let message = self.notice.clone()?;
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
                .rounded(ui::metrics::RADIUS_LG)
                .bg(colors.overlay)
                .shadow(theme.shadows.popover.clone())
                .text_size(typography::TEXT_SM)
                .child(Icon::new(IconName::WarningCircle).size(IconSize::Small).color(colors.destructive))
                .child(div().flex_1().min_w_0().text_color(colors.foreground).child(message))
                .child(Button::icon("issue-notice-close", IconName::X).size(ButtonSize::XSmall).on_click(cx.listener(|this, _, _, cx| {
                    this.notice = None;
                    cx.notify();
                })))
                .into_any_element(),
        )
    }
}

impl Render for IssueView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let container = div()
            .id("issue-view")
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
                    format!("Issue #{}", self.number),
                    Some(error.clone()),
                    Some(Button::new("issue-retry", "Retry").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| this.load(cx))).into_any_element()),
                    &colors,
                ),
                None => fill_message(format!("Loading issue #{}…", self.number), None, None, &colors),
            };
            return container.child(body);
        };
        let (description, edit) = self.render_description(&page, &colors, cx);
        let main = div()
            .flex()
            .flex_col()
            .gap(px(32.))
            .flex_1()
            .min_w_0()
            .child(section("Description", edit, description, &colors))
            .child(section("Activity", None, self.render_activity(&page, &colors, cx), &colors));
        container
            .child(div().flex_none().pt(px(20.)).pb(px(12.)).border_b_1().border_color(colors.divider).child(rail(self.render_summary(&page, &colors, cx))))
            .when_some(self.error.clone(), |this, error| this.child(rail(div().py(px(6.)).text_size(typography::TEXT_SM).text_color(colors.destructive).child(error))))
            .child(
                div()
                    .id("issue-content")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .pt(px(24.))
                    .pb(px(32.))
                    .child(rail(div().flex().items_start().gap(px(40.)).child(main).child(self.render_sidebar(&page, &colors, cx))))
                    .scrollbar(_window, cx),
            )
            .children(self.render_notice(&colors, cx))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
            .children(self.popover.as_ref().map(|popover| popover.render()))
            .children(self.confirmation.as_ref().map(|confirmation| confirmation.render(cx)))
    }
}

#[cfg(feature = "snapshot")]
impl IssueView {
    pub(crate) fn seed(root: &std::path::Path, issue: IssueDetails, cx: &mut App) {
        store::put(page_key(root, issue.number), Arc::new(build_page(issue)), cx);
    }

    pub(crate) fn snapshot(&mut self, state: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.error = None;
        self.metadata_error = None;
        self.current_user = Some("mehmet".into());
        match state {
            "comment-edit" => {
                if let Some(comment) = self.page.clone().and_then(|page| page.issue.comments.iter().find(|comment| comment.author.login == "mehmet").cloned()) {
                    self.start_comment_edit(comment.id, comment.body, window, cx);
                }
            }
            "actions" => {
                if let Some(page) = self.page.clone() {
                    let entries = self.actions_menu(&page, cx);
                    menus::show(self, "issue-actions", entries, gpui::point(px(1240.), px(60.)), Anchor::TopRight, window, cx);
                }
            }
            "milestone" => self.milestone_select.update(cx, |select, cx| select.set_open(true, window, cx)),
            "delete" => {
                if let Some(comment) = self.page.clone().and_then(|page| page.issue.comments.first().cloned()) {
                    self.delete_comment(comment.id, window, cx);
                }
            }
            _ => {}
        }
        cx.notify();
    }
}

impl IssueView {
    /// The author's login and the issue's state, once loaded (detached title bars).
    pub(crate) fn chrome(&self) -> Option<(String, String, model::Tone)> {
        let issue = &self.page.as_ref()?.issue;
        let open = model::issue_is_open(&issue.state);
        Some((issue.author.login.clone(), if open { "Open" } else { "Closed" }.to_string(), if open { model::Tone::Success } else { model::Tone::Muted }))
    }
}
