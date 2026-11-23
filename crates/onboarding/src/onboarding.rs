//! The first-run welcome (`features/onboarding`): appearance, how you work, and a few last
//! choices, each saved to Settings as it is picked; and What's New, the running version's
//! release notes in the same pane.

pub mod contextual_tips;
pub mod release_notes;
pub mod whats_new;

use ui::WithScrollbar;
use ui::scale::px;
use gpui::{
    Anchor, AnyElement, App, Context, EventEmitter, FocusHandle, Focusable, Global, IntoElement, Render,
    SharedString, Window, div, point, prelude::*,
};
use serde_json::Value;
use theme::ActiveTheme;
use ui::{Button, ButtonVariant, IconName, MenuEntry, MenuItem, OpenMenu, Spinner, Switch, metrics, typography};
use whats_new::{WhatsNewInfo, WhatsNewStore};

/// Draws Appearance's colour scheme, interface style and theme choices, which the first step
/// shows as Settings does (`ColorSchemeChoices`, `InterfaceStyleChoices`, `ThemeChoices`).
pub struct AppearanceChoices(pub fn(&App) -> AnyElement);

impl Global for AppearanceChoices {}

/// The settings key that records a finished welcome.
pub const COMPLETED_KEY: &str = "gpuiOnboardingCompleted";

/// The Tauri app's record of the welcome (`product_onboarding_state_v1`), carried over with its
/// settings file.
const LEGACY_STATE_KEY: &str = "product_onboarding_state_v1";

/// Whether the welcome has been seen: finished here, or seen in the Tauri app before moving over
/// (`resolveOnboardingContextFromState` shows it only while `lastSeenVersion` is missing).
pub fn is_completed(cx: &App) -> bool {
    completed_in(&settings::get(cx).extra)
}

fn completed_in(extra: &std::collections::BTreeMap<String, Value>) -> bool {
    extra.get(COMPLETED_KEY).and_then(Value::as_bool).unwrap_or(false)
        || extra.get(LEGACY_STATE_KEY).and_then(|state| state.get("lastSeenVersion")).and_then(Value::as_str).is_some_and(|version| !version.is_empty())
}

#[derive(Clone, Debug, PartialEq)]
pub enum OnboardingEvent {
    /// The welcome is done; open a folder next when asked to.
    Finished { open_folder: bool },
}

gpui::actions!(onboarding, [
    /// "Import settings from another editor": Settings opens on its importer.
    ImportSettings
]);

struct Step {
    title: &'static str,
    description: &'static str,
}

const STEPS: [Step; 3] = [
    Step { title: "Welcome to Athas", description: "Choose a color scheme, window style and theme." },
    Step { title: "Set up how you work", description: "Bring over your keybindings and editor settings." },
    Step { title: "A few last choices", description: "You can change any of these later in Settings." },
];

const TELEMETRY_DESCRIPTION: &str = "Athas sends anonymous operational metadata for updates and, when enabled, heartbeats, integrations, and crashes; it never sends file paths, project names, prompts, or editor content.";

/// The running version's release notes, while they load and once they have.
struct ReleaseNotes {
    info: WhatsNewInfo,
    loading: bool,
}

pub struct OnboardingView {
    step: usize,
    release_notes: Option<ReleaseNotes>,
    cli_installed: Option<bool>,
    open_menu: Option<OpenMenu>,
    focus_handle: FocusHandle,
    /// Setup choices (telemetry, Vim mode, new windows, keybinding preset) are staged here and
    /// saved when the welcome finishes (`persistSelections`): each as the stored value it was
    /// chosen over, and the choice. A choice drops once the stored value changes elsewhere.
    staged: std::collections::BTreeMap<&'static str, (Value, Value)>,
}

impl EventEmitter<OnboardingEvent> for OnboardingView {}

impl Focusable for OnboardingView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

fn set(key: &'static str, value: Value, cx: &mut App) {
    settings::update(cx, |settings| {
        if let Err(error) = settings.set(key, value) {
            eprintln!("onboarding: {error:#}");
        }
    });
}

impl OnboardingView {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let observe = cx.observe_global::<settings::SettingsStore>(|_, cx| cx.notify());
        observe.detach();
        Self { step: 0, release_notes: None, cli_installed: cli_installed(), open_menu: None, focus_handle: cx.focus_handle(), staged: Default::default() }
    }

    /// What's New for `version`: the notes kept for it, completed from the update manifest or
    /// GitHub, and marked read.
    /// The notes already in hand, for a headless shot of the page (`ATHAS_SNAPSHOT_WHATS_NEW`).
    pub fn whats_new_with(info: WhatsNewInfo, cx: &mut Context<Self>) -> Self {
        let mut view = Self::new(cx);
        view.release_notes = Some(ReleaseNotes { info, loading: false });
        view
    }

    pub fn whats_new(version: &str, cx: &mut Context<Self>) -> Self {
        let store = WhatsNewStore::default_location();
        let info = store.hydrate(version);
        let mut view = Self::new(cx);
        view.release_notes = Some(ReleaseNotes { info: info.clone(), loading: true });
        let resolve = cx.background_spawn(async move {
            let resolved = whats_new::resolve(info);
            store.store_current(resolved.clone());
            store.mark_read(&resolved.version);
            resolved
        });
        cx.spawn(async move |this, cx| {
            let info = resolve.await;
            this.update(cx, |this, cx| {
                this.release_notes = Some(ReleaseNotes { info, loading: false });
                cx.notify();
            })
            .ok();
        })
        .detach();
        view
    }

    /// The tab's title: "What's New" for release notes, else "Welcome".
    pub fn title(&self) -> &'static str {
        if self.release_notes.is_some() { "What's New" } else { "Welcome" }
    }

    /// Closing the tab: the welcome counts as seen, but staged choices are dropped, as closing
    /// the original's tab does.
    pub fn close(&mut self, cx: &mut Context<Self>) {
        self.staged.clear();
        self.finish(false, cx);
    }

    fn finish(&mut self, open_folder: bool, cx: &mut Context<Self>) {
        if self.release_notes.is_none() {
            let staged = std::mem::take(&mut self.staged);
            settings::update(cx, |settings| {
                for (key, (base, chosen)) in staged {
                    if settings.get(key).as_ref() == Some(&base)
                        && let Err(error) = settings.set(key, chosen)
                    {
                        eprintln!("onboarding: {error:#}");
                    }
                }
                settings.extra.insert(COMPLETED_KEY.into(), Value::Bool(true));
            });
        }
        cx.emit(OnboardingEvent::Finished { open_folder });
    }

    /// A setup choice: the staged one while the stored value is still the one it was made over.
    fn choice(&self, key: &'static str, cx: &App) -> Option<Value> {
        let stored = settings::get(cx).get(key);
        match self.staged.get(key) {
            Some((base, chosen)) if stored.as_ref() == Some(base) => Some(chosen.clone()),
            _ => stored,
        }
    }

    fn stage(&mut self, key: &'static str, value: Value, cx: &mut Context<Self>) {
        let stored = settings::get(cx).get(key).unwrap_or(Value::Null);
        if stored == value {
            self.staged.remove(key);
        } else {
            self.staged.insert(key, (stored, value));
        }
        cx.notify();
    }

    fn staged_switch(&self, key: &'static str, cx: &mut Context<Self>) -> AnyElement {
        let checked = self.choice(key, cx).and_then(|value| value.as_bool()).unwrap_or(false);
        let weak = cx.weak_entity();
        Switch::new(key, checked)
            .on_change(move |checked, _, cx| {
                weak.update(cx, |this, cx| this.stage(key, Value::Bool(checked), cx)).ok();
            })
            .into_any_element()
    }

    fn render_release_notes(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(notes) = &self.release_notes else { return div().into_any_element() };
        if notes.loading && !notes.info.body.as_deref().is_some_and(|body| !body.trim().is_empty()) {
            return div()
                .flex()
                .justify_center()
                .items_center()
                .min_h(px(96.))
                .child(Spinner::new("release-notes-loading").label("Loading release notes").show_label())
                .into_any_element();
        }
        release_notes::render(&whats_new::build_release_notes_markdown(&notes.info), cx)
    }

    /// One of Auto, Light and Dark: a small preview of the scheme over its name.
    fn scheme_choice(&self, id: &'static str, label: &'static str, active: bool, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let registry = theme::registry(cx);
        let preview = |theme_id: &str| registry.get(theme_id).map(|theme| (theme.colors.surface, theme.colors.background, theme.colors.foreground));
        let (left, right) = match id {
            "light" => (preview("athas-light"), preview("athas-light")),
            "dark" => (preview("athas-dark"), preview("athas-dark")),
            _ => (preview("athas-light"), preview("athas-dark")),
        };
        let half = |colors: Option<(gpui::Hsla, gpui::Hsla, gpui::Hsla)>| {
            let (surface, background, foreground) = colors.unwrap_or((gpui::black(), gpui::black(), gpui::white()));
            div()
                .flex_1()
                .h_full()
                .bg(surface)
                .pt(px(10.))
                .pl(px(10.))
                .child(
                    div()
                        .size_full()
                        .rounded_tl(metrics::radius_md())
                        .bg(background)
                        .p(px(6.))
                        .child(div().w(px(28.)).h(px(4.)).rounded_full().bg(foreground.opacity(0.4))),
                )
        };
        div()
            .id(id)
            .flex()
            .flex_col()
            .items_center()
            .gap(px(6.))
            .child(
                div()
                    .flex()
                    .w(px(112.))
                    .h(px(72.))
                    .rounded(metrics::radius_lg())
                    .overflow_hidden()
                    .border_2()
                    .border_color(if active { colors.primary } else { colors.edge })
                    .child(half(left))
                    .child(half(right)),
            )
            .child(
                div()
                    .text_size(typography::text_sm())
                    .text_color(if active { colors.foreground } else { colors.muted_foreground })
                    .child(label),
            )
            .on_click(move |_, _, cx| match id {
                "auto" => set("syncSystemTheme", Value::Bool(true), cx),
                "light" => {
                    let theme = settings::get(cx).auto_theme_light.clone();
                    settings::update(cx, |settings| {
                        settings.sync_system_theme = false;
                        settings.theme = theme;
                    });
                }
                _ => {
                    let theme = settings::get(cx).auto_theme_dark.clone();
                    settings::update(cx, |settings| {
                        settings.sync_system_theme = false;
                        settings.theme = theme;
                    });
                }
            })
            .into_any_element()
    }

    /// A row with a label and a dropdown of the themes of one appearance.
    fn theme_select(&self, label: &'static str, key: &'static str, dark: bool, cx: &mut Context<Self>) -> AnyElement {
        let current = settings::get(cx).get(key).and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
        let registry = theme::registry(cx);
        let name = registry.get(&current).map_or(current.clone(), |theme| theme.name.clone());
        let menu_key = format!("onboarding-theme:{key}");
        let open = self.open_menu.as_ref().is_some_and(|menu| menu.key == menu_key);
        self.row(
            label,
            None,
            Button::new(SharedString::from(menu_key.clone()), name)
                .variant(ButtonVariant::Outline)
                .regular_weight()
                .trailing_icon(IconName::ChevronDown)
                .active(open)
                .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                    let entries = theme::registry(cx)
                        .themes()
                        .iter()
                        .filter(|theme| theme.appearance.is_dark() == dark)
                        .map(|theme| {
                            let id = theme.id.clone();
                            MenuEntry::from(
                                MenuItem::new(theme.name.clone())
                                    .checked(theme.id == current)
                                    .on_select(move |_, cx| {
                                        set(key, Value::String(id.clone()), cx);
                                        if !settings::get(cx).sync_system_theme {
                                            set("theme", Value::String(id.clone()), cx);
                                        }
                                    }),
                            )
                        })
                        .collect();
                    let position = event.position();
                    this.open_menu = Some(OpenMenu::new(
                        menu_key.clone(),
                        entries,
                        point(position.x, position.y + px(10.)),
                        Anchor::TopRight,
                        window,
                        cx,
                        |this: &mut Self, _| this.open_menu = None,
                    ));
                    cx.notify();
                }))
                .into_any_element(),
            cx,
        )
    }

    fn row(&self, label: &'static str, description: Option<&'static str>, control: AnyElement, cx: &App) -> AnyElement {
        let description = description.map(|description| div().child(description).into_any_element());
        self.row_with(label, description, control, cx)
    }

    /// A row whose description is an element, such as text with a link after it.
    fn row_with(&self, label: &'static str, description: Option<AnyElement>, control: AnyElement, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(24.))
            .min_h(px(44.))
            .py(px(10.))
            .px(px(12.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    // Without it the column keeps its text's full width, and a long description
                    // runs past the card instead of wrapping.
                    .min_w_0()
                    .gap(px(2.))
                    .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child(label))
                    .children(description.map(|description| {
                        div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(description)
                    })),
            )
            .child(div().flex_none().child(control))
            .into_any_element()
    }

    /// The telemetry switch, its description ending in "Learn more" (the telemetry docs).
    fn telemetry_row(&self, cx: &mut Context<Self>) -> AnyElement {
        let control = self.staged_switch("telemetry", cx);
        let primary = cx.theme().colors.primary;
        let description = div()
            .child(format!("{TELEMETRY_DESCRIPTION} "))
            .child(
                div()
                    .id("telemetry-learn-more")
                    .text_color(primary)
                    .hover(|style| style.underline())
                    .child("Learn more")
                    .on_click(|_, _, cx| cx.open_url(&account::ServiceUrls::from_env().telemetry_docs())),
            )
            .into_any_element();
        self.row_with("Share anonymous telemetry", Some(description), control, cx)
    }

    fn toggle_row(&self, label: &'static str, description: Option<&'static str>, key: &'static str, cx: &mut Context<Self>) -> AnyElement {
        let control = self.staged_switch(key, cx);
        self.row(label, description, control, cx)
    }

    fn card(&self, rows: Vec<AnyElement>, cx: &App) -> AnyElement {
        let theme = cx.theme();
        div()
            .flex()
            .flex_col()
            .rounded(metrics::radius_lg())
            .bg(theme.colors.raised)
            .shadow(theme.shadows.raised.clone())
            .children(rows)
            .into_any_element()
    }

    fn render_step(&mut self, cx: &mut Context<Self>) -> AnyElement {
        match self.step {
            0 if let Some(choices) = cx.try_global::<AppearanceChoices>().map(|choices| choices.0) => choices(cx),
            0 => {
                let sync = settings::get(cx).sync_system_theme;
                let dark = cx.theme().appearance.is_dark();
                let schemes = div()
                    .flex()
                    .gap(px(16.))
                    .px(px(12.))
                    .py(px(12.))
                    .child(self.scheme_choice("auto", "Auto", sync, cx))
                    .child(self.scheme_choice("light", "Light", !sync && !dark, cx))
                    .child(self.scheme_choice("dark", "Dark", !sync && dark, cx))
                    .into_any_element();
                let mut rows = vec![schemes];
                if sync {
                    rows.push(self.theme_select("Light Theme", "autoThemeLight", false, cx));
                    rows.push(self.theme_select("Dark Theme", "autoThemeDark", true, cx));
                } else {
                    rows.push(self.theme_select("Theme", if dark { "autoThemeDark" } else { "autoThemeLight" }, dark, cx));
                }
                self.card(rows, cx)
            }
            1 => {
                let preset = self.choice("keybindingPreset", cx).and_then(|value| value.as_str().map(str::to_string)).unwrap_or_default();
                let presets = keymap::presets();
                let description = presets.get(&preset).map(|p| p.description.clone());
                let label = presets.get(&preset).map_or(preset.clone(), |p| p.label.clone());
                let menu_key = "onboarding-preset".to_string();
                let open = self.open_menu.as_ref().is_some_and(|menu| menu.key == menu_key);
                let select = Button::new("onboarding-preset", label)
                    .variant(ButtonVariant::Outline)
                    .regular_weight()
                    .trailing_icon(IconName::ChevronDown)
                    .active(open)
                    .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                        let mut ids: Vec<&String> = keymap::presets().keys().collect();
                        ids.sort_by_key(|id| if id.as_str() == "none" { String::new() } else { (*id).clone() });
                        let current = this.choice("keybindingPreset", cx).and_then(|value| value.as_str().map(str::to_string)).unwrap_or_default();
                        let weak = cx.weak_entity();
                        let entries = ids
                            .into_iter()
                            .map(|id| {
                                let preset = &keymap::presets()[id];
                                let value = id.clone();
                                let weak = weak.clone();
                                MenuEntry::from(
                                    MenuItem::new(preset.label.clone())
                                        .checked(*id == current)
                                        .on_select(move |_, cx| {
                                            weak.update(cx, |this, cx| this.stage("keybindingPreset", Value::String(value.clone()), cx)).ok();
                                        }),
                                )
                            })
                            .collect();
                        let position = event.position();
                        this.open_menu = Some(OpenMenu::new(
                            menu_key.clone(),
                            entries,
                            point(position.x, position.y + px(10.)),
                            Anchor::TopRight,
                            window,
                            cx,
                            |this: &mut Self, _| this.open_menu = None,
                        ));
                        cx.notify();
                    }))
                    .into_any_element();
                let mut preset_row = self.row("Keybinding preset", None, select, cx);
                if let Some(description) = description {
                    let colors = cx.theme().colors.clone();
                    preset_row = div()
                        .flex()
                        .flex_col()
                        .child(preset_row)
                        .child(
                            div()
                                .px(px(12.))
                                .pb(px(10.))
                                .text_size(typography::text_caption())
                                .text_color(colors.subtle_foreground)
                                .child(description),
                        )
                        .into_any_element();
                }
                let import = Button::new("onboarding-import", "Import")
                    .on_click(|_, window, cx| window.dispatch_action(Box::new(ImportSettings), cx))
                    .into_any_element();
                let import = self.row("Import settings from another editor", Some("VS Code, Cursor, Windsurf, Zed, or JetBrains."), import, cx);
                let vim = self.toggle_row("Enable Vim mode", None, "vimMode", cx);
                let mut rows = vec![import, preset_row, vim];
                if self.cli_installed == Some(false) {
                    let install = Button::new("onboarding-install-cli", "Install")
                        .on_click(cx.listener(|this, _, window, cx| {
                            if let Some(action) = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action("cli.installTerminalCommand")) {
                                window.dispatch_action(action, cx);
                            }
                            this.cli_installed = cli_installed();
                            cx.notify();
                        }))
                        .into_any_element();
                    rows.push(self.row("Install the athas command", Some("Run athas . in a terminal to open the current folder."), install, cx));
                }
                self.card(rows, cx)
            }
            _ => {
                let telemetry = self.telemetry_row(cx);
                let windows = self.toggle_row("Open folders in a new window", None, "openFoldersInNewWindow", cx);
                self.card(vec![telemetry, windows], cx)
            }
        }
    }
}

fn cli_installed() -> Option<bool> {
    #[cfg(not(target_family = "wasm"))]
    return Some(matches!(cli::install::state_for_current_user(), cli::install::CliInstallState::Installed(_)));
    #[cfg(target_family = "wasm")]
    None
}

impl OnboardingView {
    /// What's New: a release, read top to bottom. The notes sit in a card of their own, under a
    /// heading that says which version and when, with the way out and the full release at the
    /// foot — where the eye ends up, rather than floating under a short page.
    fn render_whats_new(&mut self, info: &WhatsNewInfo, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let released = info.date.as_deref().map(whats_new::format_release_date);
        let version = info.version.clone();
        let release_url = format!("{}/tag/v{version}", whats_new::GITHUB_RELEASES_URL);
        let loading = self.release_notes.as_ref().is_some_and(|notes| notes.loading) && !has_notes(info);

        let eyebrow = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(
                div()
                    .flex_none()
                    .px(px(8.))
                    .py(px(2.))
                    .rounded_full()
                    .bg(colors.primary_soft)
                    .text_size(typography::text_caption())
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.primary)
                    .child(format!("Athas {version}")),
            )
            .children(released.map(|date| {
                div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(date)
            }));

        let body = if loading {
            div()
                .flex()
                .justify_center()
                .items_center()
                .min_h(px(120.))
                .child(Spinner::new("release-notes-loading").label("Loading release notes").show_label())
                .into_any_element()
        } else if has_notes(info) {
            div()
                .flex()
                .flex_col()
                .p(px(20.))
                .rounded(metrics::radius_lg())
                .bg(colors.raised)
                .child(release_notes::render(&whats_new::normalize_release_notes(info.body.as_deref().unwrap_or_default()), cx))
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(4.))
                .py(px(40.))
                .rounded(metrics::radius_lg())
                .bg(colors.raised)
                .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child("No notes came with this update"))
                .child(
                    div()
                        .text_size(typography::text_sm())
                        .text_color(colors.subtle_foreground)
                        .child("The GitHub release has the downloads and the full changelog."),
                )
                .into_any_element()
        };

        div()
            .id("whats-new")
            .track_focus(&self.focus_handle)
            .size_full()
            .overflow_y_scroll()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .mx_auto()
                    .w_full()
                    .max_w(px(720.))
                    .px(px(32.))
                    .py(px(48.))
                    .gap(px(24.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .child(eyebrow)
                            .child(
                                div()
                                    .text_size(typography::text_lg())
                                    .font_weight(typography::SEMIBOLD)
                                    .text_color(colors.foreground)
                                    .child("What's new"),
                            ),
                    )
                    .child(body)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                Button::new("whats-new-release", "View the full release")
                                    .variant(ButtonVariant::Ghost)
                                    .trailing_icon(IconName::ArrowRight)
                                    .on_click(move |_, _, cx| cx.open_url(&release_url)),
                            )
                            .child(div().flex_1())
                            .child(
                                Button::new("onboarding-done", "Done")
                                    .variant(ButtonVariant::Accent)
                                    .on_click(cx.listener(|this, _, _, cx| this.finish(false, cx))),
                            ),
                    ),
            )
            .scrollbar(window, cx)
            .into_any_element()
    }
}

/// Whether a release came with notes to show.
fn has_notes(info: &WhatsNewInfo) -> bool {
    info.body.as_deref().is_some_and(|body| !body.trim().is_empty())
}

impl Render for OnboardingView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let release = self.release_notes.as_ref().map(|notes| notes.info.clone());
        if let Some(info) = &release {
            return self.render_whats_new(info, window, cx).into_any_element();
        }
        let (title, description) = match &release {
            Some(info) => (SharedString::from(format!("What's new in Athas {}", info.version)), SharedString::from("The latest changes, improvements, and fixes.")),
            None => (STEPS[self.step].title.into(), STEPS[self.step].description.into()),
        };
        let released = release.as_ref().and_then(|info| info.date.as_deref()).map(whats_new::format_release_date);
        let last = release.is_some() || self.step + 1 == STEPS.len();
        let body = if release.is_some() { self.render_release_notes(cx) } else { self.render_step(cx) };
        let dots = (release.is_none()).then(|| {
            div().flex().gap(px(6.)).mb(px(8.)).children((0..STEPS.len()).map(|index| {
                div().w(px(24.)).h(px(4.)).rounded_full().bg(if index <= self.step { colors.primary } else { colors.selected })
            }))
        });
        let mut buttons: Vec<AnyElement> = Vec::new();
        if self.step > 0 {
            buttons.push(
                Button::icon("onboarding-back", IconName::ArrowLeft)
                    .variant(ButtonVariant::Ghost)
                    .tooltip("Back")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.step -= 1;
                        cx.notify();
                    }))
                    .into_any_element(),
            );
        }
        if release.is_some() {
            buttons.push(Button::new("onboarding-done", "Done").variant(ButtonVariant::Accent).on_click(cx.listener(|this, _, _, cx| this.finish(false, cx))).into_any_element());
        } else if last {
            buttons.push(Button::new("onboarding-done", "Done").variant(ButtonVariant::Ghost).on_click(cx.listener(|this, _, _, cx| this.finish(false, cx))).into_any_element());
            buttons.push(
                Button::new("onboarding-open-folder", "Open Folder")
                    .variant(ButtonVariant::Accent)
                    .leading_icon(IconName::FolderOpen)
                    .on_click(cx.listener(|this, _, _, cx| this.finish(true, cx)))
                    .into_any_element(),
            );
        } else {
            buttons.push(Button::new("onboarding-skip", "Skip").variant(ButtonVariant::Ghost).on_click(cx.listener(|this, _, _, cx| this.finish(false, cx))).into_any_element());
            if self.step == 0 {
                buttons.push(
                    Button::new("onboarding-open-folder", "Open Folder…")
                        .leading_icon(IconName::FolderOpen)
                        .on_click(cx.listener(|this, _, _, cx| this.finish(true, cx)))
                        .into_any_element(),
                );
            }
            buttons.push(
                Button::new("onboarding-continue", "Continue")
                    .variant(ButtonVariant::Accent)
                    .trailing_icon(IconName::ArrowRight)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.step += 1;
                        cx.notify();
                    }))
                    .into_any_element(),
            );
        }
        div()
            .id("onboarding")
            .track_focus(&self.focus_handle)
            .size_full()
            .overflow_y_scroll()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .mx_auto()
                    .w_full()
                    .max_w(px(720.))
                    .px(px(32.))
                    .py(px(48.))
                    .gap(px(32.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(px(8.))
                            .text_center()
                            .children(dots)
                            .child(div().text_size(typography::text_lg()).font_weight(typography::SEMIBOLD).text_color(colors.foreground).child(title))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .justify_center()
                                    .gap_x(px(8.))
                                    .text_size(typography::text_sm())
                                    .text_color(colors.muted_foreground)
                                    .child(description)
                                    .when_some(released, |this, date| this.child("·").child(format!("Released {date}"))),
                            ),
                    )
                    .child(body)
                    .child(div().flex().justify_center().items_center().gap(px(8.)).children(buttons)),
            )
            .scrollbar(window, cx)
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_welcome_seen_in_the_tauri_app_counts_as_completed() {
        let mut extra = std::collections::BTreeMap::new();
        assert!(!completed_in(&extra));
        extra.insert(LEGACY_STATE_KEY.into(), serde_json::json!({}));
        assert!(!completed_in(&extra), "no lastSeenVersion: still first run");
        extra.insert(LEGACY_STATE_KEY.into(), serde_json::json!({ "lastSeenVersion": "0.16.0" }));
        assert!(completed_in(&extra));
        let mut finished = std::collections::BTreeMap::new();
        finished.insert(COMPLETED_KEY.into(), Value::Bool(true));
        assert!(completed_in(&finished));
    }
}
