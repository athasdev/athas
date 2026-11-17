//! Views an agent message carries (`generative-ui-adapter.ts`): either an extension view node, or
//! the older `{ type, props, children, actions }` component shape, converted to one.

use serde_json::{Map, Value, json};

use crate::view::{Node, ViewError, limits, parse_view};

pub const OPEN_EXTERNAL_VIEW_COMMAND: &str = "athas.openExternal";

fn is_legacy_component(value: &Value) -> bool {
    value.as_object().is_some_and(|record| record.get("props").is_some_and(Value::is_object))
}

fn legacy_action_node(action: &Map<String, Value>) -> Option<Value> {
    let non_empty = |key: &str| action.get(key).and_then(Value::as_str).filter(|text| !text.trim().is_empty());
    let command = non_empty("command").or_else(|| non_empty("url").map(|_| OPEN_EXTERNAL_VIEW_COMMAND))?;
    let label = non_empty("label")?;
    let mut view_action = json!({ "command": command });
    if command == OPEN_EXTERNAL_VIEW_COMMAND {
        view_action["args"] = json!([action.get("url")]);
    }
    let tone = match action.get("style").and_then(Value::as_str) {
        Some("primary") => "accent",
        Some("danger") => "danger",
        _ => "default",
    };
    Some(json!({ "type": "button", "label": label, "action": view_action, "tone": tone }))
}

fn legacy_actions(value: Option<&Value>) -> Vec<Value> {
    let Some(Value::Array(actions)) = value else {
        return Vec::new();
    };
    actions.iter().take(limits::MAX_ACTIONS).filter_map(Value::as_object).filter_map(legacy_action_node).collect()
}

fn text_value(value: &Value) -> Value {
    match value {
        Value::Number(_) => value.clone(),
        Value::Null => json!(""),
        Value::String(text) => json!(text),
        other => json!(js_string(other)),
    }
}

fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => "null".into(),
        Value::Array(items) => items.iter().map(|item| if item.is_null() { String::new() } else { js_string(item) }).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
        other => other.to_string(),
    }
}

fn legacy_table(props: &Map<String, Value>) -> Value {
    let rows: Vec<Vec<Value>> = match props.get("rows") {
        Some(Value::Array(rows)) => rows
            .iter()
            .map(|row| match row {
                Value::Array(cells) => cells.iter().map(text_value).collect(),
                other => vec![text_value(other)],
            })
            .collect(),
        _ => Vec::new(),
    };
    let headers: Vec<String> = match props.get("headers") {
        Some(Value::Array(headers)) => headers.iter().map(js_string).collect(),
        _ => Vec::new(),
    };
    let column_count = rows.iter().map(Vec::len).chain([headers.len()]).max().unwrap_or(0);
    if column_count == 0 {
        return json!({ "type": "empty", "message": "No table data" });
    }
    let columns: Vec<String> = (0..column_count).map(|index| headers.get(index).cloned().unwrap_or_else(|| format!("Column {}", index + 1))).collect();
    json!({ "type": "table", "columns": columns, "rows": rows })
}

struct AdapterContext {
    nodes: usize,
}

fn convert(value: &Value, depth: usize, context: &mut AdapterContext) -> Result<Value, ViewError> {
    if depth > limits::MAX_DEPTH {
        return Err(ViewError(format!("Legacy generative UI exceeds the maximum depth of {}.", limits::MAX_DEPTH)));
    }
    context.nodes += 1;
    if context.nodes > limits::MAX_NODES {
        return Err(ViewError(format!("Legacy generative UI exceeds the maximum node count of {}.", limits::MAX_NODES)));
    }
    let invalid = || ViewError("Legacy generative UI contains an invalid component.".into());
    let record = value.as_object().ok_or_else(invalid)?;
    let props = record.get("props").and_then(Value::as_object).ok_or_else(invalid)?;
    let kind = record.get("type").and_then(Value::as_str).ok_or_else(invalid)?;

    let mut content = Vec::new();
    if let Some(Value::Array(children)) = record.get("children") {
        if children.len() > limits::MAX_CHILDREN {
            return Err(ViewError(format!("Legacy generative UI must contain at most {} children per node.", limits::MAX_CHILDREN)));
        }
        for child in children {
            content.push(convert(child, depth + 1, context)?);
        }
    }
    content.extend(legacy_actions(record.get("actions")));

    Ok(match kind {
        "card" => {
            let mut card = json!({ "type": "card", "children": content });
            for key in ["title", "description"] {
                if let Some(text) = props.get(key).filter(|value| value.is_string()) {
                    card[key] = text.clone();
                }
            }
            card
        }
        "list" => {
            let mut items: Vec<Value> = match props.get("items") {
                Some(Value::Array(items)) => items.iter().map(|item| json!({ "type": "listItem", "title": js_string(item) })).collect(),
                _ => Vec::new(),
            };
            items.extend(content);
            json!({ "type": "list", "children": items })
        }
        "table" if content.is_empty() => legacy_table(props),
        "table" => {
            let mut children = vec![legacy_table(props)];
            children.extend(content);
            json!({ "type": "stack", "children": children })
        }
        "form" | "custom" => json!({ "type": "stack", "children": content }),
        other => return Err(ViewError(format!("Unsupported legacy generative UI component: {other}"))),
    })
}

pub fn normalize_generative_view(value: &Value) -> Result<Node, ViewError> {
    if !is_legacy_component(value) {
        return parse_view(value);
    }
    parse_view(&convert(value, 0, &mut AdapterContext { nodes: 0 })?)
}

/// The URL a generated view may open: HTTP or HTTPS only.
pub fn resolve_external_url(value: Option<&Value>) -> Result<String, String> {
    let text = value.and_then(Value::as_str).ok_or("The external URL is missing.")?;
    let url = url::Url::parse(text).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS links can be opened from generated UI.".into());
    }
    Ok(url.to_string())
}
