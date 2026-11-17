//! Commit messages written by the AI model (`git/commit-composer` of Athas): the context sent
//! about the staged changes, the instruction, and cleaning up what comes back. The panel does not
//! reach the AI feature itself; the workbench sets a [`CommitMessageGenerator`].

use std::{path::Path, rc::Rc};

use anyhow::Result;
use gpui::{App, Global, Task};

const MAX_STAGED_FILES: usize = 120;
const MAX_RECENT_COMMITS: usize = 24;
const MAX_DIFF_FILES: usize = 10;
const MAX_DIFF_LINES_PER_FILE: usize = 80;
const MAX_CONTEXT_CHARS: usize = 11_000;

/// The instruction for a one-line subject (`INSTRUCTIONS.title`).
pub const TITLE_INSTRUCTION: &str = "Generate a concise Git commit subject from the staged changes. Return exactly one subject line and nothing else. Keep it under 72 characters when possible. Infer and match the repository's style from recent commit subjects. Do not force conventional commit format unless the recent commits clearly use it.";

/// What the model is asked: the instruction, and the context as the "selected text".
#[derive(Clone, Debug, PartialEq)]
pub struct CommitMessageRequest {
    /// The repository folder's name, sent as the file path.
    pub repository: String,
    pub context: String,
    pub instruction: String,
}

/// Asks the model for a message. Errors carry the AI service's own explanation.
pub type CommitMessageGenerator = Rc<dyn Fn(CommitMessageRequest, &mut App) -> Task<Result<String>>>;

struct Generator(CommitMessageGenerator);

impl Global for Generator {}

/// How the panel's "Generate message with AI" reaches the AI model.
pub fn set_commit_message_generator(cx: &mut App, generator: CommitMessageGenerator) {
    cx.set_global(Generator(generator));
}

pub(crate) fn generator(cx: &App) -> Option<CommitMessageGenerator> {
    cx.try_global::<Generator>().map(|generator| generator.0.clone())
}

/// A staged file as the context lists it: its status word and path, and its staged diff lines
/// (`+`/`-` prefixed), `None` when there is no text diff.
#[derive(Clone, Debug, PartialEq)]
pub struct StagedFile {
    pub path: String,
    pub status: &'static str,
    pub binary: bool,
    pub changed_lines: Option<Vec<String>>,
}

pub fn repository_label(root: &Path) -> String {
    root.file_name().map(|name| name.to_string_lossy().into_owned()).filter(|name| !name.is_empty()).unwrap_or_else(|| "repository".into())
}

fn diff_excerpt(file: &StagedFile) -> String {
    if file.binary {
        return format!("### {}\n(binary or image change)", file.path);
    }
    let Some(lines) = &file.changed_lines else { return format!("### {}\n(no staged text diff available)", file.path) };
    let shown = lines.iter().take(MAX_DIFF_LINES_PER_FILE).cloned().collect::<Vec<_>>().join("\n");
    let omitted = lines.len().saturating_sub(MAX_DIFF_LINES_PER_FILE);
    let mut parts = vec![format!("### {}", file.path), if shown.is_empty() { "(metadata-only change)".to_string() } else { shown }];
    if omitted > 0 {
        parts.push(format!("... {omitted} more changed lines omitted"));
    }
    parts.join("\n")
}

/// The context about the staged changes (`buildCommitMessageContext`). `files` holds every staged
/// file; only the first [`MAX_DIFF_FILES`] need their lines.
pub fn build_context(repository: &str, branch: &str, recent_subjects: &[String], files: &[StagedFile], draft: &str) -> String {
    let listed = &files[..files.len().min(MAX_STAGED_FILES)];
    let sampled = &files[..files.len().min(MAX_DIFF_FILES)];
    let (additions, deletions) = sampled.iter().flat_map(|file| file.changed_lines.iter().flatten()).fold((0, 0), |(added, removed), line| {
        if line.starts_with('+') { (added + 1, removed) } else { (added, removed + 1) }
    });
    let commits = recent_subjects
        .iter()
        .map(|subject| subject.trim())
        .filter(|subject| !subject.is_empty())
        .take(MAX_RECENT_COMMITS)
        .map(|subject| format!("- {subject}"))
        .collect::<Vec<_>>()
        .join("\n");
    let staged = listed.iter().map(|file| format!("- {} staged: {}", file.status, file.path)).collect::<Vec<_>>().join("\n");
    let excerpts = sampled.iter().map(diff_excerpt).collect::<Vec<_>>().join("\n\n");
    let mut lines = vec![
        format!("Repository: {repository}"),
        format!("Branch: {}", if branch.is_empty() { "unknown" } else { branch }),
        String::new(),
        "Recent commit subjects for style:".to_string(),
        if commits.is_empty() { "- none".to_string() } else { commits },
        String::new(),
        format!("Staged files ({}):", files.len()),
        if staged.is_empty() { "- none".to_string() } else { staged },
    ];
    if files.len() > listed.len() {
        lines.push(format!("- ...and {} more staged files", files.len() - listed.len()));
    }
    lines.push(String::new());
    lines.push(format!("Staged diff summary for sampled files: +{additions} -{deletions}"));
    if files.len() > sampled.len() {
        lines.push(format!("Diff excerpts include {} of {} staged files.", sampled.len(), files.len()));
    }
    if !excerpts.is_empty() {
        lines.push(format!("\nStaged patch excerpts:\n{excerpts}"));
    }
    let draft = draft.trim();
    if !draft.is_empty() {
        lines.push(format!("\nCurrent draft:\n{draft}"));
    }
    let context = lines.into_iter().filter(|line| !line.is_empty()).collect::<Vec<_>>().join("\n");
    match context.char_indices().nth(MAX_CONTEXT_CHARS) {
        Some((end, _)) => format!("{}\n\n[context truncated]", &context[..end]),
        None => context,
    }
}

/// The first non-empty line of what the model wrote, without a Markdown fence around it.
pub fn normalize_title(message: &str) -> String {
    let mut text = message.trim();
    if let Some(rest) = text.strip_prefix("```") {
        text = rest.split_once('\n').map_or("", |(_, rest)| rest);
    }
    let text = text.trim_end().strip_suffix("```").unwrap_or(text);
    text.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, lines: Option<Vec<&str>>) -> StagedFile {
        StagedFile { path: path.into(), status: "modified", binary: false, changed_lines: lines.map(|lines| lines.into_iter().map(str::to_string).collect()) }
    }

    #[test]
    fn builds_the_context_like_athas() {
        let files = vec![file("src/a.rs", Some(vec!["+new", "-old", "+more"])), file("b.md", None)];
        let context = build_context("athas", "main", &["Fix tabs".into(), " ".into()], &files, " wip ");
        assert_eq!(
            context,
            "Repository: athas\nBranch: main\nRecent commit subjects for style:\n- Fix tabs\nStaged files (2):\n- modified staged: src/a.rs\n- modified staged: b.md\nStaged diff summary for sampled files: +2 -1\n\nStaged patch excerpts:\n### src/a.rs\n+new\n-old\n+more\n\n### b.md\n(no staged text diff available)\n\nCurrent draft:\nwip"
        );
        let empty = build_context("athas", "", &[], &[], "");
        assert!(empty.contains("Branch: unknown") && empty.contains("- none"));
    }

    #[test]
    fn truncates_long_contexts() {
        let lines: Vec<&str> = (0..80).map(|_| "+a line long enough to fill the context quickly, again and again").collect();
        let files: Vec<StagedFile> = (0..10).map(|index| file(&format!("f{index}.rs"), Some(lines.clone()))).collect();
        let context = build_context("r", "b", &[], &files, "");
        assert!(context.ends_with("[context truncated]"));
        assert!(context.chars().count() <= MAX_CONTEXT_CHARS + 25);
    }

    #[test]
    fn keeps_the_first_line() {
        assert_eq!(normalize_title("```text\n\nAdd commit messages\nBody\n```"), "Add commit messages");
        assert_eq!(normalize_title("  Fix it  "), "Fix it");
        assert_eq!(normalize_title(""), "");
    }
}
