//! The composer's Agent settings menu and Effort slider: Mode, the agent's other session
//! options, Skills, Log out and Settings, and one wording for every agent's effort scale.
//!
//! Ported from Athas's `components/input/chat-preferences-menu.tsx`, `lib/effort-levels.ts`,
//! `lib/session-config-option-classifier.ts` and the `EffortSlider` of
//! `components/input/composer-model-submenus.tsx`.

use gpui::{AnyElement, Context, IntoElement, MouseButton, Pixels, Point, div, prelude::*, px};
use ui::{IconName, MenuEntry, MenuItem, MenuSize, Popover, StepSlider, StepSliderStep};

use crate::{
    composer_modes,
    session_view::{AgentState, SessionView},
    thread::ConfigOption,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OptionCategory {
    Model,
    ModelConfig,
    Mode,
    ThoughtLevel,
    Other,
}

fn has_word(text: &str, words: &[&str]) -> bool {
    text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| words.contains(&word))
}

/// Which composer control a session option belongs to: the agent's category when it names one,
/// else read from its id and name.
pub fn classify(option: &ConfigOption) -> OptionCategory {
    match option.category.as_deref() {
        Some("model") => return OptionCategory::Model,
        Some("model_config") => return OptionCategory::ModelConfig,
        Some("mode") => return OptionCategory::Mode,
        Some("thought_level") => return OptionCategory::ThoughtLevel,
        _ => {}
    }
    let text = format!("{} {}", option.id, option.name).to_lowercase();
    if has_word(&text, &["model", "models", "provider"]) {
        OptionCategory::Model
    } else if has_word(&text, &["mode", "profile"]) {
        OptionCategory::Mode
    } else if has_word(&text, &["thought", "reasoning", "thinking", "effort"]) {
        OptionCategory::ThoughtLevel
    } else {
        OptionCategory::Other
    }
}

fn normalize(value: &str) -> String {
    value.chars().filter(char::is_ascii_alphanumeric).collect::<String>().to_lowercase()
}

/// An effort that leaves the choice to the agent ("default", "auto") rather than a level.
pub fn is_auto_effort(value: &str) -> bool {
    matches!(normalize(value).as_str(), "default" | "auto")
}

fn known_effort(value: &str) -> Option<&'static str> {
    Some(match normalize(value).as_str() {
        "none" | "off" => "Off",
        "minimal" => "Minimal",
        "low" => "Low",
        "medium" | "med" => "Medium",
        "high" => "High",
        "xhigh" | "extrahigh" | "veryhigh" => "Extra high",
        "max" | "maximum" => "Max",
        _ => return None,
    })
}

/// One wording for every agent's effort scale: Codex says `xhigh`, Claude says `Xhigh`, both read
/// "Extra high"; the agent's own "default" reads "Auto". Unknown levels keep the agent's name.
pub fn effort_label(value: &str, name: &str) -> String {
    if is_auto_effort(value) {
        return "Auto".to_string();
    }
    if let Some(known) = known_effort(value).or_else(|| known_effort(name)) {
        return known.to_string();
    }
    let fallback = if name.trim().is_empty() { value.trim() } else { name.trim() };
    let mut chars = fallback.chars();
    chars.next().map(|first| first.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

impl SessionView {
    /// The Effort popover open over the composer, if any.
    pub(crate) fn render_effort_popover(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (position, option_id) = self.effort_popover.clone()?;
        let option = self.transcript.config_options.iter().find(|option| option.id == option_id)?;
        let steps: Vec<StepSliderStep> = option
            .choices
            .iter()
            .map(|choice| {
                let step = StepSliderStep::new(choice.value.clone(), effort_label(&choice.value, &choice.name));
                match &choice.description {
                    Some(description) => step.description(description.clone()),
                    None => step,
                }
            })
            .collect();
        let auto = steps.iter().find(|step| is_auto_effort(&step.value)).cloned();
        let steps: Vec<StepSliderStep> = steps.into_iter().filter(|step| !is_auto_effort(&step.value)).collect();
        let view = cx.entity();
        let id = option.id.clone();
        let mut slider = StepSlider::new("effort-slider", "Effort", steps, option.current.clone()).on_change(move |value, _, cx| {
            let id = id.clone();
            view.update(cx, |this, cx| this.set_config_option(id, value.to_string(), cx));
        });
        if let Some(auto) = auto {
            slider = slider.auto_step(auto);
        }
        if let Some(default) = &option.default {
            slider = slider.marked(default.clone(), "Default");
        }
        Some(
            ui::anchored_overlay(
                position,
                gpui::Anchor::BottomLeft,
                px(6.),
                div()
                    .on_mouse_down_out(cx.listener(|this, _, _, cx| {
                        this.effort_popover = None;
                        cx.notify();
                    }))
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .child(Popover::new().size(MenuSize::Default).list().child(div().py(px(2.)).child(slider))),
            )
            .into_any_element(),
        )
    }

    pub(crate) fn open_effort(&mut self, option_id: String, position: Point<Pixels>, cx: &mut Context<Self>) {
        self.open_menu = None;
        self.effort_popover = match &self.effort_popover {
            Some((_, open)) if *open == option_id => None,
            _ => Some((position, option_id)),
        };
        cx.notify();
    }

    /// Forgets the models and skills read before a sign-out (`clearCodexCatalog`).
    fn forget_stale_codex_catalog(&mut self) {
        let generation = crate::codex::catalog_generation();
        if self.codex_catalog != generation {
            self.codex_catalog = generation;
            self.codex_skills = None;
            self.codex_models_read = None;
        }
    }

    /// Asks Codex for its own skills (`skills/list`), once a session, or again when `force`.
    /// Codex starts first when it has not (`startCodexComposer`); start and read get 15 s.
    pub(crate) fn load_codex_skills(&mut self, force: bool, cx: &mut Context<Self>) {
        if !crate::codex::is_codex(&self.info.agent) || self.loading_codex_skills.is_some() {
            return;
        }
        self.forget_stale_codex_catalog();
        if (self.codex_skills.is_some() && !force) || matches!(self.agent, AgentState::NotInstalled { .. }) {
            return;
        }
        let timeout = cx.background_executor().timer(crate::codex::CATALOG_TIMEOUT);
        self.loading_codex_skills = Some(cx.spawn(async move |this, cx| {
            use futures::FutureExt as _;
            let answer = {
                let read = async {
                    let (connection, _) = Self::agent_connection(&this, cx).await?;
                    connection.ext_request(crate::codex::SKILLS_METHOD, serde_json::json!({ "force": force })).await.map_err(|error| error.message)
                }
                .fuse();
                let timeout = timeout.fuse();
                futures::pin_mut!(read, timeout);
                futures::select! {
                    answer = read => answer,
                    _ = timeout => Err(crate::codex::CATALOG_TIMEOUT_MESSAGE.to_string()),
                }
            };
            this.update(cx, |this, cx| {
                this.loading_codex_skills = None;
                this.codex_skills = Some(answer.map(|value| crate::codex::normalize_skills(&value)));
                this.refresh_open_preferences_menu(cx);
                cx.notify();
            })
            .ok();
        }));
    }

    /// Reads Codex's models again once the last read is older than 30 s, or when `force`
    /// (`useCodexModels`, `listCodexComposerModels`). Codex starts first when it has not
    /// (`startCodexComposer`); start and read get 15 s together. An open model menu shows the
    /// read's progress and the list it brings.
    pub(crate) fn refresh_codex_models(&mut self, force: bool, cx: &mut Context<Self>) {
        if !crate::codex::is_codex(&self.info.agent) || self.refreshing_codex_models.is_some() {
            return;
        }
        self.forget_stale_codex_catalog();
        if !force && self.codex_models_read.is_some_and(|read| read.elapsed() < crate::codex::CATALOG_STALE) {
            return;
        }
        if matches!(self.agent, AgentState::NotInstalled { .. }) {
            return;
        }
        let timeout = cx.background_executor().timer(crate::codex::CATALOG_TIMEOUT);
        self.codex_models_error = None;
        self.refreshing_codex_models = Some(cx.spawn(async move |this, cx| {
            use futures::FutureExt as _;
            let answer = {
                let read = async {
                    let (connection, opened) = Self::agent_connection(&this, cx).await?;
                    // A session that opened while we waited came with Codex's current models.
                    if opened && !force {
                        return Ok(None);
                    }
                    connection.ext_request(crate::codex::MODELS_METHOD, serde_json::json!({ "force": force })).await.map(Some).map_err(|error| error.message)
                }
                .fuse();
                let timeout = timeout.fuse();
                futures::pin_mut!(read, timeout);
                futures::select! {
                    answer = read => answer,
                    _ = timeout => Err(crate::codex::CATALOG_TIMEOUT_MESSAGE.to_string()),
                }
            };
            this.update(cx, |this, cx| {
                this.refreshing_codex_models = None;
                match answer {
                    Ok(value) => {
                        let options: Vec<crate::acp::schema::SessionConfigOption> =
                            value.and_then(|value| value.get("configOptions").cloned()).and_then(|options| serde_json::from_value(options).ok()).unwrap_or_default();
                        if !options.is_empty() {
                            this.transcript.config_options = options.into_iter().filter_map(crate::thread::ConfigOption::from_acp).collect();
                        }
                        this.codex_models_read = Some(web_time::Instant::now());
                    }
                    Err(error) => this.codex_models_error = Some(error),
                }
                this.refresh_open_model_menu(cx);
                cx.notify();
            })
            .ok();
        }));
        self.refresh_open_model_menu(cx);
    }

    /// The rows a Codex model menu ends with: Loading… while models are read again, or why the
    /// read failed with Retry.
    pub(crate) fn codex_model_status_rows(&self, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        if !crate::codex::is_codex(&self.info.agent) {
            return Vec::new();
        }
        if self.refreshing_codex_models.is_some() {
            return vec![MenuEntry::Separator, MenuEntry::Item(MenuItem::new("Loading models…").disabled(true))];
        }
        let Some(error) = &self.codex_models_error else { return Vec::new() };
        let view = cx.entity();
        vec![
            MenuEntry::Separator,
            MenuEntry::Item(MenuItem::new(error.clone()).icon(IconName::Warning).disabled(true)),
            MenuEntry::Item(MenuItem::new("Retry").icon(IconName::ArrowClockwise).keep_open().on_select(move |_, cx| {
                view.update(cx, |this, cx| this.refresh_codex_models(true, cx));
            })),
        ]
    }

    /// Codex's Skills submenu: its skills, inserted as `$name` (`CodexSkillsSubmenu`).
    fn codex_skills_item(&self, cx: &mut Context<Self>) -> MenuItem {
        let view = cx.entity();
        let mut rows: Vec<MenuEntry> = match &self.codex_skills {
            None if self.loading_codex_skills.is_some() || matches!(self.agent, AgentState::Ready(_) | AgentState::Starting) => vec![MenuEntry::Item(MenuItem::new("Loading skills…").disabled(true))],
            None => vec![MenuEntry::Item(MenuItem::new("Skills load once Codex has started").disabled(true))],
            Some(Err(error)) => vec![MenuEntry::Item(MenuItem::new("Could not load skills").icon(IconName::Warning).keywords(error.clone()).disabled(true))],
            Some(Ok((skills, errors))) if skills.is_empty() && !errors.is_empty() => {
                vec![MenuEntry::Item(MenuItem::new("Could not load skills").icon(IconName::Warning).keywords(errors.join("\n")).disabled(true))]
            }
            Some(Ok((skills, _))) if skills.is_empty() => vec![MenuEntry::Item(MenuItem::new("No Codex skills found").disabled(true))],
            Some(Ok((skills, errors))) => {
                let mut rows: Vec<MenuEntry> = skills
                    .iter()
                    .map(|skill| {
                        let (view, name) = (view.clone(), skill.name.clone());
                        let mut item = MenuItem::new(skill.name.clone()).keywords(skill.description.clone()).disabled(!skill.enabled).on_select(move |_, cx| {
                            let name = name.clone();
                            view.update(cx, |this, cx| this.insert_codex_skill(&name, cx));
                        });
                        if !skill.scope.is_empty() {
                            item = item.trailing_text(skill.scope.clone());
                        }
                        MenuEntry::Item(item)
                    })
                    .collect();
                if !errors.is_empty() {
                    rows.push(MenuEntry::Item(MenuItem::new("Some skills could not be loaded").icon(IconName::Warning).keywords(errors.join("\n")).disabled(true)));
                }
                rows
            }
        };
        if matches!(self.agent, AgentState::Ready(_)) || matches!(self.codex_skills, Some(Err(_))) {
            rows.push(MenuEntry::Separator);
            rows.push(MenuEntry::Item(MenuItem::new(if matches!(self.codex_skills, Some(Err(_))) { "Retry" } else { "Refresh skills" }).icon(IconName::ArrowClockwise).on_select(move |_, cx| {
                view.update(cx, |this, cx| this.load_codex_skills(true, cx));
            })));
        }
        MenuItem::new("Codex skills").icon(IconName::MagicWand).submenu(rows)
    }

    /// Puts `$name` at the composer's cursor, as Codex reads a skill.
    fn insert_codex_skill(&mut self, name: &str, cx: &mut Context<Self>) {
        self.composer.update(cx, |composer, cx| {
            let cursor = composer.cursor();
            let before = &composer.text()[..cursor];
            let space = if before.is_empty() || before.ends_with(char::is_whitespace) { "" } else { " " };
            composer.replace_range(cursor..cursor, &format!("{space}${name} "), cx);
        });
    }

    /// The Agent settings menu (`ChatPreferencesMenu`).
    pub(crate) fn open_preferences_menu(&mut self, position: Point<Pixels>, window: &mut gpui::Window, cx: &mut Context<Self>) {
        self.load_skills(cx);
        if self.transcript.config_options.iter().any(|option| option.category.as_deref() == Some("model")) {
            self.refresh_codex_models(false, cx);
        }
        let entries = self.agent_menu_entries(cx);
        self.effort_popover = None;
        self.show_menu_at("preferences", entries, position, window, cx);
    }

    /// An open Agent settings menu shows the Codex skills that just loaded.
    fn refresh_open_preferences_menu(&mut self, cx: &mut Context<Self>) {
        if self.open_menu.as_ref().is_none_or(|menu| menu.key != "preferences") {
            return;
        }
        let entries = self.agent_menu_entries(cx);
        if let Some(open) = &self.open_menu {
            open.menu.update(cx, |menu, cx| menu.set_entries(entries, cx));
        }
    }

    /// The agent picker's menu: which agent (fixed once the session has a conversation), then
    /// the session's settings.
    fn agent_menu_entries(&mut self, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let mut entries = if self.transcript.entries.is_empty() {
            self.agent_choice_entries(cx)
        } else {
            vec![
                MenuEntry::Label("Agent".into()),
                MenuEntry::Item(MenuItem::new(self.agent_name()).icon(crate::model_vendor::provider_icon(&self.info.agent)).checked(true).disabled(true)),
            ]
        };
        entries.push(MenuEntry::Separator);
        entries.extend(self.preferences_entries(cx));
        entries
    }

    fn preferences_entries(&mut self, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let view = cx.entity();
        let mut entries = vec![MenuEntry::Label("Session".into())];

        if crate::builtin::is_builtin(&self.info.agent) {
            let providers = self.provider_entries(cx);
            entries.push(MenuEntry::Item(MenuItem::new("Provider").icon(IconName::PlugsConnected).submenu(providers)));
        }
        let models: Vec<(String, String)> =
            self.transcript.config_options.iter().filter(|option| classify(option) == OptionCategory::Model && !option.choices.is_empty()).map(|option| (option.id.clone(), option.current_name().to_string())).collect();
        for (id, current) in models {
            let Some((rows, searchable)) = self.config_option_entries(&id, cx) else { continue };
            let mut item = MenuItem::new("Model").icon(IconName::Sparkle).trailing_text(current);
            if searchable {
                item = item.searchable_submenu("Search models…", "No matching models");
            }
            entries.push(MenuEntry::Item(item.submenu(rows)));
        }

        let (modes, target) = composer_modes::mode_options(&self.transcript);
        if modes.len() >= 2 {
            let current = match &target {
                composer_modes::ModeTarget::Mode => self.transcript.modes.as_ref().map(|modes| modes.current.clone()),
                composer_modes::ModeTarget::Config(id) => self.transcript.config_options.iter().find(|option| option.id == *id).map(|option| option.current.clone()),
            }
            .unwrap_or_default();
            let label = modes.iter().find(|mode| mode.id == current).map_or_else(String::new, |mode| mode.label.clone());
            let rows = modes
                .iter()
                .map(|mode| {
                    let (view, target, id) = (view.clone(), target.clone(), mode.id.clone());
                    MenuEntry::Item(MenuItem::new(mode.label.clone()).checked(mode.id == current).on_select(move |_, cx| {
                        let (target, id) = (target.clone(), id.clone());
                        view.update(cx, |this, cx| match target {
                            composer_modes::ModeTarget::Mode => this.set_mode(id, cx),
                            composer_modes::ModeTarget::Config(config) => this.set_config_option(config, id, cx),
                        });
                    }))
                })
                .collect();
            entries.push(MenuEntry::Item(MenuItem::new("Mode").icon(IconName::ChatBubbleText).trailing_text(label).submenu(rows)));
        }

        for option in self.transcript.config_options.iter().filter(|option| classify(option) == OptionCategory::ThoughtLevel && !option.choices.is_empty()) {
            let label_of = |value: &str, name: &str| effort_label(value, name);
            let current = option.choices.iter().find(|choice| choice.value == option.current).map_or_else(|| option.current_name().to_string(), |choice| label_of(&choice.value, &choice.name));
            let rows = option
                .choices
                .iter()
                .map(|choice| {
                    let (view, id, value) = (view.clone(), option.id.clone(), choice.value.clone());
                    MenuEntry::Item(MenuItem::new(label_of(&choice.value, &choice.name)).checked(choice.value == option.current).on_select(move |_, cx| {
                        let (id, value) = (id.clone(), value.clone());
                        view.update(cx, |this, cx| this.set_config_option(id, value, cx));
                    }))
                })
                .collect();
            entries.push(MenuEntry::Item(MenuItem::new("Effort").icon(IconName::Brain).trailing_text(current).submenu(rows)));
        }

        for option in self.transcript.config_options.iter().filter(|option| matches!(classify(option), OptionCategory::Other | OptionCategory::ModelConfig) && !option.choices.is_empty()) {
            let rows = option
                .choices
                .iter()
                .map(|choice| {
                    let (view, id, value) = (view.clone(), option.id.clone(), choice.value.clone());
                    MenuEntry::Item(MenuItem::new(choice.name.clone()).checked(choice.value == option.current).on_select(move |_, cx| {
                        let (id, value) = (id.clone(), value.clone());
                        view.update(cx, |this, cx| this.set_config_option(id, value, cx));
                    }))
                })
                .collect();
            entries.push(MenuEntry::Item(MenuItem::new(option.name.clone()).icon(IconName::Sliders).trailing_text(option.current_name().to_string()).submenu(rows)));
        }

        if crate::codex::is_codex(&self.info.agent) {
            self.load_codex_skills(false, cx);
            entries.push(MenuEntry::Item(self.codex_skills_item(cx)));
        }
        let skills = self.skills.clone();
        let skill_rows: Vec<MenuEntry> = match &skills {
            None => vec![MenuEntry::Item(MenuItem::new("Loading skills…").disabled(true))],
            Some(skills) if skills.is_empty() => vec![MenuEntry::Item(MenuItem::new("No skills yet").disabled(true))],
            Some(skills) => skills
                .iter()
                .map(|skill| {
                    let view = view.clone();
                    let chosen = skill.clone();
                    MenuEntry::Item(MenuItem::new(skill.title.clone()).keywords(skill.description.clone()).on_select(move |_, cx| {
                        view.update(cx, |this, cx| this.attach_skill(&chosen, cx));
                    }))
                })
                .collect(),
        };
        let mut skills_item = MenuItem::new("Skills").icon(IconName::MagicWand).submenu(skill_rows);
        if let Some(skills) = skills.as_ref().filter(|skills| !skills.is_empty()) {
            skills_item = skills_item.trailing_text(skills.len().to_string());
        }
        entries.push(MenuEntry::Item(skills_item));
        entries.push(MenuEntry::Separator);
        {
            let view = view.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new("Follow the agent")
                    .icon(IconName::Crosshair)
                    .keywords("Follow the agent's edits in the editor".to_string())
                    .checked(self.following)
                    .keep_open()
                    .on_select(move |_, cx| view.update(cx, |this, cx| this.toggle_follow(cx))),
            ));
        }
        entries.push(MenuEntry::Separator);

        if matches!(&self.agent, AgentState::Ready(agent) if agent.connection.supports_logout()) {
            let view = view.clone();
            entries.push(MenuEntry::Item(MenuItem::new("Log out of agent").icon(IconName::SignOut).on_select(move |_, cx| {
                view.update(cx, |this, cx| this.log_out_of_agent(cx));
            })));
        }
        entries.push(MenuEntry::Item(MenuItem::new("Settings…").icon(IconName::Settings).on_select(|_, cx| workbench_api::open_settings(cx, Some("ai"), None))));
        entries
    }

    /// Opens the composer's Effort slider or Agent settings menu over its bottom-left corner,
    /// for a screenshot.
    pub fn show_composer_menu(&mut self, which: &str, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let position = gpui::point(px(220.), window.viewport_size().height - px(70.));
        match which {
            "effort" => {
                if let Some(option) = self.transcript.config_options.iter().find(|option| classify(option) == OptionCategory::ThoughtLevel) {
                    let id = option.id.clone();
                    self.open_effort(id, position, cx);
                }
            }
            "environment" => self.open_environment_menu_at(position, window, cx),
            _ => self.open_preferences_menu(position, window, cx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(id: &str, name: &str, category: Option<&str>) -> ConfigOption {
        ConfigOption { id: id.into(), name: name.into(), category: category.map(str::to_string), current: String::new(), choices: Vec::new(), default: None }
    }

    #[test]
    fn options_are_sorted_into_their_controls() {
        assert_eq!(classify(&option("x", "X", Some("thought_level"))), OptionCategory::ThoughtLevel);
        assert_eq!(classify(&option("reasoning_effort", "Reasoning", None)), OptionCategory::ThoughtLevel);
        assert_eq!(classify(&option("model", "Model", None)), OptionCategory::Model);
        assert_eq!(classify(&option("approval", "Approval profile", None)), OptionCategory::Mode);
        assert_eq!(classify(&option("sandbox", "Sandbox", None)), OptionCategory::Other);
    }

    #[test]
    fn efforts_read_the_same_for_every_agent() {
        assert_eq!(effort_label("xhigh", "xhigh"), "Extra high");
        assert_eq!(effort_label("Xhigh", ""), "Extra high");
        assert_eq!(effort_label("default", "Default (medium)"), "Auto");
        assert_eq!(effort_label("med", ""), "Medium");
        assert_eq!(effort_label("turbo", "turbo"), "Turbo");
        assert!(is_auto_effort("Auto"));
    }
}
