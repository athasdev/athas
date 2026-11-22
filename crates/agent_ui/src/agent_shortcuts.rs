//! The empty chat's shortcuts under the composer: suggestions for what the workspace needs now
//! (its uncommitted changes, problems, the open file), the user's newest skills and general
//! prompts, then the latest chats.
//!
//! Ported from Athas's `components/chat/agent-shortcuts.tsx` and `lib/agent-suggestions.ts`.

use std::path::{Path, PathBuf};

use ui::scale::px;
use gpui::{AnyElement, Context, Focusable as _, IntoElement, ParentElement, SharedString, Styled, Task, div, prelude::*,};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, typography};

use crate::session_view::SessionView;

const MAX_SUGGESTIONS: usize = 4;
const RECENT_CHAT_LIMIT: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SuggestionKind {
    Review,
    Problems,
    File,
    Skill,
    Prompt,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Suggestion {
    pub id: String,
    pub kind: SuggestionKind,
    pub title: String,
    /// The prompt put in the composer.
    pub content: String,
}

/// The open file a suggestion can explain: its name and its path in the project.
pub struct ActiveFile {
    pub name: String,
    pub relative_path: String,
}

/// A skill from settings, with when it last changed (ISO 8601, so newest sorts last).
pub struct SkillHint {
    pub id: String,
    pub title: String,
    pub content: String,
    pub updated_at: String,
}

fn plural(count: usize, noun: &str) -> String {
    format!("{count} {noun}{}", if count == 1 { "" } else { "s" })
}

const STATIC_SUGGESTIONS: &[(&str, &str, &str)] = &[
    ("builtin-plan-implementation", "Plan an implementation", "Inspect the relevant code and propose a focused implementation plan for this task:"),
    ("builtin-find-fix-bug", "Find and fix a bug", "Investigate this bug, identify the root cause, implement the fix, and verify it:"),
    ("builtin-write-tests", "Write tests for a change", "Inspect the relevant behavior and add focused tests for this change:"),
];

/// What the workspace needs first, then the newest skills, then general prompts; four at most.
pub fn build_suggestions(changed_files: usize, problems: usize, active_file: Option<&ActiveFile>, mut skills: Vec<SkillHint>) -> Vec<Suggestion> {
    let mut suggestions = Vec::new();
    if changed_files > 0 {
        suggestions.push(Suggestion {
            id: "context-review-changes".into(),
            kind: SuggestionKind::Review,
            title: format!("Review my changes ({})", plural(changed_files, "file")),
            content: "Review my uncommitted changes for bugs, regressions and missing tests. Use the Git diff of the workspace:".into(),
        });
    }
    if problems > 0 {
        suggestions.push(Suggestion {
            id: "context-fix-problems".into(),
            kind: SuggestionKind::Problems,
            title: format!("Fix {}", plural(problems, "problem")),
            content: format!("Fix the {} currently reported in the Problems panel, then verify the fix:", plural(problems, "error and warning")),
        });
    }
    if let Some(file) = active_file {
        suggestions.push(Suggestion {
            id: "context-explain-file".into(),
            kind: SuggestionKind::File,
            title: format!("Explain {}", file.name),
            content: format!("Explain how {} works, its main responsibilities and how it fits into the project:", file.relative_path),
        });
    }
    skills.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    suggestions.extend(skills.into_iter().map(|skill| Suggestion { id: skill.id, kind: SuggestionKind::Skill, title: skill.title, content: skill.content }));
    suggestions.extend(STATIC_SUGGESTIONS.iter().map(|(id, title, content)| Suggestion {
        id: (*id).into(),
        kind: SuggestionKind::Prompt,
        title: (*title).into(),
        content: (*content).into(),
    }));
    suggestions.truncate(MAX_SUGGESTIONS);
    suggestions
}

/// `content` added to what the composer holds, after a blank line when there is text already.
pub fn insert_into(current: &str, content: &str) -> String {
    let prefix = if !current.trim().is_empty() && !current.ends_with(char::is_whitespace) { "\n\n" } else { "" };
    format!("{current}{prefix}{} ", content.trim())
}

/// The workspace's uncommitted file count, read once per session view.
#[derive(Default)]
pub(crate) struct ShortcutState {
    changed_files: Option<usize>,
    _loading: Option<Task<()>>,
}

fn changed_file_count(root: &Path) -> usize {
    crate::context_refs::git(root, &["status", "--porcelain"]).map_or(0, |status| status.lines().filter(|line| !line.trim().is_empty()).count())
}

impl SessionView {
    fn load_changed_files(&mut self, cx: &mut Context<Self>) {
        if self.shortcuts.changed_files.is_some() || self.shortcuts._loading.is_some() {
            return;
        }
        let Some(root) = self.info.cwd.clone() else {
            self.shortcuts.changed_files = Some(0);
            return;
        };
        self.shortcuts._loading = Some(cx.spawn(async move |this, cx| {
            let count = cx.background_spawn(async move { changed_file_count(&root) }).await;
            this.update(cx, |this, cx| {
                this.shortcuts.changed_files = Some(count);
                this.shortcuts._loading = None;
                cx.notify();
            })
            .ok();
        }));
    }

    fn suggestions(&self, cx: &Context<Self>) -> Vec<Suggestion> {
        let root = self.info.cwd.as_deref();
        let problems = crate::context_refs::current_problems(cx).iter().filter(|problem| matches!(problem.severity, "error" | "warning")).count();
        let active = workbench_api::active_file(cx).map(|path: PathBuf| ActiveFile {
            name: path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string()),
            relative_path: root.and_then(|root| path.strip_prefix(root).ok()).unwrap_or(&path).display().to_string(),
        });
        let skills = cx
            .try_global::<settings::SettingsStore>()
            .map(|_| {
                settings::get(cx)
                    .ai_skills
                    .iter()
                    .filter_map(|value| {
                        let skill = serde_json::from_value::<crate::skills::SettingSkill>(value.clone()).ok()?;
                        let updated_at = skill.other.get("updatedAt").and_then(|value| value.as_str()).unwrap_or_default().to_string();
                        (!skill.title.trim().is_empty()).then_some(SkillHint { id: skill.id, title: skill.title, content: skill.content, updated_at })
                    })
                    .collect()
            })
            .unwrap_or_default();
        build_suggestions(self.shortcuts.changed_files.unwrap_or(0), problems, active.as_ref(), skills)
    }

    fn insert_suggestion(&mut self, content: &str, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let content = content.to_string();
        self.composer.update(cx, |composer, cx| {
            let current = composer.text().to_string();
            let end = current.len();
            composer.replace_range(end..end, &insert_into(&current, &content)[end..], cx);
        });
        let focus = self.composer.read(cx).focus_handle(cx);
        window.focus(&focus, cx);
    }

    /// The suggestions and recent chats under an empty chat's composer.
    pub(crate) fn render_shortcuts(&mut self, cx: &mut Context<Self>) -> AnyElement {
        self.load_changed_files(cx);
        self.load_saved_sessions(cx);
        let colors = cx.theme().colors.clone();
        let row = |id: SharedString, icon: IconName, tone: gpui::Hsla, label: String| {
            div()
                .id(id)
                .flex()
                .items_center()
                .gap(px(8.))
                .h(ui::metrics::list_row())
                .px(px(8.))
                .rounded(ui::metrics::radius_md())
                .text_size(typography::text_sm())
                .text_color(colors.muted_foreground)
                .hover(|style| style.bg(colors.accent).text_color(colors.foreground))
                .child(Icon::new(icon).size(IconSize::Small).color(tone))
                .child(div().min_w_0().flex_1().truncate().child(label))
        };
        let prompt_tones = [colors.primary, colors.success, colors.warning, colors.destructive];
        let prompt_icons = [IconName::Sparkle, IconName::Search, IconName::TerminalWindow, IconName::BookOpen];
        let suggestions = self.suggestions(cx).into_iter().enumerate().map(|(index, suggestion)| {
            let (icon, tone) = match suggestion.kind {
                SuggestionKind::Review => (IconName::GitDiff, colors.primary),
                SuggestionKind::Problems => (IconName::Warning, colors.warning),
                SuggestionKind::File => (IconName::FileCode, colors.success),
                SuggestionKind::Skill | SuggestionKind::Prompt => (prompt_icons[index % prompt_icons.len()], prompt_tones[index % prompt_tones.len()]),
            };
            let content = suggestion.content.clone();
            row(SharedString::from(format!("suggestion-{}", suggestion.id)), icon, tone, suggestion.title)
                .on_click(cx.listener(move |this, _, window, cx| this.insert_suggestion(&content, window, cx)))
        });
        let recent: Vec<_> = self
            .saved_sessions
            .as_ref()
            .map(|sessions| sessions.iter().filter(|session| session.id != self.info.id && session.entries > 0).take(RECENT_CHAT_LIMIT).cloned().collect())
            .unwrap_or_default();
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(div().flex().flex_col().gap(px(2.)).children(suggestions))
            .when(!recent.is_empty(), |this| {
                this.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(2.))
                        .child(div().px(px(8.)).pb(px(2.)).text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("Recent"))
                        .children(recent.into_iter().map(|session| {
                            let title = if session.title.is_empty() { "Untitled chat".to_string() } else { session.title.clone() };
                            let id = session.id.clone();
                            row(SharedString::from(format!("recent-{}", session.id)), IconName::History, colors.subtle_foreground, title)
                                .on_click(move |_, _, cx| workbench_api::request(cx, workbench_api::OpenRequest::Session { id: id.clone() }))
                        })),
                )
            })
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill(id: &str, updated_at: &str) -> SkillHint {
        SkillHint { id: id.into(), title: id.into(), content: format!("{id} body"), updated_at: updated_at.into() }
    }

    #[test]
    fn workspace_needs_come_first() {
        let file = ActiveFile { name: "main.rs".into(), relative_path: "src/main.rs".into() };
        let suggestions = build_suggestions(1, 3, Some(&file), vec![skill("old", "2026-01-01"), skill("new", "2026-02-01")]);
        let titles: Vec<&str> = suggestions.iter().map(|suggestion| suggestion.title.as_str()).collect();
        assert_eq!(titles, ["Review my changes (1 file)", "Fix 3 problems", "Explain main.rs", "new"]);
        assert!(suggestions[2].content.contains("src/main.rs"));
        assert!(suggestions[1].content.starts_with("Fix the 3 error and warnings"));
    }

    #[test]
    fn general_prompts_fill_the_rest() {
        let suggestions = build_suggestions(0, 0, None, Vec::new());
        assert_eq!(suggestions.len(), 3);
        assert!(suggestions.iter().all(|suggestion| suggestion.kind == SuggestionKind::Prompt));
    }

    #[test]
    fn inserting_keeps_what_was_typed() {
        assert_eq!(insert_into("", " Plan it: "), "Plan it: ");
        assert_eq!(insert_into("hello", "Plan it:"), "hello\n\nPlan it: ");
        assert_eq!(insert_into("hello ", "Plan it:"), "hello Plan it: ");
    }
}
