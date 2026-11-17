//! Project symbols (`workspace/symbol`) from every running server of a project, flattened and
//! deduplicated as `flatten_workspace_symbol_response` in Athas does.

use std::{collections::HashSet, path::PathBuf, sync::Arc};

use futures::future::join_all;
use lsp_types::{OneOf, SymbolKind, WorkspaceSymbolParams, WorkspaceSymbolResponse, request::WorkspaceSymbolRequest};

use crate::{server::LanguageServer, uri};

/// A symbol somewhere in the project, with a 0-based position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceSymbol {
    pub name: String,
    pub kind: SymbolKind,
    pub container_name: Option<String>,
    pub path: PathBuf,
    pub line: u32,
    pub character: u32,
}

impl WorkspaceSymbol {
    pub fn kind_label(&self) -> &'static str {
        symbol_kind_label(self.kind)
    }
}

/// `symbol_kind_to_string`: the names quick open shows next to a symbol.
pub fn symbol_kind_label(kind: SymbolKind) -> &'static str {
    match kind {
        SymbolKind::FILE => "file",
        SymbolKind::MODULE => "module",
        SymbolKind::NAMESPACE => "namespace",
        SymbolKind::PACKAGE => "package",
        SymbolKind::CLASS => "class",
        SymbolKind::METHOD => "method",
        SymbolKind::PROPERTY => "property",
        SymbolKind::FIELD => "field",
        SymbolKind::CONSTRUCTOR => "constructor",
        SymbolKind::ENUM => "enum",
        SymbolKind::INTERFACE => "interface",
        SymbolKind::FUNCTION => "function",
        SymbolKind::VARIABLE => "variable",
        SymbolKind::CONSTANT => "constant",
        SymbolKind::STRING => "string",
        SymbolKind::NUMBER => "number",
        SymbolKind::BOOLEAN => "boolean",
        SymbolKind::ARRAY => "array",
        SymbolKind::OBJECT => "object",
        SymbolKind::KEY => "key",
        SymbolKind::NULL => "null",
        SymbolKind::ENUM_MEMBER => "enum-member",
        SymbolKind::STRUCT => "struct",
        SymbolKind::EVENT => "event",
        SymbolKind::OPERATOR => "operator",
        SymbolKind::TYPE_PARAMETER => "type-parameter",
        _ => "unknown",
    }
}

/// One list from several servers' answers, without repeats (same file, position and name).
pub fn flatten_workspace_symbols(responses: Vec<WorkspaceSymbolResponse>) -> Vec<WorkspaceSymbol> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut push = |name: String, kind: SymbolKind, container_name: Option<String>, url: &lsp_types::Url, line: u32, character: u32| {
        let path = uri::to_path(url).unwrap_or_else(|| PathBuf::from(url.as_str()));
        if seen.insert((path.clone(), line, character, name.clone())) {
            out.push(WorkspaceSymbol { name, kind, container_name, path, line, character });
        }
    };
    for response in responses {
        match response {
            WorkspaceSymbolResponse::Flat(infos) => {
                for info in infos {
                    let start = info.location.range.start;
                    push(info.name, info.kind, info.container_name, &info.location.uri, start.line, start.character);
                }
            }
            WorkspaceSymbolResponse::Nested(symbols) => {
                for symbol in symbols {
                    match &symbol.location {
                        OneOf::Left(location) => {
                            let start = location.range.start;
                            push(symbol.name, symbol.kind, symbol.container_name, &location.uri, start.line, start.character)
                        }
                        OneOf::Right(location) => push(symbol.name, symbol.kind, symbol.container_name, &location.uri, 0, 0),
                    }
                }
            }
        }
    }
    out
}

/// Asks every server at once; a server that fails or does not support the request is skipped.
pub async fn workspace_symbols(servers: Vec<Arc<LanguageServer>>, query: String) -> Vec<WorkspaceSymbol> {
    let requests = servers.into_iter().filter(|server| server.is_running()).map(|server| {
        server.request::<WorkspaceSymbolRequest>(WorkspaceSymbolParams {
            query: query.clone(),
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        })
    });
    let responses = join_all(requests).await.into_iter().filter_map(|response| response.ok().flatten()).collect();
    flatten_workspace_symbols(responses)
}
