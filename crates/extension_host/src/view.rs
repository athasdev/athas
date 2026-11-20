//! The declarative view a UI extension renders: the node tree, its validating parser (the
//! original's `extension-view-schema.ts`) and the form helpers (`extension-view-form.ts`).

use std::collections::HashSet;
use std::fmt;

use serde::Serialize;
use serde_json::{Map, Value};

pub mod limits {
    pub const MAX_DEPTH: usize = 20;
    pub const MAX_NODES: usize = 500;
    pub const MAX_CHILDREN: usize = 100;
    pub const MAX_ACTIONS: usize = 20;
    pub const MAX_BADGES: usize = 10;
    pub const MAX_OPTIONS: usize = 100;
    pub const MAX_METADATA_ITEMS: usize = 100;
    pub const MAX_ACTIVITY_ITEMS: usize = 100;
    pub const MAX_TREE_ITEMS: usize = 250;
    pub const MAX_TREE_DEPTH: usize = 12;
    pub const MAX_ACTION_ARGS: usize = 20;
    pub const MAX_LABEL_LENGTH: usize = 500;
    pub const MAX_TEXT_LENGTH: usize = 20_000;
    pub const MAX_CODE_LENGTH: usize = 100_000;
    pub const MAX_TABLE_COLUMNS: usize = 20;
    pub const MAX_TABLE_ROWS: usize = 250;
    pub const MAX_CHART_POINTS: usize = 120;
    pub const MAX_CHART_ITEMS: usize = 50;
    pub const MAX_DIFF_LINES: usize = 500;
    pub const MAX_PAYLOAD_CHARACTERS: usize = 500_000;
    pub const MAX_PAYLOAD_VALUES: usize = 20_000;

    pub const MAX_FORM_FIELDS: usize = 50;
    pub const MAX_FIELD_NAME_LENGTH: usize = 64;
    pub const MAX_FIELD_VALUE_CHARACTERS: usize = 20_000;
    pub const MAX_FORM_PAYLOAD_CHARACTERS: usize = 100_000;
}

use limits::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Tone {
    #[default]
    Default,
    Muted,
    Accent,
    Success,
    Warning,
    Error,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ButtonTone {
    #[default]
    Default,
    Accent,
    Danger,
    Ghost,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CalloutTone {
    #[default]
    Default,
    Info,
    Success,
    Warning,
    Error,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CardVariant {
    #[default]
    Default,
    Muted,
    Outline,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InputType {
    #[default]
    Text,
    Password,
    Url,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivityState {
    #[default]
    Default,
    Running,
    Success,
    Warning,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffLineType {
    Context,
    Added,
    Removed,
    Header,
}

trait Named: Sized + Copy + 'static {
    const ALL: &'static [(&'static str, Self)];
}

macro_rules! named {
    ($ty:ty, $($name:literal => $value:expr),+ $(,)?) => {
        impl Named for $ty {
            const ALL: &'static [(&'static str, Self)] = &[$(($name, $value)),+];
        }
    };
}

named!(Tone, "default" => Tone::Default, "muted" => Tone::Muted, "accent" => Tone::Accent, "success" => Tone::Success, "warning" => Tone::Warning, "error" => Tone::Error);
named!(ButtonTone, "default" => ButtonTone::Default, "accent" => ButtonTone::Accent, "danger" => ButtonTone::Danger, "ghost" => ButtonTone::Ghost);
named!(CalloutTone, "default" => CalloutTone::Default, "info" => CalloutTone::Info, "success" => CalloutTone::Success, "warning" => CalloutTone::Warning, "error" => CalloutTone::Error);
named!(CardVariant, "default" => CardVariant::Default, "muted" => CardVariant::Muted, "outline" => CardVariant::Outline);
named!(InputType, "text" => InputType::Text, "password" => InputType::Password, "url" => InputType::Url);
named!(ActivityState, "default" => ActivityState::Default, "running" => ActivityState::Running, "success" => ActivityState::Success, "warning" => ActivityState::Warning, "error" => ActivityState::Error);
named!(DiffLineType, "context" => DiffLineType::Context, "added" => DiffLineType::Added, "removed" => DiffLineType::Removed, "header" => DiffLineType::Header);

/// A command the view asks the extension to run, with the arguments it was given.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Action {
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<Value>>,
}

impl Action {
    /// The action's own arguments followed by `extra` (the value of a control, form values).
    pub fn arguments(&self, extra: impl IntoIterator<Item = Value>) -> Vec<Value> {
        self.args.iter().flatten().cloned().chain(extra).collect()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Badge {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<Tone>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeItem {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badges: Option<Vec<Badge>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expanded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_select: Option<Action>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeItem>>,
}

/// A string or a finite number, shown as given.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum ViewValue {
    Number(f64),
    Text(String),
}

impl fmt::Display for ViewValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ViewValue::Text(text) => f.write_str(text),
            ViewValue::Number(number) => f.write_str(&format_number(*number)),
        }
    }
}

/// A number the way JavaScript's `String(number)` writes it for ordinary values.
pub fn format_number(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e21 {
        format!("{}", number as i64)
    } else {
        format!("{number}")
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenAction {
    pub label: String,
    pub action: Action,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarItem {
    pub label: String,
    pub value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<Tone>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub kind: DiffLineType,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_line: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<ActivityState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_select: Option<Action>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SelectOption {
    pub label: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TabItem {
    pub value: String,
    pub label: String,
    pub children: Vec<Node>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct KeyValueItem {
    pub label: String,
    pub value: ViewValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<Tone>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monospace: Option<bool>,
}

/// The `name`/`required` pair a control carries inside a form.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct FormField {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum ChoiceValue {
    One(String),
    Many(Vec<String>),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Node {
    Screen {
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        actions: Option<Vec<ScreenAction>>,
        children: Vec<Node>,
    },
    Stack {
        children: Vec<Node>,
    },
    Row {
        children: Vec<Node>,
    },
    Section {
        title: String,
        children: Vec<Node>,
    },
    Card {
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        variant: Option<CardVariant>,
        children: Vec<Node>,
    },
    Form {
        submit_label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pending_label: Option<String>,
        on_submit: Action,
        #[serde(skip_serializing_if = "Option::is_none")]
        disabled: Option<bool>,
        children: Vec<Node>,
    },
    Text {
        value: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tone: Option<Tone>,
    },
    Badge {
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tone: Option<Tone>,
    },
    Metric {
        label: String,
        value: ViewValue,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tone: Option<Tone>,
    },
    Progress {
        value: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    Sparkline {
        label: String,
        values: Vec<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tone: Option<Tone>,
    },
    BarChart {
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        items: Vec<BarItem>,
    },
    Callout {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tone: Option<CalloutTone>,
    },
    Table {
        columns: Vec<String>,
        rows: Vec<Vec<ViewValue>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
    },
    Code {
        value: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        wrap: Option<bool>,
    },
    Diff {
        file_path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        old_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
        lines: Vec<DiffLine>,
        #[serde(skip_serializing_if = "Option::is_none")]
        truncated: Option<bool>,
    },
    Activity {
        items: Vec<ActivityItem>,
    },
    Button {
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pending_label: Option<String>,
        action: Action,
        #[serde(skip_serializing_if = "Option::is_none")]
        tone: Option<ButtonTone>,
        #[serde(skip_serializing_if = "Option::is_none")]
        disabled: Option<bool>,
    },
    Input {
        #[serde(flatten)]
        field: FormField,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        placeholder: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        input_type: Option<InputType>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_change: Option<Action>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_submit: Option<Action>,
        #[serde(skip_serializing_if = "Option::is_none")]
        disabled: Option<bool>,
    },
    Textarea {
        #[serde(flatten)]
        field: FormField,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        placeholder: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        rows: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_change: Option<Action>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_submit: Option<Action>,
        #[serde(skip_serializing_if = "Option::is_none")]
        disabled: Option<bool>,
    },
    NumberInput {
        #[serde(flatten)]
        field: FormField,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        value: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        placeholder: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        min: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        max: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        step: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_change: Option<Action>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_submit: Option<Action>,
        #[serde(skip_serializing_if = "Option::is_none")]
        disabled: Option<bool>,
    },
    Select {
        #[serde(flatten)]
        field: FormField,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        placeholder: Option<String>,
        options: Vec<SelectOption>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_change: Option<Action>,
        #[serde(skip_serializing_if = "Option::is_none")]
        disabled: Option<bool>,
    },
    Toggle {
        #[serde(flatten)]
        field: FormField,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        checked: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_change: Option<Action>,
        #[serde(skip_serializing_if = "Option::is_none")]
        disabled: Option<bool>,
    },
    Checkbox {
        #[serde(flatten)]
        field: FormField,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        checked: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_change: Option<Action>,
        #[serde(skip_serializing_if = "Option::is_none")]
        disabled: Option<bool>,
    },
    Choice {
        #[serde(flatten)]
        field: FormField,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        multiple: bool,
        value: ChoiceValue,
        options: Vec<SelectOption>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_change: Option<Action>,
        #[serde(skip_serializing_if = "Option::is_none")]
        disabled: Option<bool>,
    },
    Tabs {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
        tabs: Vec<TabItem>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_change: Option<Action>,
    },
    Disclosure {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        open: Option<bool>,
        children: Vec<Node>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_change: Option<Action>,
    },
    KeyValue {
        items: Vec<KeyValueItem>,
    },
    List {
        children: Vec<Node>,
    },
    Tree {
        label: String,
        items: Vec<TreeItem>,
    },
    ListItem {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        meta: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        badges: Option<Vec<Badge>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        on_select: Option<Action>,
    },
    Empty {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    Loading {
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    Error {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    Divider,
}

impl Node {
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    /// The nodes nested directly inside this one (tab panels included).
    pub fn children(&self) -> Vec<&Node> {
        match self {
            Node::Screen { children, .. }
            | Node::Stack { children }
            | Node::Row { children }
            | Node::Section { children, .. }
            | Node::Card { children, .. }
            | Node::Form { children, .. }
            | Node::Disclosure { children, .. }
            | Node::List { children } => children.iter().collect(),
            Node::Tabs { tabs, .. } => tabs.iter().flat_map(|tab| tab.children.iter()).collect(),
            _ => Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ViewError(pub String);

impl fmt::Display for ViewError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ViewError {}

type Result<T> = std::result::Result<T, ViewError>;

fn fail<T>(path: &str, message: impl fmt::Display) -> Result<T> {
    Err(ViewError(format!("Invalid integration view at {path}: {message}")))
}

/// The length JavaScript reports for a string (UTF-16 units).
pub fn js_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn assert_payload_budget(value: &Value) -> Result<()> {
    let mut pending = vec![value];
    let mut characters = 0;
    let mut values = 0;
    while let Some(current) = pending.pop() {
        values += 1;
        if values > MAX_PAYLOAD_VALUES {
            return fail("$", format!("exceeds the maximum payload size of {MAX_PAYLOAD_VALUES} values"));
        }
        match current {
            Value::String(text) => {
                characters += js_len(text);
                if characters > MAX_PAYLOAD_CHARACTERS {
                    return fail("$", format!("exceeds the maximum text payload of {MAX_PAYLOAD_CHARACTERS} characters"));
                }
            }
            Value::Array(items) => pending.extend(items.iter()),
            Value::Object(map) => pending.extend(map.values()),
            _ => {}
        }
    }
    Ok(())
}

struct ParseContext {
    nodes: usize,
    form_depth: usize,
}

static EMPTY: Value = Value::Null;

fn field<'a>(node: &'a Map<String, Value>, key: &str) -> &'a Value {
    node.get(key).unwrap_or(&EMPTY)
}

fn read_record<'a>(value: &'a Value, path: &str) -> Result<&'a Map<String, Value>> {
    match value {
        Value::Object(map) => Ok(map),
        _ => fail(path, "expected an object"),
    }
}

fn read_array<'a>(value: &'a Value, path: &str) -> Result<&'a Vec<Value>> {
    match value {
        Value::Array(items) => Ok(items),
        _ => fail(path, "expected an array"),
    }
}

fn read_string_with(value: &Value, path: &str, max: usize, allow_empty: bool) -> Result<String> {
    let Value::String(text) = value else {
        return fail(path, "expected a string");
    };
    if !allow_empty && text.trim().is_empty() {
        return fail(path, "must not be empty");
    }
    if js_len(text) > max {
        return fail(path, format!("must be at most {max} characters"));
    }
    Ok(text.clone())
}

fn read_string(value: &Value, path: &str, max: usize) -> Result<String> {
    read_string_with(value, path, max, false)
}

fn read_optional_string(value: &Value, path: &str, max: usize) -> Result<Option<String>> {
    if value.is_null() { Ok(None) } else { read_string_with(value, path, max, true).map(Some) }
}

fn read_finite_number(value: &Value, path: &str) -> Result<f64> {
    match value.as_f64() {
        Some(number) if value.is_number() && number.is_finite() => Ok(number),
        _ => fail(path, "expected a finite number"),
    }
}

fn read_optional_finite_number(value: &Value, path: &str) -> Result<Option<f64>> {
    if value.is_null() { Ok(None) } else { read_finite_number(value, path).map(Some) }
}

fn read_optional_line_number(value: &Value, path: &str) -> Result<Option<u32>> {
    match read_optional_finite_number(value, path)? {
        Some(number) if number.fract() != 0.0 || number < 1.0 => fail(path, "must be a positive integer"),
        Some(number) => Ok(Some(number as u32)),
        None => Ok(None),
    }
}

fn read_optional_bool(value: &Value, path: &str) -> Result<Option<bool>> {
    match value {
        Value::Null => Ok(None),
        Value::Bool(flag) => Ok(Some(*flag)),
        _ => fail(path, "expected a boolean"),
    }
}

fn read_bool(value: &Value, path: &str) -> Result<bool> {
    match value {
        Value::Bool(flag) => Ok(*flag),
        _ => fail(path, "expected a boolean"),
    }
}

fn allowed<T: Named>() -> String {
    T::ALL.iter().map(|(name, _)| *name).collect::<Vec<_>>().join(", ")
}

fn read_optional_enum<T: Named>(value: &Value, path: &str) -> Result<Option<T>> {
    if value.is_null() {
        return Ok(None);
    }
    let found = value.as_str().and_then(|name| T::ALL.iter().find(|(candidate, _)| *candidate == name));
    match found {
        Some((_, value)) => Ok(Some(*value)),
        None => fail(path, format!("expected one of {}", allowed::<T>())),
    }
}

fn read_enum<T: Named>(value: &Value, path: &str) -> Result<T> {
    match read_optional_enum(value, path)? {
        Some(value) => Ok(value),
        None => fail(path, format!("expected one of {}", allowed::<T>())),
    }
}

fn is_valid_field_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|first| first.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

fn read_form_field(node: &Map<String, Value>, path: &str, context: &ParseContext) -> Result<FormField> {
    let name = match field(node, "name") {
        Value::Null => None,
        value => Some(read_string(value, &format!("{path}.name"), MAX_FIELD_NAME_LENGTH)?),
    };
    let required = read_optional_bool(field(node, "required"), &format!("{path}.required"))?;
    if (name.is_some() || required.is_some()) && context.form_depth == 0 {
        return fail(path, "form field metadata is only valid inside a form");
    }
    if required == Some(true) && name.is_none() {
        return fail(&format!("{path}.required"), "requires a form field name");
    }
    if required == Some(true) && field(node, "disabled") == &Value::Bool(true) {
        return fail(&format!("{path}.required"), "must not be used on a disabled field");
    }
    if let Some(name) = &name {
        if !is_valid_field_name(name) {
            return fail(&format!("{path}.name"), "must start with a letter and contain only letters, numbers, ., _, or -");
        }
        if ["constructor", "prototype", "__proto__"].contains(&name.as_str()) {
            return fail(&format!("{path}.name"), "uses a reserved field name");
        }
    }
    Ok(FormField { name, required })
}

fn read_action(value: &Value, path: &str) -> Result<Action> {
    let action = read_record(value, path)?;
    let args = match field(action, "args") {
        Value::Null => None,
        Value::Array(args) => {
            if args.len() > MAX_ACTION_ARGS {
                return fail(&format!("{path}.args"), format!("must contain at most {MAX_ACTION_ARGS} values"));
            }
            Some(args.clone())
        }
        _ => return fail(&format!("{path}.args"), "expected an array"),
    };
    Ok(Action { command: read_string(field(action, "command"), &format!("{path}.command"), MAX_LABEL_LENGTH)?, args })
}

fn read_optional_action(node: &Map<String, Value>, key: &str, path: &str) -> Result<Option<Action>> {
    match field(node, key) {
        Value::Null => Ok(None),
        value => read_action(value, &format!("{path}.{key}")).map(Some),
    }
}

fn read_badge(value: &Value, path: &str) -> Result<Badge> {
    let badge = read_record(value, path)?;
    Ok(Badge {
        label: read_string(field(badge, "label"), &format!("{path}.label"), MAX_LABEL_LENGTH)?,
        tone: read_optional_enum(field(badge, "tone"), &format!("{path}.tone"))?,
    })
}

fn read_badges(node: &Map<String, Value>, path: &str) -> Result<Option<Vec<Badge>>> {
    match field(node, "badges") {
        Value::Null => Ok(None),
        Value::Array(badges) => {
            if badges.len() > MAX_BADGES {
                return fail(&format!("{path}.badges"), format!("must contain at most {MAX_BADGES} badges"));
            }
            badges.iter().enumerate().map(|(index, badge)| read_badge(badge, &format!("{path}.badges[{index}]"))).collect::<Result<_>>().map(Some)
        }
        _ => fail(&format!("{path}.badges"), "expected an array"),
    }
}

struct TreeContext {
    items: usize,
    ids: HashSet<String>,
}

fn read_tree_items(value: &Value, path: &str, depth: usize, context: &mut TreeContext) -> Result<Vec<TreeItem>> {
    let items = read_array(value, path)?;
    if depth > MAX_TREE_DEPTH {
        return fail(path, format!("exceeds the maximum tree depth of {MAX_TREE_DEPTH}"));
    }
    if items.len() > MAX_CHILDREN {
        return fail(path, format!("must contain at most {MAX_CHILDREN} items"));
    }
    let mut result = Vec::with_capacity(items.len());
    for (index, value) in items.iter().enumerate() {
        let item_path = format!("{path}[{index}]");
        let item = read_record(value, &item_path)?;
        context.items += 1;
        if context.items > MAX_TREE_ITEMS {
            return fail(&item_path, format!("exceeds the maximum tree item count of {MAX_TREE_ITEMS}"));
        }
        let id = read_string(field(item, "id"), &format!("{item_path}.id"), MAX_LABEL_LENGTH)?;
        if !context.ids.insert(id.clone()) {
            return fail(&format!("{item_path}.id"), format!("contains duplicate tree item id \"{id}\""));
        }
        let badges = read_badges(item, &item_path)?;
        let children = match field(item, "children") {
            Value::Null => None,
            children => Some(read_tree_items(children, &format!("{item_path}.children"), depth + 1, context)?),
        };
        result.push(TreeItem {
            id,
            title: read_string(field(item, "title"), &format!("{item_path}.title"), MAX_LABEL_LENGTH)?,
            description: read_optional_string(field(item, "description"), &format!("{item_path}.description"), MAX_TEXT_LENGTH)?,
            meta: read_optional_string(field(item, "meta"), &format!("{item_path}.meta"), MAX_LABEL_LENGTH)?,
            icon: read_optional_string(field(item, "icon"), &format!("{item_path}.icon"), MAX_LABEL_LENGTH)?,
            badges,
            expanded: read_optional_bool(field(item, "expanded"), &format!("{item_path}.expanded"))?,
            on_select: read_optional_action(item, "onSelect", &item_path)?,
            children,
        });
    }
    Ok(result)
}

fn read_children(value: &Value, path: &str, depth: usize, context: &mut ParseContext) -> Result<Vec<Node>> {
    let items = read_array(value, path)?;
    if items.len() > MAX_CHILDREN {
        return fail(path, format!("must contain at most {MAX_CHILDREN} nodes"));
    }
    items.iter().enumerate().map(|(index, child)| read_node(child, &format!("{path}[{index}]"), depth + 1, context)).collect()
}

fn read_view_value(value: &Value, path: &str) -> Result<ViewValue> {
    if value.is_number() {
        return read_finite_number(value, path).map(ViewValue::Number);
    }
    read_string_with(value, path, MAX_TEXT_LENGTH, true).map(ViewValue::Text)
}

fn read_options(node: &Map<String, Value>, path: &str) -> Result<Vec<SelectOption>> {
    let options = read_array(field(node, "options"), &format!("{path}.options"))?;
    if options.is_empty() {
        return fail(&format!("{path}.options"), "must contain at least one option");
    }
    if options.len() > MAX_OPTIONS {
        return fail(&format!("{path}.options"), format!("must contain at most {MAX_OPTIONS} options"));
    }
    let options = options
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let option_path = format!("{path}.options[{index}]");
            let option = read_record(value, &option_path)?;
            Ok(SelectOption {
                label: read_string(field(option, "label"), &format!("{option_path}.label"), MAX_LABEL_LENGTH)?,
                value: read_string(field(option, "value"), &format!("{option_path}.value"), MAX_LABEL_LENGTH)?,
                disabled: read_optional_bool(field(option, "disabled"), &format!("{option_path}.disabled"))?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if options.iter().map(|option| &option.value).collect::<HashSet<_>>().len() != options.len() {
        return fail(&format!("{path}.options"), "must contain unique values");
    }
    Ok(options)
}

fn read_non_empty_items<'a>(node: &'a Map<String, Value>, path: &str, max: usize) -> Result<&'a Vec<Value>> {
    let items = read_array(field(node, "items"), &format!("{path}.items"))?;
    if items.is_empty() {
        return fail(&format!("{path}.items"), "must contain at least one item");
    }
    if items.len() > max {
        return fail(&format!("{path}.items"), format!("must contain at most {max} items"));
    }
    Ok(items)
}

fn require_handler(node: &Map<String, Value>, field_info: &FormField, path: &str, submit: bool) -> Result<()> {
    let has_handler = !field(node, "onChange").is_null() || (submit && !field(node, "onSubmit").is_null());
    if !has_handler && field_info.name.is_none() && field(node, "disabled") != &Value::Bool(true) {
        let message = if submit { "requires onChange, onSubmit, or a form field name" } else { "requires onChange or a form field name" };
        return fail(path, message);
    }
    Ok(())
}

fn read_node(value: &Value, path: &str, depth: usize, context: &mut ParseContext) -> Result<Node> {
    if depth > MAX_DEPTH {
        return fail(path, format!("exceeds the maximum depth of {MAX_DEPTH}"));
    }
    context.nodes += 1;
    if context.nodes > MAX_NODES {
        return fail(path, format!("exceeds the maximum node count of {MAX_NODES}"));
    }
    let node = read_record(value, path)?;
    let kind = read_string(field(node, "type"), &format!("{path}.type"), 40)?;
    let p = |key: &str| format!("{path}.{key}");
    let label_of = |key: &str| read_string(field(node, key), &p(key), MAX_LABEL_LENGTH);
    let optional_label = |key: &str| read_optional_string(field(node, key), &p(key), MAX_LABEL_LENGTH);
    let optional_text = |key: &str| read_optional_string(field(node, key), &p(key), MAX_TEXT_LENGTH);
    let optional_bool = |key: &str| read_optional_bool(field(node, key), &p(key));
    let action_of = |key: &str| read_optional_action(node, key, path);

    Ok(match kind.as_str() {
        "screen" => {
            let actions = match field(node, "actions") {
                Value::Null => None,
                Value::Array(actions) => {
                    if actions.len() > MAX_ACTIONS {
                        return fail(&p("actions"), format!("must contain at most {MAX_ACTIONS} actions"));
                    }
                    let mut result = Vec::new();
                    for (index, value) in actions.iter().enumerate() {
                        let action_path = format!("{path}.actions[{index}]");
                        let item = read_record(value, &action_path)?;
                        result.push(ScreenAction {
                            label: read_string(field(item, "label"), &format!("{action_path}.label"), MAX_LABEL_LENGTH)?,
                            icon: read_optional_string(field(item, "icon"), &format!("{action_path}.icon"), MAX_LABEL_LENGTH)?,
                            action: read_action(field(item, "action"), &format!("{action_path}.action"))?,
                        });
                    }
                    Some(result)
                }
                _ => return fail(&p("actions"), "expected an array"),
            };
            Node::Screen { title: optional_label("title")?, actions, children: read_children(field(node, "children"), &p("children"), depth, context)? }
        }
        "stack" => Node::Stack { children: read_children(field(node, "children"), &p("children"), depth, context)? },
        "row" => Node::Row { children: read_children(field(node, "children"), &p("children"), depth, context)? },
        "list" => Node::List { children: read_children(field(node, "children"), &p("children"), depth, context)? },
        "section" => Node::Section { title: label_of("title")?, children: read_children(field(node, "children"), &p("children"), depth, context)? },
        "card" => Node::Card {
            title: optional_label("title")?,
            description: optional_text("description")?,
            variant: read_optional_enum(field(node, "variant"), &p("variant"))?,
            children: read_children(field(node, "children"), &p("children"), depth, context)?,
        },
        "form" => {
            if context.form_depth > 0 {
                return fail(path, "forms must not be nested");
            }
            context.form_depth += 1;
            let children = read_children(field(node, "children"), &p("children"), depth, context);
            context.form_depth -= 1;
            let children = children?;
            let fields = collect_form_fields(&children);
            if fields.is_empty() {
                return fail(&p("children"), "must contain at least one named field");
            }
            if fields.len() > MAX_FORM_FIELDS {
                return fail(&p("children"), format!("must contain at most {MAX_FORM_FIELDS} named fields"));
            }
            let mut seen = HashSet::new();
            if let Some(duplicate) = fields.iter().find(|field| !seen.insert(field.name.clone())) {
                return fail(&p("children"), format!("contains duplicate field name \"{}\"", duplicate.name));
            }
            Node::Form {
                submit_label: label_of("submitLabel")?,
                pending_label: optional_label("pendingLabel")?,
                on_submit: read_action(field(node, "onSubmit"), &p("onSubmit"))?,
                disabled: optional_bool("disabled")?,
                children,
            }
        }
        "text" => Node::Text {
            value: read_string_with(field(node, "value"), &p("value"), MAX_TEXT_LENGTH, true)?,
            tone: read_optional_enum(field(node, "tone"), &p("tone"))?,
        },
        "badge" => Node::Badge { label: label_of("label")?, tone: read_optional_enum(field(node, "tone"), &p("tone"))? },
        "metric" => Node::Metric {
            label: label_of("label")?,
            value: read_view_value(field(node, "value"), &p("value"))?,
            detail: optional_label("detail")?,
            tone: read_optional_enum(field(node, "tone"), &p("tone"))?,
        },
        "progress" => Node::Progress {
            value: read_finite_number(field(node, "value"), &p("value"))?.clamp(0.0, 100.0),
            label: optional_label("label")?,
            detail: optional_label("detail")?,
        },
        "sparkline" => {
            let values = read_array(field(node, "values"), &p("values"))?;
            if values.len() < 2 {
                return fail(&p("values"), "must contain at least two points");
            }
            if values.len() > MAX_CHART_POINTS {
                return fail(&p("values"), format!("must contain at most {MAX_CHART_POINTS} points"));
            }
            Node::Sparkline {
                label: label_of("label")?,
                values: values.iter().enumerate().map(|(index, value)| read_finite_number(value, &format!("{path}.values[{index}]"))).collect::<Result<_>>()?,
                detail: optional_label("detail")?,
                tone: read_optional_enum(field(node, "tone"), &p("tone"))?,
            }
        }
        "barChart" => {
            let items = read_array(field(node, "items"), &p("items"))?;
            if items.is_empty() {
                return fail(&p("items"), "must contain at least one item");
            }
            if items.len() > MAX_CHART_ITEMS {
                return fail(&p("items"), format!("must contain at most {MAX_CHART_ITEMS} items"));
            }
            let mut bars = Vec::new();
            for (index, value) in items.iter().enumerate() {
                let item_path = format!("{path}.items[{index}]");
                let item = read_record(value, &item_path)?;
                let item_value = read_finite_number(field(item, "value"), &format!("{item_path}.value"))?;
                if item_value < 0.0 {
                    return fail(&format!("{item_path}.value"), "must not be negative");
                }
                bars.push(BarItem {
                    label: read_string(field(item, "label"), &format!("{item_path}.label"), MAX_LABEL_LENGTH)?,
                    value: item_value,
                    detail: read_optional_string(field(item, "detail"), &format!("{item_path}.detail"), MAX_LABEL_LENGTH)?,
                    tone: read_optional_enum(field(item, "tone"), &format!("{item_path}.tone"))?,
                });
            }
            Node::BarChart { label: optional_label("label")?, items: bars }
        }
        "callout" => Node::Callout { title: label_of("title")?, description: optional_text("description")?, tone: read_optional_enum(field(node, "tone"), &p("tone"))? },
        "table" => {
            let columns = read_array(field(node, "columns"), &p("columns"))?;
            if columns.is_empty() {
                return fail(&p("columns"), "must contain at least one column");
            }
            if columns.len() > MAX_TABLE_COLUMNS {
                return fail(&p("columns"), format!("must contain at most {MAX_TABLE_COLUMNS} columns"));
            }
            let rows = read_array(field(node, "rows"), &p("rows"))?;
            if rows.len() > MAX_TABLE_ROWS {
                return fail(&p("rows"), format!("must contain at most {MAX_TABLE_ROWS} rows"));
            }
            let columns = columns.iter().enumerate().map(|(index, column)| read_string(column, &format!("{path}.columns[{index}]"), MAX_LABEL_LENGTH)).collect::<Result<Vec<_>>>()?;
            let mut parsed_rows = Vec::new();
            for (row_index, row) in rows.iter().enumerate() {
                let row_path = format!("{path}.rows[{row_index}]");
                let cells = read_array(row, &row_path)?;
                if cells.len() > columns.len() {
                    return fail(&row_path, "contains more cells than the table has columns");
                }
                parsed_rows.push(cells.iter().enumerate().map(|(column, cell)| read_view_value(cell, &format!("{row_path}[{column}]"))).collect::<Result<Vec<_>>>()?);
            }
            Node::Table { columns, rows: parsed_rows, caption: optional_label("caption")? }
        }
        "code" => Node::Code {
            value: read_string_with(field(node, "value"), &p("value"), MAX_CODE_LENGTH, true)?,
            language: read_optional_string(field(node, "language"), &p("language"), 100)?,
            wrap: optional_bool("wrap")?,
        },
        "diff" => {
            let lines = read_array(field(node, "lines"), &p("lines"))?;
            if lines.is_empty() {
                return fail(&p("lines"), "must contain at least one line");
            }
            if lines.len() > MAX_DIFF_LINES {
                return fail(&p("lines"), format!("must contain at most {MAX_DIFF_LINES} lines"));
            }
            let mut parsed = Vec::new();
            for (index, value) in lines.iter().enumerate() {
                let line_path = format!("{path}.lines[{index}]");
                let line = read_record(value, &line_path)?;
                parsed.push(DiffLine {
                    kind: read_enum(field(line, "type"), &format!("{line_path}.type"))?,
                    content: read_string_with(field(line, "content"), &format!("{line_path}.content"), MAX_TEXT_LENGTH, true)?,
                    old_line: read_optional_line_number(field(line, "oldLine"), &format!("{line_path}.oldLine"))?,
                    new_line: read_optional_line_number(field(line, "newLine"), &format!("{line_path}.newLine"))?,
                });
            }
            Node::Diff {
                file_path: label_of("filePath")?,
                old_path: optional_label("oldPath")?,
                language: read_optional_string(field(node, "language"), &p("language"), 100)?,
                lines: parsed,
                truncated: optional_bool("truncated")?,
            }
        }
        "activity" => {
            let items = read_non_empty_items(node, path, MAX_ACTIVITY_ITEMS)?;
            let mut parsed = Vec::new();
            for (index, value) in items.iter().enumerate() {
                let item_path = format!("{path}.items[{index}]");
                let item = read_record(value, &item_path)?;
                parsed.push(ActivityItem {
                    title: read_string(field(item, "title"), &format!("{item_path}.title"), MAX_LABEL_LENGTH)?,
                    description: read_optional_string(field(item, "description"), &format!("{item_path}.description"), MAX_TEXT_LENGTH)?,
                    meta: read_optional_string(field(item, "meta"), &format!("{item_path}.meta"), MAX_LABEL_LENGTH)?,
                    state: read_optional_enum(field(item, "state"), &format!("{item_path}.state"))?,
                    icon: read_optional_string(field(item, "icon"), &format!("{item_path}.icon"), MAX_LABEL_LENGTH)?,
                    on_select: read_optional_action(item, "onSelect", &item_path)?,
                });
            }
            Node::Activity { items: parsed }
        }
        "button" => Node::Button {
            label: label_of("label")?,
            pending_label: optional_label("pendingLabel")?,
            action: read_action(field(node, "action"), &p("action"))?,
            tone: read_optional_enum(field(node, "tone"), &p("tone"))?,
            disabled: optional_bool("disabled")?,
        },
        "input" => {
            let form_field = read_form_field(node, path, context)?;
            require_handler(node, &form_field, path, true)?;
            Node::Input {
                field: form_field,
                label: optional_label("label")?,
                value: optional_text("value")?,
                placeholder: optional_label("placeholder")?,
                input_type: read_optional_enum(field(node, "inputType"), &p("inputType"))?,
                on_change: action_of("onChange")?,
                on_submit: action_of("onSubmit")?,
                disabled: optional_bool("disabled")?,
            }
        }
        "textarea" => {
            let form_field = read_form_field(node, path, context)?;
            require_handler(node, &form_field, path, true)?;
            let rows = read_optional_finite_number(field(node, "rows"), &p("rows"))?;
            if let Some(rows) = rows
                && (rows.fract() != 0.0 || !(2.0..=12.0).contains(&rows))
            {
                return fail(&p("rows"), "must be an integer between 2 and 12");
            }
            Node::Textarea {
                field: form_field,
                label: optional_label("label")?,
                value: optional_text("value")?,
                placeholder: optional_label("placeholder")?,
                rows: rows.map(|rows| rows as u32),
                on_change: action_of("onChange")?,
                on_submit: action_of("onSubmit")?,
                disabled: optional_bool("disabled")?,
            }
        }
        "numberInput" => {
            let form_field = read_form_field(node, path, context)?;
            require_handler(node, &form_field, path, true)?;
            let value = read_finite_number(field(node, "value"), &p("value"))?;
            let min = read_optional_finite_number(field(node, "min"), &p("min"))?;
            let max = read_optional_finite_number(field(node, "max"), &p("max"))?;
            let step = read_optional_finite_number(field(node, "step"), &p("step"))?;
            if step.is_some_and(|step| step <= 0.0) {
                return fail(&p("step"), "must be greater than zero");
            }
            if let (Some(min), Some(max)) = (min, max)
                && min > max
            {
                return fail(path, "minimum must not be greater than maximum");
            }
            if min.is_some_and(|min| value < min) {
                return fail(&p("value"), "must not be less than the minimum");
            }
            if max.is_some_and(|max| value > max) {
                return fail(&p("value"), "must not be greater than the maximum");
            }
            Node::NumberInput {
                field: form_field,
                label: optional_label("label")?,
                value,
                placeholder: optional_label("placeholder")?,
                min,
                max,
                step,
                on_change: action_of("onChange")?,
                on_submit: action_of("onSubmit")?,
                disabled: optional_bool("disabled")?,
            }
        }
        "select" => {
            let form_field = read_form_field(node, path, context)?;
            require_handler(node, &form_field, path, false)?;
            let options = read_options(node, path)?;
            Node::Select {
                field: form_field,
                label: optional_label("label")?,
                value: optional_label("value")?,
                placeholder: optional_label("placeholder")?,
                options,
                on_change: action_of("onChange")?,
                disabled: optional_bool("disabled")?,
            }
        }
        "toggle" | "checkbox" => {
            let form_field = read_form_field(node, path, context)?;
            require_handler(node, &form_field, path, false)?;
            let label = label_of("label")?;
            let description = optional_text("description")?;
            let checked = read_bool(field(node, "checked"), &p("checked"))?;
            let on_change = action_of("onChange")?;
            let disabled = optional_bool("disabled")?;
            if kind == "toggle" {
                Node::Toggle { field: form_field, label, description, checked, on_change, disabled }
            } else {
                Node::Checkbox { field: form_field, label, description, checked, on_change, disabled }
            }
        }
        "choice" => {
            let form_field = read_form_field(node, path, context)?;
            require_handler(node, &form_field, path, false)?;
            let options = read_options(node, path)?;
            let multiple = optional_bool("multiple")?.unwrap_or(false);
            let selected = if multiple {
                let values = read_array(field(node, "value"), &p("value"))?;
                let selected = values.iter().enumerate().map(|(index, value)| read_string(value, &format!("{path}.value[{index}]"), MAX_LABEL_LENGTH)).collect::<Result<Vec<_>>>()?;
                if selected.iter().collect::<HashSet<_>>().len() != selected.len() {
                    return fail(&p("value"), "must contain unique values");
                }
                ChoiceValue::Many(selected)
            } else {
                if field(node, "value").is_array() {
                    return fail(&p("value"), "expected a string");
                }
                ChoiceValue::One(label_of("value")?)
            };
            let values: Vec<&String> = match &selected {
                ChoiceValue::One(value) => vec![value],
                ChoiceValue::Many(values) => values.iter().collect(),
            };
            if values.iter().any(|value| !options.iter().any(|option| &&option.value == value && option.disabled != Some(true))) {
                return fail(&p("value"), "must reference enabled options");
            }
            Node::Choice {
                field: form_field,
                label: optional_label("label")?,
                description: optional_text("description")?,
                multiple,
                value: selected,
                options,
                on_change: action_of("onChange")?,
                disabled: optional_bool("disabled")?,
            }
        }
        "tabs" => {
            let tabs = read_array(field(node, "tabs"), &p("tabs"))?;
            if tabs.is_empty() {
                return fail(&p("tabs"), "must contain at least one tab");
            }
            if tabs.len() > MAX_OPTIONS {
                return fail(&p("tabs"), format!("must contain at most {MAX_OPTIONS} tabs"));
            }
            let mut parsed = Vec::new();
            for (index, value) in tabs.iter().enumerate() {
                let tab_path = format!("{path}.tabs[{index}]");
                let tab = read_record(value, &tab_path)?;
                parsed.push(TabItem {
                    value: read_string(field(tab, "value"), &format!("{tab_path}.value"), MAX_LABEL_LENGTH)?,
                    label: read_string(field(tab, "label"), &format!("{tab_path}.label"), MAX_LABEL_LENGTH)?,
                    children: read_children(field(tab, "children"), &format!("{tab_path}.children"), depth, context)?,
                    disabled: read_optional_bool(field(tab, "disabled"), &format!("{tab_path}.disabled"))?,
                });
            }
            if parsed.iter().map(|tab| &tab.value).collect::<HashSet<_>>().len() != parsed.len() {
                return fail(&p("tabs"), "must contain unique values");
            }
            let value = optional_label("value")?;
            if let Some(selected) = value.as_ref().filter(|value| !value.is_empty())
                && !parsed.iter().any(|tab| &tab.value == selected && tab.disabled != Some(true))
            {
                return fail(&p("value"), "must reference an enabled tab");
            }
            Node::Tabs { value, tabs: parsed, on_change: action_of("onChange")? }
        }
        "disclosure" => Node::Disclosure {
            title: label_of("title")?,
            description: optional_text("description")?,
            open: optional_bool("open")?,
            children: read_children(field(node, "children"), &p("children"), depth, context)?,
            on_change: action_of("onChange")?,
        },
        "keyValue" => {
            let items = read_non_empty_items(node, path, MAX_METADATA_ITEMS)?;
            let mut parsed = Vec::new();
            for (index, value) in items.iter().enumerate() {
                let item_path = format!("{path}.items[{index}]");
                let item = read_record(value, &item_path)?;
                parsed.push(KeyValueItem {
                    label: read_string(field(item, "label"), &format!("{item_path}.label"), MAX_LABEL_LENGTH)?,
                    value: read_view_value(field(item, "value"), &format!("{item_path}.value"))?,
                    tone: read_optional_enum(field(item, "tone"), &format!("{item_path}.tone"))?,
                    monospace: read_optional_bool(field(item, "monospace"), &format!("{item_path}.monospace"))?,
                });
            }
            Node::KeyValue { items: parsed }
        }
        "tree" => {
            let items = read_array(field(node, "items"), &p("items"))?;
            if items.is_empty() {
                return fail(&p("items"), "must contain at least one item");
            }
            Node::Tree {
                label: label_of("label")?,
                items: read_tree_items(field(node, "items"), &p("items"), 1, &mut TreeContext { items: 0, ids: HashSet::new() })?,
            }
        }
        "listItem" => Node::ListItem {
            badges: read_badges(node, path)?,
            title: label_of("title")?,
            description: optional_text("description")?,
            meta: optional_label("meta")?,
            on_select: action_of("onSelect")?,
        },
        "empty" => Node::Empty { message: label_of("message")?, description: optional_text("description")? },
        "loading" => Node::Loading { message: optional_label("message")? },
        "error" => Node::Error { message: label_of("message")?, description: optional_text("description")? },
        "divider" => Node::Divider,
        other => return fail(&p("type"), format!("unsupported node type \"{other}\"")),
    })
}

/// Validates an extension's view and returns the typed tree, or the first problem found.
pub fn parse_view(value: &Value) -> Result<Node> {
    assert_payload_budget(value)?;
    read_node(value, "$", 0, &mut ParseContext { nodes: 0, form_depth: 0 })
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum FormValue {
    Bool(bool),
    Number(f64),
    Text(String),
    List(Vec<String>),
}

impl FormValue {
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    pub fn is_missing(&self) -> bool {
        match self {
            FormValue::Text(text) => text.trim().is_empty(),
            FormValue::Number(number) => !number.is_finite(),
            FormValue::Bool(flag) => !flag,
            FormValue::List(items) => items.is_empty(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FormFieldState {
    pub name: String,
    pub value: FormValue,
    pub required: bool,
}

fn visit_form_fields(nodes: &[Node], fields: &mut Vec<FormFieldState>) {
    for node in nodes {
        let (form_field, value) = match node {
            Node::Input { field, value, .. } | Node::Textarea { field, value, .. } | Node::Select { field, value, .. } => {
                (field, FormValue::Text(value.clone().unwrap_or_default()))
            }
            Node::NumberInput { field, value, .. } => (field, FormValue::Number(*value)),
            Node::Choice { field, value, .. } => (
                field,
                match value {
                    ChoiceValue::One(value) => FormValue::Text(value.clone()),
                    ChoiceValue::Many(values) => FormValue::List(values.clone()),
                },
            ),
            Node::Toggle { field, checked, .. } | Node::Checkbox { field, checked, .. } => (field, FormValue::Bool(*checked)),
            Node::Screen { children, .. }
            | Node::Stack { children }
            | Node::Row { children }
            | Node::Section { children, .. }
            | Node::Card { children, .. }
            | Node::Form { children, .. }
            | Node::Disclosure { children, .. }
            | Node::List { children } => {
                visit_form_fields(children, fields);
                continue;
            }
            Node::Tabs { tabs, .. } => {
                for tab in tabs {
                    visit_form_fields(&tab.children, fields);
                }
                continue;
            }
            _ => continue,
        };
        if let Some(name) = &form_field.name {
            fields.push(FormFieldState { name: name.clone(), value, required: form_field.required == Some(true) });
        }
    }
}

pub fn collect_form_fields(nodes: &[Node]) -> Vec<FormFieldState> {
    let mut fields = Vec::new();
    visit_form_fields(nodes, &mut fields);
    fields
}

pub fn missing_form_fields(fields: &[FormFieldState], values: &Map<String, Value>) -> Vec<String> {
    fields
        .iter()
        .filter(|field| {
            field.required
                && match values.get(&field.name) {
                    None | Some(Value::Null) => true,
                    Some(Value::String(text)) => text.trim().is_empty(),
                    Some(Value::Number(number)) => !number.as_f64().is_some_and(f64::is_finite),
                    Some(Value::Bool(flag)) => !flag,
                    Some(Value::Array(items)) => items.is_empty(),
                    Some(Value::Object(_)) => false,
                }
        })
        .map(|field| field.name.clone())
        .collect()
}

pub fn form_payload_fits(values: &Map<String, Value>) -> bool {
    js_len(&Value::Object(values.clone()).to_string()) <= MAX_FORM_PAYLOAD_CHARACTERS
}

pub fn initial_form_values(fields: &[FormFieldState]) -> Map<String, Value> {
    fields.iter().map(|field| (field.name.clone(), field.value.to_json())).collect()
}
