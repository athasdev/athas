//! What running UI extensions add to the workbench: their sidebar views in the activity bar
//! (`project-tools.tsx`), dialogs as modals (`extension-dialog.tsx`), toolbar buttons in the
//! breadcrumb bar (`extension-toolbar-action.tsx`), commands in the palette
//! (`createExtensionCommandItems`); and the hooks that bring generative views and extension AI
//! providers to `agent_ui`.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use agent_ui::extension_hooks::{ExtensionHooks, ExtensionProvider, ExtensionSettingsAction};
use extensions_ui::ui_extensions::{self, ToolbarPosition, UiExtensions};
use extensions_ui::{ExtensionDialog, ExtensionView, ExtensionViewSurface};
use gpui::{Action, AnyElement, AnyView, App, AppContext as _, Context, Entity, SharedString, WeakEntity, Window, div, prelude::*};
use palette::CommandEntry;
use ui::{Button, ButtonSize, IconName, Plane};

use crate::Workbench;

/// Runs a command a UI extension registered.
#[derive(Clone, Debug, PartialEq, Action)]
#[action(namespace = workbench, no_json)]
pub struct RunExtensionCommand {
    pub command_id: SharedString,
}

struct Hooks;

impl ExtensionHooks for Hooks {
    fn generative_view(&self, value: &serde_json::Value, cx: &mut App) -> AnyView {
        cx.new(|cx| ExtensionView::generative(value, cx)).into()
    }

    fn providers(&self, cx: &App) -> Vec<ExtensionProvider> {
        ui_extensions::ai_providers(cx)
            .into_iter()
            .map(|provider| ExtensionProvider { id: provider.provider_id.clone(), name: provider.name(), requires_api_key: provider.requires_api_key(), models: provider.models() })
            .collect()
    }

    fn settings_actions(&self, cx: &App) -> Vec<ExtensionSettingsAction> {
        ui_extensions::ai_settings_actions(cx)
            .into_iter()
            .map(|action| ExtensionSettingsAction { id: action.id, label: action.label, description: action.description, button_label: action.button_label, icon: action.icon })
            .collect()
    }

    fn run_settings_action(&self, id: &str, cx: &mut App) {
        if let Some(action) = ui_extensions::ai_settings_actions(cx).into_iter().find(|action| action.id == id) {
            ui_extensions::run_ai_settings_action(&action, cx);
        }
    }
}

pub(crate) fn init(cx: &mut App) {
    agent_ui::extension_hooks::set_extension_hooks(Rc::new(Hooks), cx);
    cx.on_action(|action: &RunExtensionCommand, cx| ui_extensions::run_command(&action.command_id, cx));
}

/// The extension view the sidebar shows instead of its own, and the views and dialog on screen.
#[derive(Default)]
pub(crate) struct ExtensionContributions {
    sidebar_view: Option<String>,
    views: RefCell<HashMap<String, Entity<ExtensionView>>>,
    dialog: Option<(String, WeakEntity<ExtensionDialog>)>,
}

/// The palette's entries for extension commands.
pub(crate) fn palette_entries(cx: &App) -> Vec<CommandEntry> {
    ui_extensions::commands(cx)
        .into_iter()
        .map(|command| CommandEntry {
            id: format!("extension-command:{}", command.id).into(),
            label: command.title.into(),
            description: match &command.category {
                Some(category) => format!("{category} integration command").into(),
                None => "Installed integration command".into(),
            },
            category: command.category.unwrap_or_else(|| "Integrations".into()).into(),
            icon: IconName::PuzzlePiece,
            action: Box::new(RunExtensionCommand { command_id: command.id.into() }),
            shortcut: None,
        })
        .collect()
}

/// The toolbar buttons extensions put at one end of the breadcrumb bar.
pub(crate) fn toolbar_buttons(position: ToolbarPosition, cx: &App) -> Vec<AnyElement> {
    ui_extensions::toolbar_actions(position, cx)
        .into_iter()
        .map(|action| {
            Button::icon(SharedString::from(format!("extension-toolbar-{}", action.id)), ui_extensions::icon(&action.icon))
                .size(ButtonSize::Small)
                .tooltip(action.title.clone())
                .on_click(move |_, _, cx| ui_extensions::run_toolbar_action(&action, cx))
                .into_any_element()
        })
        .collect()
}

impl Workbench {
    /// Redraws as extensions register things, and shows the dialog an extension opened last.
    pub(crate) fn observe_ui_extensions(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !cx.has_global::<UiExtensions>() {
            return;
        }
        cx.observe_global_in::<UiExtensions>(window, |this, window, cx| {
            this.show_extension_dialog(window, cx);
            cx.notify();
        })
        .detach();
        self.show_extension_dialog(window, cx);
    }

    fn show_extension_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(dialog) = ui_extensions::dialogs(cx).pop() else { return };
        if self.extension_contributions.dialog.as_ref().is_some_and(|(id, view)| *id == dialog.id && view.upgrade().is_some()) {
            return;
        }
        let id = dialog.id.clone();
        let view = cx.new(|cx| ExtensionDialog::new(dialog, cx));
        self.extension_contributions.dialog = Some((id, view.downgrade()));
        self.open_modal(view, window, cx);
    }

    /// The extension view the sidebar shows, while its extension still has it registered.
    pub(crate) fn shown_extension_view(&self, cx: &App) -> Option<ui_extensions::SidebarViewInfo> {
        let id = self.extension_contributions.sidebar_view.as_ref()?;
        ui_extensions::sidebar_views(cx).into_iter().find(|view| view.id == *id)
    }

    /// Puts an extension's view in the sidebar, or the sidebar away when it already shows it.
    pub(crate) fn toggle_extension_view(&mut self, view_id: String, window: &mut Window, cx: &mut Context<Self>) {
        let narrow = Self::is_narrow(window);
        let shown = if narrow { self.sidebar_overlay_open } else { self.state.layout.sidebar_visible };
        if shown && self.extension_contributions.sidebar_view.as_deref() == Some(view_id.as_str()) {
            if narrow {
                self.sidebar_overlay_open = false;
            }
            self.update_state(cx, |state| {
                if !narrow {
                    state.layout.sidebar_visible = false;
                }
            });
            return;
        }
        self.show_extension_view(view_id, window, cx);
    }

    pub fn show_extension_view(&mut self, view_id: String, window: &mut Window, cx: &mut Context<Self>) {
        if Self::is_narrow(window) {
            self.sidebar_overlay_open = true;
        }
        self.extension_contributions.sidebar_view = Some(view_id);
        self.update_state(cx, |state| state.layout.sidebar_visible = true);
    }

    /// Back to the workbench's own views (the activity bar picked one).
    pub(crate) fn leave_extension_view(&mut self) -> bool {
        self.extension_contributions.sidebar_view.take().is_some()
    }

    /// The activity bar's buttons for extension views, after the project tools.
    pub(crate) fn extension_activity_items(&self, active: bool, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let shown = active.then(|| self.extension_contributions.sidebar_view.clone()).flatten();
        ui_extensions::sidebar_views(cx)
            .into_iter()
            .map(|view| {
                let id = view.id.clone();
                Button::icon(SharedString::from(format!("activity-extension-{}", view.id)), ui_extensions::icon(&view.icon))
                    .size(ButtonSize::Large)
                    .plane(Plane::Page)
                    .filled_when_active()
                    .active(shown.as_deref() == Some(view.id.as_str()))
                    .tooltip(view.title.clone())
                    .tooltip_side(ui::TooltipSide::Right)
                    .on_click(cx.listener(move |this, _, window, cx| this.toggle_extension_view(id.clone(), window, cx)))
                    .into_any_element()
            })
            .collect()
    }

    /// An extension's sidebar view, drawn by its extension.
    pub(crate) fn render_extension_view(&self, view: &ui_extensions::SidebarViewInfo, cx: &mut Context<Self>) -> AnyElement {
        let entity = self
            .extension_contributions
            .views
            .borrow_mut()
            .entry(view.id.clone())
            .or_insert_with(|| cx.new(|cx| ExtensionView::for_extension(view.extension_id.clone(), view.id.clone(), ExtensionViewSurface::Sidebar, cx)))
            .clone();
        div().flex().flex_col().flex_1().min_h_0().child(entity).into_any_element()
    }
}
