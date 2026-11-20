//! The editor's agent hooks: review lenses and inline edit from `agent_ui`, which the editor
//! does not depend on; and the Git panel's commit message generation.

use std::{ops::Range, path::Path, rc::Rc};

use agent_ui::{
    inline_edit::{InlineEditEvent, InlineEditPrompt, InlineEditRequest},
    review::{self, Hunk, ReviewAction},
};
use editor::{AgentHooks, AgentHunk, Editor, InlineCompletionInput, InlineEditInput, InlineEditView};
use git_panel::CommitMessageRequest;
use gpui::{App, AppContext as _, Focusable as _, Subscription, Task, WeakEntity, Window};

struct Hooks;

impl AgentHooks for Hooks {
    fn hunks(&self, path: &Path) -> Vec<AgentHunk> {
        review::hunks_for_path(path)
            .into_iter()
            .flat_map(|(session, hunks)| {
                hunks.into_iter().map(move |hunk| AgentHunk {
                    session: session.clone(),
                    base_start: hunk.base_start,
                    base_lines: hunk.base_lines,
                    current_start: hunk.current_start,
                    current_lines: hunk.current_lines,
                })
            })
            .collect()
    }

    fn resolve(&self, path: &Path, hunk: AgentHunk, keep: bool, cx: &mut App) {
        let path = path.to_path_buf();
        let session = hunk.session;
        let hunk = Hunk { base_start: hunk.base_start, base_lines: hunk.base_lines, current_start: hunk.current_start, current_lines: hunk.current_lines };
        let action = if keep { ReviewAction::KeepHunk { path, hunk } } else { ReviewAction::RejectHunk { path, hunk } };
        let task = review::apply(session, action, cx);
        cx.spawn(async move |cx| {
            let outcome = task.await;
            cx.update(|cx| {
                for notice in outcome.notices {
                    notifications::info(cx, notice);
                }
            });
        })
        .detach();
    }

    fn observe_reviews(&self, changed: Box<dyn Fn(&mut App)>, cx: &mut App) -> Subscription {
        let events = review::events(cx);
        cx.subscribe(&events, move |_, _: &review::ReviewEvent, cx| changed(cx))
    }

    fn inline_edit(&self, input: InlineEditInput, editor: WeakEntity<Editor>, window: &mut Window, cx: &mut App) -> Option<InlineEditView> {
        let request = InlineEditRequest {
            path: input.path.to_string_lossy().into_owned(),
            language_id: input.language,
            selection_text: input.selection,
            before: input.before,
            after: input.after,
            ..Default::default()
        };
        let prompt = cx.new(|cx| InlineEditPrompt::new(request, window, cx));
        let subscription = window.subscribe(&prompt, cx, move |_, event: &InlineEditEvent, window, cx| {
            let replacement = match event {
                InlineEditEvent::Accepted(edit) => Some(edit.replacement.clone()),
                InlineEditEvent::Dismissed => None,
                InlineEditEvent::Streaming(_) => return,
                InlineEditEvent::Proposal(proposal) => {
                    let proposal = proposal.clone();
                    editor.update(cx, |editor, cx| editor.set_inline_edit_preview(proposal, cx)).ok();
                    return;
                }
            };
            editor.update(cx, |editor, cx| editor.finish_inline_edit(replacement, window, cx)).ok();
        });
        let focus = prompt.focus_handle(cx);
        Some(InlineEditView { view: prompt.into(), focus, subscription })
    }

    fn rebase_range(&self, previous: &str, next: &str, range: Range<usize>) -> Option<Range<usize>> {
        agent_ui::inline_edit::rebase_range(previous, next, range)
    }

    fn complete(&self, input: InlineCompletionInput, cx: &mut App) -> Option<Task<Option<String>>> {
        let request = ai_providers::CompletionRequest {
            file_path: input.path.to_string_lossy().into_owned(),
            language_id: input.language,
            before_cursor: input.before,
            after_cursor: input.after,
            ..Default::default()
        };
        agent_ui::tab_completion::complete(request, cx)
    }
}

/// A commit message from the AI settings' model, asked as an inline edit of the context.
fn generate_commit_message(request: CommitMessageRequest, cx: &mut App) -> Task<anyhow::Result<String>> {
    let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
    let provider = agent_ui::intelligence::task_provider(&settings, "commit-message");
    let timer = cx.background_executor().timer(ai_providers::TextFeature::CommitMessage.timeout());
    cx.background_spawn(async move {
        let editor = ai_providers::InlineEditor::resolve(&provider, ai_providers::secrets::Keychain::shared()).map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let request = InlineEditRequest {
            path: request.repository,
            language_id: "git-commit".into(),
            selection_text: request.context,
            instruction: request.instruction,
            feature: ai_providers::TextFeature::CommitMessage,
            ..Default::default()
        };
        editor.edit_within(&request, timer, |_| {}).await.map_err(|error| anyhow::anyhow!(error.to_string()))
    })
}

/// A GitHub pull request or issue draft, asked as an inline edit of the form's context; an
/// organization that turned AI completion off gets an error instead.
fn generate_github_draft(request: github_panel::DraftRequest, cx: &mut App) -> Task<anyhow::Result<String>> {
    let policy = account::AccountStore::global(cx).and_then(|store| store.read(cx).subscription().and_then(|subscription| subscription.enterprise.policy.clone()));
    if policy.is_some_and(|policy| policy.managed_mode && !policy.ai_completion_enabled) {
        return Task::ready(Err(anyhow::anyhow!("AI generation is disabled by your organization policy.")));
    }
    let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
    let provider = agent_ui::intelligence::task_provider(&settings, "github-draft");
    let timer = cx.background_executor().timer(ai_providers::TextFeature::GithubDraft.timeout());
    cx.background_spawn(async move {
        let editor = ai_providers::InlineEditor::resolve(&provider, ai_providers::secrets::Keychain::shared()).map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let request = InlineEditRequest {
            path: request.file_path,
            language_id: "json".into(),
            selection_text: request.prompt,
            instruction: request.instruction,
            feature: ai_providers::TextFeature::GithubDraft,
            ..Default::default()
        };
        editor.edit_within(&request, timer, |_| {}).await.map_err(|error| anyhow::anyhow!(error.to_string()))
    })
}

pub(crate) fn init(cx: &mut App) {
    editor::set_agent_hooks(Rc::new(Hooks), cx);
    git_panel::set_commit_message_generator(cx, Rc::new(generate_commit_message));
    github_panel::set_draft_generator(cx, Rc::new(generate_github_draft));
}
