//! The skills library (centre view kind `skills`): every skill with where it comes from, search,
//! and an editor for saved skills. "Use" asks the workbench to attach the skill to the active
//! session (`SkillsEvent::Use`, handled with `SessionView::attach_skill`).

use ui::WithScrollbar as _;
use std::sync::Arc;

use ui::scale::px;
use gpui::{
    AnyElement, App, AppContext as _, ClickEvent, Context, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, ParentElement, Render,
    Styled, Subscription, Task, Window, div, prelude::*,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, TextInput, TextInputEvent, metrics, pane_header, typography};

use super::{SettingSkill, Skill, SkillRoots, SkillSource, marketplace::{self, MarketplaceSkill}};
use crate::composer::{Composer, ComposerEvent};

#[derive(Clone, Debug, PartialEq)]
pub enum SkillsEvent {
    /// Attach this skill to the active session's next prompt.
    Use(Skill),
}

struct Editor {
    /// The saved skill being changed; `None` for a new one.
    id: Option<String>,
    title: Entity<TextInput>,
    description: Entity<TextInput>,
    content: Entity<Composer>,
    error: Option<String>,
    _subscription: Subscription,
}

pub struct SkillsView {
    roots: SkillRoots,
    skills: Option<Arc<Vec<Skill>>>,
    search: Entity<TextInput>,
    query: String,
    selected: Option<String>,
    editor: Option<Editor>,
    loading: Option<Task<()>>,
    /// Showing the catalog's skills rather than the library.
    browsing: bool,
    /// Ids of catalog skills being installed or updated.
    installing: std::collections::HashSet<String>,
    marketplace_error: Option<String>,
    install_tasks: Vec<Task<()>>,
    /// A skill whose editor opens once the library has loaded (a skill's "Edit…").
    pending_edit: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<SkillsEvent> for SkillsView {}

impl Focusable for SkillsView {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.search.focus_handle(cx)
    }
}

impl SkillsView {
    /// The library for `project` (its `.athas/skills/`), or skills of no project.
    pub fn new(project: Option<std::path::PathBuf>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_roots(SkillRoots::new(project), window, cx)
    }

    pub fn with_roots(roots: SkillRoots, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| TextInput::new(window, cx).placeholder("Search skills").leading_icon(IconName::Search));
        let mut subscriptions = vec![cx.subscribe(&search, |this, _, event: &TextInputEvent, cx| {
            if let TextInputEvent::Changed(query) = event {
                this.query = query.to_string();
                cx.notify();
            }
        })];
        if cx.try_global::<settings::SettingsStore>().is_some() {
            subscriptions.push(cx.observe_global::<settings::SettingsStore>(|this, cx| this.reload(cx)));
        }
        let mut this = Self {
            roots,
            skills: None,
            search,
            query: String::new(),
            selected: None,
            editor: None,
            loading: None,
            browsing: false,
            installing: Default::default(),
            marketplace_error: None,
            install_tasks: Vec::new(),
            pending_edit: None,
            _subscriptions: subscriptions,
        };
        this.reload(cx);
        this
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).ai_skills.clone()).unwrap_or_default();
        let extension_skills = super::extension_skills(cx);
        let roots = self.roots.clone();
        self.loading = Some(cx.spawn(async move |this, cx| {
            let skills = cx.background_spawn(async move { super::load(&settings, &roots, &extension_skills) }).await;
            this.update(cx, |this, cx| {
                if this.selected.is_none() {
                    this.selected = skills.first().map(|skill| skill.id.clone());
                }
                this.skills = Some(Arc::new(skills));
                this.loading = None;
                cx.notify();
            })
            .ok();
        }));
    }

    fn visible(&self) -> Vec<Skill> {
        let Some(skills) = &self.skills else { return Vec::new() };
        let query = self.query.trim();
        if query.is_empty() {
            return skills.to_vec();
        }
        crate::mentions::rank(query, skills.iter().map(|skill| (skill.title.as_str(), skill.clone())), skills.len())
    }

    fn selected_skill(&self) -> Option<Skill> {
        let id = self.selected.as_ref()?;
        self.skills.as_ref()?.iter().find(|skill| &skill.id == id).cloned()
    }

    /// Selects the skill `id` and opens its editor, once the library has it
    /// (`workbench_api::open_skill`).
    pub fn edit_skill(&mut self, id: String, cx: &mut Context<Self>) {
        self.selected = Some(id.clone());
        self.browsing = false;
        self.pending_edit = Some(id);
        cx.notify();
    }

    /// Opens the editor on a saved skill, or on a new one.
    pub fn edit(&mut self, skill: Option<&Skill>, window: &mut Window, cx: &mut Context<Self>) {
        let title = cx.new(|cx| TextInput::new(window, cx).placeholder("Title, like Write release notes"));
        let description = cx.new(|cx| TextInput::new(window, cx).placeholder("What it does (optional)"));
        let content = cx.new(Composer::new);
        content.update(cx, |content, cx| content.set_placeholder("Instructions for the agent… (Shift-Enter for a new line)", cx));
        if let Some(skill) = skill {
            title.update(cx, |input, cx| input.set_text(skill.title.clone(), cx));
            description.update(cx, |input, cx| input.set_text(skill.description.clone(), cx));
            content.update(cx, |input, cx| input.set_text(skill.content.clone(), cx));
        }
        let subscription = cx.subscribe(&content, |this, _, event: &ComposerEvent, cx| {
            if matches!(event, ComposerEvent::Submit | ComposerEvent::SubmitNow) {
                this.save(cx);
            }
        });
        title.update(cx, |input, cx| input.focus(window, cx));
        self.editor = Some(Editor {
            id: skill.filter(|skill| skill.source == SkillSource::Settings).map(|skill| skill.id.clone()),
            title,
            description,
            content,
            error: None,
            _subscription: subscription,
        });
        cx.notify();
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        let Some(editor) = &mut self.editor else { return };
        let title = editor.title.read(cx).text().trim().to_string();
        let description = editor.description.read(cx).text().trim().to_string();
        let content = editor.content.read(cx).text().trim().to_string();
        if title.is_empty() || content.is_empty() {
            editor.error = Some("A skill needs a title and instructions".into());
            cx.notify();
            return;
        }
        if cx.try_global::<settings::SettingsStore>().is_none() {
            return;
        }
        let values = settings::get(cx).ai_skills.clone();
        let existing = editor.id.as_ref().and_then(|id| super::setting_skills(&values).into_iter().find(|skill| &skill.id == id));
        let id = editor.id.clone().unwrap_or_else(super::new_id);
        let mut skill = existing.unwrap_or_else(|| SettingSkill { id: id.clone(), ..Default::default() });
        skill.title = title;
        skill.description = (!description.is_empty()).then_some(description);
        skill.content = content;
        if !skill.other.contains_key("source") {
            skill.other.insert("source".into(), "local".into());
        }
        let updated = super::upsert_setting(&values, skill);
        settings::update(cx, |settings| settings.ai_skills = updated);
        self.editor = None;
        self.selected = Some(id);
        self.reload(cx);
    }

    fn delete(&mut self, id: String, cx: &mut Context<Self>) {
        if cx.try_global::<settings::SettingsStore>().is_none() {
            return;
        }
        let updated = super::remove_setting(&settings::get(cx).ai_skills, &id);
        settings::update(cx, |settings| settings.ai_skills = updated);
        self.selected = None;
        self.reload(cx);
    }

    /// The catalog's skills matching the search.
    fn marketplace_skills(&self, cx: &App) -> Vec<MarketplaceSkill> {
        let Some(extensions) = cx.try_global::<extensions::Extensions>() else { return Vec::new() };
        let base_url = extensions.cdn_base_url().unwrap_or(extensions::CDN_BASE_URL);
        let skills = marketplace::from_catalog(&extensions.entries(), base_url);
        let query = self.query.trim();
        if query.is_empty() {
            return skills;
        }
        crate::mentions::rank(query, skills.iter().map(|skill| (skill.title.as_str(), skill.clone())), skills.len())
    }

    fn saved_skills(cx: &App) -> Vec<SettingSkill> {
        if cx.try_global::<settings::SettingsStore>().is_none() {
            return Vec::new();
        }
        super::setting_skills(&settings::get(cx).ai_skills)
    }

    /// Installs a catalog skill into the library, or brings an installed one up to date.
    fn install(&mut self, skill: MarketplaceSkill, cx: &mut Context<Self>) {
        if !self.installing.insert(skill.id.clone()) {
            return;
        }
        self.marketplace_error = None;
        cx.notify();
        let install = marketplace::install(skill.clone(), cx);
        let task = cx.spawn(async move |this, cx| {
            let result = install.await;
            this.update(cx, |this, cx| {
                this.installing.remove(&skill.id);
                match result {
                    Ok(id) => {
                        this.selected = Some(id);
                        this.reload(cx);
                    }
                    Err(error) => this.marketplace_error = Some(error),
                }
                cx.notify();
            })
            .ok();
        });
        self.install_tasks.retain(|task| !task.is_ready());
        self.install_tasks.push(task);
    }

    fn render_marketplace(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let skills = self.marketplace_skills(cx);
        let saved = Self::saved_skills(cx);
        if skills.is_empty() {
            let message = if self.query.trim().is_empty() { "The extension catalog offers no skills yet." } else { "No skill matches that." };
            return div().p(px(16.)).child(EmptyState::new("No skills").message(message).icon(IconName::BookOpen)).into_any_element();
        }
        let rows = skills.into_iter().enumerate().map(|(index, skill)| {
            let installed = marketplace::installed(&saved, &skill.id);
            let busy = self.installing.contains(&skill.id);
            let update = installed.is_some_and(|installed| marketplace::has_update(installed, &skill));
            let button = match (installed, busy, update) {
                (_, true, _) => Button::new(("marketplace-install", index), if installed.is_some() { "Updating…" } else { "Installing…" }).disabled(true),
                (Some(_), false, true) => Button::new(("marketplace-install", index), "Update").variant(ButtonVariant::Default),
                (Some(_), false, false) => Button::new(("marketplace-install", index), "Installed").variant(ButtonVariant::Ghost).leading_icon(IconName::Check).disabled(true),
                (None, false, _) => Button::new(("marketplace-install", index), "Install").variant(ButtonVariant::Default),
            };
            let target = skill.clone();
            let meta = [skill.author.clone(), skill.version.clone().map(|version| format!("v{version}")), skill.license.clone()].into_iter().flatten().collect::<Vec<_>>().join(" · ");
            div()
                .id(("marketplace-skill", index))
                .flex()
                .items_start()
                .gap(px(8.))
                .px(px(8.))
                .py(px(8.))
                .rounded(metrics::radius_md())
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(2.))
                        .child(div().truncate().font_weight(typography::MEDIUM).child(skill.title.clone()))
                        .child(div().text_size(typography::text_caption()).text_color(colors.muted_foreground).child(skill.description.clone()))
                        .when(!meta.is_empty(), |this| this.child(div().truncate().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(meta))),
                )
                .child(button.size(ButtonSize::Small).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.install(target.clone(), cx))))
        });
        div()
            .id("marketplace-list")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .px(px(6.))
            .py(px(4.))
            .flex()
            .flex_col()
            .gap(px(1.))
            .when_some(self.marketplace_error.clone(), |this, error| this.child(div().px(px(8.)).py(px(4.)).text_size(typography::text_sm()).text_color(colors.destructive).child(error)))
            .children(rows)
            .into_any_element()
    }

    fn render_list(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let skills = self.visible();
        if self.skills.is_some() && skills.is_empty() {
            let message = if self.query.trim().is_empty() {
                "Add a skill, or put SKILL.md files in .athas/skills or ~/.claude/skills."
            } else {
                "No skill matches that."
            };
            return div().p(px(16.)).child(EmptyState::new("No skills").message(message).icon(IconName::BookOpen)).into_any_element();
        }
        let rows = skills.into_iter().enumerate().map(|(index, skill)| {
            let selected = self.selected.as_deref() == Some(skill.id.as_str());
            let id = skill.id.clone();
            div()
                .id(("skill-row", index))
                .flex()
                .flex_col()
                .gap(px(2.))
                .px(px(8.))
                .py(px(6.))
                .rounded(metrics::radius_md())
                .when(selected, |this| this.bg(colors.selected))
                .when(!selected, |this| this.hover(|style| style.bg(colors.accent)))
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                    this.selected = Some(id.clone());
                    this.editor = None;
                    cx.notify();
                }))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(div().flex_1().min_w_0().truncate().font_weight(typography::MEDIUM).child(skill.title.clone()))
                        .child(div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(skill.source.label())),
                )
                .child(
                    div()
                        .truncate()
                        .text_size(typography::text_caption())
                        .text_color(colors.muted_foreground)
                        .child(if skill.description.is_empty() { format!("/{}", skill.command()) } else { skill.description.clone() }),
                )
        });
        div().id("skill-list").flex_1().min_h_0().overflow_y_scroll().px(px(6.)).py(px(4.)).flex().flex_col().gap(px(1.)).children(rows).into_any_element()
    }

    fn render_editor(&self, editor: &Editor, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let label = |text: &'static str| div().text_size(typography::text_caption()).text_color(colors.muted_foreground).child(text);
        div()
            .flex()
            .flex_col()
            .gap(px(10.))
            .child(div().text_size(typography::text_lg()).font_weight(typography::SEMIBOLD).child(if editor.id.is_some() { "Edit skill" } else { "New skill" }))
            .child(div().flex().flex_col().gap(px(4.)).child(label("Title")).child(editor.title.clone()))
            .child(div().flex().flex_col().gap(px(4.)).child(label("Description")).child(editor.description.clone()))
            .child(
                div().flex().flex_col().gap(px(4.)).child(label("Instructions")).child(
                    div()
                        .min_h(px(160.))
                        .p(px(8.))
                        .rounded(metrics::radius_lg())
                        .border_1()
                        .border_color(colors.border)
                        .bg(colors.field)
                        .child(editor.content.clone()),
                ),
            )
            .when_some(editor.error.clone(), |this, error| this.child(div().text_size(typography::text_sm()).text_color(colors.destructive).child(error)))
            .child(
                div()
                    .flex()
                    .gap(px(6.))
                    .justify_end()
                    .child(Button::new("skill-cancel", "Cancel").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                        this.editor = None;
                        cx.notify();
                    })))
                    .child(Button::new("skill-save", "Save").variant(ButtonVariant::Accent).size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.save(cx)))),
            )
            .into_any_element()
    }

    fn render_detail(&self, skill: &Skill, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let editable = skill.source == SkillSource::Settings;
        let (use_skill, edit_skill, delete_id, file) = (skill.clone(), skill.clone(), skill.id.clone(), skill.source.file().map(|path| path.to_path_buf()));
        let origin = match &skill.source {
            SkillSource::Settings => "Saved in settings".to_string(),
            SkillSource::Project(path) | SkillSource::User(path) => path.display().to_string(),
            SkillSource::Extension(id) => format!("From the {id} extension"),
        };
        div()
            .flex()
            .flex_col()
            .gap(px(10.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(div().flex_1().min_w_0().truncate().text_size(typography::text_lg()).font_weight(typography::SEMIBOLD).child(skill.title.clone()))
                    .when_some(file, |this, file| {
                        this.child(Button::new("skill-open", "Open file").variant(ButtonVariant::Ghost).size(ButtonSize::Small).leading_icon(IconName::OpenExternal).on_click(
                            move |_, _, cx| workbench_api::open_file(cx, file.clone(), None),
                        ))
                    })
                    .when(editable, |this| {
                        this.child(Button::new("skill-delete", "Delete").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(
                            move |this, _: &ClickEvent, _, cx| this.delete(delete_id.clone(), cx),
                        )))
                        .child(Button::new("skill-edit", "Edit").variant(ButtonVariant::Default).size(ButtonSize::Small).leading_icon(IconName::Pencil).on_click(
                            cx.listener(move |this, _: &ClickEvent, window, cx| this.edit(Some(&edit_skill), window, cx)),
                        ))
                    })
                    .child(Button::new("skill-use", "Use in session").variant(ButtonVariant::Accent).size(ButtonSize::Small).on_click(cx.listener(
                        move |_, _: &ClickEvent, _, cx| cx.emit(SkillsEvent::Use(use_skill.clone())),
                    ))),
            )
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .text_size(typography::text_sm())
                    .text_color(colors.subtle_foreground)
                    .child(div().font_family(typography::MONO_FONT).text_color(colors.muted_foreground).child(format!("/{}", skill.command())))
                    .child(div().min_w_0().truncate().child(origin)),
            )
            .when(!skill.description.is_empty(), |this| this.child(div().text_color(colors.muted_foreground).child(skill.description.clone())))
            .child(
                div()
                    .p(px(12.))
                    .rounded(metrics::radius_lg())
                    .border_1()
                    .border_color(colors.border)
                    .bg(colors.raised)
                    .font_family(typography::MONO_FONT)
                    .text_size(typography::text_sm())
                    .line_height(px(19.))
                    .child(skill.content.clone()),
            )
            .into_any_element()
    }
}

impl Render for SkillsView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.skills.is_some()
            && let Some(id) = self.pending_edit.take()
            && let Some(skill) = self.skills.as_ref().and_then(|skills| skills.iter().find(|skill| skill.id == id).cloned())
        {
            self.edit(Some(&skill), window, cx);
        }
        let colors = cx.theme().colors.clone();
        let count = self.skills.as_ref().map_or(0, |skills| skills.len());
        let detail = match (&self.editor, self.selected_skill()) {
            (Some(editor), _) => self.render_editor(editor, cx),
            (None, Some(skill)) => self.render_detail(&skill, cx),
            (None, None) => div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .child(EmptyState::new("Pick a skill").message("Type / in the composer to attach one to a prompt.").icon(IconName::BookOpen))
                .into_any_element(),
        };
        div()
            .id("skills")
            .key_context("Skills")
            .size_full()
            .flex()
            .flex_col()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_size(typography::text_base())
            .text_color(colors.foreground)
            .child(
                pane_header(cx)
                    .gap(px(8.))
                    .child(Icon::new(IconName::BookOpen).size(IconSize::Small).color(colors.muted_foreground))
                    .child(div().font_weight(typography::MEDIUM).child("Skills"))
                    .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(format!("{count}")))
                    .child(div().flex_1())
                    .child(
                        Button::new("skills-library", "Library")
                            .variant(if self.browsing { ButtonVariant::Ghost } else { ButtonVariant::Default })
                            .size(ButtonSize::Small)
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                                this.browsing = false;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("skills-marketplace", "Marketplace")
                            .variant(if self.browsing { ButtonVariant::Default } else { ButtonVariant::Ghost })
                            .size(ButtonSize::Small)
                            .leading_icon(IconName::Globe)
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                                this.browsing = true;
                                this.editor = None;
                                cx.notify();
                            })),
                    )
                    .child(Button::new("skill-new", "New skill").variant(ButtonVariant::Default).size(ButtonSize::Small).leading_icon(IconName::Plus).on_click(
                        cx.listener(|this, _: &ClickEvent, window, cx| this.edit(None, window, cx)),
                    )),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .child(
                        div()
                            .w(px(300.))
                            .flex_none()
                            .h_full()
                            .flex()
                            .flex_col()
                            .border_r_1()
                            .border_color(colors.border)
                            .child(div().px(metrics::pane_inset()).py(px(8.)).child(self.search.clone()))
                            .child(if self.browsing { self.render_marketplace(cx) } else { self.render_list(cx) }),
                    )
                    .child(div().id("skill-detail").flex_1().min_w_0().h_full().overflow_y_scroll().scrollbar(window, cx).p(px(20.)).child(detail)),
            )
    }
}
