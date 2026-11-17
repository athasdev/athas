//! "Generate" on the new pull request and new issue forms (`handleGenerateDraft`): the
//! repository's status and the branch diff go to the AI model as an inline edit, which answers
//! with a JSON title and body. The panel does not reach the AI feature itself; the workbench
//! sets a [`DraftGenerator`].

use std::{path::Path, rc::Rc};

use anyhow::Result;
use gpui::{App, Global, Task};

use crate::create_view::CreateKind;

pub const INSTRUCTION: &str = "Generate a GitHub issue or pull request draft. Return valid JSON only with title and body string fields. Do not include markdown fences or explanation.";

#[cfg(not(target_family = "wasm"))]
const MAX_STATUS_FILES: usize = 30;
#[cfg(not(target_family = "wasm"))]
const MAX_DIFF_FILES: usize = 12;
#[cfg(not(target_family = "wasm"))]
const MAX_DIFF_LINES: usize = 30;

/// What the model is asked: the prompt as the "selected text", the instruction, and the file
/// path the request names (`github-pull-request` or `github-issue`).
#[derive(Clone, Debug, PartialEq)]
pub struct DraftRequest {
    pub file_path: String,
    pub prompt: String,
    pub instruction: String,
}

/// Asks the model for a draft; resolves to its raw answer. Errors carry the AI service's own
/// explanation, such as an organization policy that turns AI off.
pub type DraftGenerator = Rc<dyn Fn(DraftRequest, &mut App) -> Task<Result<String>>>;

struct Generator(DraftGenerator);

impl Global for Generator {}

pub fn set_draft_generator(cx: &mut App, generator: DraftGenerator) {
    cx.set_global(Generator(generator));
}

pub(crate) fn generator(cx: &App) -> Option<DraftGenerator> {
    cx.try_global::<Generator>().map(|generator| generator.0.clone())
}

/// The form's state the prompt describes.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DraftContext {
    pub repository: String,
    pub head: String,
    pub base: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub title: String,
    pub body: String,
    pub status: String,
    pub diff: String,
}

fn or_empty(value: &str) -> &str {
    if value.is_empty() { "(empty)" } else { value }
}

pub fn prompt(kind: CreateKind, context: &DraftContext) -> String {
    let labels = if context.labels.is_empty() { "No labels selected.".to_string() } else { context.labels.join(", ") };
    if kind == CreateKind::PullRequest {
        format!(
            "Create a concise GitHub pull request title and body from this repository context.\nReturn only JSON with \"title\" and \"body\" string fields.\nTitle must be short and imperative. Body should include a compact summary and test notes if inferable.\n\nRepository: {}\nBranch: {} -> {}\nLabels: {labels}\nExisting title: {}\nExisting body: {}\n\nGit status:\n{}\n\nDiff summary:\n{}",
            context.repository,
            context.head,
            context.base,
            or_empty(&context.title),
            or_empty(&context.body),
            context.status,
            context.diff
        )
    } else {
        let assignees = if context.assignees.is_empty() { "None".to_string() } else { context.assignees.join(", ") };
        format!(
            "Create a concise GitHub issue title and body from this draft.\nReturn only JSON with \"title\" and \"body\" string fields.\nTitle must be specific. Body should include problem, expected behavior, and useful context without filler.\n\nRepository: {}\nLabels: {labels}\nAssignees: {assignees}\nExisting title: {}\nExisting body: {}\n\nGit status:\n{}",
            context.repository,
            or_empty(&context.title),
            or_empty(&context.body),
            context.status
        )
    }
}

/// The title and body of the model's answer, from a fenced block, the first object, or the
/// whole text (`extractJsonObject`); each `None` when missing or blank.
pub fn extract_draft(text: &str) -> (Option<String>, Option<String>) {
    let trimmed = text.trim();
    let fenced = trimmed.find("```").and_then(|start| {
        let rest = &trimmed[start + 3..];
        let rest = rest.strip_prefix("json").or_else(|| rest.strip_prefix("JSON")).unwrap_or(rest);
        rest.find("```").map(|end| rest[..end].trim())
    });
    let object = || match (trimmed.find('{'), trimmed.rfind('}')) {
        (Some(start), Some(end)) if end > start => Some(&trimmed[start..=end]),
        _ => None,
    };
    let candidate = fenced.filter(|fenced| !fenced.is_empty()).or_else(object).unwrap_or(trimmed);
    let Ok(serde_json::Value::Object(value)) = serde_json::from_str::<serde_json::Value>(candidate) else { return (None, None) };
    let field = |key: &str| value.get(key).and_then(serde_json::Value::as_str).map(str::trim).filter(|text| !text.is_empty()).map(str::to_string);
    (field("title"), field("body"))
}

#[cfg(not(target_family = "wasm"))]
/// The working tree's status, one file a line (`status staged: path`).
pub fn status_summary(root: &Path) -> String {
    let lines = (|| -> Option<Vec<String>> {
        let repository = git2::Repository::discover(root).ok()?;
        let mut options = git2::StatusOptions::new();
        options.include_untracked(true).recurse_untracked_dirs(false);
        let statuses = repository.statuses(Some(&mut options)).ok()?;
        Some(
            statuses
                .iter()
                .take(MAX_STATUS_FILES)
                .filter_map(|entry| {
                    let status = entry.status();
                    let path = entry.path()?.to_string();
                    let staged = status.intersects(git2::Status::INDEX_NEW | git2::Status::INDEX_MODIFIED | git2::Status::INDEX_DELETED | git2::Status::INDEX_RENAMED);
                    let word = if status.intersects(git2::Status::WT_NEW | git2::Status::INDEX_NEW) {
                        "added"
                    } else if status.intersects(git2::Status::WT_DELETED | git2::Status::INDEX_DELETED) {
                        "deleted"
                    } else if status.intersects(git2::Status::WT_RENAMED | git2::Status::INDEX_RENAMED) {
                        "renamed"
                    } else {
                        "modified"
                    };
                    Some(format!("{word}{}: {path}", if staged { " staged" } else { "" }))
                })
                .collect(),
        )
    })()
    .unwrap_or_default();
    if lines.is_empty() { "No working tree status available.".to_string() } else { lines.join("\n") }
}

#[cfg(not(target_family = "wasm"))]
/// The changes from `base` to `head`, a few lines a file (`summarizeDiffs`).
pub fn diff_summary(root: &Path, base: &str, head: &str) -> String {
    let files = (|| -> Option<Vec<String>> {
        let repository = git2::Repository::discover(root).ok()?;
        let tree = |name: &str| repository.revparse_single(name).ok()?.peel_to_tree().ok();
        let (base, head) = (tree(base)?, tree(head)?);
        let diff = repository.diff_tree_to_tree(Some(&base), Some(&head), None).ok()?;
        let mut files = Vec::new();
        for index in 0..diff.deltas().len().min(MAX_DIFF_FILES) {
            let delta = diff.get_delta(index)?;
            let path = delta.new_file().path().or_else(|| delta.old_file().path())?.to_string_lossy().into_owned();
            let mut changes = Vec::new();
            if let Ok(Some(patch)) = git2::Patch::from_diff(&diff, index) {
                'hunks: for hunk in 0..patch.num_hunks() {
                    for line in 0..patch.num_lines_in_hunk(hunk).unwrap_or(0) {
                        if changes.len() >= MAX_DIFF_LINES {
                            break 'hunks;
                        }
                        let Ok(line) = patch.line_in_hunk(hunk, line) else { continue };
                        let sign = match line.origin() {
                            '+' => '+',
                            '-' => '-',
                            _ => continue,
                        };
                        changes.push(format!("{sign}{}", String::from_utf8_lossy(line.content()).trim_end_matches('\n')));
                    }
                }
            }
            let changes = if changes.is_empty() { "Binary or metadata-only change.".to_string() } else { changes.join("\n") };
            files.push(format!("File: {path}\n{changes}"));
        }
        Some(files)
    })()
    .unwrap_or_default();
    if files.is_empty() { "No branch diff available.".to_string() } else { files.join("\n\n") }
}

/// The web build asks the workspace server, which reads its repository the same way.
#[cfg(target_family = "wasm")]
pub fn status_summary(root: &Path) -> String {
    let call = web_protocol::github::GitHubCall::DraftStatus { path: root.to_string_lossy().into_owned() };
    crate::relay::draft_summary(call).unwrap_or_else(|_| "No working tree status available.".to_string())
}

#[cfg(target_family = "wasm")]
pub fn diff_summary(root: &Path, base: &str, head: &str) -> String {
    let call = web_protocol::github::GitHubCall::DraftDiff { path: root.to_string_lossy().into_owned(), base: base.into(), head: head.into() };
    crate::relay::draft_summary(call).unwrap_or_else(|_| "No branch diff available.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drafts_come_out_of_fences_objects_and_plain_json() {
        assert_eq!(extract_draft("```json\n{\"title\":\"Fix login\",\"body\":\"Details\"}\n```"), (Some("Fix login".into()), Some("Details".into())));
        assert_eq!(extract_draft("Sure! {\"title\": \" Add cache \"} hope it helps"), (Some("Add cache".into()), None));
        assert_eq!(extract_draft("{\"title\":\"\",\"body\":\"  \"}"), (None, None));
        assert_eq!(extract_draft("no json here"), (None, None));
    }

    #[test]
    fn prompts_name_the_branches_and_fill_empty_fields() {
        let context = DraftContext { repository: "/r".into(), head: "feature".into(), base: "main".into(), status: "modified: a.rs".into(), diff: "File: a.rs\n+x".into(), ..Default::default() };
        let pr = prompt(CreateKind::PullRequest, &context);
        assert!(pr.contains("Branch: feature -> main"));
        assert!(pr.contains("Existing title: (empty)"));
        assert!(pr.contains("Labels: No labels selected."));
        assert!(pr.ends_with("Diff summary:\nFile: a.rs\n+x"));
        let issue = prompt(CreateKind::Issue, &DraftContext { assignees: vec!["ada".into()], ..context });
        assert!(issue.contains("Assignees: ada"));
        assert!(!issue.contains("Diff summary"));
    }

    #[test]
    fn status_and_diff_read_the_repository() {
        let dir = std::env::temp_dir().join(format!("athas-github-draft-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repository = git2::Repository::init(&dir).unwrap();
        let signature = git2::Signature::now("Test", "test@example.com").unwrap();
        let commit = |message: &str, file: &str, content: &str, parent: Option<git2::Oid>| {
            std::fs::write(dir.join(file), content).unwrap();
            let mut index = repository.index().unwrap();
            index.add_path(Path::new(file)).unwrap();
            index.write().unwrap();
            let tree = repository.find_tree(index.write_tree().unwrap()).unwrap();
            let parents: Vec<_> = parent.map(|oid| repository.find_commit(oid).unwrap()).into_iter().collect();
            let parents: Vec<_> = parents.iter().collect();
            repository.commit(Some("HEAD"), &signature, &signature, message, &tree, &parents).unwrap()
        };
        let first = commit("one", "a.txt", "one\n", None);
        repository.branch("base", &repository.find_commit(first).unwrap(), true).unwrap();
        commit("two", "a.txt", "one\ntwo\n", Some(first));
        std::fs::write(dir.join("b.txt"), "new").unwrap();
        assert_eq!(status_summary(&dir), "added: b.txt");
        assert_eq!(diff_summary(&dir, "base", "HEAD"), "File: a.txt\n+two");
        assert_eq!(diff_summary(&dir, "missing", "HEAD"), "No branch diff available.");
        std::fs::remove_dir_all(&dir).ok();
    }
}
