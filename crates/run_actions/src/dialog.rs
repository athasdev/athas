//! New / Edit run action (`run-action-dialog.tsx`): name, command and working directory of an
//! action saved for one project.

use gpui::{App, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, SharedString, Subscription, Window, div, prelude::*, px};
use theme::ActiveTheme;
use ui::{Button, ButtonVariant, Dialog, DialogSize, Field, IconName, TextInput, TextInputEvent, metrics, typography};

use crate::{CustomRunAction, load_custom_actions, save_custom_actions};

pub struct RunActionDialog {
    id: Option<String>,
    workspace_path: Option<String>,
    workspace_label: SharedString,
    name: Entity<TextInput>,
    command: Entity<TextInput>,
    working_directory: Entity<TextInput>,
    on_saved: Box<dyn Fn(&mut Window, &mut App)>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<DismissEvent> for RunActionDialog {}

impl Focusable for RunActionDialog {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.name.focus_handle(cx)
    }
}

impl RunActionDialog {
    /// `existing` edits that action; otherwise a new one is saved for `workspace_path`.
    pub fn new(
        existing: Option<CustomRunAction>,
        workspace_path: Option<String>,
        on_saved: impl Fn(&mut Window, &mut App) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let field = |text: Option<&str>, placeholder: &'static str, window: &mut Window, cx: &mut Context<Self>| {
            cx.new(|cx| {
                let mut input = TextInput::new(window, cx).placeholder(placeholder);
                if let Some(text) = text {
                    input.set_text(text.to_string(), cx);
                }
                input
            })
        };
        let name = field(existing.as_ref().map(|action| action.name.as_str()), "Start development server", window, cx);
        let command = field(existing.as_ref().map(|action| action.command.as_str()), "bun run dev", window, cx);
        let working_directory = field(existing.as_ref().and_then(|action| action.working_directory.as_deref()), ".", window, cx);
        let subscriptions = [&name, &command, &working_directory]
            .into_iter()
            .map(|input| {
                cx.subscribe_in(input, window, |this, _, event: &TextInputEvent, window, cx| match event {
                    TextInputEvent::Changed(_) => cx.notify(),
                    TextInputEvent::Confirmed if this.can_save(cx) => this.save(window, cx),
                    TextInputEvent::Cancelled => cx.emit(DismissEvent),
                    _ => {}
                })
            })
            .collect();
        let workspace_path = existing.as_ref().map_or(workspace_path, |action| action.workspace_path.clone());
        let workspace_label = workspace_path
            .as_deref()
            .map(|path| path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or(path).to_string())
            .unwrap_or_else(|| "all projects".to_string())
            .into();
        Self {
            id: existing.map(|action| action.id),
            workspace_path,
            workspace_label,
            name,
            command,
            working_directory,
            on_saved: Box::new(on_saved),
            _subscriptions: subscriptions,
        }
    }

    fn can_save(&self, cx: &App) -> bool {
        !self.name.read(cx).text().trim().is_empty() && !self.command.read(cx).text().trim().is_empty()
    }

    fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_save(cx) {
            return;
        }
        let name = self.name.read(cx).text().trim().to_string();
        let command = self.command.read(cx).text().trim().to_string();
        let directory = self.working_directory.read(cx).text().trim().to_string();
        let working_directory = (!directory.is_empty()).then_some(directory);
        let mut actions = load_custom_actions();
        match self.id.as_ref().and_then(|id| actions.iter_mut().find(|action| &action.id == id)) {
            Some(action) => {
                action.name = name;
                action.command = command;
                action.working_directory = working_directory;
            }
            None => actions.push(CustomRunAction {
                id: new_action_id(),
                name,
                command,
                workspace_path: self.workspace_path.clone(),
                working_directory,
            }),
        }
        if let Err(error) = save_custom_actions(&actions) {
            eprintln!("run actions: {error:#}");
        }
        cx.emit(DismissEvent);
        (self.on_saved)(window, cx);
    }
}

fn new_action_id() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("action_{}_{:x}", now.as_millis(), now.subsec_nanos())
}

impl Render for RunActionDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let editing = self.id.is_some();
        let can_save = self.can_save(cx);
        let entity = cx.entity().downgrade();
        Dialog::new("run-action-dialog", if editing { "Edit run action" } else { "New run action" })
            .icon(IconName::Terminal)
            .size(DialogSize::Sm)
            .on_close(move |_, cx| {
                entity.update(cx, |_, cx| cx.emit(DismissEvent)).ok();
            })
            .footer([
                Button::new("run-action-cancel", "Cancel")
                    .variant(ButtonVariant::Ghost)
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(DismissEvent)))
                    .into_any_element(),
                Button::new("run-action-save", if editing { "Save changes" } else { "Add action" })
                    .disabled(!can_save)
                    .on_click(cx.listener(|this, _, window, cx| this.save(window, cx)))
                    .into_any_element(),
            ])
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .child(
                        div()
                            .rounded(metrics::RADIUS_LG)
                            .bg(colors.surface)
                            .px(px(12.))
                            .py(px(8.))
                            .text_size(typography::TEXT_SM)
                            .text_color(colors.subtle_foreground)
                            .child({
                                // One run of text, the workspace in medium foreground, wrapping as a
                                // sentence does.
                                let lead = "This action is saved for ";
                                let text = format!("{lead}{} and runs in a new terminal.", self.workspace_label);
                                let range = lead.len()..lead.len() + self.workspace_label.len();
                                gpui::StyledText::new(text).with_highlights([(
                                    range,
                                    gpui::HighlightStyle { color: Some(colors.foreground), font_weight: Some(typography::MEDIUM), ..Default::default() },
                                )])
                            }),
                    )
                    .child(Field::new().label("Name").control(self.name.clone()))
                    // Command and directory are typed in the code font (`font="mono"`).
                    .child(Field::new().label("Command").control(div().font_family(typography::MONO_FONT).child(self.command.clone())))
                    .child(
                        Field::new()
                            .label("Working directory")
                            .control(div().font_family(typography::MONO_FONT).child(self.working_directory.clone()))
                            .description("Leave empty for the project root, or enter a relative path such as apps/web."),
                    ),
            )
    }
}
