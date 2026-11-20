//! What the running UI extensions have registered (`ui-extension-store.ts`).

use std::collections::{BTreeMap, HashMap};

use crate::generated::ContributionType;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExtensionState {
    Loading,
    Active,
    Error,
    Disabled,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Registration {
    pub extension_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub contribution_type: Option<ContributionType>,
    pub state: ExtensionState,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SidebarView {
    pub id: String,
    pub extension_id: String,
    pub title: String,
    pub icon: String,
    pub order: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolbarPosition {
    Left,
    Right,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolbarAction {
    pub id: String,
    pub extension_id: String,
    pub title: String,
    pub icon: String,
    pub position: ToolbarPosition,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Command {
    pub id: String,
    pub extension_id: String,
    pub title: String,
    pub category: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Dialog {
    pub id: String,
    pub extension_id: String,
    pub title: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AiProvider {
    pub extension_id: String,
    pub provider_id: String,
    /// The manifest's `aiProviders` entry: `name`, `apiUrl`, `requiresApiKey`, `models`…
    pub contribution: serde_json::Value,
}

impl AiProvider {
    pub fn name(&self) -> String {
        self.contribution.get("name").and_then(serde_json::Value::as_str).filter(|name| !name.trim().is_empty()).unwrap_or(&self.provider_id).to_string()
    }

    pub fn requires_api_key(&self) -> bool {
        self.contribution.get("requiresApiKey").and_then(serde_json::Value::as_bool).unwrap_or(false)
    }

    /// The models it lists, as (id, name).
    pub fn models(&self) -> Vec<(String, String)> {
        let Some(models) = self.contribution.get("models").and_then(serde_json::Value::as_array) else {
            return Vec::new();
        };
        models
            .iter()
            .filter_map(|model| {
                let id = model.get("id")?.as_str()?.trim();
                if id.is_empty() {
                    return None;
                }
                let name = model.get("name").and_then(serde_json::Value::as_str).filter(|name| !name.trim().is_empty()).unwrap_or(id);
                Some((id.to_string(), name.to_string()))
            })
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AiSettingsAction {
    pub id: String,
    pub extension_id: String,
    pub provider_id: String,
    pub label: String,
    pub button_label: String,
    pub description: Option<String>,
    pub icon: String,
    pub command_id: String,
}

#[derive(Clone, Debug, Default)]
pub struct Store {
    pub extensions: BTreeMap<String, Registration>,
    pub sidebar_views: BTreeMap<String, SidebarView>,
    pub view_revisions: HashMap<String, u64>,
    pub toolbar_actions: BTreeMap<String, ToolbarAction>,
    pub commands: BTreeMap<String, Command>,
    pub dialogs: Vec<Dialog>,
    pub ai_providers: Vec<AiProvider>,
    pub ai_settings_actions: Vec<AiSettingsAction>,
}

impl Store {
    pub fn register_extension(&mut self, registration: Registration) {
        self.extensions.insert(registration.extension_id.clone(), registration);
    }

    pub fn update_extension_state(&mut self, extension_id: &str, state: ExtensionState, error: Option<String>) {
        if let Some(registration) = self.extensions.get_mut(extension_id) {
            registration.state = state;
            registration.error = error;
        }
    }

    pub fn register_sidebar_view(&mut self, view: SidebarView) {
        self.view_revisions.insert(view.id.clone(), 0);
        self.sidebar_views.insert(view.id.clone(), view);
    }

    pub fn invalidate_view(&mut self, view_id: &str) {
        *self.view_revisions.entry(view_id.to_string()).or_default() += 1;
    }

    pub fn revision(&self, view_id: &str) -> u64 {
        self.view_revisions.get(view_id).copied().unwrap_or_default()
    }

    pub fn open_dialog(&mut self, dialog: Dialog) {
        self.dialogs.retain(|open| open.id != dialog.id);
        self.dialogs.push(dialog);
    }

    pub fn close_dialog(&mut self, dialog_id: &str) {
        self.dialogs.retain(|open| open.id != dialog_id);
    }

    /// Sidebar views in the order the extensions asked for, then by title.
    pub fn ordered_sidebar_views(&self) -> Vec<SidebarView> {
        let mut views: Vec<_> = self.sidebar_views.values().cloned().collect();
        views.sort_by(|a, b| a.order.unwrap_or(f64::MAX).total_cmp(&b.order.unwrap_or(f64::MAX)).then_with(|| a.title.cmp(&b.title)));
        views
    }

    pub fn toolbar_actions_at(&self, position: ToolbarPosition) -> Vec<ToolbarAction> {
        self.toolbar_actions.values().filter(|action| action.position == position).cloned().collect()
    }

    /// Drops everything one extension registered, the registration included.
    pub fn cleanup_extension(&mut self, extension_id: &str) {
        self.sidebar_views.retain(|id, view| {
            let keep = view.extension_id != extension_id;
            if !keep {
                self.view_revisions.remove(id);
            }
            keep
        });
        self.toolbar_actions.retain(|_, action| action.extension_id != extension_id);
        self.commands.retain(|_, command| command.extension_id != extension_id);
        self.dialogs.retain(|dialog| dialog.extension_id != extension_id);
        self.ai_providers.retain(|provider| provider.extension_id != extension_id);
        self.ai_settings_actions.retain(|action| action.extension_id != extension_id);
        self.extensions.remove(extension_id);
    }
}
