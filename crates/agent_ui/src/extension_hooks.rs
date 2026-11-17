//! What UI extensions add here, through hooks the workbench installs (this crate does not depend
//! on the extension host): generative views in tool output (`GenerativeUIRenderer` in
//! `tool-call-display.tsx`), and the AI providers and settings buttons extensions register.

use std::collections::HashMap;
use std::rc::Rc;

use gpui::{AnyView, App, Global};
use serde_json::Value;

/// An AI provider an extension registered, as its manifest describes it.
#[derive(Clone, Debug, PartialEq)]
pub struct ExtensionProvider {
    pub id: String,
    pub name: String,
    pub requires_api_key: bool,
    /// (id, name)
    pub models: Vec<(String, String)>,
}

/// A button an extension adds to Settings > AI under "From extensions".
#[derive(Clone, Debug, PartialEq)]
pub struct ExtensionSettingsAction {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub button_label: String,
    /// `sparkles` or `palette`.
    pub icon: String,
}

pub trait ExtensionHooks {
    /// Draws a generative view (a view node or the older component shape).
    fn generative_view(&self, value: &Value, cx: &mut App) -> AnyView;
    fn providers(&self, cx: &App) -> Vec<ExtensionProvider>;
    fn settings_actions(&self, cx: &App) -> Vec<ExtensionSettingsAction>;
    fn run_settings_action(&self, id: &str, cx: &mut App);
}

struct Hooks {
    hooks: Rc<dyn ExtensionHooks>,
    views: HashMap<String, (Value, AnyView)>,
}

impl Global for Hooks {}

pub fn set_extension_hooks(hooks: Rc<dyn ExtensionHooks>, cx: &mut App) {
    cx.set_global(Hooks { hooks, views: HashMap::new() });
}

fn hooks(cx: &App) -> Option<Rc<dyn ExtensionHooks>> {
    cx.try_global::<Hooks>().map(|state| state.hooks.clone())
}

/// The views a tool's output carries as `{ "type": "athas_ui", "view": … }`, alone or in a list.
pub fn structured_views(output: &Value) -> Vec<&Value> {
    fn view(item: &Value) -> Option<&Value> {
        let record = item.as_object()?;
        (record.get("type").and_then(Value::as_str) == Some("athas_ui")).then(|| record.get("view")).flatten()
    }
    match output {
        Value::Array(items) => items.iter().filter_map(view).collect(),
        other => view(other).into_iter().collect(),
    }
}

/// The view drawn for `value`, kept under `key` while the value stays the same.
pub(crate) fn generative_view(key: &str, value: &Value, cx: &mut App) -> Option<AnyView> {
    let hooks = hooks(cx)?;
    if let Some((shown, view)) = cx.global::<Hooks>().views.get(key)
        && shown == value
    {
        return Some(view.clone());
    }
    let view = hooks.generative_view(value, cx);
    cx.global_mut::<Hooks>().views.insert(key.to_string(), (value.clone(), view.clone()));
    Some(view)
}

pub fn extension_providers(cx: &App) -> Vec<ExtensionProvider> {
    hooks(cx).map(|hooks| hooks.providers(cx)).unwrap_or_default()
}

pub fn extension_settings_actions(cx: &App) -> Vec<ExtensionSettingsAction> {
    hooks(cx).map(|hooks| hooks.settings_actions(cx)).unwrap_or_default()
}

pub fn run_extension_settings_action(id: &str, cx: &mut App) {
    if let Some(hooks) = hooks(cx) {
        hooks.run_settings_action(id, cx);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::structured_views;

    #[test]
    fn finds_structured_views_in_tool_output() {
        let view = json!({ "type": "screen", "children": [] });
        assert_eq!(structured_views(&json!({ "type": "athas_ui", "view": view })), vec![&view]);
        let output = json!([{ "type": "text", "text": "x" }, { "type": "athas_ui", "view": view }]);
        assert_eq!(structured_views(&output), vec![&view]);
        assert!(structured_views(&json!({ "type": "athas_ui" })).is_empty());
        assert!(structured_views(&json!("done")).is_empty());
    }
}
