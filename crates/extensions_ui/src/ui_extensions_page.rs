//! Generated UI extensions in the extension manager: create one from a prompt, list them with
//! their state, pause, resume or remove them, and open one to use its views.

use extension_host::generated::normalize_generated_id;
use extension_host::{ExtensionState, GeneratedExtension, Registration};
use gpui::{AnyElement, ClickEvent, Context, SharedString, div, prelude::*, px};
use theme::ThemeColors;
use ui::{Badge, Button, ButtonSize, ButtonTone, ButtonVariant, Icon, IconName, IconSize, PaneTitle, SectionLabel, Spinner, Switch, Tone, WithScrollbar, metrics, pane_actions, pane_header, typography};

use crate::ExtensionsView;
use crate::extension_view::{ExtensionView, Surface};
use crate::ui_extensions;

fn state_badge(extension: &GeneratedExtension, registration: Option<&Registration>) -> Badge {
    match registration.map(|registration| registration.state) {
        _ if extension.disabled => Badge::new("Paused"),
        Some(ExtensionState::Active) => Badge::new("Running").tone(Tone::Success),
        Some(ExtensionState::Error) => Badge::new("Error").tone(Tone::Danger),
        Some(ExtensionState::Disabled) => Badge::new("Paused"),
        Some(ExtensionState::Loading) | None => Badge::new("Starting").tone(Tone::Info),
    }
}

impl ExtensionsView {
    pub fn open_ui_extension(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some((extension, _)) = ui_extensions::generated(cx).into_iter().find(|(extension, _)| normalize_generated_id(&extension.id) == id) else {
            return;
        };
        self.selected = None;
        self.selected_ui = Some(id.to_string());
        self.detail_scroll.set_offset(gpui::point(px(0.), px(0.)));
        cx.emit(crate::ExtensionsViewEvent::TitleChanged(extension.name.into()));
        cx.notify();
    }

    pub(crate) fn create_ui_extension(&mut self, cx: &mut Context<Self>) {
        let prompt = self.prompt.read(cx).text().trim().to_string();
        if prompt.is_empty() || ui_extensions::is_generating(cx) {
            return;
        }
        let task = ui_extensions::generate(prompt, cx);
        cx.spawn(async move |this, cx| {
            if let Ok(id) = task.await {
                this.update(cx, |this, cx| {
                    this.prompt.update(cx, |input, cx| input.set_text("", cx));
                    this.open_ui_extension(&id, cx);
                })
                .ok();
            }
        })
        .detach();
        cx.notify();
    }

    fn render_create_card(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let generating = ui_extensions::is_generating(cx);
        let error = ui_extensions::generate_error(cx);
        div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .p(px(10.))
            .rounded(metrics::RADIUS_LG)
            .bg(colors.raised)
            .border_1()
            .border_color(colors.border)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(Icon::new(IconName::Sparkle).size(IconSize::Small).color(colors.primary))
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .items_center()
                            .h(px(28.))
                            .px(px(8.))
                            .rounded(metrics::RADIUS_MD)
                            .bg(colors.field)
                            .child(self.prompt.clone()),
                    )
                    .child(
                        Button::new("ui-extension-create", if generating { "Creating" } else { "Create" })
                            .size(ButtonSize::Small)
                            .variant(ButtonVariant::Accent)
                            .disabled(generating)
                            .when(generating, |this| this.leading(Spinner::new("ui-extension-creating").compact()))
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.create_ui_extension(cx))),
                    ),
            )
            .child(
                div()
                    .text_size(typography::TEXT_CAPTION)
                    .text_color(colors.subtle_foreground)
                    .child("Describe a panel, toolbar action or command. The model writes it; it runs sandboxed with only the permissions it asks for."),
            )
            .children(error.map(|error| div().text_size(typography::TEXT_SM).text_color(colors.destructive).child(error)))
            .into_any_element()
    }

    fn render_generated_row(&self, extension: &GeneratedExtension, registration: Option<&Registration>, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let id = normalize_generated_id(&extension.id);
        let enabled = !extension.disabled;
        let error = registration.and_then(|registration| registration.error.clone()).filter(|_| enabled);
        let hover = colors.accent;
        let (toggle_id, remove_id, open_id) = (id.clone(), id.clone(), id.clone());
        div()
            .id(SharedString::from(format!("ui-extension-{id}")))
            .flex()
            .items_center()
            .gap(px(12.))
            .w_full()
            .min_w_0()
            .px(px(10.))
            .py(px(8.))
            .rounded(metrics::RADIUS_LG)
            .hover(move |style| style.bg(hover))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(36.))
                    .rounded(metrics::RADIUS_LG)
                    .bg(colors.raised)
                    .child(Icon::new(IconName::Sparkle).size(IconSize::Custom(px(20.))).color(colors.muted_foreground)),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(1.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .min_w_0()
                            .child(div().flex_none().text_size(typography::TEXT_BASE).font_weight(typography::MEDIUM).text_color(colors.foreground).child(extension.name.clone()))
                            .child(div().min_w_0().truncate().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(format!("Generated · {}", extension.contribution_type.label())))
                            .child(state_badge(extension, registration)),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(typography::TEXT_SM)
                            .text_color(if error.is_some() { colors.destructive } else { colors.muted_foreground })
                            .child(error.unwrap_or_else(|| extension.description.clone())),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(6.))
                    .child(Switch::new(SharedString::from(format!("ui-extension-toggle-{id}")), enabled).on_change(move |enabled, _, cx| {
                        ui_extensions::set_enabled(&toggle_id, enabled, cx).detach();
                    }))
                    .child(
                        Button::icon(SharedString::from(format!("ui-extension-remove-{id}")), IconName::Trash)
                            .size(ButtonSize::Small)
                            .variant(ButtonVariant::Ghost)
                            .tone(ButtonTone::Danger)
                            .tooltip("Remove")
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                                cx.stop_propagation();
                                if this.selected_ui.as_deref() == Some(remove_id.as_str()) {
                                    this.selected_ui = None;
                                }
                                ui_extensions::remove(&remove_id, cx).detach();
                            })),
                    ),
            )
            .on_click(cx.listener(move |this, _, _, cx| this.open_ui_extension(&open_id, cx)))
            .into_any_element()
    }

    /// The Generated group at the top of the catalog: the prompt, then each generated extension.
    pub(crate) fn render_generated_section(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Vec<AnyElement> {
        if !cx.has_global::<ui_extensions::UiExtensions>() {
            return Vec::new();
        }
        let mut children = vec![div().pb(px(2.)).child(SectionLabel::new("Generated")).into_any_element(), self.render_create_card(colors, cx)];
        for (extension, registration) in ui_extensions::generated(cx) {
            children.push(self.render_generated_row(&extension, registration.as_ref(), colors, cx));
        }
        children.push(div().h(px(12.)).into_any_element());
        children
    }

    /// One generated extension: its views running live, its permissions and its code.
    pub(crate) fn render_generated_detail(&mut self, id: &str, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let Some((extension, registration)) = ui_extensions::generated(cx).into_iter().find(|(extension, _)| normalize_generated_id(&extension.id) == id) else {
            return div().into_any_element();
        };
        let store = ui_extensions::host(cx).store();
        let views: Vec<_> = store.ordered_sidebar_views().into_iter().filter(|view| view.extension_id == id).collect();
        self.ui_views.retain(|view_id, _| views.iter().any(|view| &view.id == view_id));
        let mut panels = Vec::new();
        for view in &views {
            let entity = self
                .ui_views
                .entry(view.id.clone())
                .or_insert_with(|| cx.new(|cx| ExtensionView::for_extension(id.to_string(), view.id.clone(), Surface::Sidebar, cx)))
                .clone();
            panels.push(
                div()
                    .flex()
                    .flex_col()
                    .w(px(320.))
                    .h(px(460.))
                    .flex_none()
                    .overflow_hidden()
                    .rounded(metrics::RADIUS_LG)
                    .bg(colors.surface)
                    .border_1()
                    .border_color(colors.border)
                    .child(entity)
                    .into_any_element(),
            );
        }
        let commands: Vec<_> = store.commands.values().filter(|command| command.extension_id == id).cloned().collect();
        let actions: Vec<_> = store.toolbar_actions.values().filter(|action| action.extension_id == id).cloned().collect();
        let mut permissions = Vec::new();
        let granted = &extension.permissions;
        permissions.extend(granted.network.iter().map(|origin| format!("Network: {origin}")));
        if granted.secrets {
            permissions.push("Secrets".to_string());
        }
        if granted.can_read_workspace() {
            permissions.push("Read the workspace".to_string());
        }
        if granted.clipboard_write {
            permissions.push("Write to the clipboard".to_string());
        }
        if granted.open_external {
            permissions.push("Open links".to_string());
        }
        let error = registration.as_ref().and_then(|registration| registration.error.clone());
        let section = |title: &'static str| div().pt(px(16.)).pb(px(4.)).child(SectionLabel::new(title));
        let back = cx.listener(|this, _: &ClickEvent, _, cx| {
            this.selected_ui = None;
            cx.emit(crate::ExtensionsViewEvent::TitleChanged("Integrations".into()));
            cx.notify();
        });
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .child(
                pane_header(cx)
                    .px(px(12.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .child(Button::icon("ui-extension-back", IconName::ArrowLeft).size(ButtonSize::Small).variant(ButtonVariant::Ghost).tooltip("Back").on_click(back))
                            .child(PaneTitle::new(extension.name.clone()).icon(IconName::Sparkle).detail(format!("Generated · {}", extension.contribution_type.label()))),
                    )
                    .child(pane_actions().gap(px(6.)).child(state_badge(&extension, registration.as_ref()))),
            )
            .child(
                div()
                    .id("ui-extension-detail")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .w_full()
                            .max_w(px(860.))
                            .mx_auto()
                            .px(px(16.))
                            .pb(px(24.))
                            .child(div().pt(px(8.)).text_size(typography::TEXT_BASE).text_color(colors.muted_foreground).child(extension.description.clone()))
                            .children(error.map(|error| {
                                ui::Alert::new().tone(Tone::Danger).icon(IconName::WarningCircle).title("The extension stopped").description(error).into_any_element()
                            }))
                            .when(!panels.is_empty(), |this| this.child(section("Views")).child(div().flex().flex_wrap().gap(px(12.)).children(panels)))
                            .when(!commands.is_empty() || !actions.is_empty(), |this| {
                                this.child(section("Commands")).children(commands.iter().map(|command| {
                                    let (owner, command_id) = (command.extension_id.clone(), command.id.clone());
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.))
                                        .py(px(4.))
                                        .child(div().flex_1().text_size(typography::TEXT_SM).child(command.title.clone()))
                                        .child(
                                            Button::new(SharedString::from(format!("ui-extension-run-{command_id}")), "Run").size(ButtonSize::Small).on_click(move |_, _, cx| {
                                                let task = ui_extensions::host(cx).execute_command(&owner, &command_id, Vec::new());
                                                cx.background_executor().spawn(task).detach();
                                            }),
                                        )
                                }))
                                .children(actions.iter().map(|action| {
                                    let (owner, action_id) = (action.extension_id.clone(), action.id.clone());
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.))
                                        .py(px(4.))
                                        .child(div().flex_1().text_size(typography::TEXT_SM).child(format!("Toolbar: {}", action.title)))
                                        .child(
                                            Button::new(SharedString::from(format!("ui-extension-click-{action_id}")), "Click").size(ButtonSize::Small).on_click(move |_, _, cx| {
                                                let task = ui_extensions::host(cx).execute_toolbar_action(&owner, &action_id);
                                                cx.background_executor().spawn(task).detach();
                                            }),
                                        )
                                }))
                            })
                            .child(section("Permissions"))
                            .child(div().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child(if permissions.is_empty() {
                                "None beyond its own storage and notifications.".to_string()
                            } else {
                                permissions.join(" · ")
                            }))
                            .child(section("Code"))
                            .child(
                                div()
                                    .p(px(8.))
                                    .rounded(metrics::RADIUS_LG)
                                    .bg(colors.surface)
                                    .font_family(typography::MONO_FONT)
                                    .text_size(typography::TEXT_CAPTION)
                                    .text_color(colors.foreground)
                                    .children(extension.code.lines().map(|line| div().whitespace_nowrap().child(if line.is_empty() { " ".to_string() } else { line.to_string() }))),
                            ),
                    )
                    .scrollbar_with(&self.detail_scroll),
            )
            .into_any_element()
    }
}
