//! ACP elicitations (`elicitation/create`, https://agentclientprotocol.com/protocol/v1/elicitation).
//! Form mode maps onto questionnaire steps, and the user's answers back onto the content the
//! agent's schema asked for. URL mode asks the user to open a link, such as an MCP sign-in.
//!
//! Ported from Athas's `lib/acp-elicitation.ts`.

use std::collections::HashMap;

use serde_json::{Map, Value, json};

#[derive(Clone, Debug, PartialEq)]
pub struct ChoiceOption {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
    /// Claude's AskUserQuestion option preview (`_meta["_claude/askUserQuestionOption"].preview`).
    pub preview: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextKind {
    Text,
    Email,
    Url,
    Date,
    DateTime,
    Password,
}

#[derive(Clone, Debug, PartialEq)]
pub enum QuestionKind {
    Choice {
        multiple: bool,
        /// Yes/No for a boolean field; answered as `true`/`false`.
        boolean: bool,
        options: Vec<ChoiceOption>,
        defaults: Vec<String>,
        min_items: Option<u64>,
        max_items: Option<u64>,
        /// A free-text field the agent pairs with this question for answers outside the options.
        other_field: Option<String>,
    },
    Text {
        kind: TextKind,
        default: Option<String>,
        min_length: Option<u64>,
        max_length: Option<u64>,
    },
    Number {
        integer: bool,
        default: Option<f64>,
        minimum: Option<f64>,
        maximum: Option<f64>,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Question {
    pub name: String,
    pub title: String,
    pub description: Option<String>,
    pub required: bool,
    pub kind: QuestionKind,
}

/// What the user gave for one question: the options chosen and any typed text.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Answer {
    pub chosen: Vec<String>,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Link {
    Openable {
        href: String,
        host: String,
        /// Plain http: the page and anything typed into it travel unencrypted.
        insecure: bool,
        /// The host has punycode (`xn--`) labels, which can imitate a familiar domain.
        punycode: bool,
    },
    Refused(String),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Mode {
    Form {
        title: Option<String>,
        description: Option<String>,
        questions: Vec<Question>,
        /// A required field has a type this client cannot show, so the form cannot be accepted.
        unanswerable: bool,
    },
    Url {
        url: String,
        /// Matches the `elicitation/complete` notification sent when the flow finishes.
        elicitation_id: String,
        link: Link,
    },
}

/// An `elicitation/create` request, read for the prompt.
#[derive(Clone, Debug, PartialEq)]
pub struct Elicitation {
    pub message: String,
    pub mode: Mode,
}

impl Elicitation {
    pub fn parse(request: &Value) -> Option<Self> {
        let message = request.get("message").and_then(Value::as_str).unwrap_or_default().to_string();
        let mode = match request.get("mode").and_then(Value::as_str) {
            Some("url") => {
                let url = request.get("url").and_then(Value::as_str)?.to_string();
                let elicitation_id = request.get("elicitationId").and_then(Value::as_str).unwrap_or_default().to_string();
                let link = inspect_url(&url);
                Mode::Url { url, elicitation_id, link }
            }
            _ => {
                let schema = request.get("requestedSchema")?;
                let questions = questions(schema);
                let unanswerable = unanswerable(schema, &questions);
                Mode::Form { title: string(schema, "title"), description: string(schema, "description"), questions, unanswerable }
            }
        };
        Some(Elicitation { message, mode })
    }
}

fn string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).filter(|text| !text.is_empty()).map(str::to_string)
}

fn number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn count(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

/// Claude's adapter pairs each AskUserQuestion field with an optional `<name>_custom` text field
/// marked `_meta._askUserQuestionCustomAnswer = { questionId, isCustomAnswer: true }`.
fn custom_answer_target(property: &Value) -> Option<String> {
    let marker = property.pointer("/_meta/_askUserQuestionCustomAnswer")?;
    (marker.get("isCustomAnswer") == Some(&Value::Bool(true))).then(|| marker.get("questionId")?.as_str().map(str::to_string))?
}

fn is_secret(property: &Value) -> bool {
    property.pointer("/_meta/codex/isSecret") == Some(&Value::Bool(true))
}

/// codex-acp pairs a question with an optional `<id>_note` text field marked
/// `_meta.codex = { questionId, role: "user_note" }`, sent alongside the chosen option.
fn note_target(property: &Value) -> Option<String> {
    let codex = property.pointer("/_meta/codex")?;
    (codex.get("role").and_then(Value::as_str) == Some("user_note")).then(|| codex.get("questionId")?.as_str().map(str::to_string))?
}

fn to_options(values: Option<&Value>, titled: Option<&Value>) -> Vec<ChoiceOption> {
    if let Some(titled) = titled.and_then(Value::as_array).filter(|titled| !titled.is_empty()) {
        return titled
            .iter()
            .filter_map(|option| {
                let value = option.get("const")?.as_str()?.to_string();
                let preview = option
                    .pointer("/_meta/_claude~1askUserQuestionOption/preview")
                    .and_then(Value::as_str)
                    .filter(|preview| !preview.trim().is_empty())
                    .map(str::to_string);
                Some(ChoiceOption { label: string(option, "title").unwrap_or_else(|| value.clone()), value, description: string(option, "description"), preview })
            })
            .collect();
    }
    values
        .and_then(Value::as_array)
        .map(|values| {
            values.iter().filter_map(Value::as_str).map(|value| ChoiceOption { value: value.into(), label: value.into(), description: None, preview: None }).collect()
        })
        .unwrap_or_default()
}

fn boolean_options() -> Vec<ChoiceOption> {
    [("true", "Yes"), ("false", "No")].into_iter().map(|(value, label)| ChoiceOption { value: value.into(), label: label.into(), description: None, preview: None }).collect()
}

/// A question for each field this client can show; `None` for types it does not know.
fn to_question(name: &str, property: &Value, required: bool) -> Option<Question> {
    let kind = match property.get("type").and_then(Value::as_str)? {
        "array" => {
            // Multi-selects are titled `anyOf` items or string `enum` items. Other item types must
            // not be shown as a string multi-select.
            let items = property.get("items")?;
            let options = if items.get("anyOf").and_then(Value::as_array).is_some_and(|any| !any.is_empty()) {
                to_options(None, items.get("anyOf"))
            } else if items.get("enum").and_then(Value::as_array).is_some_and(|values| !values.is_empty())
                && matches!(items.get("type").and_then(Value::as_str), None | Some("string"))
            {
                to_options(items.get("enum"), None)
            } else {
                return None;
            };
            let defaults = property
                .get("default")
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            QuestionKind::Choice {
                multiple: true,
                boolean: false,
                options,
                defaults,
                min_items: count(property, "minItems"),
                max_items: count(property, "maxItems"),
                other_field: None,
            }
        }
        "boolean" => QuestionKind::Choice {
            multiple: false,
            boolean: true,
            options: boolean_options(),
            defaults: property.get("default").and_then(Value::as_bool).map(|value| vec![value.to_string()]).unwrap_or_default(),
            min_items: None,
            max_items: None,
            other_field: None,
        },
        kind @ ("number" | "integer") => QuestionKind::Number {
            integer: kind == "integer",
            default: number(property, "default"),
            minimum: number(property, "minimum"),
            maximum: number(property, "maximum"),
        },
        "string" => {
            let options = to_options(property.get("enum"), property.get("oneOf"));
            if !options.is_empty() {
                QuestionKind::Choice {
                    multiple: false,
                    boolean: false,
                    options,
                    defaults: string(property, "default").into_iter().collect(),
                    min_items: None,
                    max_items: None,
                    other_field: None,
                }
            } else {
                let kind = if is_secret(property) {
                    TextKind::Password
                } else {
                    match property.get("format").and_then(Value::as_str) {
                        Some("email") => TextKind::Email,
                        Some("uri") => TextKind::Url,
                        Some("date") => TextKind::Date,
                        Some("date-time") => TextKind::DateTime,
                        _ => TextKind::Text,
                    }
                };
                QuestionKind::Text {
                    kind,
                    default: property.get("default").and_then(Value::as_str).map(str::to_string),
                    min_length: count(property, "minLength"),
                    max_length: count(property, "maxLength"),
                }
            }
        }
        _ => return None,
    };
    Some(Question { name: name.to_string(), title: string(property, "title").unwrap_or_else(|| name.to_string()), description: string(property, "description"), required, kind })
}

fn required_names(schema: &Value) -> Vec<String> {
    schema.get("required").and_then(Value::as_array).map(|names| names.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
}

/// One questionnaire step per schema field, in schema order. Claude's paired custom-answer fields
/// fold into their choice question; a codex-acp note becomes an optional step after its question.
/// Fields of unknown types are left out; see [`unanswerable`].
pub fn questions(schema: &Value) -> Vec<Question> {
    let empty = Map::new();
    let properties = schema.get("properties").and_then(Value::as_object).unwrap_or(&empty);
    let required = required_names(schema);
    let mut questions: Vec<Question> = Vec::new();
    let mut custom_fields: Vec<(String, String)> = Vec::new();
    for (name, property) in properties {
        if let Some(target) = custom_answer_target(property).filter(|target| properties.contains_key(target)) {
            custom_fields.push((target, name.clone()));
            continue;
        }
        let Some(mut question) = to_question(name, property, required.contains(name)) else { continue };
        if let Some(noted) = note_target(property).and_then(|target| properties.get(&target).map(|field| (target, field)))
            && matches!(question.kind, QuestionKind::Text { .. })
        {
            question.title = "Anything to add?".into();
            question.description = Some(string(noted.1, "title").unwrap_or(noted.0));
        }
        questions.push(question);
    }
    for (target, field) in custom_fields {
        if let Some(question) = questions.iter_mut().find(|question| question.name == target)
            && let QuestionKind::Choice { other_field, .. } = &mut question.kind
        {
            *other_field = Some(field);
            continue;
        }
        // No choice question to attach to: ask for the custom answer on its own.
        if let Some(orphan) = to_question(&field, &properties[&field], required.contains(&field)) {
            questions.push(orphan);
        }
    }
    questions
}

/// True when a required field has a type this client cannot show, so the form cannot be accepted.
pub fn unanswerable(schema: &Value, questions: &[Question]) -> bool {
    let empty = Map::new();
    let properties = schema.get("properties").and_then(Value::as_object).unwrap_or(&empty);
    let answerable: Vec<&str> = questions
        .iter()
        .flat_map(|question| {
            let other = match &question.kind {
                QuestionKind::Choice { other_field: Some(field), .. } => Some(field.as_str()),
                _ => None,
            };
            std::iter::once(question.name.as_str()).chain(other)
        })
        .collect();
    required_names(schema).iter().any(|name| properties.contains_key(name) && !answerable.contains(&name.as_str()))
}

/// The answers a question starts with: its defaults.
pub fn default_answer(question: &Question) -> Answer {
    match &question.kind {
        QuestionKind::Choice { defaults, .. } => Answer { chosen: defaults.clone(), text: String::new() },
        QuestionKind::Text { default, .. } => Answer { chosen: Vec::new(), text: default.clone().unwrap_or_default() },
        QuestionKind::Number { default, .. } => Answer { chosen: Vec::new(), text: default.map(format_number).unwrap_or_default() },
    }
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 { format!("{}", value as i64) } else { value.to_string() }
}

/// What is wrong with the answer to `question`, as a message for the user.
pub fn question_error(question: &Question, answer: &Answer) -> Option<String> {
    let text = answer.text.trim();
    match &question.kind {
        QuestionKind::Choice { multiple, min_items, max_items, other_field, .. } => {
            let count = answer.chosen.len() as u64;
            let typed = other_field.is_some() && !text.is_empty();
            if question.required && count == 0 && !typed {
                return Some(format!("{}: choose an answer.", question.title));
            }
            // An optional question left unanswered is fine; min/max apply once something is chosen.
            if *multiple && count > 0 {
                if let Some(min) = min_items.filter(|min| count < *min) {
                    return Some(format!("{}: choose at least {min}.", question.title));
                }
                if let Some(max) = max_items.filter(|max| count > *max) {
                    return Some(format!("{}: choose at most {max}.", question.title));
                }
            }
            None
        }
        QuestionKind::Text { kind, min_length, max_length, .. } => {
            if text.is_empty() {
                return question.required.then(|| format!("{}: enter an answer.", question.title));
            }
            let length = text.chars().count() as u64;
            if let Some(min) = min_length.filter(|min| length < *min) {
                return Some(format!("{}: enter at least {min} characters.", question.title));
            }
            if let Some(max) = max_length.filter(|max| length > *max) {
                return Some(format!("{}: enter at most {max} characters.", question.title));
            }
            match kind {
                TextKind::Email if !text.contains('@') => Some(format!("{}: enter an email address.", question.title)),
                TextKind::Url if !matches!(inspect_url(text), Link::Openable { .. }) => Some(format!("{}: enter a web address.", question.title)),
                _ => None,
            }
        }
        QuestionKind::Number { integer, minimum, maximum, .. } => {
            if text.is_empty() {
                return question.required.then(|| format!("{}: enter a number.", question.title));
            }
            let Ok(value) = text.parse::<f64>() else { return Some(format!("{}: enter a number.", question.title)) };
            if !value.is_finite() || (*integer && value.fract() != 0.0) {
                return Some(format!("{}: enter a whole number.", question.title));
            }
            if let Some(min) = minimum.filter(|min| value < *min) {
                return Some(format!("{}: enter at least {}.", question.title, format_number(min)));
            }
            if let Some(max) = maximum.filter(|max| value > *max) {
                return Some(format!("{}: enter at most {}.", question.title, format_number(max)));
            }
            None
        }
    }
}

/// The first problem with the answers, as a message for the user.
pub fn find_error(questions: &[Question], answers: &HashMap<String, Answer>) -> Option<String> {
    let blank = Answer::default();
    questions.iter().find_map(|question| question_error(question, answers.get(&question.name).unwrap_or(&blank)))
}

/// Builds the `accept` content from the answers. Choices go to the question's field; text typed next
/// to choices goes to its paired custom field. Unanswered optional fields are left out.
pub fn content(questions: &[Question], answers: &HashMap<String, Answer>) -> Map<String, Value> {
    let mut content = Map::new();
    for question in questions {
        let Some(answer) = answers.get(&question.name) else { continue };
        let text = answer.text.trim();
        match &question.kind {
            QuestionKind::Number { .. } => {
                if let Ok(value) = text.parse::<f64>()
                    && value.is_finite()
                {
                    let number = if value.fract() == 0.0 && value.abs() < 9e15 { json!(value as i64) } else { json!(value) };
                    content.insert(question.name.clone(), number);
                }
            }
            QuestionKind::Text { .. } => {
                if !text.is_empty() {
                    content.insert(question.name.clone(), json!(text));
                }
            }
            QuestionKind::Choice { multiple, boolean, options, other_field, .. } => {
                let chosen: Vec<&String> = answer.chosen.iter().filter(|value| options.iter().any(|option| &option.value == *value)).collect();
                if *boolean {
                    if let Some(first) = chosen.first() {
                        content.insert(question.name.clone(), json!(first.as_str() == "true"));
                    }
                } else if *multiple {
                    if !chosen.is_empty() {
                        content.insert(question.name.clone(), json!(chosen));
                    }
                } else if let Some(first) = chosen.first() {
                    content.insert(question.name.clone(), json!(first));
                }
                if let Some(field) = other_field
                    && !text.is_empty()
                {
                    content.insert(field.clone(), json!(text));
                }
            }
        }
    }
    content
}

/// Checks a URL-mode link before the user is asked to open it. Only web links open; anything else
/// (file:, javascript:, custom schemes) is shown but refused.
pub fn inspect_url(url: &str) -> Link {
    let url = url.trim();
    let Some((scheme, rest)) = url.split_once(':') else { return Link::Refused("This link is not a valid URL.".into()) };
    if scheme.is_empty() || !scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')) {
        return Link::Refused("This link is not a valid URL.".into());
    }
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return Link::Refused(format!("Athas only opens web links, not {scheme}: links."));
    }
    let Some(rest) = rest.strip_prefix("//") else { return Link::Refused("This link is not a valid URL.".into()) };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host_port = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
    let hostname = if host_port.starts_with('[') {
        host_port.split_once(']').map(|(host, _)| &host[1..]).unwrap_or_default()
    } else {
        host_port.split(':').next().unwrap_or_default()
    };
    if hostname.is_empty() || hostname.chars().any(char::is_whitespace) {
        return Link::Refused("This link has no host.".into());
    }
    let host = host_port.to_ascii_lowercase();
    Link::Openable {
        href: format!("{scheme}://{rest}"),
        host,
        insecure: scheme == "http",
        punycode: hostname.to_ascii_lowercase().split('.').any(|label| label.starts_with("xn--")),
    }
}

/// The JSON-RPC result for an answer: `accept` with content (none for URL mode), `decline` or
/// `cancel`.
pub fn response(action: &str, content: Option<Map<String, Value>>) -> Value {
    match content {
        Some(content) if action == "accept" => json!({ "action": "accept", "content": content }),
        _ => json!({ "action": action }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claude_question() -> Value {
        json!({
            "mode": "form",
            "message": "Which database?",
            "requestedSchema": {
                "type": "object",
                "properties": {
                    "db": { "type": "string", "title": "Database", "oneOf": [
                        { "const": "pg", "title": "Postgres", "_meta": { "_claude/askUserQuestionOption": { "preview": "SELECT 1" } } },
                        { "const": "sqlite", "title": "SQLite" }
                    ] },
                    "db_custom": { "type": "string", "_meta": { "_askUserQuestionCustomAnswer": { "questionId": "db", "isCustomAnswer": true } } },
                    "count": { "type": "integer", "minimum": 1, "maximum": 5 },
                    "ok": { "type": "boolean", "default": true },
                    "tags": { "type": "array", "minItems": 2, "items": { "enum": ["a", "b", "c"] } },
                    "token": { "type": "string", "_meta": { "codex": { "isSecret": true } } },
                    "weird": { "type": "object" }
                },
                "required": ["db", "count"]
            }
        })
    }

    #[test]
    fn form_fields_become_questions() {
        let elicitation = Elicitation::parse(&claude_question()).unwrap();
        let Mode::Form { questions, unanswerable, .. } = elicitation.mode else { panic!("form") };
        assert!(!unanswerable);
        let names: Vec<&str> = questions.iter().map(|question| question.name.as_str()).collect();
        assert_eq!(names, ["db", "count", "ok", "tags", "token"]);
        let QuestionKind::Choice { options, other_field, .. } = &questions[0].kind else { panic!("choice") };
        assert_eq!(other_field.as_deref(), Some("db_custom"));
        assert_eq!(options[0].preview.as_deref(), Some("SELECT 1"));
        assert!(matches!(questions[4].kind, QuestionKind::Text { kind: TextKind::Password, .. }));
        assert_eq!(default_answer(&questions[2]).chosen, ["true"]);
    }

    #[test]
    fn answers_are_checked_and_become_content() {
        let Mode::Form { questions, .. } = Elicitation::parse(&claude_question()).unwrap().mode else { panic!("form") };
        let mut answers: HashMap<String, Answer> = HashMap::new();
        assert_eq!(find_error(&questions, &answers).as_deref(), Some("Database: choose an answer."));
        answers.insert("db".into(), Answer { chosen: Vec::new(), text: "mysql".into() });
        answers.insert("count".into(), Answer { chosen: Vec::new(), text: "9".into() });
        assert_eq!(find_error(&questions, &answers).as_deref(), Some("count: enter at most 5."));
        answers.insert("count".into(), Answer { chosen: Vec::new(), text: "3".into() });
        answers.insert("tags".into(), Answer { chosen: vec!["a".into()], text: String::new() });
        assert_eq!(find_error(&questions, &answers).as_deref(), Some("tags: choose at least 2."));
        answers.insert("tags".into(), Answer { chosen: vec!["a".into(), "c".into()], text: String::new() });
        answers.insert("ok".into(), Answer { chosen: vec!["false".into()], text: String::new() });
        assert_eq!(find_error(&questions, &answers), None);
        let content = content(&questions, &answers);
        assert_eq!(Value::Object(content), json!({ "db_custom": "mysql", "count": 3, "tags": ["a", "c"], "ok": false }));
    }

    #[test]
    fn a_required_field_of_unknown_type_cannot_be_answered() {
        let schema = json!({ "properties": { "x": { "type": "object" } }, "required": ["x"] });
        assert!(unanswerable(&schema, &questions(&schema)));
    }

    #[test]
    fn only_web_links_open() {
        assert_eq!(
            inspect_url("https://xn--pple-43d.com/login?x=1"),
            Link::Openable { href: "https://xn--pple-43d.com/login?x=1".into(), host: "xn--pple-43d.com".into(), insecure: false, punycode: true }
        );
        assert!(matches!(inspect_url("http://localhost:8080/cb"), Link::Openable { insecure: true, .. }));
        assert_eq!(inspect_url("file:///etc/passwd"), Link::Refused("Athas only opens web links, not file: links.".into()));
        assert!(matches!(inspect_url("not a url"), Link::Refused(_)));
        let url = json!({ "mode": "url", "message": "Sign in", "url": "https://example.com", "elicitationId": "e1" });
        assert!(matches!(Elicitation::parse(&url).unwrap().mode, Mode::Url { ref elicitation_id, .. } if elicitation_id == "e1"));
    }
}
