//! Code lenses (`use-lsp-code-lens.ts`, `navigation/code-lens.ts`): a row above each line the
//! server has lenses for, with every lens for that line, refreshed once edits pause. A references
//! lens opens the inline references peek; any other runs its command on the server. Lenses without
//! a command only label something and are skipped, as Monaco did.

use std::time::Duration;

use gpui::{Context, Task, Window};
use lsp_client::{lsp, position_to_offset};

use crate::{
    Editor,
    buffer::{AppliedEdit, Bias, map_through},
    display_map::Blocks,
    peek::PEEK_ROWS,
};

const REFRESH_DELAY: Duration = Duration::from_millis(250);
pub(crate) const SHOW_REFERENCES_COMMAND: &str = "editor.action.showReferences";

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum LensAction {
    Command(lsp::Command),
    /// `editor.action.showReferences` with well-formed arguments: opens the peek.
    References { position: lsp::Position, locations: Vec<lsp::Location> },
    /// A runnable cell or chunk, by index (python `# %%` cells, R Markdown chunks).
    Cell(usize),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CodeLens {
    /// The start of the line the lens sits above, kept through edits.
    pub offset: usize,
    pub title: String,
    pub action: LensAction,
}

#[derive(Default)]
pub(crate) struct CodeLensState {
    /// The `codeLens` setting.
    pub enabled: bool,
    pub server: Vec<CodeLens>,
    /// "Run cell" / "Run chunk" lenses of script files.
    pub cells: Vec<CodeLens>,
    /// The lens under the mouse: (line, index in the line's lenses).
    pub hovered: Option<(usize, usize)>,
    task: Option<Task<()>>,
}

/// The `[uri, position, locations]` arguments of a references lens, or `None` when malformed.
pub(crate) fn show_references_arguments(arguments: Option<&[serde_json::Value]>) -> Option<(lsp::Position, Vec<lsp::Location>)> {
    let [_, position, locations, ..] = arguments? else { return None };
    let position = serde_json::from_value(position.clone()).ok()?;
    let locations = serde_json::from_value(locations.clone()).ok()?;
    Some((position, locations))
}

fn is_runnable_title(title: &str) -> bool {
    title.split(|c: char| !c.is_alphanumeric()).any(|word| ["run", "test", "debug", "bench", "profile"].contains(&word.to_lowercase().as_str()))
}

/// The server's lenses that have a command, at the starts of their lines.
pub(crate) fn lenses_from_server(lenses: Vec<lsp::CodeLens>, line_start: impl Fn(usize) -> Option<usize>) -> Vec<CodeLens> {
    let mut result: Vec<CodeLens> = lenses
        .into_iter()
        .filter_map(|lens| {
            let command = lens.command?;
            let offset = line_start(lens.range.start.line as usize)?;
            let action = match show_references_arguments(command.arguments.as_deref()) {
                Some((position, locations)) if command.command == SHOW_REFERENCES_COMMAND => LensAction::References { position, locations },
                _ => LensAction::Command(command.clone()),
            };
            Some(CodeLens { offset, title: command.title, action })
        })
        .collect();
    result.sort_by_key(|lens| lens.offset);
    result
}

impl Editor {
    pub(crate) fn set_code_lens_enabled(&mut self, enabled: bool, cx: &mut Context<Self>) {
        if self.code_lens.enabled == enabled {
            return;
        }
        self.code_lens.enabled = enabled;
        if enabled {
            self.fetch_code_lens(false, cx);
        } else {
            self.code_lens.server.clear();
            self.code_lens.task = None;
        }
        cx.notify();
    }

    /// The rows without text the display map makes room for: lens rows, the peek, and the lines
    /// of multi-line ghost text after its first, which push the code below down.
    pub(crate) fn blocks(&self) -> Blocks {
        let mut below = self.peek_line().map(|line| vec![(line, PEEK_ROWS)]).unwrap_or_default();
        if let Some(preview) = self.inline_preview()
            && below.is_empty()
        {
            below.push((preview.lines.1, preview.proposed.len()));
        }
        if let Some((line, rows)) = self.ghost_block()
            && below.is_empty()
        {
            below.push((line, rows));
        }
        let mut above: Vec<(usize, usize)> = self.code_lens_lines().into_iter().map(|(line, _)| (line, 1)).collect();
        for (line, rows) in self.agent_removed_blocks() {
            match above.binary_search_by_key(&line, |(above_line, _)| *above_line) {
                Ok(index) => above[index].1 += rows,
                Err(index) => above.insert(index, (line, rows)),
            }
        }
        Blocks { above, below }
    }

    /// Runs a "Run cell" / "Run chunk" lens.
    pub(crate) fn run_script_cell(&mut self, index: usize, cx: &mut Context<Self>) {
        self.run_script_lens(index, cx);
    }

    /// The lenses drawn above each line, by line.
    pub(crate) fn code_lens_lines(&self) -> Vec<(usize, Vec<&CodeLens>)> {
        if !self.code_lens.enabled {
            return Vec::new();
        }
        let buffer = &self.document.buffer;
        let mut lenses: Vec<&CodeLens> = self.code_lens.cells.iter().chain(&self.code_lens.server).filter(|lens| lens.offset <= buffer.len()).collect();
        lenses.sort_by_key(|lens| lens.offset);
        let mut lines: Vec<(usize, Vec<&CodeLens>)> = Vec::new();
        for lens in lenses {
            let line = buffer.line_of(lens.offset);
            match lines.last_mut() {
                Some((last, group)) if *last == line => group.push(lens),
                _ => lines.push((line, vec![lens])),
            }
        }
        lines
    }

    pub(crate) fn schedule_code_lens(&mut self, cx: &mut Context<Self>) {
        self.fetch_code_lens(true, cx);
    }

    pub(crate) fn fetch_code_lens(&mut self, debounce: bool, cx: &mut Context<Self>) {
        let supported = self.lsp.document.as_ref().is_some_and(|document| {
            document.server().capabilities().is_some_and(|capabilities| capabilities.code_lens_provider.is_some())
        });
        if !self.code_lens.enabled || !supported || crate::demo("lens") {
            self.code_lens.task = None;
            return;
        }
        let Some(document) = self.lsp.document.clone() else { return };
        let version = self.document.buffer.version();
        self.code_lens.task = Some(cx.spawn(async move |this, cx| {
            if debounce {
                cx.background_executor().timer(REFRESH_DELAY).await;
            }
            let request = document.server().request::<lsp::request::CodeLensRequest>(lsp::CodeLensParams {
                text_document: document.identifier(),
                work_done_progress_params: Default::default(),
                partial_result_params: Default::default(),
            });
            let Ok(lenses) = request.await else { return };
            this.update(cx, |editor, cx| {
                if editor.document.buffer.version() != version {
                    return;
                }
                let buffer = &editor.document.buffer;
                let lines = buffer.line_count();
                editor.code_lens.server = lenses_from_server(lenses.unwrap_or_default(), |line| (line < lines).then(|| buffer.line_start(line)));
                cx.notify();
            })
            .ok();
        }));
    }

    pub(crate) fn code_lens_edited(&mut self, changes: &[AppliedEdit]) {
        for lens in self.code_lens.server.iter_mut().chain(&mut self.code_lens.cells) {
            lens.offset = map_through(lens.offset, changes, Bias::Left);
        }
    }

    /// For headless snapshots (`ATHAS_EDITOR_DEMO=lens,peek`): references and run lenses above
    /// the file's definitions, and the peek of the word at the caret.
    pub(crate) fn run_block_demo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let buffer = &self.document.buffer;
        if crate::demo("lens") {
            self.code_lens.enabled = true;
            let definitions = (0..buffer.line_count()).filter(|line| {
                let text = buffer.line(*line);
                let text = text.trim_start();
                ["fn ", "pub fn ", "def ", "function ", "class ", "struct ", "pub struct "].iter().any(|prefix| text.starts_with(prefix))
            });
            self.code_lens.server = definitions
                .take(20)
                .flat_map(|line| {
                    let offset = buffer.line_start(line);
                    let references = CodeLens { offset, title: format!("{} references", line % 4 + 1), action: LensAction::Command(lsp::Command { title: String::new(), command: String::new(), arguments: None }) };
                    let run = CodeLens { offset, title: "▶ Run".into(), action: LensAction::Command(lsp::Command { title: String::new(), command: String::new(), arguments: None }) };
                    if line % 2 == 0 { vec![references, run] } else { vec![references] }
                })
                .collect();
        }
        if crate::demo("peek") {
            let caret = self.document.newest_selection().head;
            let Some(word) = buffer.word_range_at(caret).map(|range| buffer.slice(range)).filter(|word| !word.is_empty()) else { return };
            let text = buffer.slice(0..buffer.len());
            let uri = lsp_client::uri::from_path(&self.path);
            let locations: Vec<lsp::Location> = crate::search::word_occurrences(&text, 0, &word)
                .into_iter()
                .filter_map(|range| {
                    let rope = buffer.rope();
                    Some(lsp::Location { uri: uri.clone()?, range: lsp_client::offsets_to_range(rope, range) })
                })
                .collect();
            self.open_references_peek(caret, &locations, window, cx);
        }
    }

    pub(crate) fn hover_code_lens(&mut self, hovered: Option<(usize, usize)>, cx: &mut Context<Self>) {
        if self.code_lens.hovered != hovered {
            self.code_lens.hovered = hovered;
            cx.notify();
        }
    }

    /// The server's lenses that run, test, debug, bench or profile something
    /// (`isRunnableCodeLens`), as zero-based lines and titles, for the run menu.
    pub fn runnable_lenses(&self) -> Vec<(usize, String)> {
        self.code_lens
            .server
            .iter()
            .filter(|lens| matches!(lens.action, LensAction::Command(_)) && is_runnable_title(&lens.title) && lens.offset <= self.document.buffer.len())
            .map(|lens| (self.document.buffer.line_of(lens.offset), lens.title.clone()))
            .collect()
    }

    /// Runs the `index`th of [`Self::runnable_lenses`].
    pub fn run_runnable_lens(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some((line, title)) = self.runnable_lenses().into_iter().nth(index) else { return };
        let Some(position) = self
            .code_lens_lines()
            .into_iter()
            .find(|(lens_line, _)| *lens_line == line)
            .and_then(|(_, lenses)| lenses.iter().position(|lens| lens.title == title))
        else {
            return;
        };
        self.run_code_lens(line, position, window, cx);
    }

    /// Runs the `index`th lens above `line`.
    pub(crate) fn run_code_lens(&mut self, line: usize, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(lens) = self.code_lens_lines().into_iter().find(|(lens_line, _)| *lens_line == line).and_then(|(_, lenses)| lenses.get(index).map(|lens| (*lens).clone())) else {
            return;
        };
        match lens.action {
            LensAction::References { position, locations } => {
                let offset = position_to_offset(self.document.buffer.rope(), position);
                self.open_references_peek(offset, &locations, window, cx);
            }
            LensAction::Command(command) => {
                let Some(server) = self.lsp.document.as_ref().map(|document| document.server().clone()) else { return };
                self.code_lens.task = Some(cx.spawn(async move |this, cx| {
                    let title = command.title.clone();
                    let result = server
                        .request::<lsp::request::ExecuteCommand>(lsp::ExecuteCommandParams {
                            command: command.command,
                            arguments: command.arguments.unwrap_or_default(),
                            work_done_progress_params: Default::default(),
                        })
                        .await;
                    if let Err(error) = result {
                        this.update(cx, |editor, cx| {
                            editor.notice = Some(format!("Failed to run {title}: {error:#}"));
                            cx.notify();
                        })
                        .ok();
                    }
                }));
            }
            LensAction::Cell(index) => self.run_script_cell(index, cx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn runnable_lens_titles() {
        assert!(is_runnable_title("▶ Run"));
        assert!(is_runnable_title("Run Test"));
        assert!(is_runnable_title("Debug main"));
        assert!(!is_runnable_title("3 references"));
        assert!(!is_runnable_title("Rerun-able? no: running"));
    }

    fn lens(line: u32, command: Option<(&str, &str, Option<Vec<serde_json::Value>>)>) -> lsp::CodeLens {
        lsp::CodeLens {
            range: lsp::Range::new(lsp::Position::new(line, 0), lsp::Position::new(line, 1)),
            command: command.map(|(title, command, arguments)| lsp::Command { title: title.into(), command: command.into(), arguments }),
            data: None,
        }
    }

    /// A language server answering in-process: code lenses and semantic tokens for one file.
    fn fake_server() -> std::sync::Arc<lsp_client::LanguageServer> {
        use std::sync::{Arc, OnceLock, mpsc};
        let (requests, incoming) = mpsc::channel::<String>();
        let (events, _events) = futures::channel::mpsc::unbounded();
        let writer: lsp_client::MessageWriter = Box::new(move |body| {
            requests.send(body).ok();
        });
        let server = lsp_client::LanguageServer::connect_messages(1, "fake", std::path::Path::new("/tmp"), None, events, writer);
        let handle: Arc<OnceLock<Arc<lsp_client::LanguageServer>>> = Arc::new(OnceLock::new());
        handle.set(server.clone()).ok();
        std::thread::spawn(move || {
            while let Ok(body) = incoming.recv() {
                let message: serde_json::Value = serde_json::from_str(&body).unwrap();
                let Some(id) = message.get("id").cloned() else { continue };
                let result = match message["method"].as_str().unwrap_or_default() {
                    "initialize" => json!({ "capabilities": {
                        "codeLensProvider": {},
                        "semanticTokensProvider": { "legend": { "tokenTypes": ["function", "variable"], "tokenModifiers": ["readonly"] }, "full": true }
                    } }),
                    "textDocument/codeLens" => json!([
                        { "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 3 } }, "command": { "title": "▶ Run", "command": "run" } },
                        { "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 3 } } }
                    ]),
                    "textDocument/semanticTokens/full" => json!({ "data": [0, 3, 4, 0, 0, 1, 4, 1, 1, 1] }),
                    _ => serde_json::Value::Null,
                };
                handle.get().unwrap().receive(&json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string());
            }
        });
        server
    }

    #[test]
    fn lenses_and_tokens_from_a_server() {
        let server = fake_server();
        let document = lsp::TextDocumentIdentifier { uri: "file:///tmp/main.rs".parse().unwrap() };
        let lenses = futures::executor::block_on(server.request::<lsp::request::CodeLensRequest>(lsp::CodeLensParams {
            text_document: document.clone(),
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        }))
        .unwrap()
        .unwrap();
        let rope = ropey::Rope::from_str("fn main() {\n    x\n}\n");
        let lenses = lenses_from_server(lenses, |line| Some(rope.line_to_byte(line)));
        assert_eq!(lenses.len(), 1);
        assert_eq!((lenses[0].offset, lenses[0].title.as_str()), (12, "▶ Run"));
        let tokens = futures::executor::block_on(server.request::<lsp::request::SemanticTokensFullRequest>(lsp::SemanticTokensParams {
            text_document: document,
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        }))
        .unwrap();
        let Some(lsp::SemanticTokensResult::Tokens(tokens)) = tokens else { panic!("no tokens") };
        let legend = match server.capabilities().unwrap().semantic_tokens_provider.clone().unwrap() {
            lsp::SemanticTokensServerCapabilities::SemanticTokensOptions(options) => options.legend,
            lsp::SemanticTokensServerCapabilities::SemanticTokensRegistrationOptions(options) => options.semantic_tokens_options.legend,
        };
        let spans = crate::semantic::decode(&tokens.data, &legend, &rope);
        assert_eq!(spans.iter().map(|span| (span.range.clone(), span.kind)).collect::<Vec<_>>(), vec![(3..7, crate::syntax::SyntaxKind::Function), (16..17, crate::syntax::SyntaxKind::Constant)]);
    }

    #[test]
    fn lenses_without_commands_are_skipped() {
        let starts = [0, 10, 20];
        let lenses = lenses_from_server(
            vec![lens(2, Some(("Run", "rust-analyzer.runSingle", None))), lens(0, None), lens(1, Some(("Debug", "debug", None))), lens(9, Some(("Lost", "x", None)))],
            |line| starts.get(line).copied(),
        );
        assert_eq!(lenses.iter().map(|lens| (lens.offset, lens.title.as_str())).collect::<Vec<_>>(), vec![(10, "Debug"), (20, "Run")]);
    }

    #[test]
    fn references_lenses_open_the_peek() {
        let location = json!({ "uri": "file:///a.rs", "range": { "start": { "line": 3, "character": 4 }, "end": { "line": 3, "character": 7 } } });
        let arguments = vec![json!("file:///a.rs"), json!({ "line": 1, "character": 2 }), json!([location])];
        let lenses = lenses_from_server(vec![lens(0, Some(("1 reference", SHOW_REFERENCES_COMMAND, Some(arguments))))], |_| Some(0));
        match &lenses[0].action {
            LensAction::References { position, locations } => {
                assert_eq!(*position, lsp::Position::new(1, 2));
                assert_eq!(locations[0].range.start, lsp::Position::new(3, 4));
            }
            other => panic!("not a references lens: {other:?}"),
        }
        let malformed = lenses_from_server(vec![lens(0, Some(("refs", SHOW_REFERENCES_COMMAND, Some(vec![json!(1)]))))], |_| Some(0));
        assert!(matches!(malformed[0].action, LensAction::Command(_)));
    }
}
