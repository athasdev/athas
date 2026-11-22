//! New pull request, new issue and Run workflow in the centre (`github-create-view.tsx`).

use ui::WithScrollbar as _;
use std::{path::PathBuf, sync::Arc};

use crate::gh::{Label, WorkflowListItem};
use ui::scale::px;
use gpui::{App, ClickEvent, Context, DismissEvent, Entity, FocusHandle, Focusable, IntoElement, Render, SharedString, Subscription, Window, div, prelude::*,};
use theme::{ActiveTheme, ThemeColors};
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, MenuSize, Select, SelectEvent, SelectOption, SelectSearch, SelectVariant, SelectWidth, Switch, TextInput, TextInputEvent, metrics, typography};

use crate::{
    draft,
    editor::{self, AssigneePicker, EditorEvent, LabelPicker, MarkdownEditor, PickerEvent, Popover},
    mutation::{Mutation, Outcome},
    repo,
    store::{self, Metadata},
    widgets::{Summary, label_chip, rail, title_text},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CreateKind {
    PullRequest,
    Issue,
    Action,
}

impl CreateKind {
    pub fn parse(id: &str) -> Option<Self> {
        match id {
            "pull-request" => Some(CreateKind::PullRequest),
            "issue" => Some(CreateKind::Issue),
            "action" => Some(CreateKind::Action),
            _ => None,
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            CreateKind::PullRequest => "New pull request",
            CreateKind::Issue => "New issue",
            CreateKind::Action => "Run workflow",
        }
    }

    fn icon(self) -> IconName {
        match self {
            CreateKind::PullRequest => IconName::GitPullRequest,
            CreateKind::Issue => IconName::ChatBubbleText,
            CreateKind::Action => IconName::Activity,
        }
    }
}

/// What the form needs to be sent, checked the way Athas enables its Create button.
pub(crate) fn can_submit(kind: CreateKind, title: &str, head: &str, base: &str, workflow: &str, reference: &str) -> bool {
    match kind {
        CreateKind::Issue => !title.trim().is_empty(),
        CreateKind::PullRequest => !title.trim().is_empty() && !head.trim().is_empty() && !base.trim().is_empty(),
        CreateKind::Action => !workflow.is_empty() && !reference.trim().is_empty(),
    }
}

pub struct CreateView {
    root: PathBuf,
    kind: CreateKind,
    focus_handle: FocusHandle,
    title: Entity<TextInput>,
    body: Entity<MarkdownEditor>,
    head: Entity<Select>,
    base: Entity<Select>,
    workflow: Entity<Select>,
    reference: Entity<Select>,
    milestone: Entity<Select>,
    issue_type: Entity<Select>,
    draft: bool,
    labels: Vec<String>,
    assignees: Vec<String>,
    metadata: Option<Arc<Metadata>>,
    metadata_error: Option<SharedString>,
    loading_branches: bool,
    submitting: bool,
    generating: bool,
    error: Option<SharedString>,
    /// What the last submit made, shown in place of the form.
    created: Option<(String, i64, String)>,
    popover: Option<Popover>,
    _subscriptions: Vec<Subscription>,
}

impl Focusable for CreateView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

fn select(placeholder: &str, custom: bool, window: &mut Window, cx: &mut Context<Select>) -> Select {
    let select = Select::new(Vec::new(), "", cx).placeholder(placeholder.to_string()).variant(SelectVariant::Ghost).width(SelectWidth::Flex).menu_size(MenuSize::Wide).searchable(SelectSearch::Menu, window, cx);
    if custom { select.allow_custom_value() } else { select }
}

impl CreateView {
    pub fn new(root: PathBuf, kind: CreateKind, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let title = cx.new(|cx| TextInput::new(window, cx).placeholder(if kind == CreateKind::Issue { "Issue title" } else { "Pull request title" }));
        let body = cx.new(|cx| MarkdownEditor::new("create-body", "Write a description...", 12, None, cx));
        let head = cx.new(|cx| select("Choose head", true, window, cx));
        let base = cx.new(|cx| select("Choose base", true, window, cx));
        let workflow = cx.new(|cx| select("Choose workflow", false, window, cx));
        let reference = cx.new(|cx| select("Choose branch or tag", true, window, cx));
        let milestone = cx.new(|cx| Select::new(Vec::new(), "none", cx).placeholder("Milestone").searchable(SelectSearch::Menu, window, cx).variant(SelectVariant::Default));
        let issue_type = cx.new(|cx| Select::new(Vec::new(), "none", cx).placeholder("Issue type").searchable(SelectSearch::Menu, window, cx).variant(SelectVariant::Default));
        let changed = |_: &mut Self, _: Entity<Select>, _: &SelectEvent, cx: &mut Context<Self>| cx.notify();
        let subscriptions = vec![
            cx.subscribe(&title, |this, _, event: &TextInputEvent, cx| match event {
                TextInputEvent::Confirmed => this.submit(cx),
                _ => {
                    this.error = None;
                    cx.notify();
                }
            }),
            cx.subscribe(&body, |this, _, event: &EditorEvent, cx| {
                if *event == EditorEvent::Submit {
                    this.submit(cx);
                }
            }),
            cx.subscribe(&head, changed),
            cx.subscribe(&base, changed),
            cx.subscribe(&workflow, changed),
            cx.subscribe(&reference, changed),
        ];
        if kind != CreateKind::Action {
            window.focus(&title.focus_handle(cx), cx);
        }
        let mut view = Self {
            root,
            kind,
            focus_handle: cx.focus_handle(),
            title,
            body,
            head,
            base,
            workflow,
            reference,
            milestone,
            issue_type,
            draft: false,
            labels: Vec::new(),
            assignees: Vec::new(),
            metadata: None,
            metadata_error: None,
            loading_branches: true,
            submitting: false,
            generating: false,
            error: None,
            created: None,
            popover: None,
            _subscriptions: subscriptions,
        };
        view.load(cx);
        view
    }

    fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn repository_name(&self) -> String {
        self.root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| self.path())
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        let root = self.root.clone();
        let kind = self.kind;
        let branches = cx.background_spawn(async move {
            let branches = repo::local_branches(&root)?;
            let current = repo::detect(&root).ok().and_then(|repo| repo.branch);
            Ok::<_, String>((branches, current))
        });
        cx.spawn(async move |this, cx| {
            let result = branches.await;
            this.update(cx, |this, cx| {
                this.loading_branches = false;
                match result {
                    Ok((branches, current)) => this.set_branches(branches, current, cx),
                    Err(error) => this.error = Some(error.into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        if kind == CreateKind::Action {
            let path = self.path();
            store::fetch(cx, move |token| crate::gh::github_list_workflows(path, Some(token)), |this, result, cx| {
                match result {
                    Ok(workflows) => this.set_workflows(workflows, cx),
                    Err(error) => this.error = Some(error.into()),
                }
                cx.notify();
            });
        } else {
            let cached = store::load_metadata(cx, self.path(), |this, result, cx| {
                match result {
                    Ok(metadata) => this.set_metadata(metadata, cx),
                    Err(error) => this.metadata_error = Some(error.into()),
                }
                cx.notify();
            });
            if let Some(metadata) = cached {
                self.set_metadata(metadata, cx);
            }
        }
    }

    fn set_branches(&mut self, branches: Vec<String>, current: Option<String>, cx: &mut Context<Self>) {
        let options: Vec<SelectOption> = branches.iter().map(|branch| SelectOption::new(branch.clone(), branch.clone())).collect();
        let head = current.filter(|branch| !branch.is_empty()).or_else(|| branches.first().cloned()).unwrap_or_default();
        let base = repo::default_base(&branches);
        let reference = if head.is_empty() { "master".to_string() } else { head.clone() };
        for (select, value) in [(&self.head, head), (&self.base, base), (&self.reference, reference)] {
            let options = options.clone();
            select.update(cx, |select, cx| {
                select.set_options(options, cx);
                select.set_value(value, cx);
            });
        }
    }

    fn set_workflows(&mut self, workflows: Vec<WorkflowListItem>, cx: &mut Context<Self>) {
        let active: Vec<&WorkflowListItem> = workflows.iter().filter(|workflow| workflow.state != "deleted").collect();
        let options = active
            .iter()
            .map(|workflow| SelectOption::new(workflow.id.to_string(), if workflow.name.is_empty() { workflow.path.clone() } else { workflow.name.clone() }).keywords([workflow.path.clone()]))
            .collect();
        let first = active.first().map(|workflow| workflow.id.to_string()).unwrap_or_default();
        self.workflow.update(cx, |select, cx| {
            select.set_options(options, cx);
            if select.value().is_empty() {
                select.set_value(first, cx);
            }
        });
    }

    fn set_metadata(&mut self, metadata: Arc<Metadata>, cx: &mut Context<Self>) {
        let mut milestones = vec![SelectOption::new("none", "No milestone")];
        milestones.extend(metadata.milestones.iter().map(|milestone| SelectOption::new(milestone.number.to_string(), milestone.title.clone())));
        let mut types = vec![SelectOption::new("none", "No type")];
        types.extend(metadata.issue_types.iter().map(|kind| SelectOption::new(kind.name.clone(), kind.name.clone())));
        self.milestone.update(cx, |select, cx| select.set_options(milestones, cx));
        self.issue_type.update(cx, |select, cx| select.set_options(types, cx));
        self.metadata = Some(metadata);
        self.metadata_error = None;
    }

    fn values(&self, cx: &App) -> (String, String, String, String, String) {
        (
            self.title.read(cx).text().to_string(),
            self.head.read(cx).value().to_string(),
            self.base.read(cx).value().to_string(),
            self.workflow.read(cx).value().to_string(),
            self.reference.read(cx).value().to_string(),
        )
    }

    fn ready(&self, cx: &App) -> bool {
        let (title, head, base, workflow, reference) = self.values(cx);
        can_submit(self.kind, &title, &head, &base, &workflow, &reference)
    }

    fn mutation(&self, cx: &App) -> Mutation {
        let (title, head, base, workflow, reference) = self.values(cx);
        let body = self.body.read(cx).text(cx);
        match self.kind {
            CreateKind::PullRequest => Mutation::CreatePr { title, body, head, base, draft: self.draft, labels: self.labels.clone(), assignees: self.assignees.clone() },
            CreateKind::Issue => {
                let milestone = self.milestone.read(cx).value().parse().ok();
                let issue_type = Some(self.issue_type.read(cx).value().to_string()).filter(|value| value != "none" && !value.is_empty());
                Mutation::CreateIssue { title, body, labels: self.labels.clone(), assignees: self.assignees.clone(), milestone, issue_type }
            }
            CreateKind::Action => Mutation::DispatchWorkflow { workflow_id: workflow.parse().unwrap_or_default(), reference },
        }
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        if self.submitting || !self.ready(cx) {
            return;
        }
        self.submitting = true;
        self.error = None;
        cx.notify();
        let mutation = self.mutation(cx);
        store::mutate(cx, self.path(), mutation, |this, result, cx| {
            this.submitting = false;
            match result {
                Ok(outcome) => {
                    store::bump(cx);
                    this.created = match outcome {
                        Outcome::CreatedPr(pr) => {
                            workbench_api::open_resource(cx, "github-pr", &pr.number.to_string(), &pr.title);
                            Some(("github-pr".into(), pr.number, pr.title))
                        }
                        Outcome::CreatedIssue(issue) => {
                            workbench_api::open_resource(cx, "github-issue", &issue.number.to_string(), &issue.title);
                            Some(("github-issue".into(), issue.number, issue.title))
                        }
                        _ => Some((String::new(), 0, "Workflow queued".into())),
                    };
                }
                Err(error) => this.error = Some(error.into()),
            }
            cx.notify();
        });
    }

    /// Asks the AI model for a title and body from the repository's status and branch diff.
    fn generate(&mut self, cx: &mut Context<Self>) {
        if self.kind == CreateKind::Action || self.generating || self.submitting {
            return;
        }
        let Some(generator) = draft::generator(cx) else {
            self.error = Some("AI generation is not available.".into());
            cx.notify();
            return;
        };
        self.generating = true;
        self.error = None;
        cx.notify();
        let (title, head, base, _, _) = self.values(cx);
        let context = draft::DraftContext {
            repository: self.path(),
            head: head.clone(),
            base: base.clone(),
            labels: self.labels.clone(),
            assignees: self.assignees.clone(),
            title,
            body: self.body.read(cx).text(cx),
            ..Default::default()
        };
        let (root, kind) = (self.root.clone(), self.kind);
        let gather = cx.background_spawn(async move {
            let mut context = context;
            context.status = draft::status_summary(&root);
            if kind == CreateKind::PullRequest {
                context.diff = draft::diff_summary(&root, &base, &head);
            }
            draft::prompt(kind, &context)
        });
        let file_path = if kind == CreateKind::PullRequest { "github-pull-request" } else { "github-issue" };
        cx.spawn(async move |this, cx| {
            let prompt = gather.await;
            let request = draft::DraftRequest { file_path: file_path.into(), prompt, instruction: draft::INSTRUCTION.into() };
            let answer = cx.update(|cx| generator(request, cx)).await;
            this.update(cx, |this, cx| {
                this.generating = false;
                match answer.map(|text| draft::extract_draft(&text)) {
                    Ok((None, None)) => this.error = Some("AI did not return a usable draft.".into()),
                    Ok((title, body)) => {
                        if let Some(title) = title {
                            this.title.update(cx, |input, cx| input.set_text(title, cx));
                        }
                        if let Some(body) = body {
                            this.body.update(cx, |editor, cx| editor.set_text(&body, cx));
                        }
                    }
                    Err(error) => this.error = Some(error.to_string().into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn start_over(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.created = None;
        self.title.update(cx, |input, cx| input.set_text("", cx));
        self.body.update(cx, |editor, cx| editor.set_text("", cx));
        self.labels.clear();
        self.assignees.clear();
        self.draft = false;
        window.focus(&self.title.focus_handle(cx), cx);
        cx.notify();
    }

    fn open_label_picker(&mut self, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.popover.take().is_some_and(|popover| popover.key == "labels") {
            cx.notify();
            return;
        }
        let labels: Vec<Label> = self.metadata.as_ref().map(|metadata| metadata.labels.clone()).unwrap_or_default();
        let loading = self.metadata.is_none() || self.loading_branches;
        let picker = cx.new(|cx| LabelPicker::new(labels, self.labels.clone(), loading, window, cx));
        let subscriptions = vec![
            cx.subscribe(&picker, |this, _, PickerEvent::Changed(labels): &PickerEvent, cx| {
                this.labels = labels.clone();
                cx.notify();
            }),
            cx.subscribe_in(&picker, window, |this, _, _: &DismissEvent, window, cx| {
                this.popover = None;
                // The picker took the keyboard for its search field; give it back.
                window.focus(&this.focus_handle(cx), cx);
                cx.notify();
            }),
        ];
        self.popover = Some(Popover::new("labels", picker.into(), editor::popover_position(event), subscriptions));
        cx.notify();
    }

    fn open_assignee_picker(&mut self, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.popover.take().is_some_and(|popover| popover.key == "assignees") {
            cx.notify();
            return;
        }
        let picker = cx.new(|cx| AssigneePicker::new(self.assignees.clone(), window, cx));
        let subscriptions = vec![
            cx.subscribe(&picker, |this, _, PickerEvent::Changed(assignees): &PickerEvent, cx| {
                this.assignees = assignees.clone();
                cx.notify();
            }),
            cx.subscribe_in(&picker, window, |this, _, _: &DismissEvent, window, cx| {
                this.popover = None;
                // The picker took the keyboard for its search field; give it back.
                window.focus(&this.focus_handle(cx), cx);
                cx.notify();
            }),
        ];
        self.popover = Some(Popover::new("assignees", picker.into(), editor::popover_position(event), subscriptions));
        cx.notify();
    }

    fn render_error(&self, colors: &ThemeColors) -> Option<impl IntoElement> {
        let error = self.error.clone()?;
        Some(div().mt(px(12.)).px(px(12.)).py(px(8.)).rounded(metrics::radius_lg()).bg(colors.destructive_soft).text_size(typography::text_sm()).text_color(colors.destructive).child(error))
    }

    fn render_action_form(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> gpui::AnyElement {
        let field = |label: &'static str, select: &Entity<Select>| {
            div()
                .flex()
                .flex_1()
                .min_w(px(224.))
                .items_center()
                .gap(px(8.))
                .child(div().flex_none().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(label))
                .child(div().flex_1().min_w_0().child(select.clone()))
        };
        div()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .pb(px(24.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .text_size(typography::text_sm())
                            .text_color(colors.subtle_foreground)
                            .child(Icon::new(IconName::Activity).size(IconSize::Small).color(colors.subtle_foreground))
                            .child(self.repository_name()),
                    )
                    .child(div().text_size(typography::text_base()).font_weight(typography::SEMIBOLD).text_color(colors.foreground).child("Run workflow"))
                    .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("Choose a workflow and the branch or tag it should run against.")),
            )
            .child(div().flex().flex_wrap().items_center().gap(px(12.)).py(px(8.)).child(field("Workflow", &self.workflow)).child(field("Ref", &self.reference)))
            .children(self.render_error(colors))
            .child(
                div().mt(px(20.)).flex().justify_end().child(
                    Button::new("create-run", if self.submitting { "Running…" } else { "Run workflow" })
                        .leading_icon(IconName::Plus)
                        .variant(ButtonVariant::Accent)
                        .size(ButtonSize::Small)
                        .disabled(!self.ready(cx) || self.submitting)
                        .on_click(cx.listener(|this, _, _, cx| this.submit(cx))),
                ),
            )
            .into_any_element()
    }

    fn render_form(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> gpui::AnyElement {
        let kind = self.kind;
        let theme = cx.theme().clone();
        let branches = (kind == CreateKind::PullRequest).then(|| {
            let caption = |text: &'static str| div().flex_none().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(text);
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(8.))
                .pb(px(12.))
                .child(Icon::new(IconName::GitBranch).size(IconSize::Small).color(colors.subtle_foreground))
                .child(caption("Head"))
                .child(div().w(px(208.)).child(self.head.clone()))
                .child(caption("→"))
                .child(caption("Base"))
                .child(div().w(px(208.)).child(self.base.clone()))
                .child(
                    div()
                        .ml_auto()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .h(px(28.))
                        .px(px(8.))
                        .text_size(typography::text_sm())
                        .text_color(colors.subtle_foreground)
                        .child(Switch::new("create-draft", self.draft).on_change({
                            let this = cx.entity().downgrade();
                            move |checked, _, cx| {
                                this.update(cx, |this, cx| {
                                    this.draft = checked;
                                    cx.notify();
                                })
                                .ok();
                            }
                        }))
                        .child("Draft"),
                )
        });
        let metadata = self.metadata.clone();
        let selected_labels: Vec<Label> = metadata.as_ref().map(|metadata| metadata.labels.iter().filter(|label| self.labels.contains(&label.name)).cloned().collect()).unwrap_or_default();
        let milestones = kind == CreateKind::Issue && metadata.as_ref().is_some_and(|metadata| !metadata.milestones.is_empty());
        let types = kind == CreateKind::Issue && metadata.as_ref().is_some_and(|metadata| !metadata.issue_types.is_empty());
        let footer = div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .pt(px(16.))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(8.))
                    .min_w_0()
                    .child(Button::icon("create-labels", IconName::Tag).size(ButtonSize::Small).tooltip("Edit labels").on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_label_picker(event, window, cx))))
                    .children(selected_labels.iter().map(|label| label_chip(&label.name, &label.color, colors)))
                    .child(Button::icon("create-assignees", IconName::User).size(ButtonSize::Small).tooltip("Edit assignees").on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_assignee_picker(event, window, cx))))
                    .when(!self.assignees.is_empty(), |this| {
                        this.child(div().min_w_0().truncate().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(self.assignees.iter().map(|login| format!("@{login}")).collect::<Vec<_>>().join(", ")))
                    })
                    .when(milestones, |this| this.child(div().w(px(160.)).child(self.milestone.clone())))
                    .when(types, |this| this.child(div().w(px(160.)).child(self.issue_type.clone()))),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        Button::new("create-generate", if self.generating { "Generating…" } else { "Generate" })
                            .leading_icon(IconName::Sparkle)
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .tooltip("Draft the title and description with AI")
                            .disabled(self.generating || self.submitting)
                            .on_click(cx.listener(|this, _, _, cx| this.generate(cx))),
                    )
                    .child(
                        Button::new("create-submit", if self.submitting { "Creating…" } else { "Create" })
                            .leading_icon(IconName::Plus)
                            .variant(ButtonVariant::Accent)
                            .size(ButtonSize::Small)
                            .disabled(!self.ready(cx) || self.submitting)
                            .on_click(cx.listener(|this, _, _, cx| this.submit(cx))),
                    ),
            );
        div()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .pb(px(20.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .text_size(typography::text_sm())
                            .text_color(colors.subtle_foreground)
                            .child(Icon::new(kind.icon()).size(IconSize::Small).color(colors.subtle_foreground))
                            .child(self.repository_name()),
                    )
                    .child(div().text_size(typography::text_base()).child(self.title.clone())),
            )
            .children(branches)
            .child(div().rounded(metrics::radius_lg()).shadow(theme.shadows.raised.clone()).child(self.body.clone()))
            .children(self.metadata_error.clone().map(|error| {
                div().mt(px(12.)).text_size(typography::text_sm()).text_color(colors.destructive).child(format!("Labels and milestones are unavailable. {error}"))
            }))
            .children(self.render_error(colors))
            .child(footer)
            .into_any_element()
    }

    fn render_created(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        let (kind, number, title) = self.created.clone()?;
        let open = (!kind.is_empty()).then(|| {
            let (kind, title) = (kind.clone(), title.clone());
            Button::new("create-open", format!("Open #{number}")).variant(ButtonVariant::Accent).size(ButtonSize::Small).on_click(move |_, _, cx| workbench_api::open_resource(cx, &kind, &number.to_string(), &title))
        });
        let message = if kind.is_empty() { title } else { format!("Created #{number} · {title}") };
        Some(
            div()
                .flex()
                .flex_col()
                .items_start()
                .gap(px(12.))
                .py(px(24.))
                .child(div().flex().items_center().gap(px(8.)).text_size(typography::text_sm()).text_color(colors.foreground).child(Icon::new(IconName::CheckCircle).size(IconSize::Small).color(colors.success)).child(message))
                .child(
                    div()
                        .flex()
                        .gap(px(8.))
                        .children(open)
                        .child(Button::new("create-another", "Create another").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(|this, _, window, cx| this.start_over(window, cx)))),
                )
                .into_any_element(),
        )
    }
}

impl Render for CreateView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let summary = Summary {
            icon: Icon::new(self.kind.icon()).size(IconSize::Custom(px(20.))).color(colors.primary).into_any_element(),
            title: title_text(self.kind.title()),
            badges: Vec::new(),
            description: Some(format!("in {}", self.repository_name()).into()),
            meta: Vec::new(),
            actions: Vec::new(),
            aside: None,
        };
        let body = match self.render_created(&colors, cx) {
            Some(created) => created,
            None if self.kind == CreateKind::Action => self.render_action_form(&colors, cx),
            None => self.render_form(&colors, cx),
        };
        div()
            .id("github-create")
            .track_focus(&self.focus_handle)
            .relative()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_color(colors.foreground)
            .child(div().flex_none().pt(px(20.)).pb(px(12.)).border_b_1().border_color(colors.divider).child(rail(summary.render(&colors))))
            .child(div().id("github-create-content").flex_1().min_h_0().overflow_y_scroll().pt(px(24.)).pb(px(32.)).child(rail(div().max_w(px(880.)).child(body))).scrollbar(_window, cx))
            .children(self.popover.as_ref().map(|popover| popover.render()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_needs_what_github_requires() {
        assert!(can_submit(CreateKind::Issue, "Crash", "", "", "", ""));
        assert!(!can_submit(CreateKind::Issue, "  ", "", "", "", ""));
        assert!(can_submit(CreateKind::PullRequest, "Fix", "feature", "main", "", ""));
        assert!(!can_submit(CreateKind::PullRequest, "Fix", "", "main", "", ""));
        assert!(can_submit(CreateKind::Action, "", "", "", "42", "main"));
        assert!(!can_submit(CreateKind::Action, "", "", "", "", "main"));
        assert_eq!(CreateKind::parse("pull-request"), Some(CreateKind::PullRequest));
        assert_eq!(CreateKind::parse("nope"), None);
    }
}

#[cfg(feature = "snapshot")]
impl CreateView {
    pub(crate) fn snapshot(&mut self, state: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.metadata_error = None;
        self.error = None;
        if state == "filled" {
            self.title.update(cx, |input, cx| input.set_text("Port the GitHub write paths", cx));
            self.body.update(cx, |editor, cx| editor.set_text("## Summary\n- Comments, reviews and pickers\n- Create views", cx));
            self.labels = vec!["port".into()];
            self.assignees = vec!["mehmet".into()];
            self.draft = true;
        }
        if state == "created" {
            self.created = Some(("github-pr".into(), 812, "Port the GitHub write paths".into()));
        }
        let _ = window;
        cx.notify();
    }
}
