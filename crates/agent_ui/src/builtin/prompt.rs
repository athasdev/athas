//! What the built-in agent is told before the conversation: its mode, the workspace tools, the
//! project's rules (`AGENTS.md`, `CLAUDE.md`, `.athas/rules`, `.cursor/rules`) and the user's own.
//!
//! Ported from Athas's `utils/ai-context-builder.ts` (`buildSystemPrompt`) and
//! `lib/project-rules.ts`.

use std::path::Path;

/// The modes the agent offers: the full agent, and two that only read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Agent,
    Ask,
    Plan,
}

impl Mode {
    pub const ALL: [Mode; 3] = [Mode::Agent, Mode::Ask, Mode::Plan];

    pub fn id(self) -> &'static str {
        match self {
            Mode::Agent => "agent",
            Mode::Ask => "ask",
            Mode::Plan => "plan",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Mode::Agent => "Agent",
            Mode::Ask => "Ask",
            Mode::Plan => "Plan",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Mode::Agent => "Reads, edits and runs commands in the project",
            Mode::Ask => "Answers questions; reads the project but changes nothing",
            Mode::Plan => "Plans the work without changing anything",
        }
    }

    /// The mode for an id; Athas's own `chat` is the agent.
    pub fn from_id(id: &str) -> Option<Mode> {
        match id {
            "agent" | "chat" => Some(Mode::Agent),
            "ask" => Some(Mode::Ask),
            "plan" => Some(Mode::Plan),
            _ => None,
        }
    }

    pub fn read_only(self) -> bool {
        self != Mode::Agent
    }
}

/// The most tokens all rules together may add to the system prompt.
pub const PROJECT_RULES_MAX_TOKENS: usize = 12_000;
/// The most tokens one rule file may add before it is truncated.
const PROJECT_RULE_MAX_TOKENS: usize = 6_000;
/// Directories above the files in play that are checked for nested `AGENTS.md` files.
const MAX_NESTED_RULE_DIRECTORIES: usize = 24;
const RULES_HEADER: &str = "Project rules (from the repository and the user's settings; follow them unless the user's request conflicts):";

/// What the request is about besides its text: the file the user is editing and the files the
/// prompt attaches, which scope glob and nested rules.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RequestContext {
    pub active_file: Option<std::path::PathBuf>,
    /// The language the editor reads the active file as, and whether it holds unsaved changes.
    pub active_language: Option<String>,
    pub active_dirty: bool,
    pub context_paths: Vec<std::path::PathBuf>,
    /// The team workspace's AI instructions for the project.
    pub team_instructions: Option<String>,
}

/// The active file as the prompt shows it (`buildContextPrompt`): its name and language, and its
/// text, the first 50 and last 20 lines of a long one.
fn active_file_section(path: &Path, root: Option<&Path>, editor_language: Option<&str>, dirty: bool) -> Option<String> {
    let name = root.and_then(|root| path.strip_prefix(root).ok()).unwrap_or(path).display().to_string();
    let language = path.extension().map(|extension| extension.to_string_lossy().to_lowercase()).unwrap_or_else(|| "text".into());
    let mut section = format!("\nCurrently editing: {name}");
    if let Some(editor_language) = editor_language.filter(|language| !matches!(*language, "" | "Text" | "Plain Text")) {
        section.push_str(&format!(" ({editor_language})"));
    }
    if dirty {
        section.push_str(" [unsaved changes]");
    }
    let file_name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    if crate::completion_context::is_sensitive(&file_name) {
        return Some(section);
    }
    let content = read_rule(path)?;
    let lines: Vec<&str> = content.split('\n').collect();
    if lines.len() <= 100 {
        section.push_str(&format!("\n\nFile content:\n```{language}\n{content}\n```"));
    } else {
        let preview = [&lines[..50], &["... (content truncated) ..."], &lines[lines.len() - 20..]].concat().join("\n");
        section.push_str(&format!("\n\nFile content (preview):\n```{language}\n{preview}\n```"));
    }
    Some(section)
}

pub fn system_prompt(mode: Mode, root: Option<&Path>, user_rules: &str) -> String {
    system_prompt_for(mode, root, user_rules, &RequestContext::default())
}

pub fn system_prompt_for(mode: Mode, root: Option<&Path>, user_rules: &str, context: &RequestContext) -> String {
    let mut prompt = String::from(
        "You are Athas Agent, an expert coding assistant built into the Athas code editor. You work in the user's project with the tools offered in this session.",
    );
    match mode {
        Mode::Plan => prompt.push_str(
            "\n\nPLAN MODE: You are in Plan Mode. This means:\n- NEVER modify files or run commands that change state\n- Read and search the project to understand it, then write a concrete plan: the steps, the files each touches, risks and how to verify\n- Use planning language like \"would\", \"could\", \"should\" instead of \"will\"\n\nWhen creating implementation plans, you MUST use this structured format:\n\n[PLAN_BLOCK]\n[STEP] Step title here\nDescription of what this step involves. Can be multiple lines.\nInclude specific file paths, code changes, or commands needed.\n[/STEP]\n[STEP] Another step title\nDescription for this step.\n[/STEP]\n[/PLAN_BLOCK]\n\nRules for plans:\n- Include text before the PLAN_BLOCK for context and analysis\n- Include text after the PLAN_BLOCK for additional notes if needed\n- Each STEP must have a clear, concise title on the first line after [STEP]\n- Follow the title with a detailed description on subsequent lines\n- Use 3-8 steps for most plans\n- Each step should be independently executable\n- Always wrap your plan in [PLAN_BLOCK] tags",
        ),
        Mode::Ask => prompt.push_str(
            "\n\nASK MODE: You are in Ask Mode. This means:\n- Answer questions about the code and explain how it works\n- Read files and search the project as needed, but NEVER modify files or run commands that change state\n- When a change would help, describe it and suggest switching to Agent mode to apply it",
        ),
        Mode::Agent => prompt.push_str(
            "\n\nAGENT MODE: You can analyze and change the project:\n- Make the changes the user asks for, then verify them (build, tests) when a command for that exists\n- Keep changes focused; do not reformat or rewrite code you were not asked to touch",
        ),
    }
    prompt.push_str(
        "\n\nTools:\n- Only call tools that are offered in this session; the set depends on the mode and the workspace\n- list_files and search_files find code; read_file reads a file 250 lines at a time; edit_file applies exact text replacements; write_file creates or replaces a whole file; delete_file removes a file; run_command runs a shell command; todo_write keeps a checklist for multi-step work\n- Paths passed to workspace tools are relative to the workspace root\n- Read a file with read_file before changing it, and prefer edit_file over write_file for existing files\n- Edits land at once and the user reviews them; deletions, commands and MCP tools may need the user's approval. A declined call is not an error to retry\n- Tools named mcp__<server>__<tool> come from the user's MCP servers\n\nGuidelines:\n- Be concise but thorough; reference the user's actual code\n- Use Markdown, with fenced code blocks for code\n- Link files you mention as [path](path) so the user can open them\n- Ask a clarifying question when the request is ambiguous",
    );
    if let Some(team) = context.team_instructions.as_deref().filter(|team| !team.trim().is_empty()) {
        prompt.push_str("\n\n");
        prompt.push_str(&crate::team_context::section(team.trim()));
    }
    let mut context_paths = context.context_paths.clone();
    context_paths.extend(context.active_file.clone());
    let rules = project_rules_section(root, &context_paths, user_rules);
    if !rules.is_empty() {
        prompt.push_str("\n\n");
        prompt.push_str(&rules);
    }
    match root {
        Some(root) => {
            let name = root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            prompt.push_str(&format!("\n\nCurrent context:\nProject: {name}\nWorkspace root: {}", root.display()));
        }
        None => prompt.push_str("\n\nCurrent context:\nNo project is open, so workspace tools are not available."),
    }
    prompt.push_str(&format!("\nPlatform: {}", std::env::consts::OS));
    if let Some(section) = context.active_file.as_deref().and_then(|path| active_file_section(path, root, context.active_language.as_deref(), context.active_dirty)) {
        prompt.push_str(&section);
    }
    prompt
}

/// Matches a rule glob against a path relative to the project root (`matchesRuleGlob`). A glob
/// without a slash matches the file name anywhere, as editors treat `*.tsx`.
pub fn matches_rule_glob(glob: &str, relative_path: &str) -> bool {
    let pattern = glob.trim();
    let pattern = pattern.strip_prefix("./").unwrap_or(pattern);
    if pattern.is_empty() {
        return false;
    }
    let target = if pattern.contains('/') { relative_path } else { relative_path.rsplit('/').next().unwrap_or_default() };
    expand_braces(pattern).iter().any(|alternative| glob_matches(&alternative.chars().collect::<Vec<_>>(), &target.chars().collect::<Vec<_>>()))
}

/// `{a,b}` options as separate globs, nested braces included.
fn expand_braces(pattern: &str) -> Vec<String> {
    let Some(open) = pattern.find('{') else { return vec![pattern.to_string()] };
    let mut depth = 0;
    let mut close = None;
    for (index, c) in pattern[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    close = Some(open + index);
                    break;
                }
            }
            _ => {}
        }
    }
    let Some(close) = close else { return vec![pattern.to_string()] };
    let inner = &pattern[open + 1..close];
    let mut options = Vec::new();
    let (mut depth, mut start) = (0, 0);
    for (index, c) in inner.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => depth -= 1,
            ',' if depth == 0 => {
                options.push(&inner[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    options.push(&inner[start..]);
    let (head, tail) = (&pattern[..open], &pattern[close + 1..]);
    options.into_iter().flat_map(|option| expand_braces(&format!("{head}{option}{tail}"))).collect()
}

/// `**/` any folders (or none), `**` anything, `*` anything but `/`, `?` one character but `/`.
fn glob_matches(pattern: &[char], target: &[char]) -> bool {
    match pattern {
        [] => target.is_empty(),
        ['*', '*', '/', rest @ ..] => (0..=target.len()).any(|at| (at == 0 || target[at - 1] == '/') && glob_matches(rest, &target[at..])),
        ['*', '*', rest @ ..] => (0..=target.len()).any(|at| glob_matches(rest, &target[at..])),
        ['*', rest @ ..] => (0..=target.len()).take_while(|at| *at == 0 || target[at - 1] != '/').any(|at| glob_matches(rest, &target[at..])),
        ['?', rest @ ..] => target.first().is_some_and(|c| *c != '/') && glob_matches(rest, &target[1..]),
        [c, rest @ ..] => target.first() == Some(c) && glob_matches(rest, &target[1..]),
    }
}

/// The rules for a request with no files in play (`loadProjectRules`), as a prompt section.
pub fn project_rules(root: &Path) -> String {
    project_rules_section(Some(root), &[], "")
}

/// [`project_rules`] for a request about `context_paths`: glob rules that match one of them, and
/// `AGENTS.md`/`CLAUDE.md` in the folders above them, apply in full.
pub fn project_rules_for(root: &Path, context_paths: &[std::path::PathBuf]) -> String {
    project_rules_section(Some(root), context_paths, "")
}

struct Rule {
    title: String,
    path: Option<String>,
    content: String,
}

/// The rules Athas honours, in its order: the user's rules, `AGENTS.md` and `CLAUDE.md` at the root
/// and in the folders above the files in play, `.athas/rules` and `.cursor/rules` with their
/// frontmatter, then the legacy `.cursorrules`. Rules scoped by globs that no file in play matches
/// are listed by description for the agent to read when relevant. The section fits 12k tokens,
/// each rule 6k; rules past the budget are named.
pub fn project_rules_section(root: Option<&Path>, context_paths: &[std::path::PathBuf], user_rules: &str) -> String {
    let mut applied: Vec<Rule> = Vec::new();
    let mut available: Vec<String> = Vec::new();
    let user_rules = user_rules.trim();
    if !user_rules.is_empty() {
        applied.push(Rule { title: "User rules".into(), path: None, content: user_rules.to_string() });
    }
    if let Some(root) = root {
        let relative: Vec<String> = context_paths
            .iter()
            .filter_map(|path| path.strip_prefix(root).ok())
            .filter(|path| !path.components().any(|component| matches!(component, std::path::Component::ParentDir)))
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .filter(|path| !path.is_empty())
            .collect();
        let mut seen = std::collections::HashSet::new();
        let mut include = |rule: Rule, applied: &mut Vec<Rule>| {
            if seen.insert(rule.content.trim().to_string()) {
                applied.push(rule);
            }
        };
        let mut directories = vec![String::new()];
        directories.extend(nested_rule_directories(&relative));
        for directory in directories {
            for name in ["AGENTS.md", "CLAUDE.md"] {
                let path = if directory.is_empty() { name.to_string() } else { format!("{directory}/{name}") };
                let Some(text) = read_rule(&root.join(&path)) else { continue };
                let body = frontmatter(&text).1.trim();
                if body.is_empty() || is_import_only(body) {
                    continue;
                }
                let title = if directory.is_empty() { path.clone() } else { format!("{path} (applies to files under {directory}/)") };
                include(Rule { title, path: Some(path), content: body.to_string() }, &mut applied);
            }
        }
        let mut scoped: Vec<std::path::PathBuf> = Vec::new();
        for folder in [".athas/rules", ".cursor/rules"] {
            let Ok(entries) = std::fs::read_dir(root.join(folder)) else { continue };
            let mut paths: Vec<_> = entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("mdc")))
                .collect();
            paths.sort();
            scoped.extend(paths);
        }
        scoped.push(root.join(".cursorrules"));
        for path in scoped {
            let Some(text) = read_rule(&path) else { continue };
            let (always, body) = frontmatter(&text);
            let body = body.trim();
            if body.is_empty() || is_import_only(body) {
                continue;
            }
            let name = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            let (description, globs) = rule_scope(&text);
            let matched = !globs.is_empty() && globs.iter().any(|glob| relative.iter().any(|path| matches_rule_glob(glob, path)));
            if always {
                include(Rule { title: name.clone(), path: Some(name), content: body.to_string() }, &mut applied);
            } else if matched {
                include(Rule { title: format!("{name} (applies to {})", globs.join(", ")), path: Some(name), content: body.to_string() }, &mut applied);
            } else {
                let applies = match (globs.is_empty(), description) {
                    (false, Some(description)) => format!("{description} (applies to {})", globs.join(", ")),
                    (false, None) => format!("applies to {}", globs.join(", ")),
                    (true, Some(description)) => description,
                    (true, None) => continue,
                };
                available.push(format!("- {name}: {applies}"));
            }
        }
    }
    format_project_rules(&applied, &available, PROJECT_RULES_MAX_TOKENS)
}

/// Renders rules as a prompt section, cutting rules that do not fit the budget
/// (`formatProjectRules`).
fn format_project_rules(rules: &[Rule], available: &[String], max_tokens: usize) -> String {
    use crate::context_budget::{estimate_tokens, truncate_text_to_tokens};
    if rules.is_empty() && available.is_empty() {
        return String::new();
    }
    let mut remaining = max_tokens as isize - estimate_tokens(RULES_HEADER) as isize;
    let mut sections: Vec<String> = Vec::new();
    let mut omitted: Vec<&str> = Vec::new();
    for rule in rules {
        let title = format!("## {}", rule.title);
        let allowance = (PROJECT_RULE_MAX_TOKENS as isize).min(remaining - estimate_tokens(&title) as isize - 1);
        if allowance < 200 {
            omitted.extend(rule.path.as_deref());
            continue;
        }
        let body = truncate_text_to_tokens(&rule.content, allowance as usize);
        let section = format!("{title}\n{}", body.text);
        remaining -= estimate_tokens(&section) as isize + 1;
        sections.push(section);
    }
    if !omitted.is_empty() {
        sections.push(format!("[truncated: {} more rule files did not fit; read them when relevant: {}]", omitted.len(), omitted.join(", ")));
    }
    if !available.is_empty() {
        sections.push(format!("Other rules (read the file when its description is relevant):\n{}", available.join("\n")));
    }
    truncate_text_to_tokens(&format!("{RULES_HEADER}\n\n{}", sections.join("\n\n")), max_tokens).text
}

/// The folders above the files in play, shallowest first (`nestedDirectories`).
fn nested_rule_directories(relative_paths: &[String]) -> Vec<String> {
    let mut directories: Vec<String> = Vec::new();
    for path in relative_paths {
        let segments: Vec<&str> = path.split('/').filter(|segment| !segment.is_empty()).collect();
        for depth in 1..segments.len() {
            let directory = segments[..depth].join("/");
            if !directories.contains(&directory) {
                directories.push(directory);
            }
        }
    }
    directories.sort_by_key(|directory| directory.split('/').count());
    directories.truncate(MAX_NESTED_RULE_DIRECTORIES);
    directories
}

/// A rule's `description` and `globs` from its frontmatter.
fn rule_scope(text: &str) -> (Option<String>, Vec<String>) {
    let Some(rest) = text.strip_prefix("---\n").or_else(|| text.strip_prefix("---\r\n")) else { return (None, Vec::new()) };
    let Some(end) = rest.find("\n---") else { return (None, Vec::new()) };
    let mut description = None;
    let mut globs = Vec::new();
    let mut in_globs = false;
    for line in rest[..end].lines() {
        let trimmed = line.trim();
        if in_globs && let Some(item) = trimmed.strip_prefix("- ") {
            globs.push(item.trim().trim_matches(['"', '\'']).to_string());
            continue;
        }
        in_globs = false;
        if let Some(value) = trimmed.strip_prefix("description:") {
            let value = value.trim().trim_matches(['"', '\'']).to_string();
            description = (!value.is_empty()).then_some(value);
        } else if let Some(value) = trimmed.strip_prefix("globs:") {
            let value = value.trim().trim_start_matches('[').trim_end_matches(']');
            if value.is_empty() {
                in_globs = true;
            } else {
                let mut depth = 0;
                let mut current = String::new();
                for ch in value.chars() {
                    match ch {
                        '{' => depth += 1,
                        '}' => depth -= 1,
                        ',' if depth == 0 => {
                            globs.push(current.trim().trim_matches(['"', '\'']).to_string());
                            current.clear();
                            continue;
                        }
                        _ => {}
                    }
                    current.push(ch);
                }
                globs.push(current.trim().trim_matches(['"', '\'']).to_string());
            }
        }
    }
    globs.retain(|glob| !glob.is_empty());
    (description, globs)
}

fn read_rule(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 256 * 1024 {
        return None;
    }
    std::fs::read_to_string(path).ok().filter(|text| !text.trim().is_empty())
}

/// Whether a rule applies always, and its body without frontmatter. Plain Markdown applies
/// always; with frontmatter only `alwaysApply: true` does (glob rules need the files in play).
fn frontmatter(text: &str) -> (bool, &str) {
    let Some(rest) = text.strip_prefix("---\n").or_else(|| text.strip_prefix("---\r\n")) else { return (true, text) };
    let Some(end) = rest.find("\n---") else { return (true, text) };
    let header = &rest[..end];
    let body = rest[end + 4..].trim_start_matches(['\r', '\n']);
    let always = header.lines().any(|line| {
        let line = line.trim();
        line.strip_prefix("alwaysApply:").is_some_and(|value| value.trim().trim_matches(['"', '\'']).eq_ignore_ascii_case("true"))
    });
    (always, body)
}

/// A `CLAUDE.md` that only imports `AGENTS.md` (`@AGENTS.md`) adds nothing of its own.
fn is_import_only(text: &str) -> bool {
    text.lines().map(str::trim).filter(|line| !line.is_empty()).all(|line| line.starts_with('@') && !line.contains(' '))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_that_always_apply_are_included() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "Use bun.").unwrap();
        std::fs::write(dir.path().join("CLAUDE.md"), "@AGENTS.md\n").unwrap();
        std::fs::create_dir_all(dir.path().join(".cursor/rules")).unwrap();
        std::fs::write(dir.path().join(".cursor/rules/a.mdc"), "---\nalwaysApply: true\n---\nNo semicolons.").unwrap();
        std::fs::write(dir.path().join(".cursor/rules/b.mdc"), "---\nglobs: *.ts\n---\nOnly for ts.").unwrap();
        let rules = project_rules(dir.path());
        assert!(rules.contains("## AGENTS.md\nUse bun."));
        assert!(!rules.contains("CLAUDE.md"));
        assert!(rules.contains("No semicolons."));
        assert!(!rules.contains("Only for ts."));

        let prompt = system_prompt(Mode::Ask, Some(dir.path()), "Answer in French");
        assert!(prompt.contains("ASK MODE"));
        assert!(prompt.contains("Use bun."));
        assert!(prompt.contains("## User rules\nAnswer in French\n\n## AGENTS.md\nUse bun."));
        assert!(system_prompt(Mode::Agent, None, "").contains("No project is open"));
        assert!(system_prompt(Mode::Agent, None, "Be terse").contains("from the repository and the user's settings; follow them unless the user's request conflicts):\n\n## User rules\nBe terse"));
    }

    #[test]
    fn scoped_and_nested_rules_are_listed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".cursor/rules")).unwrap();
        std::fs::create_dir_all(dir.path().join("crates/ui")).unwrap();
        std::fs::write(dir.path().join(".cursor/rules/ts.mdc"), "---\ndescription: TypeScript style\nglobs: *.{ts,tsx}, src/**\n---\nUse strict types.").unwrap();
        std::fs::write(dir.path().join("crates/ui/AGENTS.md"), "UI rules").unwrap();
        std::fs::write(dir.path().join(".cursorrules"), "Be brief.").unwrap();
        let rules = project_rules(dir.path());
        assert!(rules.contains("## .cursorrules\nBe brief."));
        assert!(rules.contains("- .cursor/rules/ts.mdc: TypeScript style (applies to *.{ts,tsx}, src/**)"));
        assert!(!rules.contains("crates/ui/AGENTS.md"));
        assert!(!rules.contains("Use strict types."));
    }

    #[test]
    fn rules_for_the_files_in_play_apply_in_full() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".cursor/rules")).unwrap();
        std::fs::create_dir_all(dir.path().join("crates/ui/src")).unwrap();
        std::fs::create_dir_all(dir.path().join("crates/db")).unwrap();
        std::fs::write(dir.path().join(".cursor/rules/ts.mdc"), "---\nglobs: *.{ts,tsx}\n---\nUse strict types.").unwrap();
        std::fs::write(dir.path().join(".cursor/rules/rs.mdc"), "---\ndescription: Rust\nglobs: crates/**/*.rs\n---\nNo unwrap.").unwrap();
        std::fs::write(dir.path().join("crates/ui/AGENTS.md"), "UI rules").unwrap();
        std::fs::write(dir.path().join("crates/db/AGENTS.md"), "DB rules").unwrap();
        let active = dir.path().join("crates/ui/src/lib.rs");
        std::fs::write(&active, "pub fn ui() {}\n").unwrap();
        let rules = project_rules_for(dir.path(), &[active.clone()]);
        assert!(rules.contains("## .cursor/rules/rs.mdc (applies to crates/**/*.rs)\nNo unwrap."));
        assert!(rules.contains("## crates/ui/AGENTS.md (applies to files under crates/ui/)\nUI rules"));
        assert!(!rules.contains("crates/db/AGENTS.md"));
        assert!(!rules.contains("Use strict types."));

        let context = RequestContext { active_file: Some(active), context_paths: Vec::new(), team_instructions: Some("Use bun.".into()), ..Default::default() };
        let prompt = system_prompt_for(Mode::Agent, Some(dir.path()), "", &context);
        assert!(prompt.contains("athas.workspace.json; follow the user's request if it conflicts):\nUse bun."));
        assert!(prompt.contains("No unwrap."));
        assert!(prompt.contains("Currently editing: crates/ui/src/lib.rs\n\nFile content:\n```rs\npub fn ui() {}"));

        let context = RequestContext { active_file: context.active_file, active_language: Some("Rust".into()), active_dirty: true, ..Default::default() };
        let prompt = system_prompt_for(Mode::Agent, Some(dir.path()), "", &context);
        assert!(prompt.contains("Currently editing: crates/ui/src/lib.rs (Rust) [unsaved changes]\n\nFile content:"));
    }

    #[test]
    fn duplicate_rules_once_and_overflow_named() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "Use bun.").unwrap();
        std::fs::write(dir.path().join("CLAUDE.md"), "Use bun.\n").unwrap();
        std::fs::create_dir_all(dir.path().join(".athas/rules")).unwrap();
        std::fs::write(dir.path().join(".athas/rules/a.md"), "x".repeat(23_000)).unwrap();
        std::fs::write(dir.path().join(".athas/rules/b.md"), "y".repeat(23_000)).unwrap();
        std::fs::write(dir.path().join(".athas/rules/c.md"), "z".repeat(23_000)).unwrap();
        std::fs::write(dir.path().join(".athas/rules/d.md"), "w".repeat(23_000)).unwrap();
        let rules = project_rules(dir.path());
        assert_eq!(rules.matches("Use bun.").count(), 1);
        // The budget is in tokens: c is cut to what is left, d no longer fits.
        assert!(rules.contains("## .athas/rules/c.md\nzzz"));
        assert!(rules.contains("[truncated: showing about"));
        assert!(rules.contains("[truncated: 1 more rule files did not fit; read them when relevant: .athas/rules/d.md]"));
        assert!(crate::context_budget::estimate_tokens(&rules) <= PROJECT_RULES_MAX_TOKENS);
    }

    #[test]
    fn rules_follow_the_original_order() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".cursorrules"), "Legacy.").unwrap();
        std::fs::write(dir.path().join("CLAUDE.md"), "Claude.").unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "Agents.").unwrap();
        std::fs::create_dir_all(dir.path().join(".athas/rules")).unwrap();
        std::fs::write(dir.path().join(".athas/rules/style.md"), "Style.").unwrap();
        std::fs::create_dir_all(dir.path().join("src/ui")).unwrap();
        std::fs::write(dir.path().join("src/AGENTS.md"), "Src.").unwrap();
        let rules = project_rules_section(Some(dir.path()), &[dir.path().join("src/ui/a.ts")], "Mine.");
        let order: Vec<usize> = ["Mine.", "Agents.", "Claude.", "Src.", "Style.", "Legacy."].iter().map(|text| rules.find(text).unwrap()).collect();
        assert!(order.windows(2).all(|pair| pair[0] < pair[1]), "{rules}");
        assert!(rules.contains("## src/AGENTS.md (applies to files under src/)\nSrc."));
    }

    #[test]
    fn rule_globs_match_like_editors() {
        assert!(matches_rule_glob("*.tsx", "src/app/page.tsx"));
        assert!(matches_rule_glob("src/**", "src/a/b.ts"));
        assert!(matches_rule_glob("src/**/*.ts", "src/a.ts"));
        assert!(matches_rule_glob("./src/*.{ts,tsx}", "src/a.tsx"));
        assert!(!matches_rule_glob("src/*.ts", "src/a/b.ts"));
        assert!(matches_rule_glob("?.md", "docs/a.md"));
        assert!(!matches_rule_glob("", "a"));
    }

    #[test]
    fn modes_round_trip_through_their_ids() {
        for mode in Mode::ALL {
            assert_eq!(Mode::from_id(mode.id()), Some(mode));
        }
        assert_eq!(Mode::from_id("chat"), Some(Mode::Agent));
        assert!(Mode::Plan.read_only() && !Mode::Agent.read_only());
    }
}
