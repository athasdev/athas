//! Settings > Terminal > Profiles (`tabs/terminal-settings.tsx`, `terminal/stores/profiles.store.ts`):
//! the user's own ways to start a terminal, each with a name, a shell, a startup directory and
//! startup commands, saved under `terminalProfiles` where the terminal reads them.

use std::collections::HashMap;

use gpui::{App, Context, Entity, SharedString, Subscription, Window, div, prelude::*, px};
use serde_json::{Map, Value};
use theme::ActiveTheme;
use ui::{Button, ButtonTone, ButtonVariant, IconName, OpenMenu, TextArea, TextAreaEvent, TextInput, TextInputEvent, metrics, typography};

use crate::{MenuOwner, select_button};

pub const PROFILES_KEY: &str = "terminalProfiles";
const DEFAULT_SHELL: &str = "system";

/// The user's profiles as `settings.json` keeps them.
pub fn profiles(cx: &App) -> Vec<Map<String, Value>> {
    settings::get(cx)
        .extra
        .get(PROFILES_KEY)
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(|item| item.as_object().cloned()).filter(|profile| profile.get("id").and_then(Value::as_str).is_some_and(|id| !id.is_empty())).collect())
        .unwrap_or_default()
}

fn save(profiles: Vec<Map<String, Value>>, cx: &mut App) {
    settings::update(cx, |settings| {
        settings.extra.insert(PROFILES_KEY.into(), Value::Array(profiles.into_iter().map(Value::Object).collect()));
    });
}

fn text(profile: &Map<String, Value>, field: &str) -> String {
    profile.get(field).and_then(Value::as_str).unwrap_or_default().to_string()
}

/// `addProfile`: a new profile with a fresh id.
pub fn add_profile(cx: &mut App) {
    let mut all = profiles(cx);
    let millis = web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map(|elapsed| elapsed.as_millis()).unwrap_or_default();
    let suffix: String = format!("{:x}", millis.wrapping_mul(2654435761) ^ (all.len() as u128 + 1)).chars().rev().take(9).collect();
    let mut profile = Map::new();
    profile.insert("id".into(), Value::String(format!("profile_{millis}_{suffix}")));
    profile.insert("name".into(), Value::String(format!("Custom Profile {}", all.len() + 1)));
    let shell = settings::get(cx).terminal_default_shell_id.clone();
    if !shell.is_empty() {
        profile.insert("shell".into(), Value::String(shell));
    }
    profile.insert("startupCommands".into(), Value::Array(Vec::new()));
    all.push(profile);
    save(all, cx);
}

/// `updateProfile`: sets one field, or removes it for `None`.
pub fn update_profile(id: &str, field: &str, value: Option<Value>, cx: &mut App) {
    let mut all = profiles(cx);
    if let Some(profile) = all.iter_mut().find(|profile| profile.get("id").and_then(Value::as_str) == Some(id)) {
        match value {
            Some(value) => profile.insert(field.into(), value),
            None => profile.remove(field),
        };
    }
    save(all, cx);
}

pub fn delete_profile(id: &str, cx: &mut App) {
    let mut all = profiles(cx);
    all.retain(|profile| profile.get("id").and_then(Value::as_str) != Some(id));
    save(all, cx);
}

/// The fields of one profile, kept so typing is not lost between frames.
struct ProfileFields {
    name: Entity<TextInput>,
    directory: Entity<TextInput>,
    commands: Entity<TextArea>,
    _subscriptions: Vec<Subscription>,
}

pub struct TerminalProfiles {
    fields: HashMap<String, ProfileFields>,
    shells: Vec<terminal_view::Shell>,
    open_menu: Option<OpenMenu>,
    _observe: Subscription,
}

impl MenuOwner for TerminalProfiles {
    fn menu_slot(&mut self) -> &mut Option<OpenMenu> {
        &mut self.open_menu
    }
}

impl TerminalProfiles {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let observe = cx.observe_global::<settings::SettingsStore>(|_, cx| cx.notify());
        Self { fields: HashMap::new(), shells: terminal_view::available_shells(), open_menu: None, _observe: observe }
    }

    fn fields(&mut self, profile: &Map<String, Value>, window: &mut Window, cx: &mut Context<Self>) -> &ProfileFields {
        let id = text(profile, "id");
        if !self.fields.contains_key(&id) {
            let name = cx.new(|cx| {
                let mut input = TextInput::new(window, cx).placeholder("My Profile");
                input.set_text(text(profile, "name"), cx);
                input
            });
            let directory = cx.new(|cx| {
                let mut input = TextInput::new(window, cx).placeholder("Workspace directory");
                input.set_text(text(profile, "startupDirectory"), cx);
                input
            });
            let commands = cx.new(|cx| {
                let mut area = TextArea::new(cx).rows(3).placeholder("One command per line");
                let lines: Vec<String> = profile
                    .get("startupCommands")
                    .and_then(Value::as_array)
                    .map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect())
                    .unwrap_or_default();
                area.set_text(lines.join("\n"), cx);
                area
            });
            let name_id = id.clone();
            let directory_id = id.clone();
            let commands_id = id.clone();
            let subscriptions = vec![
                cx.subscribe(&name, move |_, _, event: &TextInputEvent, cx| {
                    if let TextInputEvent::Changed(value) = event {
                        update_profile(&name_id, "name", Some(Value::String(value.to_string())), cx);
                    }
                }),
                cx.subscribe(&directory, move |_, _, event: &TextInputEvent, cx| {
                    if let TextInputEvent::Changed(value) = event {
                        let value = (!value.is_empty()).then(|| Value::String(value.to_string()));
                        update_profile(&directory_id, "startupDirectory", value, cx);
                    }
                }),
                cx.subscribe(&commands, move |_, area, event: &TextAreaEvent, cx| {
                    if let TextAreaEvent::Changed = event {
                        let lines = area.read(cx).text().lines().map(str::trim).filter(|line| !line.is_empty()).map(|line| Value::String(line.to_string())).collect();
                        update_profile(&commands_id, "startupCommands", Some(Value::Array(lines)), cx);
                    }
                }),
            ];
            self.fields.insert(id.clone(), ProfileFields { name, directory, commands, _subscriptions: subscriptions });
        }
        &self.fields[&id]
    }

    fn label(text: &'static str, cx: &App) -> impl IntoElement {
        div().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(cx.theme().colors.foreground).child(text)
    }

    /// The Profiles section: its header with Add Profile, then a block per profile.
    fn render_section(&mut self, window: &mut Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let colors = cx.theme().colors.clone();
        let all = profiles(cx);
        self.fields.retain(|id, _| all.iter().any(|profile| text(profile, "id") == *id));
        let mut blocks = Vec::new();
        for (index, profile) in all.iter().enumerate() {
            let id = text(profile, "id");
            let name = text(profile, "name");
            let shell = profile.get("shell").and_then(Value::as_str).unwrap_or(DEFAULT_SHELL).to_string();
            let shell_label = if shell == DEFAULT_SHELL {
                "System Default".to_string()
            } else {
                self.shells.iter().find(|candidate| candidate.id == shell).map_or(shell.clone(), |candidate| candidate.name.clone())
            };
            let mut options: Vec<(String, String)> = vec![(DEFAULT_SHELL.into(), "System Default".into())];
            options.extend(self.shells.iter().map(|shell| (shell.id.clone(), shell.name.clone())));
            let fields = self.fields(profile, window, cx);
            let (name_input, directory_input, commands_area) = (fields.name.clone(), fields.directory.clone(), fields.commands.clone());
            let delete_id = id.clone();
            let shell_id = id.clone();
            let menu_key = format!("terminal-profile-shell:{id}");
            let shell_button = select_button(
                SharedString::from(format!("terminal-profile-shell-{index}")),
                shell_label,
                menu_key,
                options.into_iter().map(|(value, label)| (value == shell, label, value)).collect(),
                std::rc::Rc::new(move |value: String, cx: &mut App| {
                    let value = (value != DEFAULT_SHELL).then(|| Value::String(value));
                    update_profile(&shell_id, "shell", value, cx);
                }),
                false,
                true,
                cx,
            );
            blocks.push(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .px(px(12.))
                    .py(px(10.))
                    .when(index > 0, |this| this.child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider)))
                    .child(
                        div()
                            .flex()
                            .items_start()
                            .justify_between()
                            .gap(px(12.))
                            .child(div().flex_1().min_w_0().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.foreground).child(name.clone()))
                            .child(
                                Button::icon(("terminal-profile-delete", index), IconName::Trash)
                                    .variant(ButtonVariant::Ghost)
                                    .tone(ButtonTone::Danger)
                                    .tooltip(format!("Delete {name}"))
                                    .on_click(move |_, _, cx| delete_profile(&delete_id, cx)),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .gap(px(12.))
                            .child(div().flex().flex_col().gap(px(6.)).flex_1().child(Self::label("Name", cx)).child(name_input))
                            .child(div().flex().flex_col().gap(px(6.)).flex_1().child(Self::label("Shell", cx)).child(shell_button)),
                    )
                    .child(div().flex().flex_col().gap(px(6.)).child(Self::label("Startup Directory", cx)).child(directory_input))
                    .child(div().flex().flex_col().gap(px(6.)).child(Self::label("Startup Commands", cx)).child(commands_area))
                    .into_any_element(),
            );
        }
        if blocks.is_empty() {
            blocks.push(
                // `EmptyState variant="section"`: a row's padding, at the start.
                div()
                    .px(px(12.))
                    .py(px(10.))
                    .text_size(typography::TEXT_SM)
                    .text_color(colors.muted_foreground)
                    .child("No custom profiles")
                    .into_any_element(),
            );
        }
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px(px(12.))
                    .child(div().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.muted_foreground).child("Profiles"))
                    .child(
                        Button::new("terminal-profile-add", "Add Profile")
                            .variant(ButtonVariant::Ghost)
                            .leading_icon(IconName::Plus)
                            .on_click(|_, _, cx| add_profile(cx)),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .rounded(metrics::ISLAND_RADIUS)
                    .bg(colors.raised)
                    .shadow(cx.theme().shadows.raised.clone())
                    .children(blocks),
            )
            .into_any_element()
    }
}

impl Render for TerminalProfiles {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().child(self.render_section(window, cx)).children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_are_saved_where_the_terminal_reads_them() {
        gpui::TestAppContext::single().update(|cx| {
            settings::init(cx, settings::Settings::default(), None);
            add_profile(cx);
            add_profile(cx);
            let all = profiles(cx);
            assert_eq!(all.len(), 2);
            assert_eq!(text(&all[1], "name"), "Custom Profile 2");
            let id = text(&all[0], "id");
            assert!(id.starts_with("profile_"));
            assert_ne!(id, text(&all[1], "id"));
            update_profile(&id, "shell", Some(Value::String("zsh".into())), cx);
            update_profile(&id, "startupDirectory", Some(Value::String("/tmp".into())), cx);
            update_profile(&id, "startupDirectory", None, cx);
            let first = &profiles(cx)[0];
            assert_eq!(text(first, "shell"), "zsh");
            assert!(!first.contains_key("startupDirectory"));
            let custom: Vec<terminal_view::TerminalProfile> =
                serde_json::from_value(settings::get(cx).extra[PROFILES_KEY].clone()).unwrap();
            assert_eq!(custom[0].shell.as_deref(), Some("zsh"));
            assert!(terminal_view::all_profiles(&[], &custom).iter().any(|profile| profile.id == id));
            delete_profile(&id, cx);
            assert_eq!(profiles(cx).len(), 1);
        });
    }
}
