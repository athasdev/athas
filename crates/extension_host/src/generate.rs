//! Making a UI extension from a description: the model is told the extension API and the rules
//! generated code must follow, answers with one JSON record, and the record is validated the way
//! a stored one is before it installs.

use futures::future::LocalBoxFuture;
use serde_json::Value;

use crate::generated::{GeneratedExtension, read_generated_extension, wrap_generated_source};

/// Sends one prompt to the configured model and returns its text; mocked in tests.
pub trait ExtensionGenerator {
    fn complete(&self, system: String, prompt: String) -> LocalBoxFuture<'static, Result<String, String>>;
}

pub const SYSTEM_PROMPT: &str = r#"You write UI extensions for the Athas code editor.

Reply with exactly one JSON object and nothing else:
{"id": "kebab-case-id", "name": "Short name", "description": "One sentence.", "contributionType": "sidebar" | "toolbar" | "command", "permissions": {...}, "code": "..."}

`code` is the body of `async function activate(api)`. It runs in a sandbox with only `api`, timers and `console`:
- api.sidebar.registerView({ id, title, icon, render }) — render() returns a view node (may be async).
- api.toolbar.registerAction({ id, title, icon, position: "left" | "right", onClick }).
- api.commands.register({ id, title, category, run }), api.commands.execute(id, ...args).
- api.views.invalidate(viewId) re-renders a view; a view action re-renders its view on its own.
- api.storage.get/set/delete(key) keep JSON values for this extension (always allowed).
- api.notifications.show({ title, description, tone: "default" | "info" | "success" | "warning" | "error" }).
- api.http.request({ url, method, headers, body }) needs permissions.network: ["https://exact.origin"].
- api.secrets.get/set/delete needs permissions.secrets: true; api.workspace.getCurrent() needs permissions.workspace: "read";
  api.clipboard.writeText needs permissions.clipboardWrite: true; api.opener.openExternal needs permissions.openExternal: true.
  Request only the permissions the code uses, and every permission it uses.
- api.ui builds nodes: screen({ title, actions }, ...children), stack(...), row(...), section(title, ...), card({ title, description }, ...),
  form({ submitLabel, onSubmit(values) }, ...fields), text(value, tone), badge(label, tone), metric({ label, value, detail, tone }),
  progress({ value, label }), sparkline({ label, values }), barChart({ label, items: [{ label, value }] }), callout({ title, description, tone }),
  table({ columns, rows, caption }), code({ value, language }), keyValue({ items: [{ label, value }] }), list(...), listItem({ title, description, meta, onSelect }),
  tree({ label, items }), activity({ items }), button({ label, onClick, variant: "accent" }), input({ label, value, placeholder, name, onChange, onSubmit }),
  textarea(...), numberInput({ value, min, max, step, onChange }), select({ value, options: [{ label, value }], onChange }), toggle({ label, checked, onChange }),
  checkbox(...), choice({ value, options, multiple, onChange }), tabs({ value, tabs: [{ value, label, children }], onChange }), disclosure({ title, open }, ...),
  empty(message, description), loading(message), error(message, description), divider().
  Handlers can be plain functions; ids are namespaced for you.
Never use import, require, eval, Function, fetch, XMLHttpRequest, WebSocket, Worker, postMessage, document, window, self, globalThis or .constructor."#;

/// The JSON object in a model's reply: the whole reply, a fenced block, or the outermost braces.
pub fn extract_json(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Some(value);
    }
    if let Some(start) = trimmed.find("```") {
        let rest = &trimmed[start + 3..];
        let body_start = rest.find('\n').map(|index| index + 1).unwrap_or(0);
        if let Some(end) = rest[body_start..].find("```")
            && let Ok(value) = serde_json::from_str::<Value>(rest[body_start..body_start + end].trim())
        {
            return Some(value);
        }
    }
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    serde_json::from_str(trimmed.get(start..=end)?).ok()
}

/// Reads and validates a generated record (source rules, permissions and their use).
pub fn parse_generated_response(text: &str) -> Result<GeneratedExtension, String> {
    let value = extract_json(text).ok_or("The model did not answer with an extension")?;
    let extension = read_generated_extension(&value).ok_or_else(|| {
        let record = value.as_object();
        let code = record.and_then(|record| record.get("code")).and_then(Value::as_str);
        let permissions = record.and_then(|record| record.get("permissions")).cloned().unwrap_or(Value::Null);
        match code {
            None => "The generated extension is missing its id, name, description, contribution type or code".to_string(),
            Some(code) => crate::permissions::parse_generated_permissions(&permissions)
                .and_then(|permissions| crate::permissions::validate_generated_permission_usage(code, &permissions))
                .err()
                .unwrap_or_else(|| "The generated extension is missing its id, name, description or contribution type".into()),
        }
    })?;
    wrap_generated_source(&extension.code)?;
    Ok(extension)
}

pub async fn generate_extension(generator: &dyn ExtensionGenerator, prompt: &str) -> Result<GeneratedExtension, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("Describe the extension to create".into());
    }
    let reply = generator.complete(SYSTEM_PROMPT.to_string(), prompt.to_string()).await?;
    parse_generated_response(&reply)
}
