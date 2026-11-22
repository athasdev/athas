//! `when` clauses (`services/when-clause.ts`): `editorFocus && !vimMode`, with `&&`, `||`, `!`,
//! `==`, `!=` and parentheses, evaluated against the workbench's state, and turned into the GPUI
//! key context predicate that holds in the same places.

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Identifier(String),
    And,
    Or,
    Not,
    Equal,
    NotEqual,
    Text(String),
    Bool(bool),
    Open,
    Close,
}

fn tokenize(expression: &str) -> Vec<Token> {
    let chars: Vec<char> = expression.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        let next = chars.get(index + 1).copied();
        match c {
            _ if c.is_whitespace() => index += 1,
            '(' => {
                tokens.push(Token::Open);
                index += 1;
            }
            ')' => {
                tokens.push(Token::Close);
                index += 1;
            }
            '!' if next == Some('=') => {
                tokens.push(Token::NotEqual);
                index += 2;
            }
            '!' => {
                tokens.push(Token::Not);
                index += 1;
            }
            '&' if next == Some('&') => {
                tokens.push(Token::And);
                index += 2;
            }
            '|' if next == Some('|') => {
                tokens.push(Token::Or);
                index += 2;
            }
            '=' if next == Some('=') => {
                tokens.push(Token::Equal);
                index += 2;
            }
            '\'' | '"' => {
                let quote = c;
                index += 1;
                let mut value = String::new();
                while index < chars.len() && chars[index] != quote {
                    value.push(chars[index]);
                    index += 1;
                }
                index += 1;
                tokens.push(Token::Text(value));
            }
            _ => {
                let mut identifier = String::new();
                while index < chars.len() && (chars[index].is_ascii_alphanumeric() || matches!(chars[index], '_' | '.')) {
                    identifier.push(chars[index]);
                    index += 1;
                }
                match identifier.as_str() {
                    "" => index += 1,
                    "true" => tokens.push(Token::Bool(true)),
                    "false" => tokens.push(Token::Bool(false)),
                    _ => tokens.push(Token::Identifier(identifier)),
                }
            }
        }
    }
    tokens
}

/// A parsed clause.
#[derive(Clone, Debug, PartialEq)]
pub enum When {
    True,
    Literal(bool),
    Context(String),
    Equals { name: String, value: Operand, negated: bool },
    Not(Box<When>),
    And(Box<When>, Box<When>),
    Or(Box<When>, Box<When>),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Operand {
    Bool(bool),
    Text(String),
}

/// A value of the workbench state a clause reads.
#[derive(Clone, Debug, PartialEq)]
pub enum ContextValue {
    Bool(bool),
    Text(String),
}

impl From<bool> for ContextValue {
    fn from(value: bool) -> Self {
        ContextValue::Bool(value)
    }
}

/// Parses as the web workbench's evaluator reads: precedence `!` over `&&` over `||`, a missing
/// operand counts as true and an unclosed parenthesis closes at the end.
pub fn parse(clause: &str) -> When {
    let tokens = tokenize(clause);
    if tokens.is_empty() {
        return When::True;
    }
    parse_or(&tokens).0
}

fn parse_or(tokens: &[Token]) -> (When, usize) {
    let (mut node, mut consumed) = parse_and(tokens);
    while tokens.get(consumed) == Some(&Token::Or) {
        consumed += 1;
        let (right, used) = parse_and(&tokens[consumed..]);
        node = When::Or(Box::new(node), Box::new(right));
        consumed += used;
    }
    (node, consumed)
}

fn parse_and(tokens: &[Token]) -> (When, usize) {
    let (mut node, mut consumed) = parse_unary(tokens);
    while tokens.get(consumed) == Some(&Token::And) {
        consumed += 1;
        let (right, used) = parse_unary(&tokens[consumed..]);
        node = When::And(Box::new(node), Box::new(right));
        consumed += used;
    }
    (node, consumed)
}

fn parse_unary(tokens: &[Token]) -> (When, usize) {
    match tokens.first() {
        None => (When::True, 0),
        Some(Token::Not) => {
            let (inner, used) = parse_unary(&tokens[1..]);
            (When::Not(Box::new(inner)), used + 1)
        }
        Some(_) => parse_primary(tokens),
    }
}

fn parse_primary(tokens: &[Token]) -> (When, usize) {
    match tokens.first() {
        None => (When::True, 0),
        Some(Token::Open) => {
            let (inner, used) = parse_or(&tokens[1..]);
            if tokens.get(used + 1) == Some(&Token::Close) { (inner, used + 2) } else { (inner, used) }
        }
        Some(Token::Bool(value)) => (When::Literal(*value), 1),
        Some(Token::Text(value)) => (When::Literal(!value.is_empty()), 1),
        Some(Token::Identifier(name)) => {
            let operator = tokens.get(1);
            let operand = match tokens.get(2) {
                Some(Token::Bool(value)) => Some(Operand::Bool(*value)),
                Some(Token::Text(value)) | Some(Token::Identifier(value)) => Some(Operand::Text(value.clone())),
                _ => None,
            };
            match (operator, operand) {
                (Some(Token::Equal), Some(value)) => (When::Equals { name: name.clone(), value, negated: false }, 3),
                (Some(Token::NotEqual), Some(value)) => (When::Equals { name: name.clone(), value, negated: true }, 3),
                _ => (When::Context(name.clone()), 1),
            }
        }
        Some(_) => (When::True, 1),
    }
}

impl When {
    /// `evaluateWhenClause`: names the context lacks read as false.
    pub fn evaluate(&self, context: &HashMap<String, ContextValue>) -> bool {
        match self {
            When::True => true,
            When::Literal(value) => *value,
            When::Context(name) => match context.get(name) {
                Some(ContextValue::Bool(value)) => *value,
                Some(ContextValue::Text(text)) => !text.is_empty(),
                None => false,
            },
            When::Equals { name, value, negated } => {
                let equal = match (value, context.get(name)) {
                    (Operand::Bool(expected), Some(ContextValue::Bool(actual))) => expected == actual,
                    (Operand::Bool(expected), None) => !*expected,
                    (Operand::Bool(_), Some(ContextValue::Text(_))) => false,
                    (Operand::Text(expected), Some(ContextValue::Text(actual))) => expected == actual,
                    (Operand::Text(expected), Some(ContextValue::Bool(actual))) => *expected == actual.to_string(),
                    (Operand::Text(_), None) => false,
                };
                equal != *negated
            }
            When::Not(inner) => !inner.evaluate(context),
            When::And(left, right) => left.evaluate(context) && right.evaluate(context),
            When::Or(left, right) => left.evaluate(context) || right.evaluate(context),
        }
    }
}

/// `evaluateWhenClause(clause, context)`; no clause always holds.
pub fn evaluate(clause: Option<&str>, context: &HashMap<String, ContextValue>) -> bool {
    clause.is_none_or(|clause| parse(clause).evaluate(context))
}

/// The GPUI key context each workbench state name is: the focused surface's context, or a flag
/// the editor sets on its own context.
fn gpui_name(name: &str) -> String {
    match name {
        "editorFocus" => "Editor".into(),
        "terminalFocus" => "Terminal".into(),
        "browserFocus" => "Browser".into(),
        "agentSessionFocus" => "AgentSession".into(),
        "sidebarFocus" => "FileTree".into(),
        "findWidgetVisible" => "EditorFind".into(),
        "agentEditHunks" => "agent_hunk".into(),
        "vimMode" => "vim".into(),
        "vimNormalMode" => "vim_normal".into(),
        "vimInsertMode" => "vim_insert".into(),
        "vimVisualMode" => "vim_visual".into(),
        "isRecordingKeybinding" => "KeybindingRecorder".into(),
        // A single-view window (settings, extensions, a detached session), not the workbench.
        "detachedWindow" => "DetachedWindow".into(),
        other => other.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect(),
    }
}

fn to_gpui(node: &When) -> Option<String> {
    Some(match node {
        When::True | When::Literal(true) => return None,
        When::Literal(false) => "__never__".into(),
        When::Context(name) => gpui_name(name),
        When::Equals { name, value: Operand::Bool(expected), negated } => {
            let name = gpui_name(name);
            if expected != negated { name } else { format!("!{name}") }
        }
        When::Equals { name, value: Operand::Text(text), negated } => {
            let value: String = text.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
            format!("{} {} {value}", gpui_name(name), if *negated { "!=" } else { "==" })
        }
        When::Not(inner) => match (to_gpui(inner), matches!(**inner, When::Context(_))) {
            (Some(predicate), true) => format!("!{predicate}"),
            (Some(predicate), false) => format!("!({predicate})"),
            (None, _) => "__never__".into(),
        },
        When::And(left, right) => match (to_gpui(left), to_gpui(right)) {
            (Some(left), Some(right)) => format!("({left}) && ({right})"),
            (Some(side), None) | (None, Some(side)) => side,
            (None, None) => return None,
        },
        When::Or(left, right) => match (to_gpui(left), to_gpui(right)) {
            (Some(left), Some(right)) => format!("({left}) || ({right})"),
            _ => return None,
        },
    })
}

/// The key context every window root carries, workbench or detached: what a binding that holds
/// anywhere (no clause, `!terminalFocus`) is bound in, so the global keys work in a settings or
/// an extensions window too.
pub const ROOT_CONTEXT: &str = "App";

/// The workbench window's root context: the shared root, and the name `when` clauses use.
pub const WORKBENCH_CONTEXT: &str = "App Workbench";

/// A single-view window's root context (settings, extensions, a detached session).
pub const DETACHED_CONTEXT: &str = "App DetachedWindow";

/// The GPUI key context predicate a binding with this clause is bound in. A clause that holds
/// outside every surface (no clause, `!terminalFocus`) is kept to the window's root.
pub fn to_context_predicate(clause: Option<&str>) -> String {
    let node = clause.map_or(When::True, parse);
    let anywhere = node.evaluate(&HashMap::new());
    match to_gpui(&node) {
        None => ROOT_CONTEXT.into(),
        Some(predicate) if anywhere => format!("{ROOT_CONTEXT} && ({predicate})"),
        Some(predicate) => predicate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(pairs: &[(&str, bool)]) -> HashMap<String, ContextValue> {
        pairs.iter().map(|(name, value)| (name.to_string(), ContextValue::Bool(*value))).collect()
    }

    #[test]
    fn evaluates_like_the_web_workbench() {
        let editor = context(&[("editorFocus", true), ("vimMode", false)]);
        assert!(evaluate(None, &editor));
        assert!(evaluate(Some(""), &editor));
        assert!(evaluate(Some("editorFocus"), &editor));
        assert!(evaluate(Some("editorFocus && !vimMode"), &editor));
        assert!(!evaluate(Some("terminalFocus"), &editor));
        assert!(evaluate(Some("terminalFocus || editorFocus"), &editor));
        assert!(evaluate(Some("!(terminalFocus || vimMode)"), &editor));
        assert!(evaluate(Some("vimMode == false"), &editor));
        assert!(evaluate(Some("sidebarFocus == false"), &editor));
        assert!(!evaluate(Some("vimMode != false"), &editor));
        assert!(evaluate(Some("editorFocus && (vimMode || true)"), &editor));
        let mut mode = editor.clone();
        mode.insert("panel".into(), ContextValue::Text("git".into()));
        assert!(evaluate(Some("panel == 'git'"), &mode));
        assert!(evaluate(Some("panel != \"files\""), &mode));
        assert!(!evaluate(Some("missing == 'git'"), &mode));
    }

    #[test]
    fn and_binds_tighter_than_or() {
        let state = context(&[("a", true), ("b", false), ("c", false)]);
        assert!(evaluate(Some("a || b && c"), &state));
        assert!(!evaluate(Some("(a || b) && c"), &state));
    }

    #[test]
    fn every_window_root_carries_the_shared_context() {
        for context in [WORKBENCH_CONTEXT, DETACHED_CONTEXT] {
            assert!(gpui::KeyContext::parse(context).unwrap().contains(ROOT_CONTEXT), "{context}");
        }
    }

    #[test]
    fn clauses_become_gpui_predicates() {
        let parsed = |clause: Option<&str>| to_context_predicate(clause);
        assert_eq!(parsed(None), "App");
        assert_eq!(parsed(Some("editorFocus")), "Editor");
        assert_eq!(parsed(Some("!terminalFocus")), "App && (!Terminal)");
        assert_eq!(parsed(Some("editorFocus && agentEditHunks")), "(Editor) && (agent_hunk)");
        assert_eq!(parsed(Some("editorFocus && vimMode == false")), "(Editor) && (!vim)");
        assert_eq!(parsed(Some("terminalFocus || browserFocus")), "(Terminal) || (Browser)");
        for clause in ["editorFocus", "!terminalFocus", "editorFocus && !(vimMode || agentEditHunks)", "a == 'x y'", "true", "false"] {
            gpui::KeyBindingContextPredicate::parse(&parsed(Some(clause))).unwrap_or_else(|error| panic!("{clause}: {error}"));
        }
    }

    #[test]
    fn predicates_hold_where_the_clause_does() {
        use gpui::{KeyBindingContextPredicate, KeyContext};
        let stack = |names: &[&str]| -> Vec<KeyContext> {
            names
                .iter()
                .map(|level| {
                    let mut context = KeyContext::default();
                    for name in level.split(' ') {
                        context.add(name.to_string());
                    }
                    context
                })
                .collect()
        };
        let holds = |clause: &str, contexts: &[KeyContext]| {
            let predicate = KeyBindingContextPredicate::parse(&to_context_predicate(Some(clause))).unwrap();
            predicate.depth_of(contexts).is_some()
        };
        let editor = stack(&["App Workbench", "EditorPane", "Editor agent_hunk"]);
        let terminal = stack(&["App Workbench", "TerminalPanel", "Terminal"]);
        assert!(holds("editorFocus && agentEditHunks", &editor));
        assert!(!holds("editorFocus && agentEditHunks", &terminal));
        assert!(holds("!terminalFocus", &editor));
        assert!(!holds("!terminalFocus", &terminal));
        assert!(holds("terminalFocus", &terminal));
    }
}
