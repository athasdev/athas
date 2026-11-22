//! Import From Another Editor (`file-system/components/ide-settings-import-dialog.tsx`): pick an
//! editor found on this machine, review every setting and keybinding it would change, apply.

use std::path::PathBuf;

use ui::scale::px;
use gpui::{AnyElement, App, Context, EventEmitter, SharedString, Window, div, prelude::*,};
use keymap::KeybindingsImport;
use notifications::{NotificationCategory, NotificationKind};
use serde_json::Value;
use settings::{
    SETTING_DEFS,
    import::{Editor, SettingChange},
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, Switch, metrics, typography};

use workbench_api::ImportedProject;

use crate::keybindings::apply_import;
#[cfg(not(target_family = "wasm"))]
use crate::keybindings::command_ids;

pub enum EditorImportEvent {
    Close,
}

struct Source {
    editor: Editor,
    settings_file: Option<PathBuf>,
    changes: Vec<SettingChange>,
    keybindings_file: Option<PathBuf>,
    keybindings: Option<KeybindingsImport>,
    /// Folders the editor opened recently that still exist.
    projects: Vec<ImportedProject>,
}

impl Source {
    fn found(&self) -> bool {
        self.settings_file.is_some() || self.keybindings_file.is_some() || !self.projects.is_empty()
    }
}

/// The ids Athas's project history reader gives each editor's variants.
#[cfg(not(target_family = "wasm"))]
fn source_ids(editor: Editor) -> &'static [&'static str] {
    match editor {
        Editor::VsCode => &["vscode", "vscode-insiders", "vscodium"],
        Editor::Cursor => &["cursor"],
        Editor::Windsurf => &["windsurf"],
        Editor::Zed => &["zed", "zed-preview", "zed-dev"],
        Editor::JetBrains => &["jetbrains"],
    }
}

pub struct EditorImport {
    sources: Vec<Source>,
    /// The source under review, and which of its changes are ticked.
    chosen: Option<(usize, Vec<bool>, bool)>,
    /// Whether the source's recent projects are added to Athas's.
    import_projects: bool,
}

impl EventEmitter<EditorImportEvent> for EditorImport {}

/// An Athas theme for another editor's theme name: by name or id, ignoring case.
#[cfg(not(target_family = "wasm"))]
fn theme_lookup(cx: &App) -> impl Fn(&str) -> Option<String> + use<> {
    let themes: Vec<(String, String)> = theme::registry(cx).themes().iter().map(|theme| (theme.id.clone(), theme.name.clone())).collect();
    move |name: &str| {
        let name = name.trim();
        themes
            .iter()
            .find(|(id, theme)| theme.eq_ignore_ascii_case(name) || id.eq_ignore_ascii_case(name))
            .map(|(id, _)| id.clone())
    }
}

#[cfg(not(target_family = "wasm"))]
fn scan(cx: &App) -> Vec<Source> {
    let lookup = theme_lookup(cx);
    let current = settings::saved(cx).clone();
    let ids = command_ids();
    let projects = athas_project::ide_recents::importable_ide_projects();
    Editor::ALL
        .iter()
        .map(|&editor| {
            let (settings_file, imported) = settings::import::read_editor_settings(editor, &lookup).unzip();
            let keybindings_file = settings::import::editor_keybindings_file(editor);
            let keybindings = keybindings_file
                .as_ref()
                .and_then(|file| std::fs::read_to_string(file).ok())
                .and_then(|text| settings::parse_jsonc(&text).ok())
                .and_then(|value| keymap::parse_keybindings_import(&value, &ids, keymap::ImportPlatform::current()));
            Source {
                editor,
                settings_file,
                changes: settings::import::changes(&current, imported.unwrap_or_default()),
                keybindings_file,
                keybindings,
                projects: projects
                    .iter()
                    .filter(|project| source_ids(editor).contains(&project.source_id.as_str()))
                    .map(|project| ImportedProject {
                        path: project.path.clone(),
                        source_id: project.source_id.clone(),
                        source_name: project.source_name.clone(),
                    })
                    .collect(),
            }
        })
        .collect()
}

#[cfg(target_family = "wasm")]
fn scan(_: &App) -> Vec<Source> {
    Vec::new()
}

fn label_for(key: &str) -> String {
    SETTING_DEFS
        .iter()
        .find(|def| def.key == Some(key))
        .map(|def| def.label.to_string())
        .unwrap_or_else(|| match key {
            "theme" => "Theme".into(),
            "autoThemeLight" => "Light Theme".into(),
            "autoThemeDark" => "Dark Theme".into(),
            "syncSystemTheme" => "Follow System Appearance".into(),
            "windowTransparency" => "Interface Style".into(),
            other => other.to_string(),
        })
}

fn value_label(value: &Value) -> String {
    match value {
        Value::Bool(true) => "On".into(),
        Value::Bool(false) => "Off".into(),
        Value::String(text) if text.is_empty() => "(none)".into(),
        Value::String(text) => text.clone(),
        Value::Number(number) => {
            let number = number.as_f64().unwrap_or_default();
            if number.fract() == 0.0 { format!("{number:.0}") } else { format!("{number}") }
        }
        Value::Array(items) if items.is_empty() => "(none)".into(),
        Value::Array(items) => items.iter().map(value_label).collect::<Vec<_>>().join(", "),
        other => other.to_string(),
    }
}

fn home_relative(path: &std::path::Path) -> String {
    let text = path.display().to_string();
    match std::env::var("HOME") {
        Ok(home) if !home.is_empty() && text.starts_with(&home) => format!("~{}", &text[home.len()..]),
        _ => text,
    }
}

impl EditorImport {
    pub fn new(_window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self { sources: scan(cx), chosen: None, import_projects: false }
    }

    fn choose(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(source) = self.sources.get(index) else { return };
        let ticks = vec![true; source.changes.len()];
        let keybindings = source.keybindings.as_ref().is_some_and(|import| !import.keybindings.is_empty());
        self.chosen = Some((index, ticks, keybindings));
        self.import_projects = !source.projects.is_empty();
        cx.notify();
    }

    fn apply(&mut self, cx: &mut Context<Self>) {
        let Some((index, ticks, keybindings)) = self.chosen.take() else { return };
        let Some(source) = self.sources.get(index) else { return };
        let changes: Vec<SettingChange> = source
            .changes
            .iter()
            .zip(&ticks)
            .filter(|(_, ticked)| **ticked)
            .map(|(change, _)| change.clone())
            .collect();
        if !changes.is_empty() {
            settings::update(cx, |settings| settings::import::apply(settings, &changes));
        }
        if keybindings && let Some(import) = &source.keybindings {
            apply_import(import, cx);
        }
        if self.import_projects && !source.projects.is_empty() {
            workbench_api::request(cx, workbench_api::OpenRequest::ImportRecentProjects(source.projects.clone()));
        }
        let name = source.editor.name();
        notifications::notify(
            cx,
            NotificationKind::Success,
            NotificationCategory::Athas,
            format!("Imported settings from {name}"),
            Some(format!("{} setting{} changed", changes.len(), if changes.len() == 1 { "" } else { "s" }).into()),
            None,
        );
        cx.emit(EditorImportEvent::Close);
    }

    fn header(&self, title: SharedString, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(
                Button::new("import-back", "Back")
                    .variant(ButtonVariant::Ghost)
                    .leading_icon(IconName::ArrowLeft)
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.chosen.take().is_none() {
                            cx.emit(EditorImportEvent::Close);
                        }
                        cx.notify();
                    })),
            )
            .child(div().flex_1().text_size(typography::text_base()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(title))
            .into_any_element()
    }

    fn card(rows: Vec<AnyElement>, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_col()
            .rounded(metrics::island_radius())
            .bg(colors.raised)
            .shadow(cx.theme().shadows.raised.clone())
            .overflow_hidden()
            .children(rows)
            .into_any_element()
    }

    fn render_sources(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let rows: Vec<AnyElement> = self
            .sources
            .iter()
            .enumerate()
            .map(|(index, source)| {
                let found = source.found();
                let detail = match (&source.settings_file, &source.keybindings_file) {
                    (Some(settings), Some(_)) => format!("{} and keybindings", home_relative(settings)),
                    (Some(settings), None) => home_relative(settings),
                    (None, Some(keys)) => home_relative(keys),
                    (None, None) if !source.projects.is_empty() => "Recent projects".into(),
                    (None, None) => "Not found on this computer".into(),
                };
                let summary = if found {
                    let keys = source.keybindings.as_ref().map_or(0, |import| import.keybindings.len());
                    format!("{} changes, {keys} keybindings, {} recent projects", source.changes.len(), source.projects.len())
                } else {
                    String::new()
                };
                div()
                    .id(("import-source", index))
                    .relative()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .min_h(px(48.))
                    .px(px(12.))
                    .py(px(8.))
                    .when(index > 0, |this| this.child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider)))
                    .when(found, |this| this.hover(|style| style.bg(colors.accent)).on_click(cx.listener(move |this, _, _, cx| this.choose(index, cx))))
                    .when(!found, |this| this.opacity(0.6))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child(source.editor.name()))
                            .child(div().truncate().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(detail)),
                    )
                    .child(div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(summary))
                    .when(found, |this| this.child(Icon::new(IconName::ChevronRight).size(IconSize::Small).color(colors.subtle_foreground)))
                    .into_any_element()
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(self.header("Import From Another Editor".into(), cx))
            .child(
                div()
                    .px(px(12.))
                    .text_size(typography::text_sm())
                    .text_color(colors.muted_foreground)
                    .child("Settings and keybindings are read from the editor's own files. You review every change before it applies."),
            )
            .child(Self::card(rows, cx))
            .into_any_element()
    }

    fn render_preview(&self, index: usize, ticks: &[bool], keybindings: bool, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(source) = self.sources.get(index) else { return div().into_any_element() };
        let this = cx.entity().downgrade();
        let rows: Vec<AnyElement> = source
            .changes
            .iter()
            .zip(ticks)
            .enumerate()
            .map(|(position, (change, ticked))| {
                let this = this.clone();
                div()
                    .relative()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .min_h(px(44.))
                    .px(px(12.))
                    .py(px(6.))
                    .when(position > 0, |this| this.child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider)))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child(label_for(change.key)))
                            .child(div().truncate().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(format!("from {}", change.from))),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .max_w(px(280.))
                            .text_size(typography::text_sm())
                            .child(div().truncate().text_color(colors.subtle_foreground).line_through().child(value_label(&change.old)))
                            .child(Icon::new(IconName::ArrowRight).size(IconSize::XSmall).color(colors.subtle_foreground))
                            .child(div().truncate().text_color(colors.foreground).child(value_label(&change.new))),
                    )
                    .child(Switch::new(("import-change", position), *ticked).on_change(move |checked, _, cx| {
                        this.update(cx, |this, cx| {
                            if let Some((_, ticks, _)) = this.chosen.as_mut()
                                && let Some(tick) = ticks.get_mut(position)
                            {
                                *tick = checked;
                            }
                            cx.notify();
                        })
                        .ok();
                    }))
                    .into_any_element()
            })
            .collect();
        let chosen_count = ticks.iter().filter(|ticked| **ticked).count();

        let mut sections: Vec<AnyElement> = vec![self.header(format!("Import From {}", source.editor.name()).into(), cx)];
        sections.push(
            div()
                .px(px(12.))
                .text_size(typography::text_sm())
                .font_weight(typography::MEDIUM)
                .text_color(colors.muted_foreground)
                .child(format!("Settings ({})", source.changes.len()))
                .into_any_element(),
        );
        if rows.is_empty() {
            sections.push(
                Self::card(
                    vec![
                        div()
                            .p(px(16.))
                            .text_size(typography::text_sm())
                            .text_color(colors.muted_foreground)
                            .child("Nothing to change: your settings already match.")
                            .into_any_element(),
                    ],
                    cx,
                ),
            );
        } else {
            sections.push(Self::card(rows, cx));
        }

        if let (Some(import), Some(file)) = (&source.keybindings, &source.keybindings_file) {
            let this = this.clone();
            let summary = keymap::issue_summary(&import.issues);
            sections.push(
                div()
                    .px(px(12.))
                    .text_size(typography::text_sm())
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.muted_foreground)
                    .child("Keybindings")
                    .into_any_element(),
            );
            sections.push(Self::card(
                vec![
                    div()
                        .flex()
                        .items_center()
                        .gap(px(12.))
                        .min_h(px(44.))
                        .px(px(12.))
                        .py(px(6.))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w_0()
                                .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child(format!(
                                    "{} keybinding{} from {}",
                                    import.keybindings.len(),
                                    if import.keybindings.len() == 1 { "" } else { "s" },
                                    home_relative(file)
                                )))
                                .children(summary.map(|summary| div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(summary))),
                        )
                        .child(Switch::new("import-keybindings", keybindings).disabled(import.keybindings.is_empty()).on_change(move |checked, _, cx| {
                            this.update(cx, |this, cx| {
                                if let Some((_, _, keybindings)) = this.chosen.as_mut() {
                                    *keybindings = checked;
                                }
                                cx.notify();
                            })
                            .ok();
                        }))
                        .into_any_element(),
                ],
                cx,
            ));
        }

        if !source.projects.is_empty() {
            let this = this.clone();
            sections.push(
                div()
                    .px(px(12.))
                    .text_size(typography::text_sm())
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.muted_foreground)
                    .child("Recent Projects")
                    .into_any_element(),
            );
            sections.push(Self::card(
                vec![
                    div()
                        .flex()
                        .items_center()
                        .gap(px(12.))
                        .min_h(px(44.))
                        .px(px(12.))
                        .py(px(6.))
                        .child(div().flex_1().min_w_0().text_size(typography::text_sm()).text_color(colors.foreground).child(format!(
                            "{} recent project{} from {}",
                            source.projects.len(),
                            if source.projects.len() == 1 { "" } else { "s" },
                            source.editor.name()
                        )))
                        .child(Switch::new("import-recent-projects", self.import_projects).on_change(move |checked, _, cx| {
                            this.update(cx, |this, cx| {
                                this.import_projects = checked;
                                cx.notify();
                            })
                            .ok();
                        }))
                        .into_any_element(),
                ],
                cx,
            ));
        }

        let nothing = chosen_count == 0 && !keybindings && !(self.import_projects && !source.projects.is_empty());
        sections.push(
            div()
                .flex()
                .justify_end()
                .gap(px(8.))
                .child(
                    Button::new("import-cancel", "Cancel").variant(ButtonVariant::Outline).on_click(cx.listener(|this, _, _, cx| {
                        this.chosen = None;
                        cx.notify();
                    })),
                )
                .child(
                    Button::new("import-apply", if chosen_count > 0 { format!("Apply {chosen_count} Changes") } else { "Apply".into() })
                        .variant(ButtonVariant::Accent)
                        .size(ButtonSize::Medium)
                        .disabled(nothing)
                        .on_click(cx.listener(|this, _, _, cx| this.apply(cx))),
                )
                .into_any_element(),
        );
        div().flex().flex_col().gap(px(12.)).children(sections).into_any_element()
    }
}

impl Render for EditorImport {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        match self.chosen.clone() {
            Some((index, ticks, keybindings)) => self.render_preview(index, &ticks, keybindings, cx),
            None => self.render_sources(cx),
        }
    }
}
