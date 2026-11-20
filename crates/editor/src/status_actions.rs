//! The buttons at the end of a file's breadcrumb bar (`breadcrumb.tsx` default actions and
//! `editor-status-actions.tsx`): Markdown preview, find, the language mode, the language server
//! menu (restart or stop each server or all of them) and the editor preferences menu.

use gpui::{App, Context, Entity, IntoElement, Render, Subscription, WeakEntity, Window, div, prelude::*};
use lsp_client::LspStore;
use settings::Settings;
use ui::{Button, ButtonTone, ButtonVariant, DropdownMenu, IconName, MenuEntry, MenuItem, MenuSize, Select, SelectEvent, SelectOption, SelectSearch};

use crate::{Editor, LspStatus, syntax};

pub struct EditorStatusActions {
    editor: WeakEntity<Editor>,
    language: Entity<Select>,
    servers: Entity<DropdownMenu>,
    preferences: Entity<DropdownMenu>,
    _subscriptions: Vec<Subscription>,
}

/// How the language server button looks: its icon, colour and tooltip (`getStatusConfig`).
pub(crate) fn server_status(running: usize, status: &LspStatus, failed: bool) -> (IconName, ButtonTone, &'static str) {
    match status {
        LspStatus::Starting(_) => (IconName::Bolt, ButtonTone::Warning, "Connecting to Language Server..."),
        LspStatus::Failed(_) | LspStatus::NotInstalled(_) => (IconName::BoltSlash, ButtonTone::Danger, "Language server issue"),
        _ if running > 0 => (IconName::Bolt, ButtonTone::Success, "Language Servers Active"),
        _ if failed => (IconName::BoltSlash, ButtonTone::Danger, "Language server issue"),
        _ => (IconName::BoltSlash, ButtonTone::Default, "No active language servers"),
    }
}

fn toggle(label: &'static str, checked: bool, change: impl Fn(&mut Settings) + 'static) -> MenuEntry {
    MenuItem::new(label).checked(checked).on_select(move |_, cx| settings::update(cx, |settings| change(settings))).into()
}

fn preference_entries(cx: &App) -> Vec<MenuEntry> {
    let settings = settings::get(cx);
    vec![
        toggle("Breadcrumbs", settings.core_features.breadcrumbs, |settings| settings.core_features.breadcrumbs = !settings.core_features.breadcrumbs),
        toggle("Minimap", settings.show_minimap, |settings| settings.show_minimap = !settings.show_minimap),
        toggle("Outline", settings.show_outline, |settings| settings.show_outline = !settings.show_outline),
        MenuEntry::Separator,
        toggle("Line Numbers", settings.line_numbers, |settings| settings.line_numbers = !settings.line_numbers),
        toggle("Relative Line Numbers", settings.vim_relative_line_numbers, |settings| settings.vim_relative_line_numbers = !settings.vim_relative_line_numbers),
        toggle("Word Wrap", settings.word_wrap, |settings| settings.word_wrap = !settings.word_wrap),
        MenuEntry::Separator,
        toggle("Parameter Hints", settings.parameter_hints, |settings| settings.parameter_hints = !settings.parameter_hints),
        toggle("Auto Completion", settings.auto_completion, |settings| settings.auto_completion = !settings.auto_completion),
        toggle("Inlay Hints", settings.inlay_hints, |settings| settings.inlay_hints = !settings.inlay_hints),
        toggle("Code Lens", settings.code_lens, |settings| settings.code_lens = !settings.code_lens),
        toggle("Semantic Tokens", settings.semantic_tokens, |settings| settings.semantic_tokens = !settings.semantic_tokens),
        toggle("Vim Mode", settings.vim_mode, |settings| settings.vim_mode = !settings.vim_mode),
        toggle("Inline Git Blame", settings.enable_inline_git_blame, |settings| settings.enable_inline_git_blame = !settings.enable_inline_git_blame),
    ]
}

fn server_entries(editor: &WeakEntity<Editor>, cx: &App) -> Vec<MenuEntry> {
    let store = LspStore::try_global(cx);
    let mut servers = store.as_ref().map(|store| store.read(cx).servers()).unwrap_or_default();
    servers.sort_by(|a, b| a.name().cmp(b.name()));
    let unavailable = store.as_ref().map(|store| store.read(cx).unavailable()).unwrap_or_default();
    let editor = editor.upgrade();
    let project = editor
        .as_ref()
        .and_then(|editor| editor.read(cx).lsp.project_root.clone())
        .and_then(|root| root.file_name().map(|name| name.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "Language Servers".to_string());
    let mut entries: Vec<MenuEntry> = vec![MenuItem::new(project).disabled(true).into()];
    // One level: each server's name over its own Restart and Stop, no fly-out to aim for.
    if servers.len() > 1 {
        entries.push(
            MenuItem::new("Restart all")
                .icon(IconName::ArrowClockwise)
                .on_select(|_, cx| LspStore::global(cx).update(cx, |store, cx| store.restart_all(cx)))
                .into(),
        );
        entries.push(MenuItem::new("Stop all").icon(IconName::Square).on_select(|_, cx| LspStore::global(cx).update(cx, |store, cx| store.stop_all(cx))).into());
    }
    for server in &servers {
        let id = server.id();
        entries.push(MenuEntry::Separator);
        entries.push(MenuEntry::Label(server.name().to_string().into()));
        entries.push(
            MenuItem::new("Restart")
                .icon(IconName::ArrowClockwise)
                .on_select(move |_, cx| LspStore::global(cx).update(cx, |store, cx| store.restart_server(id, cx)))
                .into(),
        );
        entries.push(MenuItem::new("Stop").icon(IconName::Square).on_select(move |_, cx| LspStore::global(cx).update(cx, |store, cx| store.stop_server(id, cx))).into());
    }
    let status = editor.as_ref().map(|editor| editor.read(cx).lsp_status()).unwrap_or(LspStatus::Off);
    match &status {
        LspStatus::Starting(name) => entries.push(MenuItem::new(format!("Connecting to {name}...")).disabled(true).into()),
        LspStatus::NotInstalled(name) | LspStatus::Failed(name) => {
            entries.push(MenuItem::new("Language server issue").icon(IconName::BoltSlash).tone(ui::MenuItemTone::Destructive).disabled(true).into());
            entries.push(
                MenuItem::new(format!("Start {name}"))
                    .on_select(|_, cx| LspStore::global(cx).update(cx, |store, cx| store.retry_unavailable(cx)))
                    .into(),
            );
        }
        _ if servers.is_empty() && !unavailable.is_empty() => {
            entries.push(MenuItem::new("Language server issue").icon(IconName::BoltSlash).tone(ui::MenuItemTone::Destructive).disabled(true).into());
            entries.push(MenuItem::new("Try again").on_select(|_, cx| LspStore::global(cx).update(cx, |store, cx| store.retry_unavailable(cx))).into());
        }
        _ if servers.is_empty() => entries.push(MenuItem::new("No active language servers").icon(IconName::BoltSlash).disabled(true).into()),
        _ => {}
    }
    entries
}

impl EditorStatusActions {
    pub fn new(editor: &Entity<Editor>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let current = editor.read(cx).language_name();
        let options: Vec<SelectOption> = syntax::all_languages().into_iter().map(|language| SelectOption::new(language.name, language.name)).collect();
        let language = cx.new(|cx| {
            Select::new(options, current, cx)
                .searchable(SelectSearch::Menu, window, cx)
                .leading_icon(IconName::Code)
                .icon_only()
                .hide_chevron()
                .menu_size(MenuSize::Default)
                .tooltip(format!("Language mode: {current}"))
        });
        let weak = editor.downgrade();
        let servers = {
            let weak = weak.clone();
            let trigger_editor = weak.clone();
            cx.new(move |_| {
                DropdownMenu::new(
                    move |_, _, cx| {
                        let running = LspStore::global(cx).read(cx).servers().len();
                        let failed = !LspStore::global(cx).read(cx).unavailable().is_empty();
                        let status = trigger_editor.upgrade().map(|editor| editor.read(cx).lsp_status()).unwrap_or(LspStatus::Off);
                        let (icon, tone, title) = server_status(running, &status, failed);
                        Button::icon("editor-lsp-status", icon).variant(ButtonVariant::Ghost).tone(tone).tooltip(title).into_any_element()
                    },
                    move |_, cx| server_entries(&weak, cx),
                )
                .size(MenuSize::Wide)
            })
        };
        let preferences = cx.new(|_| {
            DropdownMenu::new(
                |_, _, _| Button::icon("editor-preferences", IconName::Sliders).variant(ButtonVariant::Ghost).tooltip("Editor preferences").into_any_element(),
                |_, cx| preference_entries(cx),
            )
        });
        let store = LspStore::global(cx);
        let subscriptions = vec![
            cx.subscribe(&language, {
                let weak = weak.clone();
                move |_, _, event: &SelectEvent, cx| {
                    if let SelectEvent::Changed(name) = event
                        && let Some(editor) = weak.upgrade()
                    {
                        editor.update(cx, |editor, cx| editor.set_language_named(name, cx));
                    }
                }
            }),
            cx.observe(editor, |this, editor, cx| {
                let name = editor.read(cx).language_name();
                this.language.update(cx, |select, cx| {
                    if select.value() != name {
                        select.set_value(name, cx);
                    }
                });
                cx.notify();
            }),
            cx.observe(&store, |_, _, cx| cx.notify()),
        ];
        Self { editor: weak, language, servers, preferences, _subscriptions: subscriptions }
    }

    pub fn editor(&self) -> &WeakEntity<Editor> {
        &self.editor
    }
}

impl Render for EditorStatusActions {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let editor = self.editor.upgrade();
        let markdown = editor.as_ref().is_some_and(|editor| editor.read(cx).language_name() == "Markdown");
        let previewing = editor.as_ref().is_some_and(|editor| editor.read(cx).preview.is_some());
        let weak = self.editor.clone();
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap_0p5()
            .when(markdown, |this| {
                let weak = weak.clone();
                this.child(
                    Button::icon("editor-markdown-preview", if previewing { IconName::Pen } else { IconName::Eye })
                        .variant(ButtonVariant::Ghost)
                        .tooltip(if previewing { "Show Markdown Source" } else { "Preview Markdown" })
                        .on_click(move |_, window, cx| {
                            if let Some(editor) = weak.upgrade() {
                                editor.update(cx, |editor, cx| editor.toggle_markdown_preview(&crate::ToggleMarkdownPreview, window, cx));
                            }
                        }),
                )
            })
            .child(Button::icon("editor-find", IconName::Search).variant(ButtonVariant::Ghost).tooltip("Find in file").on_click(move |_, window, cx| {
                if let Some(editor) = weak.upgrade() {
                    editor.update(cx, |editor, cx| editor.open_find(false, window, cx));
                }
            }))
            .child(self.language.clone())
            .child(self.servers.clone())
            .child(self.preferences.clone())
    }
}

impl Editor {
    /// Shows the file in another language (the language mode picker).
    pub(crate) fn set_language_named(&mut self, name: &str, cx: &mut Context<Self>) {
        let Some(language) = syntax::language_named(name) else { return };
        if language.name == self.document.syntax.language.name {
            return;
        }
        self.document.syntax = syntax::SyntaxState::new(language);
        self.schedule_parse(cx);
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_button() {
        assert_eq!(server_status(1, &LspStatus::Ready("rust-analyzer".into()), false).1, ButtonTone::Success);
        assert_eq!(server_status(0, &LspStatus::Starting("x".into()), false).1, ButtonTone::Warning);
        assert_eq!(server_status(2, &LspStatus::Failed("x".into()), false).1, ButtonTone::Danger);
        assert_eq!(server_status(0, &LspStatus::Off, true).1, ButtonTone::Danger);
        assert_eq!(server_status(0, &LspStatus::Off, false), (IconName::BoltSlash, ButtonTone::Default, "No active language servers"));
    }

    #[test]
    fn languages_for_the_picker() {
        let names: Vec<&str> = syntax::all_languages().iter().map(|language| language.name).collect();
        assert_eq!(names.first(), Some(&"Plain Text"));
        assert!(names.contains(&"Java") && names.contains(&"Rust"));
        assert!(!names.contains(&"Hash comments"));
        assert_eq!(syntax::language_named("Kotlin").map(|language| language.name), Some("Kotlin"));
    }
}
