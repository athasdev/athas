//! The Settings view (`features/settings/components`): pages down the side, each a stack of
//! titled cards of rows, with search across every page.
//!
//! Besides the rows `settings::SETTING_DEFS` describes, pages carry the views of their features:
//! theme cards on Appearance, font pickers with a preview, the keybinding editor on Keybindings,
//! the account and sharing views on Account & Sync, and the settings import and export actions.
//! The view only emits `DismissEvent`; the workbench reloads keys when `keymap.json` changes by
//! observing `keymap::UserKeymapRevision`.

mod appearance;
mod commands;
mod custom_theme_creator;
mod editor_import;
mod font_picker;
#[cfg_attr(target_family = "wasm", path = "github_credentials_web.rs")]
mod github_credentials;
mod keybindings;
mod notification_permission;
mod report_bug;
mod team;
pub mod team_workspaces;
mod terminal_profiles;
mod typed_confirm;

use ui::WithScrollbar;
use std::{cell::Cell, collections::HashMap, ops::Range, rc::Rc};

use gpui::{
    Anchor, AnyElement, App, Bounds, ClipboardItem, Context, DismissEvent, ElementId, Entity,
    EventEmitter, FocusHandle, Focusable, HighlightStyle, MouseButton, PathPromptOptions, Pixels,
    Point, ScrollHandle, SharedString, StyledText, Subscription, Window, anchored, canvas, deferred,
    div, point, prelude::*, px, relative,
};
use notifications::{NotificationCategory, NotificationKind};
use palette::Picker;
use serde_json::Value;
use settings::{SETTING_DEFS, SETTINGS_PAGES, SettingDef, SettingKind};
use theme::ActiveTheme;
use ui::{
    Badge, Button, ButtonSize, ButtonTone, ButtonVariant, Icon, IconName, IconSize, MenuEntry,
    MenuItem, OpenMenu, Plane, SidebarListItem, Switch, TextInput, TextInputEvent, Tone, metrics,
    typography,
};

pub use appearance::theme_choices;
pub use commands::{
    ManageWorkspaces, OpenKeyboardShortcuts, OpenKeymapJson, OpenSettingsAt, OpenSettingsJson, ToggleSetting, init,
    open_keymap_json, open_settings_json, palette_setting_entries, reload_keymap_file,
    reload_settings_file,
};
use editor_import::{EditorImport, EditorImportEvent};
use font_picker::{FontPicker, FontPickerEvent};
use github_credentials::GitHubCredentials;
use keybindings::KeybindingsEditor;
use report_bug::ReportBugDelegate;
use team::TeamSettings;
use terminal_profiles::TerminalProfiles;
use typed_confirm::{Confirmed, TypedConfirm};

/// A view that hangs one menu at a time, such as a select's options.
pub(crate) trait MenuOwner: Sized + 'static {
    fn menu_slot(&mut self) -> &mut Option<OpenMenu>;
}

/// A select (`ui/select`): the chosen option's label on an outline button that opens the options
/// in a menu. `options` are (checked, label, value).
#[allow(clippy::too_many_arguments)]
/// The example a field shows while empty, as the original's settings tabs give it.
fn field_placeholder(key: &str) -> Option<&'static str> {
    Some(match key {
        "editorRulers" => "80, 100",
        "hiddenFilePatterns" => "*.log, *.tmp, **/*.bak",
        "hiddenDirectoryPatterns" => "node_modules, .git, build/",
        "searchExcludePatterns" => "dist, *.min.js, **/*.lock",
        "customEditorCommand" => "micro $FILE",
        "gitDefaultBranchName" => "Git default",
        "aiUserRules" => "Prefer small changes and run the relevant tests.",
        _ => return None,
    })
}

/// The icon themes the extensions provide, as (id, name).
fn installed_icon_themes(cx: &App) -> Vec<(String, String)> {
    if cx.try_global::<extensions::Extensions>().is_none() {
        return Vec::new();
    }
    extensions::get(cx).icon_themes().iter().map(|theme| (theme.id.clone(), theme.name.clone())).collect()
}

/// The width of a searchable select's input trigger (an `<input>`'s default size at 12px).
const SEARCHABLE_SELECT_WIDTH: Pixels = px(170.);

pub(crate) fn select_button<V: MenuOwner>(
    id: impl Into<ElementId>,
    label: String,
    menu_key: String,
    options: Vec<(bool, String, String)>,
    on_select: Rc<dyn Fn(String, &mut App)>,
    disabled: bool,
    full_width: bool,
    cx: &mut Context<V>,
) -> AnyElement {
    let button = Button::new(id, label)
        .variant(ButtonVariant::Outline)
        .regular_weight()
        .trailing_icon(IconName::ChevronDown)
        .disabled(disabled)
        .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
            let position = event.position();
            open_select_menu(this, menu_key.clone(), &options, on_select.clone(), point(position.x, position.y + px(10.)), window, cx);
        }));
    if full_width { button.full_width().align_between().into_any_element() } else { button.into_any_element() }
}

/// Opens a select's options (checked, label, value) as a menu hanging from `position`.
pub(crate) fn open_select_menu<V: MenuOwner>(
    this: &mut V,
    menu_key: String,
    options: &[(bool, String, String)],
    on_select: Rc<dyn Fn(String, &mut App)>,
    position: Point<Pixels>,
    window: &mut Window,
    cx: &mut Context<V>,
) {
    let entries = options
        .iter()
        .map(|(checked, label, value)| {
            let value = value.clone();
            let on_select = on_select.clone();
            MenuEntry::from(MenuItem::new(label.clone()).checked(*checked).on_select(move |_, cx| on_select(value.clone(), cx)))
        })
        .collect();
    *this.menu_slot() = Some(OpenMenu::new(menu_key, entries, position, Anchor::TopRight, window, cx, |this: &mut V, _| *this.menu_slot() = None));
    cx.notify();
}

/// A select option's label on this platform: Multi-Cursor Modifier names the keys as macOS
/// does there ("Option", "Cmd") and as Alt / Ctrl elsewhere.
fn option_label(key: &str, value: &str, label: &str) -> String {
    match (key, value) {
        ("editorMultiCursorModifier", "alt") => if cfg!(target_os = "macos") { "Option" } else { "Alt" }.into(),
        ("editorMultiCursorModifier", "mod") => if cfg!(target_os = "macos") { "Cmd" } else { "Ctrl" }.into(),
        _ => label.into(),
    }
}

/// Settings of the "ai" page that the AI settings view draws itself.
const AI_VIEW_KEYS: &[&str] = &["aiCustomModelId", "aiCompletion", "aiUserRules"];

/// The font picker open over a row, and the setting it sets.
struct OpenFontPicker {
    key: &'static str,
    picker: Entity<FontPicker>,
    position: Point<Pixels>,
    _subscriptions: [Subscription; 2],
}

/// A search result the view is scrolling to: the row (or the page view that draws it), and
/// frames left to find it.
struct Jump {
    target: JumpTarget,
    attempts: u8,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum JumpTarget {
    /// A row of `SETTING_DEFS` the page draws.
    Row(usize),
    /// The page's nth own view (`page_views`), for rows it draws itself.
    View(usize),
}

/// Whether the page draws `def` as one of its rows; the account, team and AI views and the
/// keybinding editor draw their own.
fn drawn_as_row(def: &SettingDef) -> bool {
    def.kind != SettingKind::View
        && !matches!(def.tab, "account" | "team")
        && !(def.tab == "keyboard" && def.key.is_none())
        && !(def.tab == "ai" && def.key.is_none_or(|key| AI_VIEW_KEYS.contains(&key)))
}

/// Rows only an account with the plan sees (`canShowSettingsTab`): Enterprise Controls and the
/// integration allowlist need enterprise access, the team's collaboration rows a team.
fn visible_with_access(def: &SettingDef, enterprise: bool, collaboration: bool) -> bool {
    if def.tab != "team" {
        return true;
    }
    match def.section {
        Some("Enterprise Controls" | "Integration Allowlist") => enterprise,
        None => collaboration,
        _ => enterprise || collaboration,
    }
}

/// The catalog category an Integrations section stands for (`ExtensionKind::id`).
fn integrations_category(def: &SettingDef) -> Option<&'static str> {
    match def.section? {
        "Agents" => Some("agent"),
        "MCP Servers" => Some("mcp"),
        _ => None,
    }
}

/// The search target of a row a page's view draws: the first row of its section the page draws
/// itself, or the view.
fn view_target(def: &SettingDef) -> JumpTarget {
    if let Some(index) = SETTING_DEFS.iter().position(|row| row.tab == def.tab && row.section == def.section && drawn_as_row(row)) {
        return JumpTarget::Row(index);
    }
    let sharing = def.tab == "account" && matches!(def.section, Some("Cloud Sessions" | "Shared Items"));
    JumpTarget::View(usize::from(sharing))
}

pub struct SettingsView {
    page: &'static str,
    /// Fills a window of its own instead of floating as a dialog.
    standalone: bool,
    search: Entity<TextInput>,
    query: SharedString,
    fields: HashMap<&'static str, (Entity<TextInput>, Subscription)>,
    open_menu: Option<OpenMenu>,
    font_picker: Option<OpenFontPicker>,
    keybindings: Option<Entity<KeybindingsEditor>>,
    ai: Option<Entity<agent_ui::AiSettingsView>>,
    account: Option<(Entity<account::AccountSettings>, Entity<collaboration::SharingSettings>)>,
    importer: Option<(Entity<EditorImport>, Subscription)>,
    terminal_profiles: Option<Entity<TerminalProfiles>>,
    github: Option<Entity<GitHubCredentials>>,
    team: Option<Entity<TeamSettings>>,
    integrations: Option<Entity<extensions_ui::ExtensionsView>>,
    report_bug: Option<(Entity<Picker<ReportBugDelegate>>, Subscription)>,
    theme_creator: Option<(Entity<custom_theme_creator::CustomThemeCreator>, Subscription)>,
    reset_settings: Entity<TypedConfirm>,
    uninstall_cli: Entity<TypedConfirm>,
    show_telemetry_log: bool,
    shells: Vec<terminal_view::Shell>,
    scroll: ScrollHandle,
    telemetry_scroll: ScrollHandle,
    nav_scroll: ScrollHandle,
    jump: Option<Jump>,
    jump_bounds: Rc<Cell<Option<Bounds<Pixels>>>>,
    flash: Option<usize>,
    /// Where each row's control was drawn, so clicking the row opens it at its control.
    control_bounds: Rc<std::cell::RefCell<HashMap<usize, Bounds<Pixels>>>>,
    /// Rows stack their control under the label (`@max-[640px]/settings`).
    stacked: bool,
    focus_handle: FocusHandle,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<DismissEvent> for SettingsView {}

impl MenuOwner for SettingsView {
    fn menu_slot(&mut self) -> &mut Option<OpenMenu> {
        &mut self.open_menu
    }
}

impl Focusable for SettingsView {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.search.focus_handle(cx)
    }
}

fn page_icon(page: &str) -> IconName {
    match page {
        "general" => IconName::Settings,
        "account" => IconName::UserCircle,
        "appearance" => IconName::PaintBrush,
        "notifications" => IconName::Bell,
        "editor" => IconName::CodeBlock,
        "file-explorer" => IconName::Sitemap,
        "git" => IconName::GitBranch,
        "terminal" => IconName::TerminalWindow,
        "keyboard" => IconName::Keyboard,
        "ai" => IconName::Sparkle,
        "integrations" => IconName::PuzzlePiece,
        "team" => IconName::Users,
        _ => IconName::Gear,
    }
}

fn page_title(page: &str) -> &'static str {
    SETTINGS_PAGES.iter().find(|(id, _)| *id == page).map_or("Settings", |(_, title)| title)
}

/// The order the page list shows the pages in (`SETTINGS_NAVIGATION_ORDER`).
const NAVIGATION_ORDER: [&str; 13] =
    ["general", "appearance", "notifications", "keyboard", "editor", "file-explorer", "terminal", "git", "ai", "integrations", "account", "team", "advanced"];

/// Pages merged into others, with the page that took them in (`MERGED_SETTINGS_TABS`), so an
/// old link, command or saved last page still opens.
const MERGED_PAGES: [(&str, &str); 8] = [
    ("language", "editor"),
    ("sharing", "account"),
    ("ai-models", "ai"),
    ("ai-completion", "ai"),
    ("ai-agents", "ai"),
    ("workspaces", "team"),
    ("collaboration", "team"),
    ("enterprise", "team"),
];

/// The page id as `SETTINGS_PAGES` spells it, when `page` names one or a page merged into one
/// (`resolveSettingsPage`).
pub fn known_page(page: &str) -> Option<&'static str> {
    let page = MERGED_PAGES.iter().find(|(old, _)| *old == page).map_or(page, |(_, now)| now);
    SETTINGS_PAGES.iter().find(|(id, _)| *id == page).map(|(id, _)| *id)
}

fn value_text(value: &Option<Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(text) => Some(text.clone()),
                Value::Number(number) => Some(number.to_string()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(", "),
        Some(Value::Bool(flag)) => flag.to_string(),
        _ => String::new(),
    }
}

/// Comma-separated text as a list of strings.
fn list_value(text: &str) -> Value {
    Value::Array(text.split(',').map(str::trim).filter(|item| !item.is_empty()).map(|item| Value::String(item.to_string())).collect())
}

/// `commitRulers`: whole columns above zero, split on commas or spaces.
fn columns_value(text: &str) -> Value {
    Value::Array(
        text.split(|c: char| c == ',' || c.is_whitespace())
            .filter_map(|part| part.parse::<u64>().ok())
            .filter(|column| *column > 0)
            .map(|column| Value::Number(column.into()))
            .collect(),
    )
}

fn number_text(value: f64) -> String {
    if value.fract() == 0.0 { format!("{value:.0}") } else { format!("{value:.1}") }
}

/// Lower case with runs of other characters as one space (`normalizeSearchText`).
fn normalize_search(text: &str) -> String {
    text.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|word| !word.is_empty()).collect::<Vec<_>>().join(" ")
}

/// Letters and digits only (`compactSearchText`), so "darkmode" finds "Dark Mode".
fn compact_search(text: &str) -> String {
    text.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// How well `value` answers the query, scaled by the field's `weight` (`scoreField`).
fn score_field(value: &str, query: &str, tokens: &[&str], weight: u32) -> u32 {
    let normalized = normalize_search(value);
    let compact = compact_search(value);
    let words: Vec<&str> = normalized.split(' ').filter(|word| !word.is_empty()).collect();
    let mut score = 0;
    if normalized == query {
        score += weight * 40;
    } else if normalized.starts_with(query) {
        score += weight * 28;
    } else if normalized.contains(query) || compact.contains(&compact_search(query)) {
        score += weight * 18;
    }
    for token in tokens {
        score += if words.contains(token) {
            weight * 10
        } else if words.iter().any(|word| word.starts_with(token)) {
            weight * 7
        } else if normalized.contains(token) {
            weight * 4
        } else if compact.contains(&compact_search(token)) {
            weight * 3
        } else {
            0
        };
    }
    score
}

/// A row's search score, 0 when some word of the query matches none of its fields
/// (`scoreSettingSearchRecord`: label 16, section 8, page 7, keywords 6, description 3).
fn search_score(query: &str, def: &SettingDef) -> u32 {
    let query = normalize_search(query);
    if query.is_empty() {
        return 0;
    }
    let tokens: Vec<&str> = query.split(' ').collect();
    let mut fields: Vec<(&str, u32)> = vec![(def.label, 16), (def.section.unwrap_or_default(), 8), (page_title(def.tab), 7), (def.description.unwrap_or_default(), 3)];
    fields.extend(settings::search_keywords(def.label).iter().map(|keyword| (*keyword, 6)));
    if let Some(key) = def.key {
        fields.push((key, 1));
    }
    let all_matched = tokens.iter().all(|token| {
        fields.iter().any(|(value, _)| normalize_search(value).contains(token) || compact_search(value).contains(&compact_search(token)))
    });
    if !all_matched {
        return 0;
    }
    fields.iter().map(|(value, weight)| score_field(value, &query, &tokens, *weight)).sum()
}

/// Where each word of the query occurs in `text`, merged, for highlighting.
fn match_ranges(text: &str, words: &[&str]) -> Vec<Range<usize>> {
    let haystack = text.to_ascii_lowercase();
    let mut ranges: Vec<Range<usize>> = Vec::new();
    for word in words.iter().filter(|word| !word.is_empty() && word.is_ascii()) {
        let mut start = 0;
        while let Some(found) = haystack[start..].find(word) {
            let begin = start + found;
            ranges.push(begin..begin + word.len());
            start = begin + word.len();
        }
    }
    ranges.sort_by_key(|range| range.start);
    let mut merged: Vec<Range<usize>> = Vec::new();
    for range in ranges {
        match merged.last_mut() {
            Some(last) if range.start <= last.end => last.end = last.end.max(range.end),
            _ => merged.push(range),
        }
    }
    merged
}

pub(crate) fn notify(cx: &mut App, kind: NotificationKind, message: impl Into<SharedString>, description: Option<String>) {
    notifications::notify(cx, kind, NotificationCategory::Athas, message, description.map(SharedString::from), None);
}

/// Where Athas keeps its logs: the OS's logs folder for the app.
fn logs_folder() -> Option<std::path::PathBuf> {
    #[cfg(not(target_family = "wasm"))]
    return logging::logs_dir();
    #[cfg(target_family = "wasm")]
    None
}

/// Shows the logs folder, with the newest log selected when there is one.
fn reveal_logs(cx: &mut App) {
    match logs_folder() {
        Some(folder) if std::fs::create_dir_all(&folder).is_ok() => {
            #[cfg(not(target_family = "wasm"))]
            if let Some(latest) = logging::latest_log_file(&folder) {
                cx.reveal_path(&latest);
                return;
            }
            cx.reveal_path(&folder)
        }
        _ => notify(cx, NotificationKind::Error, "Failed to open the logs folder", None),
    }
}

fn home_dir() -> std::path::PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(Into::into).unwrap_or_default()
}

/// The text each font setting previews.
const FONT_PREVIEW: &str = "The quick brown fox jumps over the lazy dog 0123456789 {}[]=>";

/// The space a standalone Settings window leaves at its top for the traffic lights and dragging.
const STANDALONE_TOP: gpui::Pixels = px(40.);

impl SettingsView {
    /// Opens on `page`, or on the page Settings was last left on.
    pub fn new(page: Option<&'static str>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| {
            TextInput::new(window, cx).placeholder("Search settings").leading_icon(IconName::Search).clearable()
        });
        let subscription = cx.subscribe(&search, |this, _, event: &TextInputEvent, cx| match event {
            TextInputEvent::Changed(query) => {
                this.query = query.clone();
                this.flash = None;
                cx.notify();
            }
            TextInputEvent::Confirmed => {
                if let Some(&(index, _)) = this.search_results(cx).first() {
                    this.open_result(index, cx);
                }
            }
            TextInputEvent::Cancelled if !this.query.trim().is_empty() => {
                this.search.update(cx, |search, cx| search.set_text("", cx));
                this.query = SharedString::default();
                this.flash = None;
                cx.notify();
            }
            TextInputEvent::Cancelled => cx.emit(DismissEvent),
            _ => {}
        });
        let observe = cx.observe_global::<settings::SettingsStore>(|_, cx| cx.notify());
        let reset_settings = cx.new(|cx| TypedConfirm::new("settings-reset", "Reset", true, window, cx));
        let uninstall_cli = cx.new(|cx| TypedConfirm::new("shell-uninstall", "Uninstall", false, window, cx));
        let reset = cx.subscribe(&reset_settings, |this, _, _: &Confirmed, cx| this.reset_settings(cx));
        let uninstall = cx.subscribe_in(&uninstall_cli, window, |_, _, _: &Confirmed, window, cx| {
            if let Ok(action) = cx.build_action("platform::UninstallCliCommand", None) {
                window.dispatch_action(action, cx);
            }
            cx.notify();
        });
        search.update(cx, |search, cx| search.focus(window, cx));
        let remembered = cx
            .try_global::<settings::SettingsStore>()
            .and_then(|_| known_page(&settings::saved(cx).last_settings_tab));
        Self {
            page: page.or(remembered).unwrap_or("general"),
            standalone: false,
            search,
            query: SharedString::default(),
            fields: HashMap::new(),
            open_menu: None,
            font_picker: None,
            keybindings: None,
            ai: None,
            account: None,
            importer: None,
            terminal_profiles: None,
            github: None,
            team: None,
            integrations: None,
            report_bug: None,
            theme_creator: None,
            reset_settings,
            uninstall_cli,
            show_telemetry_log: false,
            shells: terminal_view::available_shells(),
            scroll: ScrollHandle::new(),
            telemetry_scroll: ScrollHandle::new(),
            nav_scroll: ScrollHandle::new(),
            control_bounds: Rc::default(),
            stacked: false,
            jump: None,
            jump_bounds: Rc::new(Cell::new(None)),
            flash: None,
            focus_handle: cx.focus_handle(),
            _subscriptions: vec![subscription, observe, reset, uninstall],
        }
    }

    /// Fills a window of its own (New Settings Window) instead of floating as a dialog.
    pub fn set_standalone(&mut self, standalone: bool) {
        self.standalone = standalone;
    }

    /// Shows the table of every command on the Keybindings page, as its Edit button does.
    pub fn edit_keybindings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.set_page("keyboard", cx);
        let editor = self.keybindings_editor(window, cx);
        editor.update(cx, |editor, cx| editor.set_editing(true, window, cx));
    }

    /// Opens the Report a Bug picker, as its button does.
    /// Opens Create Theme over the page.
    pub fn create_theme(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_theme_creator(window, cx);
    }

    pub fn report_bug(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_report_bug(window, cx);
    }

    /// Searches the settings for `query`, as typing in the search field does.
    pub fn set_query(&mut self, query: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.search.update(cx, |search, cx| {
            search.set_text(query.to_string(), cx);
            search.focus(window, cx);
        });
        self.query = query.to_string().into();
        cx.notify();
    }

    /// Sets a switch. Agent Notifications asks the OS for permission first and stays off, with a
    /// warning, unless it is granted (`handleAgentNotificationsChange`).
    fn set_switch(key: &'static str, on: bool, cx: &mut App) {
        if key != "aiAgentNotifications" || !on {
            Self::set(key, Value::Bool(on), cx);
            return;
        }
        let answered = move |permission: notification_permission::Permission, cx: &mut App| {
            use notification_permission::Permission;
            Self::set(key, Value::Bool(permission == Permission::Granted), cx);
            match permission {
                Permission::Granted => notify(cx, NotificationKind::Success, "Agent notifications enabled", None),
                Permission::Denied => notify(cx, NotificationKind::Warning, "Native notification permission was not granted", None),
                Permission::Unavailable => notify(cx, NotificationKind::Error, "Native notifications are unavailable", None),
            }
        };
        let (sender, receiver) = std::sync::mpsc::channel();
        notification_permission::request(move |permission| {
            sender.send(permission).ok();
        });
        if let Ok(permission) = receiver.try_recv() {
            answered(permission, cx);
            return;
        }
        cx.spawn(async move |cx| {
            let permission = cx
                .background_spawn(async move { receiver.recv().unwrap_or(notification_permission::Permission::Unavailable) })
                .await;
            cx.update(|cx| answered(permission, cx));
        })
        .detach();
    }

    fn set(key: &'static str, value: Value, cx: &mut App) {
        settings::update(cx, |settings| {
            if let Err(error) = settings.set(key, value) {
                eprintln!("settings: {error:#}");
            }
        });
    }

    /// Shows a page and remembers it for next time (`lastSettingsTab`).
    pub fn set_page(&mut self, page: &'static str, cx: &mut Context<Self>) {
        self.page = page;
        self.importer = None;
        self.scroll.set_offset(point(px(0.), px(0.)));
        if settings::saved(cx).last_settings_tab != page {
            settings::update(cx, |settings| settings.last_settings_tab = page.to_string());
        }
        cx.notify();
    }

    /// The rows the search matches, in page order.
    /// The rows matching the query, best first (`searchSettings`): every word must occur in the
    /// label, section, page, description or keywords, and the score weighs where it occurs.
    fn search_results(&self, cx: &App) -> Vec<(usize, &'static SettingDef)> {
        let current = settings::saved(cx);
        let subscription = account::AccountStore::global(cx).and_then(|store| store.read(cx).subscription().cloned());
        let enterprise = subscription.as_ref().is_some_and(|subscription| subscription.enterprise.has_access);
        let collaboration = subscription.as_ref().and_then(|subscription| subscription.collaboration.as_ref()).is_some_and(|team| team.enabled);
        let mut results: Vec<(usize, u32, &'static SettingDef)> = SETTING_DEFS
            .iter()
            .enumerate()
            .filter(|(_, def)| settings::row_visible(def, current) && visible_with_access(def, enterprise, collaboration))
            .filter_map(|(index, def)| {
                let score = search_score(&self.query, def);
                (score > 0).then_some((index, score, def))
            })
            .collect();
        results.sort_by_key(|(_, score, def)| (std::cmp::Reverse(*score), NAVIGATION_ORDER.iter().position(|page| *page == def.tab).unwrap_or(NAVIGATION_ORDER.len())));
        results.into_iter().map(|(index, _, def)| (index, def)).collect()
    }

    /// Shows a search result's page with the row scrolled into view and marked, keeping the
    /// search (`openSearchResult`).
    fn open_result(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(def) = SETTING_DEFS.get(index) else { return };
        self.set_page(def.tab, cx);
        // An Integrations section is a category of the catalog, which opens showing it. The
        // page may not have been built yet, and then the stored filter is all it takes.
        if def.tab == "integrations"
            && let Some(category) = integrations_category(def)
        {
            match self.integrations.clone() {
                Some(view) => view.update(cx, |view, cx| view.show_category(category, cx)),
                None => settings::update(cx, |settings| settings.extensions_active_tab = category.to_string()),
            }
        }
        let target = if def.kind == SettingKind::View { view_target(def) } else { JumpTarget::Row(index) };
        // The theme cards head Appearance, and the catalog its own categories; both open at the top.
        let at_top = def.tab == "integrations" || (def.tab == "appearance" && def.section == Some("Theme") && def.kind == SettingKind::View);
        self.jump = (!at_top).then_some(Jump { target, attempts: 6 });
        self.jump_bounds.set(None);
        self.flash = Some(index);
        cx.notify();
    }

    /// Scrolls to the row a jump is after, once the last frame has placed it.
    fn settle_jump(&mut self, cx: &mut Context<Self>) {
        let Some(jump) = self.jump.as_mut() else { return };
        if let Some(row) = self.jump_bounds.take() {
            let viewport = self.scroll.bounds();
            let offset = self.scroll.offset();
            let row_in_content = row.top() - viewport.top() - offset.y;
            let target = (row_in_content - px(24.)).max(px(0.));
            self.scroll.set_offset(point(offset.x, -target));
            self.jump = None;
            cx.notify();
        } else if jump.attempts > 0 {
            jump.attempts -= 1;
            cx.notify();
        } else {
            self.jump = None;
        }
    }

    /// A text field for a setting, created once and kept so typing is not lost between frames.
    /// While it is not being typed into it follows the stored value, so a reset, an import, a
    /// sync or a settings.json edit shows at once (the original's inputs are controlled).
    fn field(&mut self, def: &SettingDef, value: String, window: &mut Window, cx: &mut Context<Self>) -> Entity<TextInput> {
        let key = def.key.unwrap_or_default();
        if let Some((input, _)) = self.fields.get(key) {
            let input = input.clone();
            if !input.focus_handle(cx).is_focused(window) && input.read(cx).text().as_ref() != value.as_str() {
                input.update(cx, |input, cx| input.set_text(value, cx));
            }
            return input;
        }
        let number = matches!(def.kind, SettingKind::Number { .. });
        let input = cx.new(|cx| {
            let placeholder = field_placeholder(key).unwrap_or(def.label);
            let mut input = TextInput::new(window, cx).placeholder(placeholder);
            // A number is its own raised pill between the steppers, centred (`ui/number-input.tsx`).
            if number {
                input = input.centered();
            }
            input.set_text(value, cx);
            input
        });
        let kind = def.kind;
        let subscription = cx.subscribe(&input, move |_, input, event: &TextInputEvent, cx| {
            let commit = matches!(event, TextInputEvent::Confirmed | TextInputEvent::Blurred);
            let text = input.read(cx).text().to_string();
            match kind {
                SettingKind::List if commit => Self::set(key, list_value(&text), cx),
                SettingKind::Columns if commit => {
                    let columns = columns_value(&text);
                    let shown = value_text(&Some(columns.clone()));
                    Self::set(key, columns, cx);
                    input.update(cx, |input, cx| input.set_text(shown, cx));
                }
                // A time applies once it reads as one, like `<input type="time">`.
                SettingKind::Time if settings::is_time_of_day(&text) => Self::set(key, Value::String(text), cx),
                SettingKind::Time if commit => {
                    let current = value_text(&settings::saved(cx).get(key));
                    input.update(cx, |input, cx| input.set_text(current, cx));
                }
                SettingKind::Text if matches!(event, TextInputEvent::Changed(_)) => Self::set(key, Value::String(text), cx),
                // A typed number applies on Return or blur, clamped to the row's range and step
                // (`NumberInput`); anything else puts the stored value back.
                SettingKind::Number { min, max, step } if commit => {
                    let stored = settings::saved(cx).get(key).and_then(|value| value.as_f64()).unwrap_or(min);
                    let typed = text.trim().parse::<f64>().ok().filter(|number| number.is_finite());
                    let next = typed.map_or(stored, |number| ((number.clamp(min, max) / step).round() * step * 1000.).round() / 1000.);
                    if typed.is_some()
                        && let Some(number) = serde_json::Number::from_f64(next)
                    {
                        Self::set(key, Value::Number(number), cx);
                    }
                    input.update(cx, |input, cx| input.set_text(number_text(next), cx));
                }
                _ => {}
            }
        });
        self.fields.insert(key, (input.clone(), subscription));
        input
    }

    fn open_font_picker(&mut self, key: &'static str, monospace: bool, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let current = SharedString::from(value_text(&settings::saved(cx).get(key)));
        let picker = cx.new(|cx| FontPicker::new(current, monospace, window, cx));
        let picked = cx.subscribe(&picker, move |_, _, event: &FontPickerEvent, cx| {
            let FontPickerEvent::Picked(family) = event;
            Self::set(key, Value::String(family.to_string()), cx);
        });
        let dismissed = cx.subscribe_in(&picker, window, |this, _, _: &DismissEvent, window, cx| {
            this.font_picker = None;
            this.search.update(cx, |search, cx| search.focus(window, cx));
            cx.notify();
        });
        self.font_picker = Some(OpenFontPicker { key, picker, position, _subscriptions: [picked, dismissed] });
        cx.notify();
    }

    pub fn open_importer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let importer = cx.new(|cx| EditorImport::new(window, cx));
        let subscription = cx.subscribe(&importer, |this, _, event: &EditorImportEvent, cx| match event {
            EditorImportEvent::Close => {
                this.importer = None;
                cx.notify();
            }
        });
        self.importer = Some((importer, subscription));
        self.scroll.set_offset(point(px(0.), px(0.)));
        cx.notify();
    }

    fn export_settings(&mut self, cx: &mut Context<Self>) {
        let json = settings::import::export_json(settings::saved(cx), &settings::import::timestamp_now());
        let path = cx.prompt_for_new_path(&home_dir(), Some("athas-settings.json"));
        cx.spawn(async move |_, cx| {
            let Ok(Ok(Some(path))) = path.await else { return };
            let written = json.and_then(|json| Ok(std::fs::write(&path, json)?));
            cx.update(|cx| match written {
                Ok(()) => notify(cx, NotificationKind::Success, "Settings exported", None),
                Err(error) => notify(cx, NotificationKind::Error, "Failed to export settings", Some(format!("{error:#}"))),
            });
        })
        .detach();
    }

    fn import_settings(&mut self, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Import".into()),
        });
        cx.spawn(async move |_, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            let imported = std::fs::read_to_string(&path)
                .map_err(anyhow::Error::from)
                .and_then(|text| settings::import::parse_settings_import(&text));
            cx.update(|cx| match imported {
                Ok(import) => {
                    // Keys only this build knows (onboarding, …) stay as they are.
                    let extra = settings::saved(cx).extra.clone();
                    settings::update(cx, |settings| {
                        *settings = import.settings;
                        for (key, value) in extra {
                            settings.extra.entry(key).or_insert(value);
                        }
                    });
                    let skipped = (!import.skipped.is_empty()).then(|| format!("Skipped {}", import.skipped.join(", ")));
                    notify(cx, NotificationKind::Success, "Settings imported", skipped);
                }
                Err(error) => notify(cx, NotificationKind::Error, "Invalid settings file", Some(format!("{error:#}"))),
            });
        })
        .detach();
    }

    fn reset_settings(&mut self, cx: &mut Context<Self>) {
        settings::update(cx, |settings| {
            let extra = std::mem::take(&mut settings.extra);
            *settings = settings::Settings { extra, ..Default::default() };
        });
        notify(cx, NotificationKind::Success, "Settings reset to defaults", None);
    }

    fn open_report_bug(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let picker = cx.new(|cx| Picker::new(ReportBugDelegate::new(), window, cx));
        let dismissed = cx.subscribe_in(&picker, window, |this, _, _: &DismissEvent, window, cx| {
            this.report_bug = None;
            this.search.update(cx, |search, cx| search.focus(window, cx));
            cx.notify();
        });
        self.report_bug = Some((picker, dismissed));
        cx.notify();
    }

    fn open_theme_creator(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let base = settings::saved(cx).theme.clone();
        let creator = custom_theme_creator::open(&base, window, cx);
        let dismissed = cx.subscribe(&creator, |this, _, _: &DismissEvent, cx| {
            this.theme_creator = None;
            cx.notify();
        });
        self.theme_creator = Some((creator, dismissed));
        cx.notify();
    }

    fn import_theme(&mut self, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: false, prompt: Some("Import".into()) });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            this.update(cx, |_, cx| match extensions::import_theme_file(&path, cx) {
                Ok(themes) => {
                    let Some(first) = themes.first() else { return };
                    let message = if themes.len() == 1 { format!("Imported {}", first.name) } else { format!("Imported {} theme variants", themes.len()) };
                    notify(cx, NotificationKind::Success, message, None);
                    extensions::select_theme(&first.id, cx);
                    cx.notify();
                }
                Err(error) => {
                    let details = (!error.details.is_empty()).then(|| error.details.iter().take(4).cloned().collect::<Vec<_>>().join("\n"));
                    notify(cx, NotificationKind::Error, error.message, details);
                }
            })
            .ok();
        })
        .detach();
    }

    /// One row per imported theme, with a button that removes it.
    fn custom_theme_rows(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let registry = theme::registry(cx);
        registry
            .custom_themes()
            .map(|theme| {
                let id = theme.id.clone();
                div()
                    .relative()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(24.))
                    .min_h(px(44.))
                    .py(px(10.))
                    .px(px(12.))
                    .child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .child(div().text_size(typography::TEXT_SM).text_color(colors.foreground).child(theme.name.clone()))
                            .child(
                                div()
                                    .text_size(typography::TEXT_CAPTION)
                                    .text_color(colors.muted_foreground)
                                    .child(if theme.appearance.is_dark() { "Dark" } else { "Light" }),
                            ),
                    )
                    .child(
                        Button::icon(SharedString::from(format!("custom-theme-remove-{id}")), IconName::Trash)
                            .variant(ButtonVariant::Ghost)
                            .tone(ButtonTone::Danger)
                            .tooltip(format!("Remove {}", theme.name))
                            .on_click(cx.listener(move |_, _, _, cx| {
                                if let Err(error) = extensions::remove_custom_theme(&id, cx) {
                                    notify(cx, NotificationKind::Error, "Failed to remove custom theme", Some(error.message));
                                }
                                cx.notify();
                            })),
                    )
                    .into_any_element()
            })
            .collect()
    }

    fn dispatch_by_name(name: &'static str) -> impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static {
        move |_, window, cx| {
            if let Ok(action) = cx.build_action(name, None) {
                window.dispatch_action(action, cx);
            }
        }
    }

    /// `Athas 0.x · Up to date`, as the update check stands.
    fn version_status(cx: &App) -> String {
        let status = workbench_api::update_status(cx);
        let version = format!("Athas {}", env!("CARGO_PKG_VERSION"));
        if status.downloading {
            format!("{version} · Downloading {}%", status.progress.unwrap_or(0))
        } else if status.installing {
            format!("{version} · Installing")
        } else if let Some(available) = &status.available {
            format!("{version} · {available} available")
        } else if status.error.is_some() {
            format!("{version} · Update check failed")
        } else {
            format!("{version} · Up to date")
        }
    }

    fn cli_status() -> (bool, String) {
        match cli::install::state_for_current_user() {
            cli::install::CliInstallState::Installed(_) => (true, "Installed at ~/.local/bin/athas".into()),
            _ => (false, "Open folders from your shell with athas".into()),
        }
    }

    fn github_credentials(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Entity<GitHubCredentials> {
        self.github.get_or_insert_with(|| cx.new(|cx| GitHubCredentials::new(window, cx))).clone()
    }

    /// A row's description that comes from state rather than the schema.
    fn live_description(&self, def: &SettingDef, cx: &App) -> Option<String> {
        if github_credentials::is_credentials_row(def.tab, def.label) {
            return self.github.as_ref().and_then(|github| github.read(cx).description(def.label));
        }
        match (def.tab, def.label) {
            ("general", "Version") => Some(Self::version_status(cx)),
            ("general", "Shell Command") => Some(Self::cli_status().1),
            ("advanced", "Anonymous Usage Telemetry") => Some("Never includes file paths, prompts, or code.".into()),
            ("appearance", "Custom Themes") => Some("Theme format".into()),
            _ => None,
        }
    }

    /// The control of a row that runs something rather than holding a value.
    fn render_action(&mut self, index: usize, def: &SettingDef, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if github_credentials::is_credentials_row(def.tab, def.label) {
            let github = self.github_credentials(window, cx);
            return github.update(cx, |github, cx| github.control(def.label, cx));
        }
        match (def.tab, def.label) {
            ("general", "Version") => {
                let status = workbench_api::update_status(cx);
                let busy = status.checking || status.downloading || status.installing;
                let label = |version: &str| {
                    if status.downloading {
                        "Downloading...".to_string()
                    } else if status.installing {
                        "Installing...".to_string()
                    } else {
                        format!("{} {version}", if status.download_only { "Download" } else { "Install" })
                    }
                };
                match status.available.as_deref() {
                    Some(version) => div()
                        .flex()
                        .items_center()
                        .gap_1()
                        .child(
                            Button::new("settings-update-later", "Download later")
                                .variant(ButtonVariant::Ghost)
                                .disabled(busy)
                                .on_click(Self::dispatch_by_name("platform::DownloadUpdateLater")),
                        )
                        .child(
                            Button::new("settings-update-install", label(version))
                                .variant(ButtonVariant::Accent)
                                .disabled(busy)
                                .on_click(Self::dispatch_by_name("platform::DownloadUpdate")),
                        )
                        .into_any_element(),
                    None => Button::new("settings-update-check", if status.checking { "Checking..." } else { "Check for updates" })
                        .variant(ButtonVariant::Outline)
                        .disabled(busy)
                        .on_click(Self::dispatch_by_name("platform::CheckForUpdates"))
                        .into_any_element(),
                }
            }
            ("general", "Shell Command") => {
                if Self::cli_status().0 {
                    return self.uninstall_cli.clone().into_any_element();
                }
                div()
                    .flex()
                    .gap(px(8.))
                    .child(
                        Button::new(("shell-install", index), "Install")
                            .variant(ButtonVariant::Outline)
                            .on_click(cx.listener(|_, _, window, cx| {
                                if let Ok(action) = cx.build_action("platform::InstallCliCommand", None) {
                                    window.dispatch_action(action, cx);
                                }
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new(("shell-copy", index), "Copy")
                            .variant(ButtonVariant::Outline)
                            .tooltip("Copy install command to clipboard")
                            .on_click(|_, _, cx| match cli::install::bundled_cli_binary() {
                                Some(binary) => {
                                    let command = format!("mkdir -p ~/.local/bin && ln -sf '{}' ~/.local/bin/athas", binary.display());
                                    cx.write_to_clipboard(ClipboardItem::new_string(command));
                                    notify(cx, NotificationKind::Success, "Install command copied to clipboard", None);
                                }
                                None => notify(cx, NotificationKind::Error, "Failed to copy command: athas-cli is not next to this build", None),
                            }),
                    )
                    .into_any_element()
            }
            ("general", "Import From Another Editor") => Button::new("settings-import-editor", "Import")
                .variant(ButtonVariant::Outline)
                .on_click(cx.listener(|this, _, window, cx| this.open_importer(window, cx)))
                .into_any_element(),
            ("general", "Report a Bug") => Button::new("settings-report-bug", "Report")
                .variant(ButtonVariant::Outline)
                .on_click(cx.listener(|this, _, window, cx| this.open_report_bug(window, cx)))
                .into_any_element(),
            ("advanced", "Export Settings") => Button::new("settings-export", "Export")
                .variant(ButtonVariant::Outline)
                .on_click(cx.listener(|this, _, _, cx| this.export_settings(cx)))
                .into_any_element(),
            ("advanced", "Import Settings") => Button::new("settings-import", "Import")
                .variant(ButtonVariant::Outline)
                .on_click(cx.listener(|this, _, _, cx| this.import_settings(cx)))
                .into_any_element(),
            ("advanced", "Telemetry Log") => div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(Button::new("telemetry-log-clear", "Clear").variant(ButtonVariant::Outline).on_click(cx.listener(|_, _, _, cx| {
                    telemetry::clear_log(cx);
                    notify(cx, NotificationKind::Success, "Telemetry log cleared", None);
                    cx.notify();
                })))
                .child(
                    Button::new("telemetry-log-toggle", if self.show_telemetry_log { "Hide" } else { "Show" })
                        .variant(ButtonVariant::Outline)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.show_telemetry_log = !this.show_telemetry_log;
                            cx.notify();
                        })),
                )
                .into_any_element(),
            ("advanced", "Logs Folder") => Button::new("settings-logs-folder", "Open")
                .variant(ButtonVariant::Outline)
                .on_click(|_, _, cx| reveal_logs(cx))
                .into_any_element(),
            ("advanced", "Reset Settings") => self.reset_settings.clone().into_any_element(),
            ("appearance", "Custom Themes") => div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(
                    Button::new("custom-theme-create", "Create")
                        .variant(ButtonVariant::Outline)
                        .leading_icon(IconName::FilePlus)
                        .on_click(cx.listener(|this, _, window, cx| this.open_theme_creator(window, cx))),
                )
                .child(
                    Button::new("custom-theme-import", "Import")
                        .variant(ButtonVariant::Outline)
                        .leading_icon(IconName::Upload)
                        .on_click(cx.listener(|this, _, _, cx| this.import_theme(cx))),
                )
                .into_any_element(),
            _ => div()
                .px(px(8.))
                .rounded_full()
                .bg(cx.theme().colors.accent)
                .text_size(typography::TEXT_CAPTION)
                .text_color(cx.theme().colors.subtle_foreground)
                .child("Coming with its feature")
                .into_any_element(),
        }
    }

    fn render_control(&mut self, index: usize, def: &SettingDef, enabled: bool, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(key) = def.key else {
            return self.render_action(index, def, window, cx);
        };
        let value = settings::saved(cx).get(key);
        match def.kind {
            SettingKind::Toggle | SettingKind::InvertedToggle => {
                let inverted = def.kind == SettingKind::InvertedToggle;
                let on = value.and_then(|v| v.as_bool()).unwrap_or(false) != inverted;
                Switch::new(("setting-switch", index), on)
                    .disabled(!enabled)
                    .on_change(move |checked, _, cx| Self::set_switch(key, checked != inverted, cx))
                    .into_any_element()
            }
            SettingKind::Select(_) if key == "iconTheme" && !installed_icon_themes(cx).is_empty() => {
                // A searchable select with an input trigger, as Shell (`appearance-settings.tsx`).
                let (options, on_select) = self.select_options(def, cx);
                let label = options.iter().find(|(checked, ..)| *checked).map(|(_, label, _)| label.clone()).unwrap_or_else(|| value_text(&value));
                let button = select_button(("setting-select", index), label, format!("setting-select:{key}"), options, on_select, !enabled, true, cx);
                div().when(!self.stacked, |this| this.w(SEARCHABLE_SELECT_WIDTH)).when(self.stacked, |this| this.w_full()).child(button).into_any_element()
            }
            SettingKind::Select(options) => {
                let current = value_text(&value);
                let label = options
                    .iter()
                    .find(|(value, _)| *value == current)
                    .map_or(current.clone(), |(value, label)| option_label(key, value, label));
                let menu_key = format!("setting-select:{key}");
                let (choices, on_select) = self.select_options(def, cx);
                Button::new(("setting-select", index), label)
                    .variant(ButtonVariant::Outline)
                    .regular_weight()
                    .trailing_icon(IconName::ChevronDown)
                    .disabled(!enabled)
                    .active(self.open_menu.as_ref().is_some_and(|menu| menu.key == menu_key))
                    .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                        let position = event.position();
                        open_select_menu(this, menu_key.clone(), &choices, on_select.clone(), point(position.x, position.y + px(10.)), window, cx);
                    }))
                    .into_any_element()
            }
            SettingKind::Shell | SettingKind::Profile => {
                let (options, on_select) = self.select_options(def, cx);
                let label = options.iter().find(|(checked, ..)| *checked).map(|(_, label, _)| label.clone()).unwrap_or_default();
                // A searchable select with an input trigger (`searchableTrigger="input"`): an
                // input-sized field, the choice at its start and the chevron at its end.
                let button = select_button(("setting-select", index), label, format!("setting-select:{key}"), options, on_select, !enabled, true, cx);
                div().when(!self.stacked, |this| this.w(SEARCHABLE_SELECT_WIDTH)).when(self.stacked, |this| this.w_full()).child(button).into_any_element()
            }
            SettingKind::Font { monospace } => {
                let current = value_text(&value);
                let open = self.font_picker.as_ref().is_some_and(|picker| picker.key == key);
                let button = Button::new(("setting-font", index), if current.is_empty() { "Default".to_string() } else { crate::font_picker::display_name(&current).to_string() })
                    .variant(ButtonVariant::Outline)
                    .regular_weight()
                    .trailing_icon(IconName::ChevronDown)
                    .full_width()
                    .align_between()
                    .active(open)
                    .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                        let position = event.position();
                        this.open_font_picker(key, monospace, point(position.x, position.y + px(10.)), window, cx);
                    }));
                div().when(!self.stacked, |this| this.w(SEARCHABLE_SELECT_WIDTH)).when(self.stacked, |this| this.w_full()).child(button)
                    .into_any_element()
            }
            SettingKind::Number { min, max, step } => {
                let current = value.and_then(|v| v.as_f64()).unwrap_or(min);
                let colors = cx.theme().colors.clone();
                let stepper = |id: &'static str, icon: IconName, next: f64, possible: bool| {
                    div()
                        .id((id, index))
                        .flex()
                        .items_center()
                        .justify_center()
                        .flex_none()
                        .size(px(24.))
                        .rounded_full()
                        .when(possible, |this| this.hover(|style| style.bg(colors.accent)))
                        .child(Icon::new(icon).size(IconSize::XSmall).color(if possible { colors.subtle_foreground } else { colors.subtle_foreground.opacity(0.5) }))
                        .when(possible, |this| {
                            this.on_click(move |_, _, cx| {
                                // Steps land on the step grid, so 1.4 + 0.1 is 1.5, not 1.5000000000000002.
                                let rounded = ((next.clamp(min, max) / step).round() * step * 1000.).round() / 1000.;
                                if let Some(number) = serde_json::Number::from_f64(rounded) {
                                    Self::set(key, Value::Number(number), cx);
                                }
                            })
                        })
                };
                // Ghost steppers either side of the number's own pill, 4px apart (`ui/number-input.tsx`).
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .w(px(128.))
                    .text_size(typography::TEXT_SM)
                    .child(stepper("setting-decrement", IconName::Minus, current - step, enabled && current > min))
                    .child({
                        // The number itself is a field: click it and type.
                        let input = self.field(def, number_text(current), window, cx);
                        input.update(cx, |input, cx| input.set_disabled(!enabled, cx));
                        div().flex_1().min_w_0().text_color(colors.foreground).child(input)
                    })
                    .child(stepper("setting-increment", IconName::Plus, current + step, enabled && current < max))
                    .into_any_element()
            }
            SettingKind::Text | SettingKind::List | SettingKind::Columns | SettingKind::Time => {
                let input = self.field(def, value_text(&value), window, cx);
                input.update(cx, |input, cx| input.set_disabled(!enabled, cx));
                div().when(self.stacked, |this| this.w_full()).when(!self.stacked, |this| this.w(px(256.))).child(input).into_any_element()
            }
            SettingKind::Action => self.render_action(index, def, window, cx),
            SettingKind::View => div().into_any_element(),
        }
    }

    /// A select row's options (checked, label, value) and what choosing one does.
    fn select_options(&self, def: &SettingDef, cx: &App) -> (Vec<(bool, String, String)>, Rc<dyn Fn(String, &mut App)>) {
        let key = def.key.unwrap_or_default();
        let current = value_text(&settings::saved(cx).get(key));
        let options: Vec<(String, String)> = match def.kind {
            // Icon themes come from the installed extensions, by their own names (`iconThemeRegistry`).
            SettingKind::Select(_) if key == "iconTheme" && !installed_icon_themes(cx).is_empty() => installed_icon_themes(cx),
            SettingKind::Select(options) => options.iter().map(|(value, label)| (value.to_string(), option_label(key, value, label))).collect(),
            SettingKind::Shell => std::iter::once((String::new(), "System Default".to_string()))
                .chain(self.shells.iter().map(|shell| (shell.id.clone(), shell.name.clone())))
                .collect(),
            SettingKind::Profile => {
                let custom: Vec<terminal_view::TerminalProfile> = settings::saved(cx)
                    .extra
                    .get(terminal_profiles::PROFILES_KEY)
                    .and_then(|value| serde_json::from_value(value.clone()).ok())
                    .unwrap_or_default();
                terminal_view::all_profiles(&self.shells, &custom)
                    .into_iter()
                    .map(|profile| (if profile.id == "system-default" { String::new() } else { profile.id }, profile.name))
                    .collect()
            }
            _ => Vec::new(),
        };
        // A shell or profile that is gone (uninstalled, deleted) reads as the default.
        let selected = if matches!(def.kind, SettingKind::Select(_)) || options.iter().any(|(id, _)| *id == current) { current } else { String::new() };
        let options = options.into_iter().map(|(value, label)| (value == selected, label, value)).collect();
        (options, Rc::new(move |value: String, cx: &mut App| Self::set(key, Value::String(value), cx)))
    }

    /// Clicking a row away from its control works the control (`SettingRow.handleRowClick`):
    /// a switch flips, a select or font picker opens at its control, a field takes focus with
    /// its text selected.
    fn activate_row(&mut self, index: usize, def: &'static SettingDef, window: &mut Window, cx: &mut Context<Self>) {
        let Some(key) = def.key else { return };
        if !settings::row_enabled(def, settings::saved(cx)) {
            return;
        }
        let control = self.control_bounds.borrow().get(&index).copied();
        let below = control.map_or(window.mouse_position(), |bounds| point(bounds.right(), bounds.bottom() + px(4.)));
        match def.kind {
            SettingKind::Toggle | SettingKind::InvertedToggle => {
                let current = settings::saved(cx).get(key).and_then(|value| value.as_bool()).unwrap_or(false);
                Self::set_switch(key, !current, cx);
            }
            SettingKind::Select(_) | SettingKind::Shell | SettingKind::Profile => {
                let (options, on_select) = self.select_options(def, cx);
                open_select_menu(self, format!("setting-select:{key}"), &options, on_select, below, window, cx);
            }
            SettingKind::Font { monospace } => self.open_font_picker(key, monospace, below, window, cx),
            SettingKind::Number { .. } | SettingKind::Text | SettingKind::List | SettingKind::Columns | SettingKind::Time => {
                if let Some((input, _)) = self.fields.get(key) {
                    let input = input.clone();
                    input.update(cx, |input, cx| {
                        input.focus(window, cx);
                        input.select_all_text(cx);
                    });
                }
            }
            SettingKind::Action | SettingKind::View => {}
        }
    }

    /// A line of sample text in the font a setting names, at the size it is used at.
    fn font_preview(key: &'static str, cx: &App) -> AnyElement {
        let settings = settings::saved(cx);
        let family = value_text(&settings.get(key));
        let size = match key {
            "uiFontFamily" => settings.ui_font_size,
            "terminalFontFamily" => settings.terminal_font_size,
            _ => settings.font_size,
        };
        div()
            .pt(px(2.))
            .truncate()
            .when(!family.is_empty(), |this| this.font_family(SharedString::from(family)))
            .text_size(px(size.clamp(8., 24.) as f32))
            .text_color(cx.theme().colors.muted_foreground)
            .child(FONT_PREVIEW)
            .into_any_element()
    }

    fn render_row(&mut self, index: usize, def: &'static SettingDef, first: bool, words: &[&str], window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let enabled = settings::row_enabled(def, settings::saved(cx));
        let control = self.render_control(index, def, enabled, window, cx);
        let colors = cx.theme().colors.clone();
        let resettable = def.key.is_some_and(|key| !settings::saved(cx).is_default(key));
        let highlight = HighlightStyle {
            background_color: Some(colors.primary_soft),
            color: Some(colors.foreground),
            ..Default::default()
        };
        let text = |text: SharedString| {
            let ranges = match_ranges(&text, words);
            StyledText::new(text).with_highlights(ranges.into_iter().map(|range| (range, highlight)))
        };
        let description = self.live_description(def, cx).map(SharedString::from).or(def.description.map(SharedString::from));
        let font_key = matches!(def.kind, SettingKind::Font { .. }).then(|| def.key.unwrap_or_default());
        let tracked = self.jump.as_ref().is_some_and(|jump| jump.target == JumpTarget::Row(index));
        let flashing = self.flash == Some(index);
        let bounds = self.jump_bounds.clone();
        let activates = enabled && def.key.is_some() && !matches!(def.kind, SettingKind::Action | SettingKind::View);
        let reset_label = format!("Reset {}", def.label);
        let stacked = self.stacked;
        let control_bounds = self.control_bounds.clone();
        div()
            .relative()
            .flex()
            .when(stacked, |this| this.flex_col().items_stretch().gap(px(8.)))
            .when(!stacked, |this| this.items_center().justify_between().gap(px(24.)))
            .min_h(px(44.))
            .py(px(10.))
            .px(px(12.))
            .when(flashing, |this| this.rounded(metrics::RADIUS_MD).bg(colors.primary_soft))
            .when(!first, |this| {
                this.child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider))
            })
            .when(tracked, |this| {
                this.child(
                    canvas(move |row, _, _| bounds.set(Some(row)), |_, _, _, _| {})
                        .absolute()
                        .size_full(),
                )
            })
            .child(
                div()
                    .id(("setting-label", index))
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .child(div().text_size(typography::TEXT_SM).text_color(colors.foreground).child(text(def.label.into())))
                            .when(def.key.is_some(), |this| {
                                this.child(div().flex().items_center().justify_center().size(px(20.)).when(resettable, |this| {
                                    let key = def.key.unwrap_or_default();
                                    this.child(
                                        Button::icon(("setting-reset", index), IconName::ArrowCounterClockwise)
                                            .variant(ButtonVariant::Ghost)
                                            .size(ButtonSize::Small)
                                            .tooltip(reset_label.clone())
                                            .on_click(move |_, _, cx| {
                                                cx.stop_propagation();
                                                settings::update(cx, |settings| settings.reset(key));
                                            }),
                                    )
                                }))
                            }),
                    )
                    .children(description.map(|description| {
                        // Descriptions that are, or end in, a `TextLink`: telemetry's "Learn more"
                        // and Custom Themes' "Theme format".
                        let link = |id: &'static str, label: &'static str, url: String| {
                            div().id(id).text_color(colors.primary).hover(|style| style.underline()).child(label).on_click(move |_, _, cx| {
                                cx.stop_propagation();
                                cx.open_url(&url);
                            })
                        };
                        if def.tab == "appearance" && def.label == "Custom Themes" {
                            let url = format!("{}/themes", account::ServiceUrls::from_env().docs());
                            return div().flex().text_size(typography::TEXT_SM).line_height(relative(1.375)).child(link("theme-format-link", "Theme format", url)).into_any_element();
                        }
                        let learn_more = (def.tab == "advanced" && def.label == "Anonymous Usage Telemetry")
                            .then(|| link("telemetry-learn-more", "Learn more", account::ServiceUrls::from_env().telemetry_docs()));
                        div()
                            .when(learn_more.is_some(), |this| this.flex().flex_wrap().gap_x(px(4.)))
                            .text_size(typography::TEXT_SM)
                            .line_height(relative(1.375))
                            .text_color(colors.subtle_foreground)
                            .child(text(description))
                            .children(learn_more)
                            .into_any_element()
                    }))
                    .children(font_key.map(|key| Self::font_preview(key, cx)))
                    .when(activates, |this| this.on_click(cx.listener(move |this, _, window, cx| this.activate_row(index, def, window, cx)))),
            )
            .child(
                div()
                    .relative()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .when(stacked, |this| this.w_full().flex_wrap())
                    .when(!stacked, |this| this.flex_none())
                    .child(control)
                    .child(
                        canvas(move |bounds, _, _| {
                            control_bounds.borrow_mut().insert(index, bounds);
                        }, |_, _, _, _| {})
                        .absolute()
                        .size_full(),
                    ),
            )
            .into_any_element()
    }

    /// The telemetry log under "Telemetry Log", when shown.
    fn telemetry_log(&self, cx: &App) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let entries = telemetry::log_entries(cx);
        if entries.is_empty() {
            return div()
                .relative()
                .py(px(20.))
                .text_center()
                .text_size(typography::TEXT_SM)
                .text_color(colors.muted_foreground)
                .child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider))
                .child("No entries yet")
                .into_any_element();
        }
        div()
            .id("telemetry-log")
            .relative()
            .flex()
            .flex_col()
            .max_h(px(288.))
            .overflow_y_scroll()
            .px(px(12.))
            .py(px(10.))
            .gap(px(2.))
            .child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider))
            .children(entries.into_iter().rev().map(|entry| {
                let status = serde_json::to_value(entry.status).ok().and_then(|value| value.as_str().map(str::to_string)).unwrap_or_default();
                let tone = match status.as_str() {
                    "failed" => Tone::Danger,
                    "sent" => Tone::Success,
                    "local" => Tone::Accent,
                    _ => Tone::Neutral,
                };
                let time = entry.timestamp.replace('T', " ");
                let time = time.split('.').next().unwrap_or_default().trim_end_matches('Z').to_string();
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .py(px(6.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().truncate().text_size(typography::TEXT_SM).text_color(colors.foreground).child(entry.event_type.clone()))
                            .child(
                                div()
                                    .truncate()
                                    .text_size(typography::TEXT_SM)
                                    .text_color(colors.subtle_foreground)
                                    .child(entry.error.clone().unwrap_or_else(|| entry.summary.clone())),
                            ),
                    )
                    .child(Badge::new(status).tone(tone))
                    .child(div().flex_none().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child(time))
            }))
            .scrollbar_with(&self.telemetry_scroll)
            .into_any_element()
    }

    /// "N commands not covered by this preset", under the preset row.
    fn preset_coverage_alert(cx: &App) -> Option<AnyElement> {
        let preset = settings::saved(cx).keybinding_preset.clone();
        if preset == "none" {
            return None;
        }
        let missing = keymap::preset_coverage(&preset).missing.len();
        if missing == 0 {
            return None;
        }
        let colors = cx.theme().colors.clone();
        Some(
            div()
                .relative()
                .px(px(12.))
                .py(px(10.))
                .child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .px(px(10.))
                        .py(px(8.))
                        .rounded(metrics::RADIUS_MD)
                        .bg(colors.warning_soft)
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.warning)
                        .child(Icon::new(IconName::WarningCircle).size(IconSize::Small).color(colors.warning))
                        .child(format!("{missing} command{} not covered by this preset.", if missing == 1 { "" } else { "s" })),
                )
                .into_any_element(),
        )
    }

    fn render_sections(&mut self, defs: Vec<(usize, &'static SettingDef)>, words: &[&str], window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let shadow = cx.theme().shadows.raised.clone();
        let mut sections: Vec<(&'static str, Option<&'static str>, Vec<(usize, &'static SettingDef)>)> = Vec::new();
        for (index, def) in defs {
            match sections.last_mut() {
                Some((tab, section, rows)) if *section == def.section && *tab == def.tab => rows.push((index, def)),
                _ => sections.push((def.tab, def.section, vec![(index, def)])),
            }
        }
        let mut elements = Vec::new();
        for (tab, title, rows) in sections {
                let mut children: Vec<AnyElement> = Vec::new();
                // The theme cards head Appearance > Theme.
                if words.is_empty() && tab == "appearance" && title == Some("Theme") {
                    children.push(appearance::theme_choices(cx));
                }
                let offset = children.len();
                let mut position = 0;
                for (index, def) in rows {
                    if def.tab == "git" && def.label == "Token Permissions" {
                        let github = self.github_credentials(window, cx);
                        if github.read(cx).destructive_scopes().is_empty() {
                            continue;
                        }
                    }
                    children.push(self.render_row(index, def, position + offset == 0, words, window, cx));
                    position += 1;
                    if def.tab == "advanced" && def.label == "Telemetry Log" && self.show_telemetry_log {
                        children.push(self.telemetry_log(cx));
                    }
                    if def.tab == "general" && def.label == "Version" {
                        // The download's progress and a failed check's error, under the row.
                        let status = workbench_api::update_status(cx);
                        if status.downloading
                            && let Some(progress) = status.progress
                        {
                            children.push(div().px(px(12.)).py(px(10.)).child(ui::Progress::new(f32::from(progress))).into_any_element());
                        }
                        if let Some(error) = status.error {
                            children.push(div().px(px(12.)).py(px(10.)).child(ui::Alert::new().tone(Tone::Danger).description(error)).into_any_element());
                        }
                    }
                    if def.key == Some("keybindingPreset") {
                        children.extend(Self::preset_coverage_alert(cx));
                    }
                    if def.tab == "appearance" && def.label == "Custom Themes" {
                        children.extend(self.custom_theme_rows(cx));
                    }
                }
                let danger = tab == "advanced" && title == Some("Reset");
                elements.push(div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .children(title.map(|title| {
                        div()
                            .flex()
                            .items_center()
                            .min_h(px(24.))
                            .px(px(12.))
                            .text_size(typography::TEXT_SM)
                            .font_weight(typography::MEDIUM)
                            // A destructive zone's title reads in the destructive colour (`tone="danger"`).
                            .text_color(if danger { colors.destructive } else { colors.muted_foreground })
                            .child(title)
                    }))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .rounded(metrics::RADIUS_LG)
                            .bg(colors.background)
                            .shadow(shadow.clone())
                            .overflow_hidden()
                            .children(children),
                    )
                    .into_any_element());
                // The terminal's own profiles sit between Launch and Typography.
                if words.is_empty() && tab == "terminal" && title == Some("Launch") {
                    let profiles = self.terminal_profiles.get_or_insert_with(|| cx.new(TerminalProfiles::new)).clone();
                    elements.push(profiles.into_any_element());
                }
        }
        elements
    }

    /// The catalog of the Integrations page. It flows in the page and the page scrolls it; it
    /// used to sit in a 560px box with a scroller of its own inside the page's.
    fn integrations_view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Entity<extensions_ui::ExtensionsView> {
        let scroll = self.scroll.clone();
        self.integrations
            .get_or_insert_with(|| {
                let view = cx.new(|cx| extensions_ui::ExtensionsView::new(window, cx));
                view.update(cx, |view, cx| view.embed_in_page(scroll, cx));
                // The page draws the view's toolbar itself, so a filter or a search the view
                // takes has to redraw the page around it.
                cx.observe(&view, |_, _, cx| cx.notify()).detach();
                view
            })
            .clone()
    }

    /// The bar a page pins over its content, above the scroller so it stays in sight:
    /// Integrations' categories, updates and search.
    fn page_toolbar(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        if self.page != "integrations" || self.importer.is_some() {
            return None;
        }
        let view = self.integrations_view(window, cx);
        view.update(cx, |view, cx| view.page_toolbar(cx))
    }

    /// Opens an integration's page on Integrations; for previews.
    pub fn open_integration(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.set_page("integrations", cx);
        let view = self.integrations_view(window, cx);
        view.update(cx, |view, cx| view.open_extension(id, cx));
    }

    fn keybindings_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Entity<KeybindingsEditor> {
        self.keybindings.get_or_insert_with(|| cx.new(|cx| KeybindingsEditor::new(window, cx))).clone()
    }

    /// The views a page carries beyond its rows.
    fn page_views(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        match self.page {
            "keyboard" => vec![self.keybindings_editor(window, cx).into_any_element()],
            "ai" => {
                let scroll = self.scroll.clone();
                let view = self.ai.get_or_insert_with(|| {
                    let view = cx.new(|cx| agent_ui::AiSettingsView::new(window, cx));
                    // Integrations' reveal scrolls the Settings page itself.
                    view.update(cx, |view, _| view.set_page_scroll(scroll));
                    view
                });
                vec![view.clone().into_any_element()]
            }
            "account" => {
                let (account, sharing) = self.account.get_or_insert_with(|| {
                    (cx.new(account::AccountSettings::new), cx.new(collaboration::SharingSettings::new))
                });
                vec![account.clone().into_any_element(), sharing.clone().into_any_element()]
            }
            "team" => {
                let team = self.team.get_or_insert_with(|| cx.new(|cx| TeamSettings::new(window, cx)));
                vec![team.clone().into_any_element()]
            }
            "integrations" => vec![self.integrations_view(window, cx).into_any_element()],
            _ => Vec::new(),
        }
    }
}

impl Render for SettingsView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.settle_jump(cx);
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let searching = !self.query.trim().is_empty();
        // Narrow layouts (`ui/workbench.tsx` at 680px, `settings-section.tsx` at 640px): the
        // pages become a dropdown over the content, and rows stack their control under the label.
        let viewport = window.viewport_size();
        let width = if self.standalone { viewport.width } else { (viewport.width - px(64.)).min(px(1152.)) };
        let narrow = width <= px(680.);
        let content_width = if narrow { width - px(24.) } else { width - px(208.) - px(48.) };
        self.stacked = content_width <= px(640.);

        // The Team page is for accounts with a team or an enterprise plan.
        let team_access = account::AccountStore::global(cx)
            .and_then(|store| store.read(cx).subscription().cloned())
            .is_some_and(|subscription| subscription.enterprise.has_access || subscription.collaboration.as_ref().is_some_and(|team| team.enabled));
        if self.page == "team" && !team_access {
            self.page = "general";
        }
        let mut pages: Vec<&(&'static str, &'static str)> = SETTINGS_PAGES.iter().filter(|(id, _)| *id != "team" || team_access).collect();
        pages.sort_by_key(|(id, _)| NAVIGATION_ORDER.iter().position(|page| page == id).unwrap_or(NAVIGATION_ORDER.len()));
        let nav: Vec<AnyElement> = if searching {
            let results = self.search_results(cx);
            if results.is_empty() {
                vec![
                    div()
                        .px(px(8.))
                        .py(px(6.))
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.muted_foreground)
                        .child("No matching settings")
                        .into_any_element(),
                ]
            } else {
                results
                    .into_iter()
                    .map(|(index, def)| {
                        let description = match def.section {
                            Some(section) => format!("{} / {section}", page_title(def.tab)),
                            None => page_title(def.tab).to_string(),
                        };
                        SidebarListItem::new(("settings-result", index), def.label)
                            .in_content()
                            .description(description)
                            .active(self.flash == Some(index))
                            .on_click(cx.listener(move |this, _, _, cx| this.open_result(index, cx)))
                            .into_any_element()
                    })
                    .collect()
            }
        } else {
            pages
                .iter()
                .copied()
                .map(|(id, title)| {
                    let id: &'static str = id;
                    SidebarListItem::new(("settings-page", id.as_ptr() as usize), *title)
                        .in_content()
                        .leading(Icon::new(page_icon(id)).size(IconSize::Small).color(colors.subtle_foreground))
                        .active(self.page == id)
                        .on_click(cx.listener(move |this, _, _, cx| this.set_page(id, cx)))
                        .into_any_element()
                })
                .collect()
        };

        let page_dropdown = (narrow && !searching).then(|| {
            let current = self.page;
            let menu_key = "settings-pages".to_string();
            let options: Vec<(bool, String, String)> = pages.iter().map(|(id, title)| (*id == current, title.to_string(), id.to_string())).collect();
            let open = self.open_menu.as_ref().is_some_and(|menu| menu.key == menu_key);
            let weak = cx.weak_entity();
            let on_select: Rc<dyn Fn(String, &mut App)> = Rc::new(move |id: String, cx: &mut App| {
                if let Some(page) = known_page(&id) {
                    weak.update(cx, |this, cx| this.set_page(page, cx)).ok();
                }
            });
            Button::new("settings-page-dropdown", page_title(current))
                .variant(ButtonVariant::Default)
                .regular_weight()
                .full_width()
                .align_between()
                .leading_icon(page_icon(current))
                .trailing_icon(IconName::ChevronDown)
                .active(open)
                .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                    let position = event.position();
                    open_select_menu(this, menu_key.clone(), &options, on_select.clone(), point(position.x, position.y + px(10.)), window, cx);
                }))
        });
        let page_toolbar = self.page_toolbar(window, cx);
        let importing = self.importer.as_ref().map(|(importer, _)| importer.clone());
        let table_page = importing.is_none() && self.page == "keyboard" && self.keybindings.as_ref().is_some_and(|editor| editor.read(cx).is_editing());
        let mut content: Vec<AnyElement> = Vec::new();
        if let Some(importer) = &importing {
            content.push(importer.clone().into_any_element());
        } else {
            let page = self.page;
            let editing_keys = page == "keyboard" && self.keybindings_editor(window, cx).read(cx).is_editing();
            let current = settings::saved(cx).clone();
            let defs: Vec<(usize, &'static SettingDef)> = SETTING_DEFS
                .iter()
                .enumerate()
                .filter(|(_, def)| def.tab == page && settings::row_visible(def, &current))
                // The account and team views draw their own rows, and the keybinding editor its
                // Shortcuts section, or the whole page while editing.
                .filter(|(_, def)| drawn_as_row(def) && !(page == "keyboard" && editing_keys))
                .collect();
            content = self.render_sections(defs, &[], window, cx);
            let tracked_view = self.jump.as_ref().and_then(|jump| match jump.target {
                JumpTarget::View(view) => Some(view),
                JumpTarget::Row(_) => None,
            });
            let bounds = self.jump_bounds.clone();
            content.extend(self.page_views(window, cx).into_iter().enumerate().map(|(position, view)| {
                if tracked_view != Some(position) {
                    return view;
                }
                let bounds = bounds.clone();
                div()
                    .relative()
                    .child(view)
                    .child(canvas(move |view, _, _| bounds.set(Some(view)), |_, _, _, _| {}).absolute().size_full())
                    .into_any_element()
            }));
        }

        let title = "Import";

        div()
            .id("settings")
            .relative()
            .track_focus(&self.focus_handle)
            .occlude()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .flex()
            .when(narrow, |this| this.flex_col())
            .when(self.standalone, |this| this.size_full())
            .when(!self.standalone, |this| {
                this.w((window.viewport_size().width - px(64.)).min(px(1152.)))
                    .h((window.viewport_size().height - px(64.)).min(px(768.)))
                    .rounded(metrics::OVERLAY_RADIUS)
                    .shadow(theme.shadows.dialog.clone())
            })
            .overflow_hidden()
            .bg(colors.surface)
            .font_family(typography::UI_FONT)
            .text_color(colors.foreground)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_none()
                    .when(narrow, |this| this.w_full())
                    .when(!narrow, |this| this.w(px(208.)).h_full())
                    .p(px(8.))
                    // In its own window the sidebar runs to the top, under the traffic lights,
                    // on the window plane like the workbench's sidebar.
                    .when(self.standalone, |this| this.pt(STANDALONE_TOP))
                    .when(self.standalone && !narrow, |this| this.bg(colors.window))
                    .gap(px(12.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .when(!self.standalone, |this| this.child(
                                div()
                                    .flex()
                                    .items_center()
                                    .h(px(28.))
                                    .px(px(6.))
                                    .text_size(typography::TEXT_BASE)
                                    .font_weight(typography::MEDIUM)
                                    .child("Settings"),
                            ))
                            .child(self.search.clone())
                            .children(page_dropdown),
                    )
                    .when(!narrow || searching, |this| {
                        this.child(
                            div()
                                .id("settings-nav")
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_h_0()
                                .when(narrow, |this| this.max_h(px(240.)))
                                .gap(px(2.))
                                .overflow_y_scroll()
                                .children(nav)
                                .scrollbar_with(&self.nav_scroll),
                        )
                    }),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .when(importing.is_some(), |this| {
                        this.child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .h(metrics::PANE_HEADER)
                                .px(px(24.))
                                .text_size(typography::TEXT_BASE)
                                .font_weight(typography::MEDIUM)
                                .child(title),
                        )
                    })
                    .when(importing.is_none() || self.standalone, |this| {
                        this.pt(if self.standalone { STANDALONE_TOP } else if narrow { px(16.) } else { px(24.) })
                    })
                    .children(page_toolbar.map(|toolbar| {
                        div().flex().flex_none().px(if narrow { px(12.) } else { px(24.) }).pb(px(16.)).child(toolbar)
                    }))
                    .child(
                        // The page scrolls with the overlay scrollbar (`ScrollArea`).
                        div()
                            .relative()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_h_0()
                            .child(
                                div()
                                    .id("settings-content")
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_h_0()
                                    // The keybindings table scrolls by itself under its header,
                                    // so the page around it holds still.
                                    .when(!table_page, |this| this.overflow_y_scroll().track_scroll(&self.scroll).pb(px(40.)))
                                    .when(table_page, |this| this.pb(px(24.)))
                                    .px(if narrow { px(12.) } else { px(24.) })
                                    .gap(px(32.))
                                    .children(content),
                            )
                            .child(ui::Scrollbar::new("settings-scrollbar", &self.scroll)),
                    ),
            )
            .when(!self.standalone, |this| {
                this.child(
                    div().absolute().top(px(12.)).right(px(12.)).child(
                        Button::icon("settings-close", IconName::X)
                            .size(ButtonSize::Small)
                            .plane(Plane::Content)
                            .tooltip("Close")
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(DismissEvent))),
                    ),
                )
            })
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
            .children(self.theme_creator.as_ref().map(|(creator, _)| {
                div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(colors.scrim)
                    .child(creator.clone())
            }))
            .children(self.report_bug.as_ref().map(|(picker, _)| {
                div()
                    .absolute()
                    .top(px(64.))
                    .left_0()
                    .right_0()
                    .flex()
                    .justify_center()
                    .child(picker.clone())
            }))
            .children(self.font_picker.as_ref().map(|open| {
                deferred(
                    anchored()
                        .position(open.position)
                        .anchor(Anchor::TopRight)
                        .snap_to_window_with_margin(px(8.))
                        .child(div().mt(px(4.)).child(open.picker.clone())),
                )
                .with_priority(1)
            }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_matches_merge() {
        assert_eq!(match_ranges("Font Family", &["font"]), vec![0..4]);
        assert_eq!(match_ranges("Tab Size", &["ab", "tab"]), vec![0..3]);
        assert_eq!(match_ranges("Line Height", &["e"]), vec![3..4, 6..7]);
        assert!(match_ranges("Theme", &[]).is_empty());
    }

    #[test]
    fn search_scores_labels_over_descriptions_and_uses_keywords() {
        let def = |label: &str| SETTING_DEFS.iter().find(|def| def.label == label).unwrap();
        let font = def("Font Size");
        let family = def("Font Family");
        assert!(search_score("font size", font) > search_score("font size", family), "the label match ranks first");
        assert_eq!(search_score("font zebra", font), 0, "every word must match");
        assert!(search_score("fontsize", font) > 0, "compact text matches");
        let keyworded = SETTING_DEFS.iter().find(|def| !settings::search_keywords(def.label).is_empty()).unwrap();
        let keyword = settings::search_keywords(keyworded.label)[0];
        assert!(search_score(keyword, keyworded) > 0, "a keyword alone finds its row");
    }

    #[test]
    fn rows_drawn_by_views_are_searchable_and_gated() {
        let find = |label: &str| SETTING_DEFS.iter().find(|def| def.label == label).unwrap();
        let shortcut = find("Quick File Open");
        assert_eq!(shortcut.kind, SettingKind::View);
        assert!(search_score("quick file", shortcut) > 0);
        assert!(!drawn_as_row(shortcut), "search-only rows are not drawn");
        assert_eq!(view_target(shortcut), JumpTarget::View(0));
        assert_eq!(view_target(find("Shared Items")), JumpTarget::View(1), "sharing is the account page's second view");
        let accent = SETTING_DEFS.iter().position(|def| def.label == "Use System Accent Color").unwrap();
        assert_eq!(view_target(find("Color Scheme")), JumpTarget::Row(accent), "theme rows land on the Theme section");
        let managed = find("Managed Mode");
        assert!(!visible_with_access(managed, false, true) && visible_with_access(managed, true, false));
        assert!(!visible_with_access(find("Members"), true, false));
        assert!(visible_with_access(find("Version"), false, false));
    }

    #[test]
    fn multi_cursor_keys_are_named_for_the_platform() {
        let alt = option_label("editorMultiCursorModifier", "alt", "Alt");
        assert_eq!(alt, if cfg!(target_os = "macos") { "Option" } else { "Alt" });
        assert_eq!(option_label("theme", "dark", "Dark"), "Dark");
    }

    #[test]
    fn merged_pages_open_the_page_that_took_them() {
        assert_eq!(known_page("enterprise"), Some("team"));
        assert_eq!(known_page("sharing"), Some("account"));
        assert_eq!(known_page("editor"), Some("editor"));
        assert_eq!(known_page("nope"), None);
    }
}
