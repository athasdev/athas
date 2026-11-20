//! Semantic tokens (`lsp-semantic-tokens.tsx`, `semantic-token-styles.ts`): the server's token
//! types coloured over the syntax highlighter's, when the `semanticTokens` setting is on, fetched
//! again once typing pauses. Servers that offer deltas send only what changed since the last
//! result (`semantic_tokens.rs` in the original's LSP crate).

use std::{ops::Range, time::Duration};

use gpui::{Context, Task};
use lsp_client::{lsp, position_to_offset};
use ropey::Rope;

use crate::{
    Editor,
    buffer::{AppliedEdit, Bias, map_through},
    syntax::SyntaxKind,
};

const DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SemanticSpan {
    pub range: Range<usize>,
    pub kind: SyntaxKind,
    pub deprecated: bool,
}

#[derive(Default)]
pub(crate) struct SemanticState {
    pub enabled: bool,
    /// Sorted, disjoint.
    pub spans: Vec<SemanticSpan>,
    /// The last full token set and its result id, which a delta request builds on.
    previous: Option<(String, Vec<lsp::SemanticToken>)>,
    task: Option<Task<()>>,
}

fn flatten_tokens(tokens: &[lsp::SemanticToken]) -> Vec<u32> {
    tokens.iter().flat_map(|token| [token.delta_line, token.delta_start, token.length, token.token_type, token.token_modifiers_bitset]).collect()
}

/// The full token set after applying a delta's edits to `previous`, or `None` when an edit does
/// not fit (the caller asks for full tokens then). Edits address single integers and are applied
/// from the back so earlier offsets stay valid.
pub(crate) fn apply_delta(previous: &[lsp::SemanticToken], edits: &[lsp::SemanticTokensEdit]) -> Option<Vec<lsp::SemanticToken>> {
    let mut data = flatten_tokens(previous);
    let mut edits: Vec<&lsp::SemanticTokensEdit> = edits.iter().collect();
    edits.sort_by_key(|edit| std::cmp::Reverse(edit.start));
    for edit in edits {
        let start = edit.start as usize;
        let end = start.checked_add(edit.delete_count as usize)?;
        if end > data.len() {
            return None;
        }
        data.splice(start..end, flatten_tokens(edit.data.as_deref().unwrap_or_default()));
    }
    if data.len() % 5 != 0 {
        return None;
    }
    Some(
        data.chunks_exact(5)
            .map(|chunk| lsp::SemanticToken { delta_line: chunk[0], delta_start: chunk[1], length: chunk[2], token_type: chunk[3], token_modifiers_bitset: chunk[4] })
            .collect(),
    )
}

/// The colour of a standard token type, as Monaco's token theme drew it.
fn standard_kind(token_type: &str) -> Option<SyntaxKind> {
    Some(match token_type {
        "namespace" | "type" | "class" | "enum" | "interface" | "struct" | "typeParameter" => SyntaxKind::Type,
        "parameter" | "variable" | "label" => SyntaxKind::Variable,
        "property" => SyntaxKind::Property,
        "enumMember" | "constant" => SyntaxKind::Constant,
        "event" | "function" | "method" | "macro" => SyntaxKind::Function,
        "comment" => SyntaxKind::Comment,
        "string" => SyntaxKind::String,
        "keyword" | "modifier" => SyntaxKind::Keyword,
        "number" => SyntaxKind::Number,
        "regexp" => SyntaxKind::Regex,
        "operator" => SyntaxKind::Operator,
        "decorator" | "attribute" => SyntaxKind::Attribute,
        "boolean" => SyntaxKind::Boolean,
        "null" => SyntaxKind::Null,
        _ => return None,
    })
}

fn normalized(name: &str) -> String {
    name.chars().filter(|ch| !matches!(ch, '-' | '_' | ' ')).flat_map(char::to_lowercase).collect()
}

/// The standard token type a server's type name stands for (server-specific names folded in).
pub(crate) fn standard_token_type(token_type: &str) -> Option<&'static str> {
    const STANDARD: [&str; 28] = [
        "namespace", "type", "class", "enum", "interface", "struct", "typeParameter", "parameter", "variable", "property", "enumMember", "event", "function",
        "method", "macro", "label", "comment", "string", "keyword", "modifier", "number", "regexp", "operator", "decorator", "boolean", "null", "constant",
        "attribute",
    ];
    let name = normalized(token_type);
    let alias = match name.as_str() {
        "annotation" | "builtinattribute" | "derive" => "attribute",
        "bool" => "boolean",
        "builtinconstant" => "constant",
        "builtinfunction" | "derivehelper" => "function",
        "builtinmodule" | "toolmodule" => "namespace",
        "builtintype" | "typealias" | "union" => "type",
        "character" | "escapesequence" | "formatspecifier" => "string",
        "constparameter" => "parameter",
        "field" => "property",
        "generic" => "typeParameter",
        "lifetime" => "label",
        "selfkeyword" => "keyword",
        _ => "",
    };
    if !alias.is_empty() {
        return Some(alias);
    }
    STANDARD.into_iter().find(|standard| normalized(standard) == name)
}

/// The server's relative token stream as sorted, non-overlapping spans in `rope`, keeping tokens
/// with a length and a coloured type, clamped to their line.
pub(crate) fn decode(tokens: &[lsp::SemanticToken], legend: &lsp::SemanticTokensLegend, rope: &Rope) -> Vec<SemanticSpan> {
    let types: Vec<Option<&'static str>> = legend.token_types.iter().map(|token_type| standard_token_type(token_type.as_str())).collect();
    let modifier_bit = |wanted: &str| legend.token_modifiers.iter().position(|modifier| normalized(modifier.as_str()) == wanted).filter(|bit| *bit < 32);
    let readonly = modifier_bit("readonly");
    let deprecated = modifier_bit("deprecated");
    let mut spans: Vec<SemanticSpan> = Vec::new();
    let (mut line, mut character) = (0u32, 0u32);
    for token in tokens {
        if token.delta_line > 0 {
            line += token.delta_line;
            character = token.delta_start;
        } else {
            character += token.delta_start;
        }
        let Some(token_type) = types.get(token.token_type as usize).copied().flatten() else { continue };
        if token.length == 0 || line as usize >= rope.len_lines() {
            continue;
        }
        let has = |bit: Option<usize>| bit.is_some_and(|bit| token.token_modifiers_bitset >> bit & 1 == 1);
        let kind = if has(readonly) && matches!(token_type, "variable" | "property" | "parameter") { SyntaxKind::Constant } else { standard_kind(token_type).unwrap() };
        let line_start = rope.line_to_byte(line as usize);
        let line_text = rope.line(line as usize);
        let line_len = line_text.len_bytes() - if line_text.chars().last() == Some('\n') { 1 } else { 0 };
        let start = position_to_offset(rope, lsp::Position::new(line, character));
        if start >= line_start + line_len {
            continue;
        }
        if spans.last().is_some_and(|last| start < last.range.end) {
            continue;
        }
        let end = position_to_offset(rope, lsp::Position::new(line, character + token.length)).min(line_start + line_len);
        if end > start {
            spans.push(SemanticSpan { range: start..end, kind, deprecated: has(deprecated) });
        }
    }
    spans
}

impl Editor {
    pub(crate) fn set_semantic_tokens_enabled(&mut self, enabled: bool, cx: &mut Context<Self>) {
        if self.semantic.enabled == enabled {
            return;
        }
        self.semantic.enabled = enabled;
        if enabled {
            self.fetch_semantic_tokens(false, cx);
        } else {
            self.semantic.spans.clear();
            self.semantic.previous = None;
            self.semantic.task = None;
        }
        cx.notify();
    }

    pub(crate) fn fetch_semantic_tokens(&mut self, debounce: bool, cx: &mut Context<Self>) {
        let options = self.lsp.document.as_ref().and_then(|document| match document.server().capabilities()?.semantic_tokens_provider.as_ref()? {
            lsp::SemanticTokensServerCapabilities::SemanticTokensOptions(options) => Some(options.clone()),
            lsp::SemanticTokensServerCapabilities::SemanticTokensRegistrationOptions(options) => Some(options.semantic_tokens_options.clone()),
        });
        let full = options.as_ref().and_then(|options: &lsp::SemanticTokensOptions| options.full.clone()).filter(|full| !matches!(full, lsp::SemanticTokensFullOptions::Bool(false)));
        let (true, Some(options), Some(full), Some(document)) = (self.semantic.enabled, options, full, self.lsp.document.clone()) else {
            self.semantic.task = None;
            return;
        };
        let legend = options.legend;
        let supports_delta = matches!(full, lsp::SemanticTokensFullOptions::Delta { delta: Some(true) });
        let previous = self.semantic.previous.clone().filter(|_| supports_delta);
        let version = self.document.buffer.version();
        self.semantic.task = Some(cx.spawn(async move |this, cx| {
            if debounce {
                cx.background_executor().timer(DEBOUNCE).await;
            }
            let full_request = || {
                document.server().request::<lsp::request::SemanticTokensFullRequest>(lsp::SemanticTokensParams {
                    text_document: document.identifier(),
                    work_done_progress_params: Default::default(),
                    partial_result_params: Default::default(),
                })
            };
            let mut resolved: Option<(Option<String>, Vec<lsp::SemanticToken>)> = None;
            if let Some((result_id, previous)) = previous {
                let delta = document
                    .server()
                    .request::<lsp::request::SemanticTokensFullDeltaRequest>(lsp::SemanticTokensDeltaParams {
                        text_document: document.identifier(),
                        previous_result_id: result_id,
                        work_done_progress_params: Default::default(),
                        partial_result_params: Default::default(),
                    })
                    .await;
                resolved = match delta {
                    Ok(Some(lsp::SemanticTokensFullDeltaResult::Tokens(tokens))) => Some((tokens.result_id, tokens.data)),
                    Ok(Some(lsp::SemanticTokensFullDeltaResult::TokensDelta(delta))) => apply_delta(&previous, &delta.edits).map(|data| (delta.result_id, data)),
                    Ok(Some(lsp::SemanticTokensFullDeltaResult::PartialTokensDelta { edits })) => apply_delta(&previous, &edits).map(|data| (None, data)),
                    _ => None,
                };
            }
            if resolved.is_none() {
                let Ok(Some(result)) = full_request().await else { return };
                resolved = Some(match result {
                    lsp::SemanticTokensResult::Tokens(tokens) => (tokens.result_id, tokens.data),
                    lsp::SemanticTokensResult::Partial(partial) => (None, partial.data),
                });
            }
            let Some((result_id, tokens)) = resolved else { return };
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() != version {
                    return;
                }
                editor.semantic.spans = decode(&tokens, &legend, editor.document.buffer.rope());
                editor.semantic.previous = result_id.map(|id| (id, tokens));
                cx.notify();
            })
            .ok();
        }));
    }

    pub(crate) fn semantic_edited(&mut self, changes: &[AppliedEdit]) {
        if self.semantic.spans.is_empty() {
            return;
        }
        for span in &mut self.semantic.spans {
            span.range.start = map_through(span.range.start, changes, Bias::Right);
            span.range.end = map_through(span.range.end, changes, Bias::Left).max(span.range.start);
        }
        self.semantic.spans.retain(|span| !span.range.is_empty());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(delta_line: u32, delta_start: u32, length: u32, token_type: u32, modifiers: u32) -> lsp::SemanticToken {
        lsp::SemanticToken { delta_line, delta_start, length, token_type, token_modifiers_bitset: modifiers }
    }

    #[test]
    fn decodes_relative_tokens() {
        let legend = lsp::SemanticTokensLegend {
            token_types: ["function", "variable", "unknownThing", "builtin_type"].map(lsp::SemanticTokenType::new).to_vec(),
            token_modifiers: ["readonly", "deprecated"].map(lsp::SemanticTokenModifier::new).to_vec(),
        };
        let rope = Rope::from_str("fn main() {\n    let x: u8 = 1;\n}\n");
        let tokens = [
            token(0, 3, 4, 0, 2),
            token(1, 8, 1, 1, 1),
            token(0, 3, 2, 3, 0),
            token(0, 0, 1, 1, 0),
            token(0, 3, 9, 2, 0),
            token(1, 0, 40, 1, 0),
        ];
        let spans = decode(&tokens, &legend, &rope);
        let line_one = rope.line_to_byte(1);
        assert_eq!(
            spans,
            vec![
                SemanticSpan { range: 3..7, kind: SyntaxKind::Function, deprecated: true },
                SemanticSpan { range: line_one + 8..line_one + 9, kind: SyntaxKind::Constant, deprecated: false },
                SemanticSpan { range: line_one + 11..line_one + 13, kind: SyntaxKind::Type, deprecated: false },
                SemanticSpan { range: rope.line_to_byte(2)..rope.line_to_byte(2) + 1, kind: SyntaxKind::Variable, deprecated: false },
            ]
        );
    }

    #[test]
    fn applies_delta_edits() {
        let previous = [token(0, 0, 2, 0, 0), token(1, 4, 3, 1, 0), token(0, 5, 1, 2, 0)];
        let edits = [
            lsp::SemanticTokensEdit { start: 10, delete_count: 5, data: Some(vec![token(0, 6, 2, 3, 1)]) },
            lsp::SemanticTokensEdit { start: 6, delete_count: 1, data: None },
        ];
        let edits_with_int = [lsp::SemanticTokensEdit { start: 6, delete_count: 0, data: None }];
        let applied = apply_delta(&previous, &edits);
        assert_eq!(applied, None, "a single integer removed leaves a partial token");
        let mut fixed = edits.clone();
        fixed[1] = lsp::SemanticTokensEdit { start: 5, delete_count: 5, data: Some(vec![token(2, 0, 4, 1, 0)]) };
        assert_eq!(apply_delta(&previous, &fixed), Some(vec![token(0, 0, 2, 0, 0), token(2, 0, 4, 1, 0), token(0, 6, 2, 3, 1)]));
        assert_eq!(apply_delta(&previous, &edits_with_int), Some(previous.to_vec()));
        assert_eq!(apply_delta(&previous, &[lsp::SemanticTokensEdit { start: 14, delete_count: 5, data: None }]), None);
    }

    #[test]
    fn server_names_fold_into_standard_types() {
        assert_eq!(standard_token_type("enumMember"), Some("enumMember"));
        assert_eq!(standard_token_type("type_alias"), Some("type"));
        assert_eq!(standard_token_type("TypeParameter"), Some("typeParameter"));
        assert_eq!(standard_token_type("lifetime"), Some("label"));
        assert_eq!(standard_token_type("wat"), None);
    }
}
