//! The keybinding editor (`tabs/keyboard-settings.tsx`, `keymaps/components/keybinding-row.tsx`):
//! a summary with the custom shortcut count, then after Edit every command with the key in effect,
//! searchable and filterable, each row rebound by recording a keystroke, reset to its default or
//! removed. Changes are saved to `keymap.json` and the workbench binds them at once (it observes
//! [`keymap::UserKeymapRevision`]).

use ui::TooltipExt as _;
use std::collections::{HashMap, HashSet};

use ui::scale::px;
use gpui::{
    AnyElement, App, Context, Entity, KeystrokeEvent, PathPromptOptions, SharedString, Subscription,
    UniformListScrollHandle, Window, div, prelude::*, uniform_list,
};
use keymap::{ImportFormat, Keybinding};
use notifications::{NotificationCategory, NotificationKind};
use theme::ActiveTheme;
use ui::{
    Badge, Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, Kbd, TextInput,
    TextInputEvent, ToggleGroup, ToggleOption, Tone, metrics, typography,
};

use crate::typed_confirm::{Confirmed, TypedConfirm};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Filter {
    All,
    User,
    Default,
    Preset,
    PresetChanges,
    Extension,
}

impl Filter {
    const ALL: [Filter; 6] = [Filter::All, Filter::User, Filter::Default, Filter::Preset, Filter::PresetChanges, Filter::Extension];

    fn id(self) -> &'static str {
        match self {
            Filter::All => "all",
            Filter::User => "user",
            Filter::Default => "default",
            Filter::Preset => "preset",
            Filter::PresetChanges => "preset-changes",
            Filter::Extension => "extension",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Filter::All => "All",
            Filter::User => "User",
            Filter::Default => "Default",
            Filter::Preset => "Preset",
            Filter::PresetChanges => "Preset Changes",
            Filter::Extension => "Integration",
        }
    }

    fn icon(self) -> IconName {
        match self {
            Filter::All => IconName::Circles,
            Filter::User => IconName::User,
            Filter::Default => IconName::Sliders,
            Filter::Preset | Filter::PresetChanges => IconName::Download,
            Filter::Extension => IconName::Cube,
        }
    }
}

struct Recording {
    command: String,
    key: Option<String>,
    _intercept: Subscription,
}

pub struct KeybindingsEditor {
    user: Vec<Keybinding>,
    search: Entity<TextInput>,
    query: SharedString,
    filter: Filter,
    recording: Option<Recording>,
    /// The table of every command, after Edit; the summary rows before.
    editing: bool,
    reset: Entity<TypedConfirm>,
    /// The table's rows as last filtered: the list draws only the visible ones from here.
    rows: std::rc::Rc<Vec<CommandRow>>,
    /// In a pane too narrow for five columns (the sidebar) a row stacks instead.
    narrow: bool,
    list_scroll: UniformListScrollHandle,
    _subscriptions: Vec<Subscription>,
}

/// One command of the table, with what its row shows.
struct CommandRow {
    id: String,
    title: String,
    subtitle: String,
    ported: bool,
    binding: Option<Keybinding>,
    source: &'static str,
    /// The titles of the commands its key also runs.
    conflicts: Vec<String>,
}

/// Every row is this tall, so the table can draw only the rows in view. A stacked row holds the
/// command over its key, so it needs more.
const ROW_HEIGHT: f32 = 52.;
const STACKED_ROW_HEIGHT: f32 = 76.;

fn notify(cx: &mut App, kind: NotificationKind, message: impl Into<SharedString>, description: Option<String>) {
    notifications::notify(cx, kind, NotificationCategory::Athas, message, description.map(SharedString::from), None);
}

#[cfg(not(target_family = "wasm"))]
fn load_user() -> Vec<Keybinding> {
    keymap::load_user_bindings(keymap::user_bindings_path().as_ref())
}

#[cfg(target_family = "wasm")]
fn load_user() -> Vec<Keybinding> {
    Vec::new()
}

/// Saves the user's bindings to `keymap.json` and has the workbench bind them.
pub fn save_user(bindings: &[Keybinding], cx: &mut App) {
    #[cfg(not(target_family = "wasm"))]
    if let Some(path) = keymap::user_bindings_path() {
        match keymap::save_user_bindings(&path, bindings) {
            Ok(json) => crate::commands::keymap_file_written(cx, json),
            Err(error) => {
                notify(cx, NotificationKind::Error, "Could not save keybindings", Some(format!("{error:#}")));
                return;
            }
        }
    }
    #[cfg(target_family = "wasm")]
    let _ = bindings;
    keymap::user_bindings_changed(cx);
}

/// The commands a keybindings file may name: every command Athas defines.
pub fn command_ids() -> HashSet<&'static str> {
    keymap::commands().iter().map(|command| command.id.as_str()).collect()
}

/// Applies a parsed keybindings file: its preset, then its bindings over the user's own.
pub fn apply_import(import: &keymap::KeybindingsImport, cx: &mut App) {
    let preset = import.preset.clone().or_else(|| (import.format == ImportFormat::VsCode).then(|| "vscode".to_string()));
    if let Some(preset) = &preset {
        let preset = preset.clone();
        settings::update(cx, |settings| settings.keybinding_preset = preset);
    }
    let merged = keymap::merge_imported(&load_user(), &import.keybindings);
    save_user(&merged, cx);
    let count = import.keybindings.len();
    let message = if import.format == ImportFormat::VsCode && count == 0 {
        "Applied VS Code keybinding preset".to_string()
    } else {
        format!(
            "Imported {count} {}{}{}",
            if import.format == ImportFormat::VsCode { "VS Code " } else { "" },
            if count == 1 { "keybinding" } else { "keybindings" },
            if preset.is_some() { " and preset" } else { "" }
        )
    };
    let kind = if import.issues.is_empty() { NotificationKind::Success } else { NotificationKind::Warning };
    notify(cx, kind, message, keymap::issue_summary(&import.issues));
}

impl KeybindingsEditor {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| TextInput::new(window, cx).placeholder("Search keybindings").leading_icon(IconName::Search).clearable());
        let subscription = cx.subscribe(&search, |this, _, event: &TextInputEvent, cx| {
            if let TextInputEvent::Changed(query) = event {
                this.query = query.clone();
                cx.notify();
            }
        });
        // Another writer of `keymap.json` (an import, the file saved in the editor) shows here at once.
        let reload = cx.observe_global::<keymap::UserKeymapRevision>(|this, cx| {
            this.user = load_user();
            cx.notify();
        });
        let observe_settings = cx.observe_global::<settings::SettingsStore>(|_, cx| cx.notify());
        let reset = cx.new(|cx| TypedConfirm::new("keybindings-reset", "Reset to Defaults", true, window, cx));
        let confirmed = cx.subscribe(&reset, |this, _, _: &Confirmed, cx| this.reset_all(cx));
        Self {
            user: load_user(),
            search,
            query: SharedString::default(),
            filter: Filter::All,
            recording: None,
            editing: false,
            reset,
            rows: Default::default(),
            narrow: false,
            list_scroll: UniformListScrollHandle::new(),
            _subscriptions: vec![subscription, reload, observe_settings, confirmed],
        }
    }

    /// Whether the pane is too narrow for the five-column table (the sidebar).
    pub fn set_narrow(&mut self, narrow: bool, cx: &mut Context<Self>) {
        if self.narrow != narrow {
            self.narrow = narrow;
            cx.notify();
        }
    }

    /// Whether the table of every command is showing, rather than the summary rows.
    pub fn is_editing(&self) -> bool {
        self.editing
    }

    pub fn set_editing(&mut self, editing: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.editing = editing;
        self.recording = None;
        if editing {
            self.search.update(cx, |search, cx| search.focus(window, cx));
        }
        cx.notify();
    }

    /// The custom shortcuts the user made, for the summary's "Edit Keybindings" row.
    pub fn user_override_count(&self) -> usize {
        self.user.iter().filter(|binding| binding.source == "user").count()
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        save_user(&self.user, cx);
        cx.notify();
    }

    fn start_recording(&mut self, command: String, cx: &mut Context<Self>) {
        let this = cx.entity().downgrade();
        // Keys go to the recorder before any binding runs, so `⌘B` is recorded, not acted on.
        let intercept = cx.intercept_keystrokes(move |event: &KeystrokeEvent, _, cx| {
            if this.update(cx, |this, cx| this.record(event, cx)).is_ok() {
                cx.stop_propagation();
            }
        });
        self.recording = Some(Recording { command, key: None, _intercept: intercept });
        cx.notify();
    }

    /// `useKeybindingRecorder`: each combination replaces the last; Return or Escape stops and
    /// saves what was pressed.
    fn record(&mut self, event: &KeystrokeEvent, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let plain = !keystroke.modifiers.modified();
        match keystroke.key.as_str() {
            "escape" | "enter" if plain => self.commit_recording(cx),
            _ => {
                if let (Some(recording), Some(key)) = (self.recording.as_mut(), keymap::format_keystroke(keystroke)) {
                    recording.key = Some(keymap::normalize_key(&key));
                }
            }
        }
        cx.notify();
    }

    /// `KeybindingRow.handleSave`: the recorded key replaces the command's bindings, in the
    /// context its binding had.
    fn commit_recording(&mut self, cx: &mut Context<Self>) {
        let Some(recording) = self.recording.take() else { return };
        let Some(key) = recording.key else { return };
        let command = recording.command;
        let when = self.binding_for(&command, cx).and_then(|binding| binding.when);
        self.user.retain(|binding| binding.command != command);
        self.user.push(Keybinding {
            key,
            command,
            when,
            args: None,
            source: "user".into(),
            enabled: Some(true),
            replace_defaults: None,
        });
        self.save(cx);
    }

    fn preset(cx: &App) -> String {
        settings::get(cx).keybinding_preset.clone()
    }

    fn binding_for(&self, command: &str, cx: &App) -> Option<Keybinding> {
        keymap::bindings_by_command(&keymap::effective_bindings(&Self::preset(cx), &self.user)).remove(command)
    }

    /// Drops the user's bindings of the command, so its default applies again.
    fn reset(&mut self, command: &str, cx: &mut Context<Self>) {
        self.user.retain(|binding| binding.command != command);
        self.save(cx);
    }

    /// Leaves the command without a key: one disabled user binding replaces its defaults.
    fn remove(&mut self, binding: &Keybinding, cx: &mut Context<Self>) {
        self.user.retain(|existing| existing.command != binding.command);
        self.user.push(Keybinding {
            key: binding.key.clone(),
            command: binding.command.clone(),
            when: binding.when.clone(),
            args: None,
            source: "user".into(),
            enabled: Some(false),
            replace_defaults: None,
        });
        self.save(cx);
    }

    fn reset_all(&mut self, cx: &mut Context<Self>) {
        self.user.clear();
        self.save(cx);
        notify(cx, NotificationKind::Success, "Keybindings reset to defaults", None);
    }

    fn import(&mut self, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Import".into()),
        });
        cx.spawn(async move |_, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            cx.update(|cx| {
                let parsed = std::fs::read_to_string(&path)
                    .map_err(anyhow::Error::from)
                    .and_then(|text| settings::parse_jsonc(&text));
                match parsed.map(|value| keymap::parse_keybindings_import(&value, &command_ids(), keymap::ImportPlatform::current())) {
                    Ok(Some(import)) => apply_import(&import, cx),
                    Ok(None) => notify(cx, NotificationKind::Error, "Invalid keybindings file format", None),
                    Err(error) => notify(cx, NotificationKind::Error, format!("Failed to import keybindings: {error:#}"), None),
                }
            });
        })
        .detach();
    }

    fn export(&mut self, cx: &mut Context<Self>) {
        let directory = dirs_home();
        let path = cx.prompt_for_new_path(&directory, Some("keybindings.json"));
        let payload = keymap::export_payload(&Self::preset(cx), &self.user, &settings::import::timestamp_now());
        cx.spawn(async move |_, cx| {
            let Ok(Ok(Some(path))) = path.await else { return };
            let written = serde_json::to_string_pretty(&payload).map_err(anyhow::Error::from).and_then(|json| Ok(std::fs::write(&path, json)?));
            cx.update(|cx| match written {
                Ok(()) => notify(cx, NotificationKind::Success, "Keybindings exported", None),
                Err(error) => notify(cx, NotificationKind::Error, format!("Failed to export keybindings: {error:#}"), None),
            });
        })
        .detach();
    }

    /// The Shortcuts section of the summary: the custom shortcut count and Edit.
    pub fn render_summary(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let count = self.user_override_count();
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div()
                    .px(px(12.))
                    .text_size(typography::text_sm())
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.muted_foreground)
                    .child("Shortcuts"),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(24.))
                    .min_h(px(44.))
                    .py(px(10.))
                    .px(px(12.))
                    .rounded(metrics::radius_lg())
                    .bg(colors.raised)
                    .shadow(cx.theme().shadows.raised.clone())
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child("Edit Keybindings"))
                            .when(count > 0, |this| {
                                this.child(
                                    div()
                                        .text_size(typography::text_caption())
                                        .text_color(colors.subtle_foreground)
                                        .child(format!("{count} custom shortcut{}", if count == 1 { "" } else { "s" })),
                                )
                            }),
                    )
                    .child(
                        Button::new("keybindings-edit", "Edit")
                            .variant(ButtonVariant::Outline)
                            .on_click(cx.listener(|this, _, window, cx| this.set_editing(true, window, cx))),
                    ),
            )
            .into_any_element()
    }

    /// A binding as keys: each chord apart, "then" between them (`ui/keybinding.tsx`).
    fn render_keys(key: &str, cx: &App) -> AnyElement {
        let chords = keymap::display_chords(key);
        div()
            .flex()
            .items_center()
            .gap(px(4.))
            .children(chords.into_iter().enumerate().flat_map(|(index, chord)| {
                let then = (index > 0).then(|| {
                    div().text_size(typography::text_caption()).text_color(cx.theme().colors.subtle_foreground).child("then").into_any_element()
                });
                then.into_iter().chain(std::iter::once(Kbd::new(chord).into_any_element()))
            }))
            .into_any_element()
    }

    fn render_key_cell(&self, index: usize, command: &str, title: &str, binding: Option<&Keybinding>, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let shown = binding.filter(|binding| binding.enabled != Some(false) && !binding.key.is_empty());
        if let Some(recording) = self.recording.as_ref().filter(|recording| recording.command == command) {
            return div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(4.))
                .w_full()
                .h(px(28.))
                .pl(px(8.))
                .pr(px(2.))
                .rounded(metrics::radius_md())
                .bg(colors.primary_soft)
                .border_2()
                .border_color(colors.focus_ring)
                .child(div().flex_1().min_w_0().truncate().text_size(typography::text_sm()).map(|this| match &recording.key {
                    Some(key) => this.child(Self::render_keys(key, cx)),
                    None => this.text_color(colors.subtle_foreground).child("Press keys..."),
                }))
                .child(
                    Button::new(("record-cancel", index), "ESC")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .tooltip("Cancel recording")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.recording = None;
                            cx.notify();
                        })),
                )
                .into_any_element();
        }
        let command = command.to_string();
        div()
            .id(("binding-key", index))
            .flex()
            .items_center()
            .w_full()
            .h(px(28.))
            .px(px(8.))
            .rounded(metrics::radius_md())
            .bg(colors.raised)
            .shadow(cx.theme().shadows.raised.clone())
            .hover(|style| style.bg(colors.accent))
            .text_size(typography::text_sm())
            .anchored_tooltip({ let text: gpui::SharedString = (format!("Edit keybinding for {title}")).into(); move || ui::Tooltip::new(text.clone()) })
            .map(|this| match shown {
                Some(binding) => this.child(Self::render_keys(&binding.key, cx)),
                None => this.text_color(colors.subtle_foreground).child("Not assigned"),
            })
            .on_click(cx.listener(move |this, _, _, cx| this.start_recording(command.clone(), cx)))
            .into_any_element()
    }

    /// The header's first row: back, the search filling the room, then the file actions. Too
    /// narrow for all of it on one line (the sidebar), the file actions wrap under the search.
    fn render_toolbar(&self, cx: &mut Context<Self>) -> AnyElement {
        let narrow = self.narrow;
        let actions = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .when(narrow, |this| this.flex_wrap())
            .child(
                Button::new("keybindings-json", "Edit JSON")
                    .variant(ButtonVariant::Outline)
                    .tooltip("Open keymap.json in the editor")
                    .on_click(|_, window, cx| window.dispatch_action(Box::new(crate::commands::OpenKeymapJson), cx)),
            )
            .child(
                Button::new("keybindings-import", "Import")
                    .variant(ButtonVariant::Outline)
                    .on_click(cx.listener(|this, _, _, cx| this.import(cx))),
            )
            .child(
                Button::new("keybindings-export", "Export")
                    .variant(ButtonVariant::Outline)
                    .on_click(cx.listener(|this, _, _, cx| this.export(cx))),
            )
            .child(self.reset.clone());
        let search_row = div()
            .flex()
            .items_center()
            .gap(px(8.))
            // Clear of the Settings window's close button in the corner above.
            .when(!narrow, |this| this.pr(px(24.)))
            .child(
                Button::icon("keybindings-back", IconName::ArrowLeft)
                    .tooltip("Back to Keybindings")
                    .on_click(cx.listener(|this, _, window, cx| this.set_editing(false, window, cx))),
            )
            .child(div().flex_1().min_w_0().child(self.search.clone()));
        if narrow {
            return div().flex().flex_col().gap(px(8.)).child(search_row).child(actions).into_any_element();
        }
        search_row.child(actions).into_any_element()
    }
}

/// Where save dialogs start.
fn dirs_home() -> std::path::PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(Into::into).unwrap_or_default()
}

/// Widths of the table's columns (`<colgroup>`): command, keybinding, when, source, actions.
const COLUMNS: [f32; 5] = [0.32, 0.23, 0.20, 0.11, 0.14];

fn column(index: usize) -> gpui::Div {
    div().flex_none().min_w_0().w(gpui::relative(COLUMNS[index])).pr(px(12.))
}

impl Render for KeybindingsEditor {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.editing {
            return self.render_summary(cx);
        }
        let theme = cx.theme().clone();
        let colors = theme.colors.clone();
        let preset = Self::preset(cx);
        let effective = keymap::effective_bindings(&preset, &self.user);
        let by_command = keymap::bindings_by_command(&effective);
        let conflicts = keymap::conflicts(by_command.values());
        let preset_changes: HashSet<String> = keymap::preset_changes(&preset).into_iter().collect();
        let all_commands = keymap::all_commands(cx);
        let titles: HashMap<&str, &str> = all_commands.iter().map(|command| (command.id.as_str(), command.title.as_str())).collect();
        let registry: Option<HashSet<String>> = cx.try_global::<keymap::CommandRegistry>().map(|registry| registry.ids().iter().cloned().collect());
        let available = |id: &str| registry.as_ref().is_none_or(|registry| registry.contains(id));

        let query = self.query.trim().to_lowercase();
        let words: Vec<&str> = query.split_whitespace().collect();
        let commands: Vec<&keymap::CommandInfo> = all_commands
            .iter()
            .filter(|command| {
                let binding = by_command.get(&command.id);
                let source = binding.map(|binding| binding.source.as_str());
                let keep = match self.filter {
                    Filter::All => true,
                    Filter::User => source == Some("user"),
                    Filter::Default => source.is_none_or(|source| source == "default"),
                    Filter::Preset => source == Some("preset"),
                    Filter::PresetChanges => preset_changes.contains(&command.id),
                    Filter::Extension => source == Some("extension"),
                };
                if !keep {
                    return false;
                }
                if words.is_empty() {
                    return true;
                }
                let key = binding.map(|binding| binding.key.as_str()).unwrap_or_default();
                let haystack = format!(
                    "{} {} {} {} {} {} {}",
                    command.title,
                    command.id,
                    command.category,
                    command.description.as_deref().unwrap_or_default(),
                    key,
                    keymap::display_key(key),
                    binding.and_then(|binding| binding.when.as_deref()).unwrap_or_default()
                )
                .to_lowercase();
                words.iter().all(|word| haystack.contains(word))
            })
            .collect();

        self.rows = std::rc::Rc::new(
            commands
                .iter()
                .map(|command| {
                    let binding = by_command.get(&command.id);
                    CommandRow {
                        id: command.id.clone(),
                        title: command.title.clone(),
                        subtitle: format!("{} · {}", command.category, command.id),
                        ported: available(&command.id),
                        binding: binding.cloned(),
                        source: match binding.map(|binding| binding.source.as_str()) {
                            Some("preset") => "Preset",
                            Some("extension") => "Integration",
                            Some("user") => "User",
                            _ => "Default",
                        },
                        conflicts: conflicts
                            .get(&command.id)
                            .map(|others| others.iter().map(|other| titles.get(other.as_str()).copied().unwrap_or(other.as_str()).to_string()).collect())
                            .unwrap_or_default(),
                    }
                })
                .collect(),
        );
        let count = self.rows.len();

        let filter = self.filter;
        let filters = ToggleGroup::new(
            "keybinding-filter",
            Filter::ALL.into_iter().map(|option| ToggleOption::new(option.id(), option.label()).icon(option.icon())).collect(),
            filter.id(),
        )
        .on_change({
            let this = cx.entity().downgrade();
            move |value, _, cx| {
                if let Some(next) = Filter::ALL.into_iter().find(|option| option.id() == value.as_ref()) {
                    this.update(cx, |this, cx| {
                        this.filter = next;
                        cx.notify();
                    })
                    .ok();
                }
            }
        });

        // The header stays put while the table scrolls under it: search and the file actions,
        // then the filters and how many commands they leave, then the columns.
        let columns = div()
            .flex()
            .flex_none()
            .items_center()
            .h(px(32.))
            .px(px(12.))
            .border_b_1()
            .border_color(colors.divider)
            .text_size(typography::text_caption())
            .font_weight(typography::MEDIUM)
            .text_color(colors.subtle_foreground)
            .children(["Command", "Keybinding", "When", "Source", ""].into_iter().enumerate().map(|(index, label)| column(index).child(label)));
        // Stacked rows carry their own labels; a header of five columns would name nothing.
        let columns = (!self.narrow).then_some(columns);
        let body = if count == 0 {
            div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .text_size(typography::text_sm())
                .text_color(colors.muted_foreground)
                .child("No keybindings found")
                .into_any_element()
        } else {
            ui::with_scrollbar(
                uniform_list("keybinding-rows", count, cx.processor(Self::render_rows)).track_scroll(&self.list_scroll).flex_1().min_h_0(),
                ui::Scrollbar::uniform("keybinding-rows-scrollbar", &self.list_scroll),
            )
            .into_any_element()
        };
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .gap(px(12.))
            .child(self.render_toolbar(cx))
            .child(
                div()
                    .flex()
                    .gap(px(12.))
                    // Side by side the count is pushed off a narrow pane, so there it sits under
                    // the filters instead.
                    .map(|this| if self.narrow { this.flex_col().items_start().gap(px(6.)) } else { this.items_center().justify_between() })
                    .child(filters)
                    .child(div().flex_none().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(format!("{count} commands"))),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .rounded(metrics::radius_lg())
                    .bg(colors.raised)
                    .shadow(theme.shadows.raised.clone())
                    .overflow_hidden()
                    .children(columns)
                    .child(body),
            )
            .into_any_element()
    }

}

impl KeybindingsEditor {
    /// The rows in view; each the same height (a conflict shows as a tint and a warning icon
    /// whose tooltip names the other commands, not as a band under the row).
    fn render_rows(&mut self, range: std::ops::Range<usize>, _window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let rows = self.rows.clone();
        range
            .filter_map(|index| {
                let row = rows.get(index)?;
                let is_user = row.source == "User";
                let conflict = (!row.conflicts.is_empty()).then(|| format!("Same key as {}", row.conflicts.join(", ")));
                let command_id = row.id.clone();
                let removed = row.binding.clone();
                let title = div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .min_w_0()
                    .child(
                        div()
                            .truncate()
                            .text_size(typography::text_sm())
                            .text_color(if row.ported { colors.foreground } else { colors.muted_foreground })
                            .child(row.title.clone()),
                    )
                    .when(!row.ported, |this| this.child(Badge::new("Not ported yet")));
                let subtitle = div()
                    .truncate()
                    .text_size(typography::text_caption())
                    .text_color(colors.subtle_foreground)
                    .child(row.subtitle.clone());
                let key_cell = self.render_key_cell(index, &row.id, &row.title, row.binding.as_ref(), cx);
                let conflict_mark = conflict.clone().map(|text| {
                    div()
                        .id(("binding-conflict", index))
                        .flex_none()
                        .child(Icon::new(IconName::WarningCircle).size(IconSize::Small).color(colors.destructive))
                        .anchored_tooltip(move || ui::Tooltip::new(text.clone()))
                });
                let source_badge = Badge::new(row.source).tone(if is_user { Tone::Accent } else { Tone::Neutral });
                let reset_button = is_user.then(|| {
                    let command_id = command_id.clone();
                    Button::icon(("binding-reset", index), IconName::ArrowCounterClockwise)
                        .size(ButtonSize::Small)
                        .tooltip("Reset to default")
                        .on_click(cx.listener(move |this, _, _, cx| this.reset(&command_id, cx)))
                });
                let remove_button = removed.map(|binding| {
                    Button::icon(("binding-remove", index), IconName::Trash)
                        .size(ButtonSize::Small)
                        .tooltip("Remove keybinding")
                        .on_click(cx.listener(move |this, _, _, cx| this.remove(&binding, cx)))
                });
                let frame = div()
                    .w_full()
                    .px(px(12.))
                    .border_b_1()
                    .border_color(colors.divider)
                    .when(conflict.is_some(), |this| this.bg(colors.destructive_soft));
                // Stacked, a row is the command over its key, its source and its actions; the
                // When clause has no line of its own and shows on the key instead.
                if self.narrow {
                    return Some(
                        frame
                            .flex()
                            .flex_col()
                            .justify_center()
                            .gap(px(4.))
                            .h(px(STACKED_ROW_HEIGHT))
                            .child(title)
                            .child(subtitle)
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .child(div().flex_1().min_w_0().child(key_cell))
                                    .children(conflict_mark)
                                    .child(source_badge)
                                    .children(reset_button)
                                    .children(remove_button),
                            )
                            .into_any_element(),
                    );
                }
                Some(
                    frame
                        .flex()
                        .items_center()
                        .h(px(ROW_HEIGHT))
                        .child(column(0).flex().flex_col().gap(px(2.)).child(title).child(subtitle))
                        .child(column(1).flex().items_center().gap(px(6.)).child(key_cell).children(conflict_mark))
                        .child(
                            column(2)
                                .truncate()
                                .text_size(typography::text_sm())
                                .text_color(colors.subtle_foreground)
                                .child(row.binding.as_ref().and_then(|binding| binding.when.clone()).unwrap_or_else(|| "-".into())),
                        )
                        .child(column(3).child(source_badge))
                        .child(
                            column(4)
                                .flex()
                                .items_center()
                                .justify_end()
                                .gap(px(2.))
                                .children(reset_button)
                                .children(remove_button),
                        )
                        .into_any_element(),
                )
            })
            .collect()
    }
}
