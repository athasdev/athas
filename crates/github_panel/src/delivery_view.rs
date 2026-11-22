//! A release or a deployment in the centre (`github-delivery-viewer.tsx`): a release's notes,
//! assets and editor; a deployment's status history.

use ui::WithScrollbar as _;
use std::{path::PathBuf, sync::Arc, time::Duration};

use crate::gh::{Deployment, Release, ReleaseAsset};
use chrono::Utc;
use ui::scale::px;
use gpui::{
    Anchor, AnyElement, App, ClickEvent, ClipboardItem, Context, Entity, FocusHandle, Focusable, IntoElement, PathPromptOptions, Render, SharedString, Subscription, Window, div,
    prelude::*,
};
use theme::{ActiveTheme, ThemeColors};
use ui::{AlertAction, AlertDialog, Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, MenuEntry, OpenMenu, Switch, TextInput, TextInputEvent, metrics, typography};

use crate::{
    editor::{self, ConfirmHost, Confirmation, EditorEvent, MarkdownEditor},
    markdown::{self, Block},
    menus::{self, MenuHost, below},
    model::{self, Tone},
    mutation::{self, Mutation, Outcome, ReleaseDraft},
    store,
    widgets::{Summary, badge, fill_message, meta_chip, rail, section, title_text, user_chip},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeliveryKind {
    Release,
    Deployment,
}

/// A deployments page is re-read this often while it is open.
const DEPLOYMENT_POLL: Duration = Duration::from_secs(30);

pub fn release_title(release: &Release) -> String {
    release.name.as_deref().map(str::trim).filter(|name| !name.is_empty()).map(str::to_string).unwrap_or_else(|| release.tag_name.clone())
}

pub fn release_status(release: &Release) -> (&'static str, Tone) {
    if release.draft {
        ("Draft", Tone::Warning)
    } else if release.prerelease {
        ("Prerelease", Tone::Accent)
    } else {
        ("Published", Tone::Success)
    }
}

/// A deployment status as Athas words and colours it, and whether it is still going.
pub fn deployment_status_state(state: Option<&str>) -> (&'static str, Tone, bool) {
    match state {
        Some("success") => ("Successful", Tone::Success, false),
        Some("failure") => ("Failed", Tone::Error, false),
        Some("error") => ("Error", Tone::Error, false),
        Some("inactive") => ("Inactive", Tone::Muted, false),
        Some("queued") => ("Queued", Tone::Warning, true),
        Some("pending") => ("Pending", Tone::Warning, true),
        Some("in_progress") => ("In progress", Tone::Accent, true),
        Some(_) => ("Unknown status", Tone::Muted, true),
        None => ("Awaiting status", Tone::Muted, true),
    }
}

pub fn deployment_state(deployment: &Deployment) -> (&'static str, Tone, bool) {
    if deployment.status_error.is_some() {
        return ("Status unavailable", Tone::Warning, false);
    }
    deployment_status_state(deployment.statuses.first().map(|status| status.state.as_str()))
}

/// Only plain web links without credentials open.
pub fn safe_url(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    let rest = value.strip_prefix("https://").or_else(|| value.strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    (!authority.is_empty() && !authority.contains('@')).then(|| value.to_string())
}

pub fn format_asset_size(bytes: u64) -> String {
    let bytes = bytes as f64;
    if bytes < 1024. {
        format!("{bytes} B")
    } else if bytes < 1024f64.powi(2) {
        format!("{:.1} KB", bytes / 1024.)
    } else if bytes < 1024f64.powi(3) {
        format!("{:.1} MB", bytes / 1024f64.powi(2))
    } else {
        format!("{:.1} GB", bytes / 1024f64.powi(3))
    }
}

fn repository_url(release: &Release) -> String {
    release.html_url.split("/releases").next().unwrap_or_default().to_string()
}

fn draft_key(root: &str, id: Option<i64>) -> String {
    format!("{root}|release-draft|{}", id.map(|id| id.to_string()).unwrap_or_else(|| "new".into()))
}

/// The release form (`release-editor.tsx`).
struct ReleaseForm {
    tag: Entity<TextInput>,
    target: Entity<TextInput>,
    name: Entity<TextInput>,
    previous: Entity<TextInput>,
    body: Entity<MarkdownEditor>,
    prerelease: bool,
    busy: Option<&'static str>,
    error: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

impl ReleaseForm {
    fn draft(&self, cx: &App) -> ReleaseDraft {
        ReleaseDraft {
            tag_name: self.tag.read(cx).text().to_string(),
            target_commitish: self.target.read(cx).text().to_string(),
            name: self.name.read(cx).text().to_string(),
            body: self.body.read(cx).text(cx),
            prerelease: self.prerelease,
        }
    }
}

pub struct DeliveryView {
    root: PathBuf,
    kind: DeliveryKind,
    id: Option<i64>,
    focus_handle: FocusHandle,
    release: Option<Arc<Release>>,
    deployment: Option<Arc<Deployment>>,
    notes: Vec<Block>,
    loading: bool,
    error: Option<SharedString>,
    /// A publish, delete or deactivate in flight, or what the asset list is doing.
    pending: Option<SharedString>,
    action_error: Option<SharedString>,
    deleted: bool,
    form: Option<ReleaseForm>,
    asset_filter: Entity<TextInput>,
    open_menu: Option<OpenMenu>,
    confirmation: Option<Confirmation>,
    _subscriptions: Vec<Subscription>,
    _poll: Option<gpui::Task<()>>,
}

impl Focusable for DeliveryView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl MenuHost for DeliveryView {
    fn menu_slot(&mut self) -> &mut Option<OpenMenu> {
        &mut self.open_menu
    }
}

impl ConfirmHost for DeliveryView {
    fn confirmation_slot(&mut self) -> &mut Option<Confirmation> {
        &mut self.confirmation
    }
}

fn release_key(root: &str, id: i64) -> String {
    format!("{root}|release|{id}")
}

fn deployment_key(root: &str, id: i64) -> String {
    format!("{root}|deployment|{id}")
}

impl DeliveryView {
    /// `id` is `None` for a new release.
    pub fn new(root: PathBuf, kind: DeliveryKind, id: Option<i64>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let path = root.to_string_lossy().into_owned();
        let release = id.and_then(|id| store::get::<Release>(&release_key(&path, id), cx)).filter(|_| kind == DeliveryKind::Release);
        let deployment = id.and_then(|id| store::get::<Deployment>(&deployment_key(&path, id), cx)).filter(|_| kind == DeliveryKind::Deployment);
        let asset_filter = cx.new(|cx| TextInput::new(window, cx).placeholder("Filter assets…").leading_icon(IconName::Search));
        let subscriptions = vec![cx.subscribe(&asset_filter, |_, _, _: &TextInputEvent, cx| cx.notify())];
        let poll = (kind == DeliveryKind::Deployment).then(|| {
            cx.spawn_in(window, async move |this, cx| {
                loop {
                    cx.background_executor().timer(DEPLOYMENT_POLL).await;
                    let polled = this.update_in(cx, |this, window, cx| {
                        if window.is_window_active() {
                            this.load(cx);
                        }
                    });
                    if polled.is_err() {
                        break;
                    }
                }
            })
        });
        let mut view = Self {
            notes: release.as_ref().map(|release| markdown::parse(release.body.as_deref().unwrap_or_default(), Some(&repository_url(release)))).unwrap_or_default(),
            root,
            kind,
            id,
            focus_handle: cx.focus_handle(),
            release,
            deployment,
            loading: false,
            error: None,
            pending: None,
            action_error: None,
            deleted: false,
            form: None,
            asset_filter,
            open_menu: None,
            confirmation: None,
            _subscriptions: subscriptions,
            _poll: poll,
        };
        if id.is_none() && kind == DeliveryKind::Release {
            view.start_editing(window, cx);
        } else {
            view.load(cx);
        }
        view
    }

    fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.id else { return };
        if self.loading || self.deleted {
            return;
        }
        self.loading = true;
        cx.notify();
        let path = self.path();
        match self.kind {
            DeliveryKind::Release => store::fetch(cx, move |token| crate::gh::github_get_release(path, id, Some(token)), |this, result, cx| {
                this.loading = false;
                match result {
                    Ok(release) => {
                        this.set_release(release, cx);
                        this.error = None;
                    }
                    Err(error) => this.error = Some(error.into()),
                }
                cx.notify();
            }),
            DeliveryKind::Deployment => store::fetch(cx, move |token| crate::gh::github_get_deployment(path, id, Some(token)), |this, result, cx| {
                this.loading = false;
                match result {
                    Ok(deployment) => {
                        let deployment = Arc::new(deployment);
                        store::put(deployment_key(&this.path(), deployment.id), deployment.clone(), cx);
                        this.deployment = Some(deployment);
                        this.error = None;
                    }
                    Err(error) => this.error = Some(error.into()),
                }
                cx.notify();
            }),
        }
    }

    fn set_release(&mut self, release: Release, cx: &mut Context<Self>) {
        self.notes = markdown::parse(release.body.as_deref().unwrap_or_default(), Some(&repository_url(&release)));
        self.id = Some(release.id);
        let release = Arc::new(release);
        store::put(release_key(&self.path(), release.id), release.clone(), cx);
        self.release = Some(release);
    }

    fn start_editing(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let key = draft_key(&self.path(), self.id);
        let initial = store::get::<ReleaseDraft>(&key, cx).map(|draft| (*draft).clone()).or_else(|| self.release.as_deref().map(ReleaseDraft::of)).unwrap_or_default();
        let input = |text: &str, placeholder: &str, window: &mut Window, cx: &mut Context<Self>| {
            let (text, placeholder) = (text.to_string(), placeholder.to_string());
            cx.new(|cx| {
                let mut input = TextInput::new(window, cx).placeholder(placeholder);
                input.set_text(text, cx);
                input
            })
        };
        let tag = input(&initial.tag_name, "v1.0.0", window, cx);
        let target = input(&initial.target_commitish, "Branch name or commit SHA", window, cx);
        let name = input(&initial.name, "Defaults to the tag name", window, cx);
        let previous = input("", "Automatic", window, cx);
        let repository = self.release.as_deref().map(repository_url);
        let body = cx.new(|cx| {
            let mut editor = MarkdownEditor::new("release-notes", "Describe what changed in this release…", 12, repository, cx);
            editor.set_text(&initial.body, cx);
            editor
        });
        let mut subscriptions: Vec<Subscription> = [&tag, &target, &name, &previous].into_iter().map(|input| cx.subscribe(input, |this, _, _: &TextInputEvent, cx| this.remember_draft(cx))).collect();
        subscriptions.push(cx.subscribe(&body, |this, _, event: &EditorEvent, cx| match event {
            EditorEvent::Submit => this.save_release(cx),
            _ => this.remember_draft(cx),
        }));
        window.focus(&tag.focus_handle(cx), cx);
        self.form = Some(ReleaseForm { tag, target, name, previous, body, prerelease: initial.prerelease, busy: None, error: None, _subscriptions: subscriptions });
        cx.notify();
    }

    /// Keeps what is typed for the life of the app, as Athas keeps it for the session.
    fn remember_draft(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &self.form else { return };
        let draft = form.draft(cx);
        store::put(draft_key(&self.path(), self.id), Arc::new(draft), cx);
        cx.notify();
    }

    fn cancel_editing(&mut self, cx: &mut Context<Self>) {
        store::forget(&draft_key(&self.path(), self.id), cx);
        self.form = None;
        cx.notify();
    }

    fn save_release(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &mut self.form else { return };
        let draft = form.draft(cx);
        if !draft.is_valid() || form.busy.is_some() {
            return;
        }
        form.busy = Some("save");
        form.error = None;
        cx.notify();
        let key = draft_key(&self.path(), self.id);
        store::mutate(cx, self.path(), Mutation::SaveRelease { id: self.id, draft }, move |this, result, cx| {
            match result {
                Ok(Outcome::Release(release)) => {
                    store::forget(&key, cx);
                    store::bump(cx);
                    this.set_release(*release, cx);
                    this.form = None;
                }
                Ok(_) => this.form = None,
                Err(error) => {
                    if let Some(form) = &mut this.form {
                        form.busy = None;
                        form.error = Some(error.into());
                    }
                }
            }
            cx.notify();
        });
    }

    fn generate_notes(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &mut self.form else { return };
        let draft = form.draft(cx);
        if !draft.is_valid() || form.busy.is_some() {
            return;
        }
        let previous = Some(form.previous.read(cx).text().trim().to_string()).filter(|value| !value.is_empty());
        form.busy = Some("generate");
        form.error = None;
        cx.notify();
        let path = self.path();
        let (tag, target) = (draft.tag_name.trim().to_string(), draft.target_commitish.trim().to_string());
        store::fetch(cx, move |token| crate::gh::github_generate_release_notes(path, tag, target, previous, Some(token)), |this, result, cx| {
            let Some(form) = &mut this.form else { return };
            form.busy = None;
            match result {
                Ok(notes) => {
                    let mut draft = form.draft(cx);
                    mutation::merge_generated_notes(&mut draft, &notes);
                    let (name, body) = (form.name.clone(), form.body.clone());
                    name.update(cx, |input, cx| input.set_text(draft.name.clone(), cx));
                    body.update(cx, |editor, cx| editor.set_text(&draft.body, cx));
                    this.remember_draft(cx);
                }
                Err(error) => form.error = Some(error.into()),
            }
            cx.notify();
        });
    }

    fn act(&mut self, label: &str, mutation: Mutation, cx: &mut Context<Self>, done: impl FnOnce(&mut Self, Outcome, &mut Context<Self>) + 'static) {
        if self.pending.is_some() {
            return;
        }
        self.pending = Some(label.to_string().into());
        self.action_error = None;
        cx.notify();
        store::mutate(cx, self.path(), mutation, move |this, result, cx| {
            this.pending = None;
            match result {
                Ok(outcome) => {
                    store::bump(cx);
                    done(this, outcome, cx);
                }
                Err(error) => this.action_error = Some(error.into()),
            }
            cx.notify();
        });
    }

    fn publish(&mut self, make_latest: bool, cx: &mut Context<Self>) {
        let Some(release) = self.release.clone() else { return };
        let make_latest = make_latest && !release.prerelease;
        self.act("Publishing…", Mutation::PublishRelease { id: release.id, make_latest }, cx, |this, outcome, cx| match outcome {
            Outcome::Release(release) => this.set_release(*release, cx),
            _ => this.load(cx),
        });
    }

    fn confirm_publish(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(release) = self.release.clone() else { return };
        let message = "This makes the draft and its assets available to the repository’s audience and may notify watchers.";
        let view = cx.entity().downgrade();
        let action = |label: &str, latest: bool, accent: bool| {
            let view = view.clone();
            AlertAction::new(label.to_string()).variant(if accent { ButtonVariant::Accent } else { ButtonVariant::Default }).on_click(move |_, cx| {
                view.update(cx, |this, cx| this.publish(latest, cx)).ok();
            })
        };
        let choices = if release.prerelease {
            vec![action("Publish Release", false, true)]
        } else {
            vec![action("Publish and set as latest", true, false), action("Publish Release", false, true)]
        };
        let dialog = AlertDialog::choice("Publish release?", message, choices, cx);
        self.host_dialog(dialog, window, cx);
    }

    fn host_dialog(&mut self, dialog: Entity<AlertDialog>, window: &mut Window, cx: &mut Context<Self>) {
        editor::host(self, dialog, window, cx);
    }

    fn confirm_delete(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(release) = self.release.clone() else { return };
        editor::confirm(self, "Delete release?", "The release and its uploaded assets will be deleted. The Git tag will remain.", "Delete Release", true, window, cx, move |this, _, cx| {
            this.act("Deleting…", Mutation::DeleteRelease { id: release.id }, cx, |this, _, cx| {
                this.deleted = true;
                cx.notify();
            });
        });
    }

    fn confirm_deactivate(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(deployment) = self.deployment.clone() else { return };
        editor::confirm(
            self,
            "Mark deployment inactive?",
            "This changes its status on GitHub. It does not stop, roll back, or remove the running environment.",
            "Mark Inactive",
            false,
            window,
            cx,
            move |this, _, cx| this.act("Updating…", Mutation::DeactivateDeployment { id: deployment.id }, cx, |this, _, cx| this.load(cx)),
        );
    }

    fn upload_assets(&mut self, cx: &mut Context<Self>) {
        let Some(release) = self.release.clone() else { return };
        if self.pending.is_some() {
            return;
        }
        self.pending = Some("Choose assets".into());
        self.action_error = None;
        cx.notify();
        let paths = cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: true, prompt: Some("Upload release assets".into()) });
        let auth = store::check_auth(false, cx);
        let path = self.path();
        cx.spawn(async move |this, cx| {
            let files = match paths.await {
                Ok(Ok(Some(files))) => files,
                _ => Vec::new(),
            };
            let token = auth.await.token();
            let total = files.len();
            let mut uploaded = 0;
            let mut failure = None;
            for (index, file) in files.into_iter().enumerate() {
                let name = file.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                this.update(cx, |this, cx| {
                    this.pending = Some(format!("Uploading {} of {total} · {name}", index + 1).into());
                    cx.notify();
                })
                .ok();
                let Some(token) = token.clone() else {
                    failure = Some("GitHub is not authenticated.".to_string());
                    break;
                };
                let mutation = Mutation::UploadReleaseAsset { release_id: release.id, file: file.to_string_lossy().into_owned() };
                let path = path.clone();
                match cx.background_executor().spawn(async move { mutation.perform(path, token) }).await {
                    Ok(_) => uploaded += 1,
                    Err(error) => {
                        failure = Some(error);
                        break;
                    }
                }
            }
            this.update(cx, |this, cx| {
                this.pending = None;
                if let Some(error) = failure {
                    this.action_error = Some(if uploaded > 0 { format!("{uploaded} uploaded before the error. {error}") } else { error }.into());
                }
                if uploaded > 0 {
                    store::bump(cx);
                    this.load(cx);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn confirm_delete_asset(&mut self, asset: ReleaseAsset, window: &mut Window, cx: &mut Context<Self>) {
        let message = format!("{} will be permanently removed from this release.", asset.name);
        editor::confirm(self, "Delete asset?", &message, "Delete Asset", true, window, cx, move |this, _, cx| {
            this.act("Deleting asset", Mutation::DeleteReleaseAsset { id: asset.id }, cx, |this, _, cx| this.load(cx));
        });
    }

    fn more_menu(&self, cx: &Context<Self>) -> Vec<MenuEntry> {
        let busy = self.pending.is_some();
        let mut entries: Vec<MenuEntry> = Vec::new();
        if let Some(release) = &self.release {
            if let Some(url) = safe_url(Some(&release.html_url)) {
                entries.push(menus::link("Open on GitHub", url).icon(IconName::OpenExternal).into());
            }
            entries.push(menus::copy("Copy Tag", release.tag_name.clone()).icon(IconName::Copy).into());
            if !release.immutable {
                entries.push(menus::item("Delete Release…", cx, |this, window, cx| this.confirm_delete(window, cx)).icon(IconName::Trash).destructive().disabled(busy).into());
            }
        }
        if let Some(deployment) = &self.deployment {
            let repository = crate::links::current_repo(cx).map(|repo| format!("https://github.com/{repo}"));
            if let Some(url) = &repository {
                entries.push(menus::link("Open on GitHub", format!("{url}/deployments")).icon(IconName::OpenExternal).into());
            }
            entries.push(menus::copy("Copy Commit SHA", deployment.sha.clone()).icon(IconName::Copy).into());
            if let Some(url) = repository {
                entries.push(menus::link("Open Commit on GitHub", format!("{url}/commit/{}", deployment.sha)).icon(IconName::GitCommit).into());
            }
            if deployment.statuses.first().is_none_or(|status| status.state != "inactive") {
                entries.push(menus::item("Mark Inactive", cx, |this, window, cx| this.confirm_deactivate(window, cx)).icon(IconName::MinusCircle).disabled(busy).into());
            }
        }
        entries
    }

    fn render_actions(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let busy = self.pending.is_some();
        let mut actions = Vec::new();
        if let Some(deployment) = &self.deployment {
            let latest = deployment.statuses.first();
            if let Some(url) = safe_url(latest.and_then(|status| status.environment_url.as_deref())) {
                actions.push(Button::new("delivery-environment", "Open Environment").leading_icon(IconName::OpenExternal).variant(ButtonVariant::Accent).size(ButtonSize::Small).on_click(move |_, _, cx| cx.open_url(&url)).into_any_element());
            }
            if let Some(url) = safe_url(latest.and_then(|status| status.log_url.as_deref())) {
                actions.push(Button::new("delivery-logs", "Logs").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(move |_, _, cx| crate::links::open(cx, &url)).into_any_element());
            }
        }
        if let Some(release) = &self.release {
            if release.draft {
                actions.push(Button::new("delivery-publish", "Publish").variant(ButtonVariant::Accent).size(ButtonSize::Small).disabled(busy).on_click(cx.listener(|this, _, window, cx| this.confirm_publish(window, cx))).into_any_element());
            }
            if !release.immutable {
                actions.push(Button::new("delivery-edit", "Edit").variant(ButtonVariant::Ghost).size(ButtonSize::Small).disabled(busy).on_click(cx.listener(|this, _, window, cx| this.start_editing(window, cx))).into_any_element());
            }
        }
        actions.push(
            Button::icon("delivery-refresh", IconName::ArrowClockwise)
                .size(ButtonSize::Small)
                .tooltip(if self.loading { "Refreshing…" } else { "Refresh" })
                .disabled(self.loading || busy)
                .on_click(cx.listener(|this, _, _, cx| this.load(cx)))
                .into_any_element(),
        );
        actions.push(
            Button::icon("delivery-more", IconName::Dots)
                .size(ButtonSize::Small)
                .tooltip("More actions")
                .active(menus::is_open(&self.open_menu, "delivery-more"))
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                    let entries = this.more_menu(cx);
                    menus::show(this, "delivery-more", entries, below(event), Anchor::TopRight, window, cx);
                }))
                .into_any_element(),
        );
        actions
    }

    fn render_release_summary(&self, release: &Release, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let now = Utc::now();
        let (label, tone) = release_status(release);
        let mut badges = vec![badge(label, tone, colors).into_any_element()];
        if release.immutable {
            badges.push(badge("Immutable", Tone::Muted, colors).into_any_element());
        }
        let tag_url = format!("{}/tree/{}", repository_url(release), release.tag_name);
        let timestamp = release.published_at.clone().unwrap_or_else(|| release.created_at.clone());
        let mut meta = vec![meta_chip("release-tag", Some(IconName::Tag), release.tag_name.clone(), Some(tag_url), true, colors).into_any_element()];
        if let Some(author) = &release.author {
            meta.push(user_chip("release-author", &author.login, colors).into_any_element());
        }
        meta.push(div().child(format!("{} {}", if release.published_at.is_some() { "Published" } else { "Created" }, model::time_ago(&timestamp, now))).into_any_element());
        Summary {
            icon: Icon::new(IconName::Tag).size(IconSize::Custom(px(20.))).color(colors.subtle_foreground).into_any_element(),
            title: title_text(release_title(release)),
            badges,
            description: None,
            meta,
            actions: self.render_actions(cx),
            aside: None,
        }
        .render(colors)
        .into_any_element()
    }

    fn render_deployment_summary(&self, deployment: &Deployment, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let now = Utc::now();
        let (label, tone, _) = deployment_state(deployment);
        let mut badges = vec![badge(label, tone, colors).into_any_element()];
        if deployment.production_environment {
            badges.push(badge("Production", Tone::Accent, colors).into_any_element());
        }
        if deployment.transient_environment {
            badges.push(badge("Preview", Tone::Muted, colors).into_any_element());
        }
        let mut meta = Vec::new();
        if let Some(creator) = &deployment.creator {
            meta.push(user_chip("deployment-creator", &creator.login, colors).into_any_element());
        }
        meta.push(div().child(format!("Created {}", model::time_ago(&deployment.created_at, now))).into_any_element());
        meta.push(meta_chip("deployment-ref", Some(IconName::GitBranch), deployment.git_ref.clone(), None, true, colors).into_any_element());
        meta.push(meta_chip("deployment-sha", Some(IconName::GitCommit), model::short_sha(&deployment.sha).to_string(), None, true, colors).into_any_element());
        Summary {
            icon: Icon::new(IconName::Rocket).size(IconSize::Custom(px(20.))).color(colors.subtle_foreground).into_any_element(),
            title: title_text(deployment.environment.clone()),
            badges,
            description: deployment.description.clone().map(Into::into),
            meta,
            actions: self.render_actions(cx),
            aside: None,
        }
        .render(colors)
        .into_any_element()
    }

    fn render_form(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let form = self.form.as_ref()?;
        let busy = form.busy.is_some();
        let valid = form.draft(cx).is_valid();
        let field = |label: &'static str, input: &Entity<TextInput>, description: Option<&'static str>| {
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w(px(240.))
                .gap(px(6.))
                .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(label))
                .child(input.clone())
                .children(description.map(|text| div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(text)))
        };
        let editing = self.release.is_some();
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(24.))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(16.))
                        .child(div().flex().flex_wrap().gap(px(16.)).child(field("Tag", &form.tag, None)).child(field("Target branch or commit", &form.target, Some("Used when the tag does not already exist."))))
                        .child(field("Release title", &form.name, None))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .text_size(typography::text_sm())
                                .child(Switch::new("release-prerelease", form.prerelease).disabled(busy).on_change({
                                    let this = cx.entity().downgrade();
                                    move |checked, _, cx| {
                                        this.update(cx, |this, cx| {
                                            if let Some(form) = &mut this.form {
                                                form.prerelease = checked;
                                            }
                                            this.remember_draft(cx);
                                        })
                                        .ok();
                                    }
                                }))
                                .child("Mark as prerelease"),
                        )
                        .child(field("Previous tag for generated notes", &form.previous, Some("Generated notes are appended to your current description."))),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .child(
                            div().flex().items_center().justify_between().child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("Release notes")).child(
                                Button::new("release-generate", if form.busy == Some("generate") { "Generating…" } else { "Generate Notes" })
                                    .size(ButtonSize::Small)
                                    .disabled(!valid || busy)
                                    .on_click(cx.listener(|this, _, _, cx| this.generate_notes(cx))),
                            ),
                        )
                        .child(form.body.clone()),
                )
                .children(form.error.clone().map(|error| div().text_size(typography::text_sm()).text_color(colors.destructive).child(error)))
                .child(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(8.))
                        .when(editing, |this| {
                            this.child(Button::new("release-cancel", "Cancel").variant(ButtonVariant::Ghost).size(ButtonSize::Small).disabled(busy).on_click(cx.listener(|this, _, _, cx| this.cancel_editing(cx))))
                        })
                        .child(
                            Button::new("release-save", if form.busy == Some("save") { "Saving…" } else if editing { "Save Changes" } else { "Save Draft" })
                                .variant(ButtonVariant::Accent)
                                .size(ButtonSize::Small)
                                .disabled(!valid || busy)
                                .on_click(cx.listener(|this, _, _, cx| this.save_release(cx))),
                        ),
                )
                .into_any_element(),
        )
    }

    fn render_assets(&self, release: &Release, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let query = self.asset_filter.read(cx).text().to_lowercase();
        let busy = self.pending.is_some();
        let assets: Vec<&ReleaseAsset> = release.assets.iter().filter(|asset| format!("{} {}", asset.name, asset.label.clone().unwrap_or_default()).to_lowercase().contains(&query)).collect();
        let rows = assets.iter().enumerate().map(|(index, asset)| {
            let asset = (*asset).clone();
            let state = if asset.state != "uploaded" { format!(" · {}", asset.state) } else { String::new() };
            let download = safe_url(Some(&asset.browser_download_url)).filter(|_| asset.state == "uploaded");
            div()
                .flex()
                .items_center()
                .gap(px(10.))
                .px(px(10.))
                .py(px(8.))
                .rounded(metrics::radius_md())
                .border_1()
                .border_color(colors.divider)
                .child(Icon::new(IconName::Download).size(IconSize::Small).color(colors.subtle_foreground))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(div().truncate().text_size(typography::text_sm()).text_color(colors.foreground).child(asset.name.clone()))
                        .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(format!("{} · {} downloads{state}", format_asset_size(asset.size), asset.download_count))),
                )
                .children(asset.digest.clone().map(|digest| {
                    Button::icon(SharedString::from(format!("asset-digest-{index}")), IconName::Copy).size(ButtonSize::Small).tooltip("Copy asset digest").on_click(move |_, _, cx| cx.write_to_clipboard(ClipboardItem::new_string(digest.clone())))
                }))
                .child({
                    let link = asset.browser_download_url.clone();
                    Button::icon(SharedString::from(format!("asset-link-{index}")), IconName::Link).size(ButtonSize::Small).tooltip(format!("Copy link to {}", asset.name)).on_click(move |_, _, cx| cx.write_to_clipboard(ClipboardItem::new_string(link.clone())))
                })
                .child(
                    Button::icon(SharedString::from(format!("asset-download-{index}")), IconName::Download)
                        .size(ButtonSize::Small)
                        .tooltip(format!("Download {} in browser", asset.name))
                        .disabled(download.is_none())
                        .on_click(move |_, _, cx| {
                            if let Some(url) = &download {
                                cx.open_url(url);
                            }
                        }),
                )
                .when(!release.immutable, |this| {
                    let name = asset.name.clone();
                    this.child(
                        Button::icon(SharedString::from(format!("asset-delete-{index}")), IconName::Trash)
                            .size(ButtonSize::Small)
                            .tone(ui::ButtonTone::Danger)
                            .tooltip(format!("Delete {name}"))
                            .disabled(busy)
                            .on_click(cx.listener(move |this, _, window, cx| this.confirm_delete_asset(asset.clone(), window, cx))),
                    )
                })
        });
        let toolbar = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(8.))
            .when(release.assets.len() > 5, |this| this.child(div().w(px(240.)).child(self.asset_filter.clone())))
            .when(!release.immutable, |this| {
                this.child(Button::new("asset-upload", "Upload Assets").leading_icon(IconName::Upload).size(ButtonSize::Small).disabled(busy).on_click(cx.listener(|this, _, _, cx| this.upload_assets(cx))))
            })
            .children(self.pending.clone().map(|pending| div().min_w_0().truncate().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(pending)));
        let sources = div()
            .flex()
            .flex_wrap()
            .gap(px(8.))
            .children(safe_url(release.zipball_url.as_deref()).map(|url| Button::new("asset-zip", "Source ZIP").leading_icon(IconName::Download).variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(move |_, _, cx| cx.open_url(&url))))
            .children(safe_url(release.tarball_url.as_deref()).map(|url| Button::new("asset-tar", "Source tar.gz").leading_icon(IconName::Download).variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(move |_, _, cx| cx.open_url(&url))));
        let empty = assets.is_empty().then(|| {
            div().px(px(10.)).py(px(8.)).text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(if release.assets.is_empty() { "No uploaded assets." } else { "No matching assets." })
        });
        section(
            format!("Assets ({})", release.assets.len()),
            None,
            div()
                .flex()
                .flex_col()
                .gap(px(10.))
                .child(toolbar)
                .children(self.action_error.clone().filter(|_| self.confirmation.is_none()).map(|error| div().text_size(typography::text_sm()).text_color(colors.destructive).child(error)))
                .children(rows)
                .children(empty)
                .child(sources),
            colors,
        )
        .into_any_element()
    }

    fn render_release(&self, release: &Release, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let notes = if self.notes.is_empty() {
            div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("No release notes provided.").into_any_element()
        } else {
            markdown::render(&self.notes, "release-notes", cx)
        };
        let downloads: u64 = release.assets.iter().map(|asset| asset.download_count).sum();
        let main = div().flex().flex_col().gap(px(32.)).flex_1().min_w_0().child(section("Release notes", None, notes, colors)).child(self.render_assets(release, colors, cx));
        let mut sidebar = div()
            .flex()
            .flex_col()
            .gap(px(24.))
            .w(px(240.))
            .flex_none()
            .child(section("Target", None, div().font_family(typography::MONO_FONT).text_color(colors.foreground).child(release.target_commitish.clone()), colors))
            .child(section("Downloads", None, div().text_color(colors.foreground).child(format!("{downloads} across {} assets", release.assets.len())), colors));
        if let Some(url) = safe_url(release.discussion_url.as_deref()) {
            sidebar = sidebar.child(section(
                "Discussion",
                None,
                div().flex().ml(px(-8.)).child(Button::new("release-discussion", "Open Discussion").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(move |_, _, cx| cx.open_url(&url))),
                colors,
            ));
        }
        div().flex().items_start().gap(px(40.)).child(main).child(sidebar).into_any_element()
    }

    fn render_deployment(&self, deployment: &Deployment, colors: &ThemeColors) -> AnyElement {
        let now = Utc::now();
        let latest = deployment.statuses.first();
        let rows = deployment.statuses.iter().enumerate().map(|(index, status)| {
            let (label, tone, _) = deployment_status_state(Some(&status.state));
            let log = safe_url(status.log_url.as_deref());
            div()
                .flex()
                .items_center()
                .gap(px(10.))
                .px(px(10.))
                .py(px(8.))
                .rounded(metrics::radius_md())
                .border_1()
                .border_color(colors.divider)
                .when(index == 0, |this| this.bg(colors.surface))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .gap(px(2.))
                        .child(div().flex().items_center().gap(px(6.)).text_size(typography::text_sm()).child(badge(label, tone, colors)).when(index == 0, |this| this.child("Latest")))
                        .child(div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(status.description.clone().filter(|text| !text.is_empty()).unwrap_or_else(|| "No status description".into())))
                        .child(
                            div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(format!(
                                "{}{}",
                                model::time_ago(&status.created_at, now),
                                status.creator.as_ref().map(|creator| format!(" · {}", creator.login)).unwrap_or_default()
                            )),
                        ),
                )
                .children(log.map(|url| {
                    Button::new(SharedString::from(format!("deployment-log-{index}")), "Logs").leading_icon(IconName::OpenExternal).variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(move |_, _, cx| crate::links::open(cx, &url))
                }))
        });
        let history = div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .children(rows)
            .when(deployment.statuses.is_empty(), |this| {
                this.child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("Waiting for the deployment provider to report a status. This view refreshes automatically."))
            });
        let main = div().flex().flex_col().gap(px(32.)).flex_1().min_w_0().child(section(format!("Status history ({})", deployment.statuses.len()), None, history, colors));
        let mut sidebar = div().flex().flex_col().gap(px(24.)).w(px(240.)).flex_none();
        if let Some(environment) = latest.and_then(|status| status.environment.clone()).filter(|environment| *environment != deployment.environment) {
            sidebar = sidebar.child(section("Environment", None, div().text_color(colors.foreground).child(environment), colors));
        }
        sidebar = sidebar
            .child(section("Commit", None, div().font_family(typography::MONO_FONT).text_color(colors.foreground).child(deployment.sha.clone()), colors))
            .child(section("Task", None, div().text_color(colors.foreground).child(deployment.task.clone()), colors));
        if let Some(url) = safe_url(latest.and_then(|status| status.environment_url.as_deref())) {
            let tooltip = url.clone();
            sidebar = sidebar.child(section(
                "Environment URL",
                None,
                div().flex().ml(px(-8.)).child(
                    Button::new("deployment-environment", "Open Environment").leading_icon(IconName::OpenExternal).variant(ButtonVariant::Ghost).size(ButtonSize::Small).tooltip(tooltip).on_click(move |_, _, cx| cx.open_url(&url)),
                ),
                colors,
            ));
        }
        div().flex().items_start().gap(px(40.)).child(main).child(sidebar).into_any_element()
    }
}

impl Render for DeliveryView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let container = div()
            .id("delivery-view")
            .track_focus(&self.focus_handle)
            .relative()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_color(colors.foreground);
        let noun = if self.kind == DeliveryKind::Release { "release" } else { "deployment" };
        if self.deleted {
            return container.child(fill_message("Release deleted", Some("The Git tag remains.".into()), None, &colors)).into_any_element();
        }
        let release = self.release.clone();
        let deployment = self.deployment.clone();
        let summary = if self.form.is_some() {
            Summary {
                icon: Icon::new(IconName::Tag).size(IconSize::Custom(px(20.))).color(colors.subtle_foreground).into_any_element(),
                title: title_text(if release.is_some() { "Edit Release" } else { "New Release" }),
                badges: Vec::new(),
                description: None,
                meta: Vec::new(),
                actions: Vec::new(),
                aside: None,
            }
            .render(&colors)
            .into_any_element()
        } else if let Some(release) = &release {
            self.render_release_summary(release, &colors, cx)
        } else if let Some(deployment) = &deployment {
            self.render_deployment_summary(deployment, &colors, cx)
        } else {
            let body = match &self.error {
                Some(error) => fill_message(
                    error.clone(),
                    None,
                    Some(Button::new("delivery-retry", "Try again").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| this.load(cx))).into_any_element()),
                    &colors,
                ),
                None => fill_message(format!("Loading {noun}…"), None, None, &colors),
            };
            return container.child(body).into_any_element();
        };
        let content = match (self.render_form(&colors, cx), &release, &deployment) {
            (Some(form), _, _) => form,
            (None, Some(release), _) => self.render_release(release, &colors, cx),
            (None, None, Some(deployment)) => self.render_deployment(deployment, &colors),
            _ => div().into_any_element(),
        };
        let stale = self.error.clone().filter(|_| release.is_some() || deployment.is_some());
        container
            .child(div().flex_none().pt(px(20.)).pb(px(12.)).border_b_1().border_color(colors.divider).child(rail(summary)))
            .children(stale.map(|error| rail(div().pt(px(8.)).text_size(typography::text_sm()).text_color(colors.destructive).child(format!("Could not refresh. Showing previously loaded data. {error}")))))
            .children(self.action_error.clone().filter(|_| self.form.is_none() && release.is_none()).map(|error| rail(div().pt(px(8.)).text_size(typography::text_sm()).text_color(colors.destructive).child(error))))
            .child(div().id("delivery-content").flex_1().min_h_0().overflow_y_scroll().pt(px(24.)).pb(px(32.)).child(rail(content)).scrollbar(_window, cx))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
            .children(self.confirmation.as_ref().map(|confirmation| confirmation.render(cx)))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn words_release_and_deployment_states() {
        let release: Release = serde_json::from_value(json!({
            "id": 1, "tag_name": "v1", "target_commitish": "main", "name": "  ", "body": null, "draft": false, "prerelease": true,
            "html_url": "https://github.com/o/r/releases/tag/v1", "created_at": "2026-11-01T00:00:00Z", "published_at": null, "author": null, "assets": [],
            "zipball_url": null, "tarball_url": null, "discussion_url": null
        }))
        .unwrap();
        assert_eq!(release_title(&release), "v1");
        assert_eq!(release_status(&release), ("Prerelease", Tone::Accent));
        assert_eq!(repository_url(&release), "https://github.com/o/r");
        assert_eq!(deployment_status_state(Some("in_progress")), ("In progress", Tone::Accent, true));
        assert_eq!(deployment_status_state(None).0, "Awaiting status");
        assert_eq!(deployment_status_state(Some("weird")).0, "Unknown status");
    }

    #[test]
    fn opens_only_plain_web_links() {
        assert_eq!(safe_url(Some("https://example.com/x")).as_deref(), Some("https://example.com/x"));
        assert_eq!(safe_url(Some("https://user:pw@example.com")), None);
        assert_eq!(safe_url(Some("javascript:alert(1)")), None);
        assert_eq!(safe_url(None), None);
    }

    #[test]
    fn formats_asset_sizes() {
        assert_eq!(format_asset_size(512), "512 B");
        assert_eq!(format_asset_size(2048), "2.0 KB");
        assert_eq!(format_asset_size(5 * 1024 * 1024), "5.0 MB");
    }
}

#[cfg(feature = "snapshot")]
impl DeliveryView {
    pub(crate) fn seed_release(root: &std::path::Path, release: Release, cx: &mut App) {
        store::put(release_key(&root.to_string_lossy(), release.id), Arc::new(release), cx);
    }

    pub(crate) fn seed_deployment(root: &std::path::Path, deployment: Deployment, cx: &mut App) {
        store::put(deployment_key(&root.to_string_lossy(), deployment.id), Arc::new(deployment), cx);
    }

    pub(crate) fn snapshot(&mut self, state: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.error = None;
        match state {
            "publish" => self.confirm_publish(window, cx),
            "edit" => self.start_editing(window, cx),
            _ => {}
        }
        cx.notify();
    }
}
