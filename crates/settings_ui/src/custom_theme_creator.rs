//! Create Theme (`custom-theme-creator-dialog.tsx`): a name, an id and a base theme make a theme
//! file, which can be edited before it is saved as JSON or installed.

use gpui::{App, Context, DismissEvent, Entity, EventEmitter, SharedString, Subscription, Window, div, prelude::*, px};
use theme::{
    ActiveTheme,
    theme_file::{format_theme_file, parse_theme_file_json, theme_file_from_base, theme_id_from_name},
};
use ui::{
    Button, ButtonVariant, Dialog, DialogLayout, DialogSize, Field, IconName, Select, SelectEvent, SelectOption, SelectSearch,
    SelectWidth, TextArea, TextAreaEvent, TextInput, TextInputEvent, typography,
};

use crate::home_dir;

pub struct CustomThemeCreator {
    name: Entity<TextInput>,
    id: Entity<TextInput>,
    base: Entity<Select>,
    json: Entity<TextArea>,
    id_edited: bool,
    /// The JSON was edited by hand, so changing the fields no longer rewrites it.
    manual: bool,
    issues: Vec<String>,
    /// The JSON the fields last wrote, to tell a hand edit from it.
    generated: String,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<DismissEvent> for CustomThemeCreator {}

impl CustomThemeCreator {
    pub fn new(base_theme: &str, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let registry = theme::registry(cx);
        let options: Vec<SelectOption> = registry.themes().iter().map(|theme| SelectOption::new(theme.id.clone(), theme.name.clone())).collect();
        let base_id = registry.get(base_theme).map(|theme| theme.id.clone()).or_else(|| registry.themes().first().map(|theme| theme.id.clone())).unwrap_or_default();
        let name = cx.new(|cx| {
            let mut input = TextInput::new(window, cx);
            input.set_text("My Athas Theme", cx);
            input
        });
        let id = cx.new(|cx| {
            let mut input = TextInput::new(window, cx);
            input.set_text("my-athas-theme", cx);
            input
        });
        let base = cx.new(|cx| Select::new(options, base_id, cx).width(SelectWidth::Full).searchable(SelectSearch::Input, window, cx));
        let json = cx.new(|cx| TextArea::new(cx).rows(16).mono());
        let subscriptions = vec![
            cx.subscribe(&name, |this, _, event: &TextInputEvent, cx| {
                if let TextInputEvent::Changed(text) = event {
                    if !this.id_edited {
                        let id = theme_id_from_name(text);
                        this.id.update(cx, |input, cx| input.set_text(id, cx));
                    }
                    this.manual = false;
                    this.regenerate(cx);
                }
            }),
            cx.subscribe(&id, |this, _, event: &TextInputEvent, cx| {
                if let TextInputEvent::Changed(_) = event {
                    this.manual = false;
                    this.regenerate(cx);
                }
            }),
            cx.subscribe(&base, |this, _, event: &SelectEvent, cx| {
                if let SelectEvent::Changed(_) = event {
                    this.manual = false;
                    this.regenerate(cx);
                }
            }),
            cx.subscribe(&json, |this, _, event: &TextAreaEvent, cx| {
                if let TextAreaEvent::Changed = event
                    && this.json.read(cx).text() != this.generated
                {
                    this.manual = true;
                    this.issues.clear();
                    cx.notify();
                }
            }),
        ];
        let mut creator = Self { name, id, base, json, id_edited: false, manual: false, issues: Vec::new(), generated: String::new(), _subscriptions: subscriptions };
        creator.regenerate(cx);
        creator
    }

    /// Marks the id as typed by the user, so renaming no longer changes it.
    fn id_typed(&mut self, cx: &mut Context<Self>) {
        self.id_edited = true;
        cx.notify();
    }

    fn regenerate(&mut self, cx: &mut Context<Self>) {
        if self.manual {
            return;
        }
        let base_id = self.base.read(cx).value().clone();
        let Some(base) = theme::registry(cx).get(&base_id) else { return };
        let name = self.name.read(cx).text().to_string();
        let id = self.id.read(cx).text().to_string();
        let text = format_theme_file(&theme_file_from_base(&id, &name, None, &base));
        self.generated = text.clone();
        self.json.update(cx, |json, cx| json.set_text(text, cx));
        cx.notify();
    }

    fn validated(&mut self, cx: &mut Context<Self>) -> Option<String> {
        let text = self.json.read(cx).text().to_string();
        match parse_theme_file_json(&text) {
            Ok(_) => {
                self.issues.clear();
                cx.notify();
                Some(text)
            }
            Err(error) => {
                self.issues = error.issues;
                cx.notify();
                None
            }
        }
    }

    fn install(&mut self, cx: &mut Context<Self>) {
        let Some(text) = self.validated(cx) else { return };
        match extensions::install_theme_json(&text, cx) {
            Ok(themes) => {
                let Some(first) = themes.first() else { return };
                let message = if themes.len() == 1 { format!("Installed {}", first.name) } else { format!("Installed {} theme variants", themes.len()) };
                crate::notify(cx, notifications::NotificationKind::Success, message, None);
                extensions::select_theme(&first.id, cx);
                cx.emit(DismissEvent);
            }
            Err(error) => {
                self.issues = if error.details.is_empty() { vec![error.message] } else { error.details };
                cx.notify();
            }
        }
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        let Some(text) = self.validated(cx) else { return };
        let file_name = parse_theme_file_json(&text)
            .ok()
            .and_then(|file| file.themes.first().map(|theme| theme.id.clone()))
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| "athas-theme".into());
        let path = cx.prompt_for_new_path(&home_dir(), Some(&format!("{file_name}.json")));
        cx.spawn(async move |_, cx| {
            let Ok(Ok(Some(path))) = path.await else { return };
            let written = std::fs::write(&path, text);
            cx.update(|cx| match written {
                Ok(()) => crate::notify(cx, notifications::NotificationKind::Success, "Theme JSON saved", None),
                Err(error) => crate::notify(cx, notifications::NotificationKind::Error, "Failed to save theme JSON", Some(error.to_string())),
            });
        })
        .detach();
    }
}

impl Render for CustomThemeCreator {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let error = (!self.issues.is_empty()).then(|| self.issues.iter().take(8).cloned().collect::<Vec<_>>().join("\n"));
        let entity = cx.entity();
        Dialog::new("custom-theme-creator", "Create Theme")
            .icon(IconName::BracketsCurly)
            .size(DialogSize::Lg)
            .layout(DialogLayout::Form)
            .on_close({
                let entity = entity.clone();
                move |_, cx| entity.update(cx, |_, cx| cx.emit(DismissEvent))
            })
            .footer([
                Button::new("custom-theme-cancel", "Cancel")
                    .variant(ButtonVariant::Ghost)
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(DismissEvent)))
                    .into_any_element(),
                Button::new("custom-theme-save", "Save JSON")
                    .variant(ButtonVariant::Outline)
                    .on_click(cx.listener(|this, _, _, cx| this.save(cx)))
                    .into_any_element(),
                Button::new("custom-theme-install", "Install Theme")
                    .variant(ButtonVariant::Accent)
                    .on_click(cx.listener(|this, _, _, cx| this.install(cx)))
                    .into_any_element(),
            ])
            .child(
                div()
                    .font_family(typography::UI_FONT)
                    .text_size(typography::TEXT_SM)
                    .text_color(colors.subtle_foreground)
                    .child("Start from an installed theme, then edit the generated JSON before saving or installing it."),
            )
            .child(
                div()
                    .flex()
                    .gap(px(12.))
                    .child(div().flex_1().min_w_0().child(Field::new().label("Name").control(self.name.clone())))
                    .child(
                        div()
                            .id("custom-theme-id")
                            .flex_1()
                            .min_w_0()
                            .on_key_down(cx.listener(|this, _, _, cx| this.id_typed(cx)))
                            .child(Field::new().label("ID").control(self.id.clone())),
                    ),
            )
            .child(Field::new().label("Base theme").control(self.base.clone()))
            .child(Field::new().label("Theme JSON").control(self.json.clone()).error(error.map(SharedString::from)))
    }
}

/// Opens the dialog's view over Settings.
pub(crate) fn open(base_theme: &str, window: &mut Window, cx: &mut App) -> Entity<CustomThemeCreator> {
    let base_theme = base_theme.to_string();
    cx.new(|cx| CustomThemeCreator::new(&base_theme, window, cx))
}
