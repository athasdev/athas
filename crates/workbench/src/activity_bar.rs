use gpui::{Context, IntoElement, ParentElement, Styled, Window, div, prelude::*, px};
use ui::{Avatar, Button, ButtonSize, IconName, TooltipExt, metrics};
use workspace::SidebarView;

use crate::{ShowNotifications, ToggleAccountMenu, ToggleTerminal, Workbench};

/// Runs the command `id` (`app.downloadUpdate`, …) through the command registry.
fn run_command(id: &str, window: &mut gpui::Window, cx: &mut gpui::App) {
    if let Some(action) = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action(id)) {
        window.dispatch_action(action, cx);
    }
}

/// The Problems control's colour and tooltip (`buildDiagnosticsActivityStatus`): hidden with
/// diagnostics off or none reported; red with errors, amber with warnings.
pub(crate) fn diagnostics_activity_status(enabled: bool, errors: usize, warnings: usize, infos: usize) -> Option<(ui::ButtonTone, String)> {
    let total = errors + warnings + infos;
    if !enabled || total == 0 {
        return None;
    }
    let details: Vec<String> = [(errors, "error"), (warnings, "warning"), (infos, "info")]
        .into_iter()
        .filter(|(count, _)| *count > 0)
        .map(|(count, severity)| format!("{count} {severity}{}", if count == 1 { "" } else { "s" }))
        .collect();
    let tone = if errors > 0 {
        ui::ButtonTone::Danger
    } else if warnings > 0 {
        ui::ButtonTone::Warning
    } else {
        ui::ButtonTone::Default
    };
    Some((tone, format!("{total} diagnostic{}: {}", if total == 1 { "" } else { "s" }, details.join(", "))))
}

impl Workbench {
    /// `DiagnosticsActivityControl`: opens Problems, highlighted while it is the tab in front.
    fn render_diagnostics_control(&self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        let counts = cx.try_global::<lsp_client::DiagnosticsStore>().map(|store| store.counts()).unwrap_or_default();
        let enabled = settings::get(cx).core_features.diagnostics;
        let (tone, tooltip) = diagnostics_activity_status(enabled, counts.errors, counts.warnings, counts.infos + counts.hints)?;
        let active = matches!(
            self.state.focused_tabs().and_then(|tabs| tabs.active_item()),
            Some(workspace::TabItem::Resource { kind, .. }) if kind == "problems"
        );
        Some(
            Button::icon("diagnostics-activity", IconName::Warning)
                .size(ButtonSize::Medium)
                .variant(ui::ButtonVariant::Chrome)
                .tone(tone)
                .filled_when_active()
                .active(active)
                .tooltip(tooltip)
                .tooltip_side(ui::TooltipSide::Right)
                .on_click(|_, window, cx| window.dispatch_action(Box::new(crate::ShowProblems), cx))
                .into_any_element(),
        )
    }

    /// `AppUpdateControl`: an update on offer (a menu to install it, read its notes or put it off),
    /// its progress, or the What's New notes of an update not read yet.
    fn render_update_control(&mut self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        let status = workbench_api::update_status(cx);
        let busy = status.downloading || status.installing;
        if let Some(version) = status.available.clone().filter(|_| !status.checking || busy) {
            let tooltip = match (&status.error, status.downloading, status.installing) {
                (Some(error), _, _) => error.clone(),
                (None, true, _) => format!("Updating Athas {}%", status.progress.unwrap_or(0)),
                (None, false, true) => "Installing update...".to_string(),
                _ => format!("Update available: {version}"),
            };
            if busy {
                return Some(
                    div()
                        .id("update-progress")
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(metrics::RAIL_CONTROL)
                        .child(ui::Spinner::new("update-spinner").label(if status.downloading { "Downloading" } else { "Installing" }).compact())
                        .anchored_tooltip(move || ui::Tooltip::new(tooltip.clone()).side(ui::TooltipSide::Right))
                        .into_any_element(),
                );
            }
            let verb = if status.download_only { "Download" } else { "Install" };
            return Some(
                Button::icon("app-update", IconName::Download)
                    .size(ButtonSize::Medium)
                    .variant(ui::ButtonVariant::Accent)
                    .tooltip(tooltip)
                    .tooltip_side(ui::TooltipSide::Right)
                    .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                        let item = |label: String, icon: IconName, command: &'static str| -> ui::MenuEntry {
                            ui::MenuItem::new(label).icon(icon).on_select(move |window, cx| run_command(command, window, cx)).into()
                        };
                        let entries = vec![
                            item(format!("{verb} Athas {version}"), IconName::Download, "app.downloadUpdate"),
                            item("View release notes".into(), IconName::FileText, "app.viewReleaseNotes"),
                            item("Download later".into(), IconName::Clock, "app.downloadUpdateLater"),
                        ];
                        this.show_menu("app-update", entries, event.position(), gpui::Anchor::BottomLeft, window, cx);
                    }))
                    .into_any_element(),
            );
        }
        let unread = *self.whats_new_unread.get_or_insert_with(|| onboarding::whats_new::WhatsNewStore::default_location().is_unread(env!("CARGO_PKG_VERSION")));
        unread.then(|| {
            Button::icon("whats-new", IconName::FileText)
                .size(ButtonSize::Medium)
                .variant(ui::ButtonVariant::Chrome)
                .tooltip("What's new in Athas")
                .tooltip_side(ui::TooltipSide::Right)
                .on_click(|_, window, cx| run_command("help.showWhatsNew", window, cx))
                .into_any_element()
        })
    }

    /// The column down the left edge that picks what the sidebar shows: the agents, then every
    /// project tool. Workbench status and the account sit at its foot.
    pub(crate) fn render_activity_bar(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let narrow = Self::is_narrow(window);
        let shown = if narrow { self.sidebar_overlay_open } else { self.state.layout.sidebar_visible };
        let active_view = (shown && self.shown_extension_view(cx).is_none()).then_some(self.state.layout.sidebar_view);
        let terminal_open = self.state.layout.bottom_pane_visible && self.state.layout.bottom_tab == workspace::BottomTab::Terminal;
        let platform = self.platform;
        let unread = cx.try_global::<notifications::Notifications>().map_or(0, |store| store.unread());
        let primary = theme::ActiveTheme::theme(&**cx).colors.primary;
        let surface = theme::ActiveTheme::theme(&**cx).colors.surface;

        let tools: Vec<SidebarView> = SidebarView::PROJECT_TOOLS.into_iter().filter(|view| self.tool_available(*view, cx)).collect();
        let item = |view: SidebarView, cx: &mut Context<Self>| {
            let button = match view {
                SidebarView::Agents => Button::icon("activity-agents", IconName::ChatBubbleText),
                SidebarView::Files => Button::icon("activity-files", IconName::Files),
                SidebarView::Git => Button::icon("activity-git", IconName::GitBranch),
                SidebarView::GitHub => Button::new("activity-github", "").icon_path("icons/github.svg").icon_only(),
            };
            button
                .size(ButtonSize::Medium)
                .variant(ui::ButtonVariant::Chrome)
                .filled_when_active()
                .active(active_view == Some(view))
                .tooltip(view.title())
                .tooltip_side(ui::TooltipSide::Right)
                .on_click(cx.listener(move |this, _, window, cx| this.toggle_sidebar_view(view, window, cx)))
        };
        let extension_items = self.extension_activity_items(shown, cx);
        let update_control = self.render_update_control(cx);

        div()
            .flex()
            .flex_col()
            .flex_none()
            .items_center()
            .h_full()
            .w(metrics::RAIL_CONTROL)
            .overflow_hidden()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .items_center()
                    .gap(metrics::CHROME_GAP_TIGHT)
                    .pt(metrics::CHROME_GAP_TIGHT)
                    .child(item(SidebarView::Agents, cx))
                    .children(tools.into_iter().map(|view| item(view, cx)))
                    .children(extension_items),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_none()
                    .items_center()
                    .gap(metrics::CHROME_GAP_TIGHT)
                    .pt(metrics::CHROME_GAP_TIGHT)
                    .pb(metrics::WORKBENCH_GAP)
                    .children(update_control)
                    .children(self.render_diagnostics_control(cx))
                    .child(
                        Button::icon("run-actions", IconName::Play)
                            .size(ButtonSize::Medium)
                            .variant(ui::ButtonVariant::Chrome)
                            .tooltip("Run")
                            .tooltip_side(ui::TooltipSide::Right)
                            .active(self.menu_is_open("run-actions"))
                            .on_click(cx.listener(|this, event: &gpui::ClickEvent, window, cx| {
                                this.show_run_dropdown(event.position(), window, cx);
                            })),
                    )
                    .child(
                        Button::icon("toggle-terminal", IconName::TerminalWindow)
                            .size(ButtonSize::Medium)
                            .variant(ui::ButtonVariant::Chrome)
                            .filled_when_active()
                            .active(terminal_open)
                            .tooltip(if terminal_open { "Hide Terminal" } else { "Show Terminal" })
                            .tooltip_side(ui::TooltipSide::Right)
                            .shortcut(platform.shortcut("⌘J", "Ctrl+J"))
                            .on_click(|_, window, cx| window.dispatch_action(Box::new(ToggleTerminal), cx)),
                    )
                    .child(
                        div()
                            .relative()
                            .child(
                                Button::icon("notifications", IconName::Bell)
                                    .size(ButtonSize::Medium)
                                    .variant(ui::ButtonVariant::Chrome)
                                    .tooltip("Inbox")
                                    .filled_when_active()
                                    .active(self.inbox.is_some())
                                    .tooltip_side(ui::TooltipSide::Right)
                                    .on_click(|_, window, cx| window.dispatch_action(Box::new(ShowNotifications), cx)),
                            )
                            .when(unread > 0, |this| {
                                this.child(
                                    div()
                                        .absolute()
                                        .top(px(6.))
                                        .right(px(6.))
                                        .size(px(6.))
                                        .rounded_full()
                                        .bg(primary)
                                        .border_1()
                                        .border_color(surface),
                                )
                            }),
                    )
                    .child(
                        Button::new("account", "")
                            .icon_only()
                            .size(ButtonSize::Medium)
                            .variant(ui::ButtonVariant::Chrome)
                            .leading(
                                Avatar::new(&crate::web_chrome::web_chrome(cx).and_then(|chrome| (chrome.account_name)(cx)).unwrap_or_else(|| account::avatar_name(cx)))
                                    .size(px(16.))
                                    .image(ui::avatar::account(cx).and_then(|me| me.picture())),
                            )
                            .active(self.account_menu.is_some() || self.web_account_menu_open())
                            .tooltip("Account")
                            .tooltip_side(ui::TooltipSide::Right)
                            .on_click(|_, window, cx| window.dispatch_action(Box::new(ToggleAccountMenu), cx)),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn diagnostics_status_reads_like_the_original() {
        assert_eq!(super::diagnostics_activity_status(true, 0, 0, 0), None);
        assert_eq!(super::diagnostics_activity_status(false, 2, 0, 0), None);
        let (tone, tooltip) = super::diagnostics_activity_status(true, 2, 1, 0).unwrap();
        assert_eq!(tone, ui::ButtonTone::Danger);
        assert_eq!(tooltip, "3 diagnostics: 2 errors, 1 warning");
        assert_eq!(super::diagnostics_activity_status(true, 0, 1, 0).unwrap().0, ui::ButtonTone::Warning);
    }
}
