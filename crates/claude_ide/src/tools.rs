//! The editor tools Claude Code calls, answered from plain editor state: open editors,
//! diagnostics, opening a file, dirty state and saving, closing tabs. `openDiff` waits on the user,
//! so it comes back as a [`Outcome::Diff`] for the caller to show.
//!
//! Ported from Athas's `integrations/claude-code/services/claude-ide-tools.ts`.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

/// A file open in an editor tab.
#[derive(Clone, Debug, PartialEq)]
pub struct OpenEditor {
    pub path: PathBuf,
    pub label: String,
    pub language: String,
    pub dirty: bool,
    pub active: bool,
    pub line_count: usize,
}

/// One diagnostic, with zero-based positions.
#[derive(Clone, Debug, PartialEq)]
pub struct IdeDiagnostic {
    pub message: String,
    /// `Error`, `Warning`, `Information` or `Hint`.
    pub severity: &'static str,
    pub start: (u32, u32),
    pub end: (u32, u32),
    pub source: Option<String>,
    pub code: Option<String>,
}

/// A change Claude proposed with `openDiff`.
#[derive(Clone, Debug, PartialEq)]
pub struct DiffRequest {
    pub request_id: String,
    pub old_file_path: PathBuf,
    pub new_file_path: PathBuf,
    pub new_contents: String,
    pub tab_name: String,
}

pub enum Outcome {
    Answer(Vec<String>),
    Diff(DiffRequest),
}

/// What the tools read and do in the editor.
pub trait ToolEnv {
    fn open_editors(&self) -> Vec<OpenEditor>;
    /// Diagnostics of `path`, or of every file that has some.
    fn diagnostics(&self, path: Option<&Path>) -> Vec<(PathBuf, Vec<IdeDiagnostic>)>;
    /// Opens `path` at a 1-based line.
    /// Opens a file in the editor, with a byte range of its text selected when given.
    fn open_file(&mut self, path: &Path, selection: Option<std::ops::Range<usize>>);
    /// Saves an open file; `None` when it is not open.
    fn save(&mut self, path: &Path) -> Option<bool>;
    /// Closes the diff Claude opened under `tab_name`, answering it rejected; false when none is.
    fn close_diff(&mut self, tab_name: &str) -> bool;
    /// Closes the editor tab named `tab_name` (its label or path).
    fn close_tab(&mut self, tab_name: &str);
    /// Closes every open Claude diff; how many.
    fn close_all_diffs(&mut self) -> usize;
    /// The text of `path`, from its editor or the disk.
    fn read(&self, path: &Path) -> Option<String>;
    /// The open project's root, which relative paths resolve against.
    fn workspace_root(&self) -> Option<PathBuf> {
        None
    }
    /// The user's home folder, which `~/…` paths resolve against.
    fn home_dir(&self) -> Option<PathBuf> {
        #[allow(deprecated)]
        std::env::home_dir()
    }
}

/// `~` or a path starting `~/` (or `~\`).
fn is_home_relative(path: &str) -> bool {
    path == "~" || path.starts_with("~/") || path.starts_with("~\\")
}

fn is_absolute_tool_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with('/') || (bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'/' | b'\\')) || path.starts_with("remote://")
}

/// Resolves a path an agent sent against the open workspace when it is relative
/// (`resolveWorkspacePath`). `~/…` paths resolve against `home` and are never joined to the
/// workspace root, which would make paths like `<root>/~/…` that do not exist.
pub fn resolve_tool_path(path: &str, root: Option<&Path>, home: Option<&Path>) -> PathBuf {
    let join = |parent: &Path, child: &str| {
        let child = child.trim_matches(['/', '\\']);
        if child.is_empty() { parent.to_path_buf() } else { parent.join(child) }
    };
    if is_home_relative(path) {
        return home.map_or_else(|| PathBuf::from(path), |home| join(home, &path[1..]));
    }
    if is_absolute_tool_path(path) {
        return PathBuf::from(path);
    }
    root.map_or_else(|| PathBuf::from(path), |root| join(root, path))
}

fn string_arg<'a>(args: &'a Value, name: &str) -> Option<&'a str> {
    args.get(name).and_then(Value::as_str)
}

fn require_string<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    string_arg(args, name).ok_or_else(|| format!("Missing required parameter: {name}"))
}

pub fn file_uri_to_path(uri: &str) -> PathBuf {
    let Some(rest) = uri.strip_prefix("file://") else { return PathBuf::from(uri) };
    let mut bytes = Vec::with_capacity(rest.len());
    let raw = rest.as_bytes();
    let mut index = 0;
    while index < raw.len() {
        if raw[index] == b'%'
            && index + 2 < raw.len()
            && let Some(byte) = std::str::from_utf8(&raw[index + 1..index + 3]).ok().and_then(|hex| u8::from_str_radix(hex, 16).ok())
        {
            bytes.push(byte);
            index += 3;
            continue;
        }
        bytes.push(raw[index]);
        index += 1;
    }
    let path = String::from_utf8_lossy(&bytes).into_owned();
    let windows = path.len() > 2 && path.as_bytes()[0] == b'/' && path.as_bytes()[2] == b':';
    PathBuf::from(if windows { path[1..].to_string() } else { path })
}

pub fn path_to_file_uri(path: &Path) -> String {
    let path = path.to_string_lossy().replace('\\', "/");
    let mut url = String::from("file://");
    if !path.starts_with('/') {
        url.push('/');
    }
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' | b':' => url.push(byte as char),
            _ => url.push_str(&format!("%{byte:02X}")),
        }
    }
    url
}

fn line_start(text: &str, line: usize) -> usize {
    let mut offset = 0;
    for _ in 0..line {
        match text[offset..].find('\n') {
            Some(next) => offset += next + 1,
            None => return text.len(),
        }
    }
    offset
}

fn line_end(text: &str, offset: usize) -> usize {
    text[offset..].find('\n').map_or(text.len(), |next| offset + next)
}

/// The byte range `openFile` asks to select: from the start of `startText` to the end of
/// `endText` (searched after it), or whole 1-based lines `startLine`..`endLine`.
pub fn find_open_file_selection(text: &str, args: &Value) -> Option<std::ops::Range<usize>> {
    if let Some(start_text) = string_arg(args, "startText").filter(|text| !text.is_empty()) {
        let from = text.find(start_text)?;
        let mut to = from + start_text.len();
        if let Some(end_text) = string_arg(args, "endText").filter(|text| !text.is_empty())
            && let Some(end) = text[to..].find(end_text)
        {
            to += end + end_text.len();
        }
        if args.get("selectToEndOfLine").and_then(Value::as_bool) == Some(true) {
            to = line_end(text, to);
        }
        return Some(from..to);
    }
    let start_line = args.get("startLine").and_then(Value::as_u64)? as usize;
    let end_line = args.get("endLine").and_then(Value::as_u64).map_or(start_line, |line| line as usize);
    let from = line_start(text, start_line.saturating_sub(1));
    let to = line_end(text, line_start(text, end_line.saturating_sub(1)));
    Some(from..to.max(from))
}

fn count_lines(text: &str) -> usize {
    if text.is_empty() { 1 } else { text.split('\n').count() }
}

fn document_not_open(path: &str) -> Vec<String> {
    vec![json!({ "success": false, "message": format!("Document not open: {path}") }).to_string()]
}

/// Runs one tool.
pub fn run_tool(env: &mut dyn ToolEnv, request_id: &str, tool: &str, args: &Value) -> Result<Outcome, String> {
    let answer = |texts: Vec<String>| Ok(Outcome::Answer(texts));
    match tool {
        "openFile" => {
            let path = resolve_tool_path(require_string(args, "filePath")?, env.workspace_root().as_deref(), env.home_dir().as_deref());
            let text = env.read(&path);
            let selection = text.as_deref().and_then(|text| find_open_file_selection(text, args));
            env.open_file(&path, selection);
            if args.get("makeFrontmost").and_then(Value::as_bool) == Some(false) {
                let editor = env.open_editors().into_iter().find(|editor| editor.path == path);
                return answer(vec![
                    json!({
                        "success": true,
                        "filePath": path,
                        "languageId": editor.as_ref().map_or("plaintext".to_string(), |editor| editor.language.clone()),
                        "lineCount": text.as_deref().map_or(0, count_lines),
                    })
                    .to_string(),
                ]);
            }
            answer(vec![format!("Opened file: {}", path.display())])
        }
        "openDiff" => Ok(Outcome::Diff(DiffRequest {
            request_id: request_id.to_string(),
            old_file_path: PathBuf::from(require_string(args, "old_file_path")?),
            new_file_path: PathBuf::from(require_string(args, "new_file_path")?),
            new_contents: require_string(args, "new_file_contents")?.to_string(),
            tab_name: require_string(args, "tab_name")?.to_string(),
        })),
        "getOpenEditors" => {
            let tabs: Vec<Value> = env
                .open_editors()
                .into_iter()
                .map(|editor| {
                    json!({
                        "uri": path_to_file_uri(&editor.path),
                        "isActive": editor.active,
                        "label": editor.label,
                        "languageId": editor.language,
                        "isDirty": editor.dirty,
                        "fileName": editor.path,
                        "isUntitled": false,
                        "lineCount": editor.line_count,
                    })
                })
                .collect();
            answer(vec![json!({ "tabs": tabs }).to_string()])
        }
        "getDiagnostics" => {
            let uri = string_arg(args, "uri");
            let path = uri.map(file_uri_to_path);
            let files: Vec<Value> = env
                .diagnostics(path.as_deref())
                .into_iter()
                .filter(|(_, diagnostics)| uri.is_some() || !diagnostics.is_empty())
                .map(|(path, diagnostics)| {
                    json!({
                        "uri": path_to_file_uri(&path),
                        "diagnostics": diagnostics.iter().map(|diagnostic| json!({
                            "message": diagnostic.message,
                            "severity": diagnostic.severity,
                            "range": {
                                "start": { "line": diagnostic.start.0, "character": diagnostic.start.1 },
                                "end": { "line": diagnostic.end.0, "character": diagnostic.end.1 },
                            },
                            "source": diagnostic.source,
                            "code": diagnostic.code,
                        })).collect::<Vec<_>>(),
                    })
                })
                .collect();
            answer(vec![Value::Array(files).to_string()])
        }
        "checkDocumentDirty" => {
            let path = require_string(args, "filePath")?;
            match env.open_editors().into_iter().find(|editor| editor.path == Path::new(path)) {
                Some(editor) => answer(vec![json!({ "success": true, "filePath": path, "isDirty": editor.dirty, "isUntitled": false }).to_string()]),
                None => answer(document_not_open(path)),
            }
        }
        "saveDocument" => {
            let path = require_string(args, "filePath")?;
            match env.save(Path::new(path)) {
                Some(true) => answer(vec![json!({ "success": true, "filePath": path, "saved": true, "message": "Document saved successfully" }).to_string()]),
                Some(false) => answer(vec![json!({ "success": false, "filePath": path, "message": "Failed to save file" }).to_string()]),
                None => answer(document_not_open(path)),
            }
        }
        "close_tab" => {
            let tab_name = require_string(args, "tab_name")?;
            if !env.close_diff(tab_name) {
                env.close_tab(tab_name);
            }
            answer(vec!["TAB_CLOSED".to_string()])
        }
        "closeAllDiffTabs" => answer(vec![format!("CLOSED_{}_DIFF_TABS", env.close_all_diffs())]),
        other => Err(format!("Athas does not support the {other} tool")),
    }
}

/// How a diff review ends, as Claude reads it: accepted contents are written by Claude itself.
pub fn diff_answer(request: &DiffRequest, accepted: bool) -> Vec<String> {
    if accepted { vec!["FILE_SAVED".into(), request.new_contents.clone()] } else { vec!["DIFF_REJECTED".into(), request.tab_name.clone()] }
}
