//! A session's pages beside its chat:
//! - Overview: a short, model-written account of who started the session, what it is about,
//!   what is done and what is not.
//! - Changes: every file the agent changed, with each edit's diff.
//! - Issues: the GitHub issues the session is linked to (by link, or added as context).
//!
//! The overview is written by the model the AI settings give "Session overviews". A session on
//! an outside agent (Claude Code, Codex, Gemini) without such a choice asks that agent's own
//! command line instead, so it runs on the account the session already uses.

use gpui::{AnyElement, App, ClickEvent, Context, Hsla, IntoElement, ParentElement, SharedString, Styled, Task, div, prelude::*, px, relative};
use serde::{Deserialize, Serialize};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, metrics, typography};

use crate::{
    SessionView, builtin, follow_ups, summary,
    thread::{Entry, PlanStatus, ToolContent, ToolStatus, Transcript},
};

use crate::render::{CONTENT_PADDING, CONTENT_WIDTH};
/// The Changes page's file list: its first width, and the least it can be dragged to.
pub const CHANGES_LIST_WIDTH: f32 = 280.;
const CHANGES_LIST_MIN_WIDTH: f32 = 180.;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SessionPage {
    #[default]
    Chat,
    Overview,
    Changes,
    Issues,
}

/// What the Overview page shows, saved with the transcript.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionOverview {
    pub about: String,
    pub done: Vec<String>,
    pub remaining: Vec<String>,
    /// How many transcript entries it was written from: more since means it is out of date.
    pub entries: usize,
    /// What wrote it, such as "Claude Code · Haiku" or a model id.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub source: String,
}

/// A GitHub issue the session is linked to.
#[derive(Clone, Debug, PartialEq)]
pub struct LinkedIssue {
    pub number: u64,
    pub title: Option<String>,
    /// The issue's page when the session linked it by URL; such an issue may be another
    /// repository's.
    pub url: Option<String>,
}

/// The issues the session links: issue URLs in its messages, and issues added as context,
/// first mention first.
pub fn linked_issues(transcript: &Transcript) -> Vec<LinkedIssue> {
    let mut issues: Vec<LinkedIssue> = Vec::new();
    let note = |issues: &mut Vec<LinkedIssue>, number: u64, title: String, url: Option<String>| match issues.iter_mut().find(|issue| issue.number == number) {
        Some(issue) => {
            if !title.is_empty() {
                issue.title.get_or_insert(title);
            }
        }
        None => issues.push(LinkedIssue { number, title: (!title.is_empty()).then_some(title), url }),
    };
    for resource in summary::resources(transcript) {
        if let summary::Resource::Issue { number, url, .. } = resource {
            note(&mut issues, number, String::new(), Some(url));
        }
    }
    for entry in &transcript.entries {
        let Entry::User(message) = entry else { continue };
        for (number, title) in &message.issues {
            // A tab titled "#12 Crash on save" names the issue with its number in front.
            let title = title.trim_start_matches(&format!("#{number}")).trim().to_string();
            note(&mut issues, *number, title, None);
        }
        // An agent's replay of the prompt carries the context as text ("GitHub issue: Title (#12)").
        for line in message.text.lines() {
            let Some(rest) = line.trim().strip_prefix("GitHub issue: ") else { continue };
            let Some((title, number)) = rest.rsplit_once(" (#") else { continue };
            let Ok(number) = number.trim_end_matches(')').parse::<u64>() else { continue };
            note(&mut issues, number, title.to_string(), None);
        }
    }
    issues
}

/// One edit of a changed file: the entry and content index of its diff in the transcript.
#[derive(Clone, Debug, PartialEq)]
pub struct FileEdit {
    pub entry: usize,
    pub content: usize,
    pub old: Option<String>,
    pub new: String,
}

/// Each changed file's edits, oldest first, in the order the Changes summary lists the files
/// (latest change first).
pub fn file_edits(transcript: &Transcript) -> Vec<(summary::FileChange, Vec<FileEdit>)> {
    let changes = summary::changes(transcript);
    changes
        .files
        .into_iter()
        .map(|file| {
            let mut edits = Vec::new();
            for (entry, item) in transcript.entries.iter().enumerate() {
                let Entry::ToolCall(call) = item else { continue };
                for (content, part) in call.content.iter().enumerate() {
                    if let ToolContent::Diff { path, old_text, new_text } = part
                        && *path == file.path
                    {
                        edits.push(FileEdit { entry, content, old: old_text.clone(), new: new_text.clone() });
                    }
                }
            }
            (file, edits)
        })
        .collect()
}

/// The session as the overview model reads it: the first request, then the conversation, the
/// plan, the changed files and failed steps, cut to fit.
pub fn digest(transcript: &Transcript) -> String {
    fn clip(text: &str, max: usize) -> String {
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.chars().count() <= max { text } else { format!("{}…", text.chars().take(max).collect::<String>()) }
    }
    let first = transcript.first_prompt().map(|prompt| clip(follow_ups::strip_context_preamble(prompt), 1500)).unwrap_or_default();
    let mut lines: Vec<String> = Vec::new();
    for entry in &transcript.entries {
        match entry {
            Entry::User(message) => {
                let text = follow_ups::strip_context_preamble(&message.text);
                if !text.trim().is_empty() {
                    lines.push(format!("User: {}", clip(text, 600)));
                }
            }
            Entry::Agent(message) if !message.text.trim().is_empty() => lines.push(format!("Agent: {}", clip(&message.text, 500))),
            Entry::ToolCall(call) if call.status == ToolStatus::Failed => lines.push(format!("Failed step: {}", clip(&call.title, 160))),
            _ => {}
        }
    }
    let plan: Vec<String> = transcript
        .plan
        .iter()
        .map(|step| {
            let status = match step.status {
                PlanStatus::Completed => "done",
                PlanStatus::InProgress => "in progress",
                _ => "not started",
            };
            format!("- [{status}] {}", clip(&step.content, 200))
        })
        .collect();
    let changes = summary::changes(transcript);
    let files: Vec<String> = changes.files.iter().take(40).map(|file| format!("- {} (+{} −{})", file.path.display(), file.additions, file.deletions)).collect();

    let budget = ai_providers::inline_edit::CONTEXT_CHARS.saturating_sub(first.len() + plan.iter().chain(&files).map(|line| line.len() + 1).sum::<usize>() + 200);
    // The newest part of the conversation says most about where the session stands.
    let mut kept: Vec<&String> = Vec::new();
    let mut used = 0;
    for line in lines.iter().rev() {
        if used + line.len() + 1 > budget {
            break;
        }
        used += line.len() + 1;
        kept.push(line);
    }
    kept.reverse();
    let mut out = format!("First request:\n{first}\n\nConversation{}:\n", if kept.len() < lines.len() { " (latest part)" } else { "" });
    for line in kept {
        out.push_str(line);
        out.push('\n');
    }
    if !plan.is_empty() {
        out.push_str("\nPlan:\n");
        out.push_str(&plan.join("\n"));
        out.push('\n');
    }
    if !files.is_empty() {
        out.push_str("\nFiles changed:\n");
        out.push_str(&files.join("\n"));
        out.push('\n');
    }
    out
}

const INSTRUCTION: &str = "Write a short overview of this coding-agent session. Return JSON only: \
{\"about\": \"one or two sentences on what the session is about and why\", \"done\": [\"what was finished, a few words each\"], \
\"remaining\": [\"what is not done yet or left open\"]}. At most 5 items per list; an empty list when there is nothing. \
Plain language, no file dumps, no markdown. Write in the language the user writes in.";

/// The overview the model writes from `text`, read leniently (fences, prose around the object).
pub fn parse(text: &str) -> Option<SessionOverview> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    let value: serde_json::Value = serde_json::from_str(text.get(start..=end)?).ok()?;
    let list = |key: &str| -> Vec<String> {
        value
            .get(key)
            .and_then(|items| items.as_array())
            .map(|items| items.iter().filter_map(|item| item.as_str()).map(|item| item.trim().to_string()).filter(|item| !item.is_empty()).take(6).collect())
            .unwrap_or_default()
    };
    let about = value.get("about").and_then(|about| about.as_str()).unwrap_or_default().trim().to_string();
    (!about.is_empty()).then(|| SessionOverview { about, done: list("done"), remaining: list("remaining"), ..Default::default() })
}

/// An agent's command line that can answer one prompt and exit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentCli {
    Claude,
    Codex,
    Gemini,
}

impl AgentCli {
    /// The command line of the session's agent, if it has one.
    pub fn for_agent(agent: &str) -> Option<Self> {
        let agent = agent.to_ascii_lowercase();
        if agent.contains("claude") {
            Some(Self::Claude)
        } else if agent.contains("codex") {
            Some(Self::Codex)
        } else if agent.contains("gemini") {
            Some(Self::Gemini)
        } else {
            None
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code · Haiku",
            Self::Codex => "Codex",
            Self::Gemini => "Gemini CLI",
        }
    }

    /// Runs the prompt through the command line (blocking), in a scratch folder so the project's
    /// own instructions stay out, and gives up after `timeout`.
    #[cfg(not(target_family = "wasm"))]
    fn run(self, prompt: &str, timeout: std::time::Duration) -> Result<String, String> {
        use std::{
            io::Write as _,
            process::{Command, Stdio},
        };
        let scratch = std::env::temp_dir();
        let answer_file = scratch.join(format!("athas-overview-{}.txt", std::process::id()));
        let mut command = match self {
            Self::Claude => {
                let mut command = Command::new("claude");
                command.args(["-p", "--model", "haiku", "--max-turns", "1", "--output-format", "text"]);
                command
            }
            Self::Codex => {
                let mut command = Command::new("codex");
                command.args(["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-last-message"]).arg(&answer_file).arg("-");
                command
            }
            Self::Gemini => {
                let mut command = Command::new("gemini");
                command.args(["-p", "Answer the request given on standard input."]);
                command
            }
        };
        command.current_dir(&scratch).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => format!("{} is not installed", self.label()),
            _ => error.to_string(),
        })?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(prompt.as_bytes()).map_err(|error| error.to_string())?;
        }
        // Read the output while it runs, so a full pipe never stalls the child.
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let read = |pipe: Option<Box<dyn std::io::Read + Send>>| {
            std::thread::spawn(move || {
                let mut text = String::new();
                if let Some(mut pipe) = pipe {
                    let _ = pipe.read_to_string(&mut text);
                }
                text
            })
        };
        let stdout = read(stdout.map(|pipe| Box::new(pipe) as Box<dyn std::io::Read + Send>));
        let stderr = read(stderr.map(|pipe| Box::new(pipe) as Box<dyn std::io::Read + Send>));
        let started = std::time::Instant::now();
        let status = loop {
            match child.try_wait().map_err(|error| error.to_string())? {
                Some(status) => break status,
                None if started.elapsed() > timeout => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(ai_providers::inline_edit::TIMED_OUT.to_string());
                }
                None => std::thread::sleep(std::time::Duration::from_millis(100)),
            }
        };
        let stdout = stdout.join().unwrap_or_default();
        let stderr = stderr.join().unwrap_or_default();
        let text = match self {
            Self::Codex => std::fs::read_to_string(&answer_file).unwrap_or_default(),
            _ => stdout,
        };
        let _ = std::fs::remove_file(&answer_file);
        if !status.success() && text.trim().is_empty() {
            let error = stderr.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or("it stopped with an error").trim().to_string();
            return Err(format!("{}: {error}", self.label()));
        }
        Ok(text)
    }
}

/// Where the overview is asked for, in order: a later one is tried when an earlier one is not set
/// up (no key, not signed in, not installed).
#[derive(Clone, Debug)]
enum Writer {
    Model(ai_providers::ProviderSettings),
    #[cfg_attr(target_family = "wasm", allow(dead_code))]
    Cli(AgentCli),
}

fn writers(agent: &str, chat_provider: Option<ai_providers::ProviderSettings>, cx: &App) -> Vec<Writer> {
    let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
    let feature = ai_providers::TextFeature::SessionOverview;
    let chosen = crate::intelligence::task_connection(&settings, feature.id()).is_some();
    let model = Writer::Model(chat_provider.filter(ai_providers::local::is_local_provider).unwrap_or_else(|| crate::intelligence::task_provider(&settings, feature.id())));
    match AgentCli::for_agent(agent) {
        // The model picked for overviews wins; otherwise the session's own agent writes it.
        Some(cli) if !chosen => vec![Writer::Cli(cli), model],
        Some(cli) => vec![model, Writer::Cli(cli)],
        None if builtin::is_builtin(agent) => vec![model],
        // Another agent: the default model, then whichever command line is installed.
        None => vec![model, Writer::Cli(AgentCli::Claude), Writer::Cli(AgentCli::Codex)],
    }
}

/// Asks for the overview, trying each writer in turn. `None` in tests and fixtures.
fn generate(digest: String, writers: Vec<Writer>, cx: &mut App) -> Option<Task<Result<SessionOverview, String>>> {
    use gpui::AppContext as _;
    if cfg!(test) || std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() {
        return None;
    }
    let feature = ai_providers::TextFeature::SessionOverview;
    let executor = cx.background_executor().clone();
    Some(cx.background_spawn(async move {
        let mut errors: Vec<String> = Vec::new();
        for writer in writers {
            let (text, source) = match writer {
                Writer::Model(provider) => {
                    let editor = match ai_providers::inline_edit::InlineEditor::resolve(&provider, &crate::ai_settings::KeychainRef) {
                        Ok(editor) => editor,
                        Err(error) => {
                            errors.push(error.to_string());
                            continue;
                        }
                    };
                    let request = ai_providers::inline_edit::InlineEditRequest {
                        path: "agent-session-overview".into(),
                        language_id: "text".into(),
                        selection_text: digest.clone(),
                        instruction: INSTRUCTION.into(),
                        feature,
                        ..Default::default()
                    };
                    match editor.edit_within(&request, executor.timer(feature.timeout()), |_| {}).await {
                        Ok(text) => (text, if provider.model_id.is_empty() || provider.model_id == "auto" { "Athas".to_string() } else { provider.model_id.clone() }),
                        Err(error) => {
                            errors.push(error.to_string());
                            continue;
                        }
                    }
                }
                #[cfg(not(target_family = "wasm"))]
                Writer::Cli(cli) => {
                    let prompt = format!("{INSTRUCTION}\n\nThe session:\n\n{digest}");
                    match cli.run(&prompt, std::time::Duration::from_secs(120)) {
                        Ok(text) => (text, cli.label().to_string()),
                        Err(error) => {
                            errors.push(error);
                            continue;
                        }
                    }
                }
                #[cfg(target_family = "wasm")]
                Writer::Cli(_) => continue,
            };
            match parse(&text) {
                Some(overview) => return Ok(SessionOverview { source, ..overview }),
                None => errors.push(format!("{source} did not return an overview.")),
            }
        }
        // The first writer's error says most: it is the one the user expects to run.
        Err(errors.into_iter().next().unwrap_or_else(|| "Set a model for Session overviews in AI settings.".into()))
    }))
}

impl SessionView {
    /// Shows a page by name (`overview`, `changes`, `issues`, else the chat): for screenshots.
    pub fn show_page_named(&mut self, name: &str, cx: &mut Context<Self>) {
        self.page = match name {
            "overview" => SessionPage::Overview,
            "changes" => SessionPage::Changes,
            "issues" => SessionPage::Issues,
            _ => SessionPage::Chat,
        };
        cx.notify();
    }

    pub(crate) fn set_page(&mut self, page: SessionPage, cx: &mut Context<Self>) {
        self.page = page;
        match page {
            SessionPage::Overview if self.overview_needs_writing() => self.write_overview(cx),
            SessionPage::Issues => self.load_open_issues(cx),
            _ => {}
        }
        cx.notify();
    }

    /// No overview yet, or the session went on since, and no turn is running to change it more.
    fn overview_needs_writing(&self) -> bool {
        let entries = self.transcript.entries.len();
        entries > 0 && !self.is_running() && self.transcript.overview.as_ref().is_none_or(|overview| overview.entries != entries)
    }

    pub(crate) fn write_overview(&mut self, cx: &mut Context<Self>) {
        if self.overview_task.is_some() {
            return;
        }
        let chat_provider = (builtin::is_builtin(&self.info.agent) && cx.try_global::<settings::SettingsStore>().is_some())
            .then(|| builtin::session_provider(crate::intelligence::task_provider(settings::get(cx), "agent"), &self.transcript));
        let entries = self.transcript.entries.len();
        let writers = writers(&self.info.agent, chat_provider, cx);
        let Some(task) = generate(digest(&self.transcript), writers, cx) else { return };
        self.overview_error = None;
        self.overview_task = Some(cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.overview_task = None;
                match result {
                    Ok(mut overview) => {
                        overview.entries = entries;
                        this.transcript.overview = Some(overview);
                        this.schedule_save(cx);
                    }
                    Err(error) => this.overview_error = Some(error),
                }
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    /// The project's open issues, for the titles of issues linked by URL.
    fn load_open_issues(&mut self, cx: &mut Context<Self>) {
        if self.open_issues.is_some() || self.issues_task.is_some() {
            return;
        }
        let Some(root) = self.info.cwd.clone() else { return };
        let Some(task) = github_panel::quick_open::open_issues(root, cx) else { return };
        self.issues_task = Some(cx.spawn(async move |this, cx| {
            let issues = task.await;
            this.update(cx, |this, cx| {
                this.issues_task = None;
                this.open_issues = Some(issues.into_iter().map(|(number, title, url, _)| (number, title, url)).collect());
                cx.notify();
            })
            .ok();
        }));
    }

    /// The strip of pages over the session: Chat, Overview, Changes, Issues.
    pub(crate) fn render_page_tabs(&self, changes: usize, issues: usize, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let knob_shadow = cx.theme().shadows.raised_inset.clone();
        // The window tab's look: a soft track on hover, a raised knob for the page shown.
        let tab = |id: &'static str, icon: IconName, label: &'static str, page: SessionPage, count: Option<usize>, cx: &mut Context<Self>| {
            let active = self.page == page;
            let (hover_fg, hover_bg) = (colors.foreground, colors.segment_track);
            div()
                .id(id)
                .relative()
                .flex()
                .items_center()
                .h_full()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .h(px(26.))
                        .px(px(10.))
                        .rounded_full()
                        .when(active, |this| this.bg(colors.segment_knob).shadow(knob_shadow.clone()))
                        .text_size(typography::TEXT_SM)
                        .font_weight(typography::MEDIUM)
                        .text_color(if active { colors.foreground } else { colors.muted_foreground })
                        .when(!active, |this| this.hover(move |style| style.text_color(hover_fg).bg(hover_bg)))
                        .child(Icon::new(icon).size(IconSize::Small).color(if active { colors.foreground } else { colors.subtle_foreground }))
                        .child(label)
                        .when_some(count.filter(|count| *count > 0), |this, count| {
                            this.child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .h(px(16.))
                                    .min_w(px(16.))
                                    .px(px(5.))
                                    .rounded_full()
                                    .bg(if active { colors.foreground.opacity(0.1) } else { colors.segment_track })
                                    .text_size(typography::TEXT_CAPTION)
                                    .text_color(if active { colors.foreground } else { colors.muted_foreground })
                                    .child(count.to_string()),
                            )
                        }),
                )
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.set_page(page, cx)))
        };
        div()
            .flex_none()
            .flex()
            .items_center()
            .gap(px(4.))
            .h(px(40.))
            .px(px(10.))
            .border_b_1()
            .border_color(colors.divider)
            .child(tab("session-page-chat", IconName::ChatBubbleText, "Chat", SessionPage::Chat, None, cx))
            .child(tab("session-page-overview", IconName::Sparkle, "Overview", SessionPage::Overview, None, cx))
            .child(tab("session-page-changes", IconName::GitDiff, "Changes", SessionPage::Changes, Some(changes), cx))
            .child(tab("session-page-issues", IconName::CircleDot, "Issues", SessionPage::Issues, Some(issues), cx))
            .into_any_element()
    }

    fn page(&self, id: &'static str, content: impl IntoElement) -> AnyElement {
        div()
            .id(id)
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .items_center()
            .px(px(CONTENT_PADDING))
            .pt(px(28.))
            .pb(px(48.))
            .child(div().w_full().max_w(px(CONTENT_WIDTH)).flex().flex_col().gap(px(24.)).child(content))
            .into_any_element()
    }

    fn page_title(&self, cx: &App) -> gpui::Div {
        let colors = &cx.theme().colors;
        let title = crate::title::clean_chat_title(&self.info.title).unwrap_or_else(|| "Untitled session".into());
        div().text_size(px(20.)).line_height(relative(1.3)).font_weight(typography::SEMIBOLD).text_color(colors.foreground).child(title)
    }

    pub(crate) fn render_overview(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        // The session's creator is whoever is signed in, so their avatar is the account's own.
        let me = ui::avatar::account(cx);
        let creator = me
            .as_ref()
            .map(|me| {
                let name = me.name.trim();
                if name.is_empty() { me.github_login.clone().unwrap_or_else(|| me.email.clone()) } else { name.to_string() }
            })
            .unwrap_or_else(|| "You".to_string());
        let creator_person = me.map_or_else(|| ui::Person::new(creator.clone()), |me| ui::Person::new(creator.clone()).user_id(me.user_id));
        let started = self
            .transcript
            .entries
            .iter()
            .find_map(|entry| match entry {
                Entry::User(message) => message.sent_at,
                _ => None,
            })
            .and_then(|at| chrono::DateTime::from_timestamp_millis(i64::try_from(at).ok()?))
            .map(|at| at.with_timezone(&chrono::Local).format("%b %-d, %Y").to_string());
        let agent = crate::acp::agents::display_name(&self.info.agent);
        let changed = summary::changes(&self.transcript).files.len();
        let running = self.is_running();
        let writing = self.overview_task.is_some();
        let stale = self.transcript.overview.as_ref().is_some_and(|overview| overview.entries != self.transcript.entries.len());
        let overview = self.transcript.overview.clone();
        let (done, total) = overview.as_ref().map(|overview| (overview.done.len(), overview.done.len() + overview.remaining.len())).unwrap_or((0, 0));

        // Title, with the overview's one action where an issue page keeps "Close issue".
        let action = (overview.is_some() && !writing && !running).then(|| {
            Button::new("overview-refresh", if stale { "Update overview" } else { "Regenerate" })
                .leading_icon(IconName::ArrowClockwise)
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Small)
                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.write_overview(cx)))
        });
        let header = div().flex().items_start().gap(px(16.)).child(self.page_title(cx).flex_1().min_w_0()).children(action);

        // Properties, as chips: state, agent, who started it, when, progress, files.
        let chip = |leading: AnyElement, label: String| {
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .h(px(28.))
                .px(px(10.))
                .rounded(metrics::RADIUS_MD)
                .border_1()
                .border_color(colors.border)
                .text_size(typography::TEXT_SM)
                .text_color(colors.foreground)
                .child(leading)
                .child(label)
        };
        let icon = |name: IconName, tint: Hsla| Icon::new(name).size(IconSize::Small).color(tint).into_any_element();
        let (state_icon, state) = if running {
            (icon(IconName::PlayCircle, colors.primary), "Running")
        } else if total > 0 && done == total {
            (icon(IconName::CheckCircle, colors.success), "Done")
        } else if total > 0 {
            (ui::ProgressCircle::new(done as f32 * 100. / total as f32).tone(ui::ProgressTone::Warning).size(px(14.)).into_any_element(), "In progress")
        } else {
            (icon(IconName::CircleDotted, colors.muted_foreground), "Idle")
        };
        let chips = div()
            .flex()
            .flex_wrap()
            .gap(px(8.))
            .child(chip(state_icon, state.to_string()))
            .child(chip(crate::model_vendor::agent_mark(&self.info.agent, px(14.), colors.muted_foreground), agent.clone()))
            .child(chip(ui::Avatar::person(&creator_person, cx).size(px(16.)).into_any_element(), creator.clone()))
            .children(started.map(|started| chip(icon(IconName::Calendar, colors.muted_foreground), started)))
            .when(total > 0, |this| {
                this.child(chip(ui::ProgressCircle::new(done as f32 * 100. / total as f32).tone(ui::ProgressTone::Success).size(px(14.)).into_any_element(), format!("{done} / {total} tasks")))
            })
            .when(changed > 0, |this| this.child(chip(icon(IconName::GitDiff, colors.muted_foreground), format!("{changed} {} changed", if changed == 1 { "file" } else { "files" }))));

        let section_label = |name: IconName, label: &'static str| {
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .text_size(typography::TEXT_SM)
                .text_color(colors.muted_foreground)
                .child(Icon::new(name).size(IconSize::Small).color(colors.muted_foreground))
                .child(label)
        };

        // About: the model's account, or where it stands.
        let about: AnyElement = match (&overview, writing, &self.overview_error) {
            (Some(overview), _, _) => {
                let note: SharedString = if writing {
                    "Updating…".into()
                } else if stale {
                    "The session went on since this was written".into()
                } else if overview.source.is_empty() {
                    "Written by AI from the session".into()
                } else {
                    format!("Written by {} from the session", overview.source).into()
                };
                let tint = if stale && !writing { colors.warning } else { colors.subtle_foreground };
                div()
                    .flex()
                    .flex_col()
                    .gap(px(10.))
                    .child(div().text_size(px(14.)).line_height(relative(1.65)).text_color(colors.foreground).child(overview.about.clone()))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .text_size(typography::TEXT_CAPTION)
                            .text_color(tint)
                            .child(Icon::new(if stale && !writing { IconName::Clock } else { IconName::Sparkle }).size(IconSize::XSmall).color(tint))
                            .child(note),
                    )
                    .into_any_element()
            }
            (None, true, _) => div()
                .flex()
                .flex_col()
                .gap(px(10.))
                .child(ui::Skeleton::new("overview-line-1").h(px(12.)).w(relative(0.92)))
                .child(ui::Skeleton::new("overview-line-2").h(px(12.)).w(relative(0.7)))
                .into_any_element(),
            (None, false, Some(error)) => ui::Alert::new()
                .tone(ui::Tone::Warning)
                .icon(IconName::Warning)
                .title("Could not write the overview")
                .description(error.clone())
                .action(Button::new("overview-retry", "Try again").size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.write_overview(cx))))
                .into_any_element(),
            (None, false, None) => div()
                .text_size(typography::TEXT_SM)
                .text_color(colors.muted_foreground)
                .child(if running { "The overview is written once the agent finishes this turn." } else { "No overview yet." })
                .into_any_element(),
        };
        let about = div().flex().flex_col().gap(px(10.)).child(section_label(IconName::TextAlignLeft, "About")).child(about);

        // Tasks: what is done and what is not, as one list with its progress.
        let tasks = overview.as_ref().filter(|_| total > 0).map(|overview| {
            let row = |text: &String, finished: bool| {
                div()
                    .flex()
                    .items_start()
                    .gap(px(10.))
                    .py(px(7.))
                    .px(px(12.))
                    .text_size(typography::TEXT_SM)
                    .line_height(relative(1.5))
                    .child(
                        div().flex_none().pt(px(2.)).child(if finished {
                            Icon::new(IconName::CheckCircle).size(IconSize::Small).color(colors.success)
                        } else {
                            Icon::new(IconName::CircleDotted).size(IconSize::Small).color(colors.muted_foreground)
                        }),
                    )
                    .child(div().flex_1().min_w_0().text_color(if finished { colors.muted_foreground } else { colors.foreground }).child(text.clone()))
            };
            let fill = done as f32 / total as f32;
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.))
                        .h(px(36.))
                        .px(px(8.))
                        .rounded(metrics::RADIUS_MD)
                        .bg(colors.segment_track)
                        .child(div().flex().items_center().justify_center().size(px(22.)).rounded(px(6.)).bg(colors.primary.opacity(0.16)).child(Icon::new(IconName::ListChecks).size(IconSize::XSmall).color(colors.primary)))
                        .child(div().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.foreground).child("Tasks"))
                        .child(div().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child(total.to_string()))
                        .child(div().flex_1())
                        .child(div().w(px(72.)).h(px(4.)).rounded_full().bg(colors.border).child(div().h_full().w(relative(fill)).rounded_full().bg(colors.success)))
                        .child(div().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child(format!("{done} done"))),
                )
                .children(overview.remaining.iter().map(|item| row(item, false)))
                .children(overview.done.iter().map(|item| row(item, true)))
        });

        let content = div()
            .flex()
            .flex_col()
            .gap(px(28.))
            .child(div().flex().flex_col().gap(px(14.)).child(header).child(chips))
            .child(about)
            .children(tasks)
            .children(self.render_activity(&creator_person, &agent, cx));
        self.page("session-overview", content)
    }

    /// The session's history as a timeline: prompts, files the agent changed, commands it ran,
    /// steps that failed.
    fn render_activity(&self, creator: &ui::Person, agent: &str, cx: &mut Context<Self>) -> Option<AnyElement> {
        let colors = cx.theme().colors.clone();
        let events = activity(&self.transcript);
        if events.is_empty() {
            return None;
        }
        const SHOWN: usize = 8;
        let all = self.expanded.contains("overview-activity-all");
        let hidden = if all { 0 } else { events.len().saturating_sub(SHOWN) };
        let now = workspace::now_ms();
        let count = events.len();
        let rows: Vec<AnyElement> = events
            .into_iter()
            .enumerate()
            .skip(hidden)
            .map(|(index, event)| {
                let (actor, leading) = match event.kind {
                    ActivityKind::Started | ActivityKind::Asked => (creator.name.to_string(), ui::Avatar::person(creator, cx).size(px(20.)).into_any_element()),
                    ActivityKind::Edited => (agent.to_string(), activity_icon(IconName::PencilLine, colors.muted_foreground, &colors)),
                    ActivityKind::Ran => (agent.to_string(), activity_icon(IconName::Terminal, colors.muted_foreground, &colors)),
                    ActivityKind::Failed => (agent.to_string(), activity_icon(IconName::WarningCircle, colors.destructive, &colors)),
                };
                let last = index + 1 == count;
                let mut line = div().flex().flex_wrap().items_baseline().gap_x(px(5.)).text_size(typography::TEXT_SM).line_height(relative(1.5));
                line = line.child(div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(actor));
                for (text, strong) in event.parts {
                    line = line.child(div().text_color(if strong { colors.foreground } else { colors.muted_foreground }).child(text));
                }
                if let Some(at) = event.at {
                    line = line.child(div().text_color(colors.subtle_foreground).child(format!("· {}", ago(at, now))));
                }
                div()
                    .flex()
                    .gap(px(12.))
                    .child(
                        // The rail: the event's mark, and a line down to the next one.
                        div()
                            .flex_none()
                            .w(px(20.))
                            .flex()
                            .flex_col()
                            .items_center()
                            .child(div().flex_none().size(px(20.)).flex().items_center().justify_center().child(leading))
                            .when(!last, |this| this.child(div().flex_1().w(px(1.)).min_h(px(10.)).bg(colors.border))),
                    )
                    .child(div().flex_1().min_w_0().pb(px(if last { 0. } else { 14. })).child(line))
                    .into_any_element()
            })
            .collect();
        let more = (hidden > 0 || (all && count > SHOWN)).then(|| {
            let label = if all { "Show less".to_string() } else { format!("Show {hidden} earlier") };
            Button::new("overview-activity-more", label).variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                if !this.expanded.remove("overview-activity-all") {
                    this.expanded.insert("overview-activity-all".into());
                }
                cx.notify();
            }))
        });
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(14.))
                .child(div().flex().items_center().justify_between().child(div().text_size(px(14.)).font_weight(typography::SEMIBOLD).text_color(colors.foreground).child("Activity")).children(more))
                .child(div().flex().flex_col().children(rows))
                .into_any_element(),
        )
    }

    /// Opens the Changes page on `path`, from the top of its diff.
    pub(crate) fn show_change(&mut self, path: std::path::PathBuf, cx: &mut Context<Self>) {
        self.changes_file = Some(path);
        self.changes_scroll.scroll_to_item(0, gpui::ScrollStrategy::Top);
        self.set_page(SessionPage::Changes, cx);
    }

    pub(crate) fn render_changes(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let theme = cx.theme().clone();
        let files = file_edits(&self.transcript);
        if files.is_empty() {
            let empty = ui::EmptyState::new("No changes yet").icon(IconName::GitDiff).message("Files the agent creates or edits in this session show here, with their diffs.");
            return self.page("session-changes", div().w_full().flex().justify_center().pt(px(72.)).child(empty));
        }
        let (additions, deletions) = files.iter().fold((0, 0), |(added, removed), (file, _)| (added + file.additions, removed + file.deletions));
        let root = self.info.cwd.clone();
        let selected = self.changes_file.clone().filter(|path| files.iter().any(|(file, _)| file.path == *path)).unwrap_or_else(|| files[0].0.path.clone());
        let counts = |added: usize, removed: usize| {
            div()
                .flex_none()
                .flex()
                .gap(px(6.))
                .text_size(typography::TEXT_CAPTION)
                .when(added > 0, |this| this.child(div().text_color(colors.git_added).child(format!("+{added}"))))
                .when(removed > 0, |this| this.child(div().text_color(colors.git_deleted).child(format!("−{removed}"))))
        };
        let file_icon = |name: &str, cx: &mut Context<Self>| match extensions::icon_for(name, false, false, cx) {
            Some(source) => gpui::img(source).flex_none().size(px(14.)).into_any_element(),
            None => Icon::new(IconName::File).size(IconSize::Small).color(colors.subtle_foreground).into_any_element(),
        };
        let name_of = |path: &std::path::Path| path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());

        // Left: every changed file, latest first, with the totals and the full review on top.
        let list_header = div()
            .flex_none()
            .flex()
            .items_center()
            .gap(px(8.))
            .h(px(36.))
            .px(px(12.))
            .border_b_1()
            .border_color(colors.divider)
            .text_size(typography::TEXT_SM)
            .child(div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(format!("{} {}", files.len(), if files.len() == 1 { "file" } else { "files" })))
            .child(counts(additions, deletions))
            .child(div().flex_1())
            .child(
                Button::icon("changes-review", IconName::GitDiff)
                    .size(ButtonSize::XSmall)
                    .tooltip("Review all changes")
                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.open_review(cx))),
            );
        let mut rows: Vec<AnyElement> = Vec::new();
        for (position, (file, _)) in files.iter().enumerate() {
            let name = name_of(&file.path);
            let folder = relative_folder(&file.path, root.as_deref());
            let active = file.path == selected;
            let path = file.path.clone();
            let hover = colors.segment_track;
            let name_color = if file.status == ToolStatus::Failed {
                colors.destructive
            } else if file.created {
                colors.git_added
            } else {
                colors.foreground
            };
            rows.push(
                div()
                    .id(("changes-file", position))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(px(28.))
                    .px(px(8.))
                    .rounded(metrics::RADIUS_MD)
                    .when(active, |this| this.bg(colors.segment_knob).shadow(theme.shadows.raised_inset.clone()))
                    .when(!active, |this| this.hover(move |style| style.bg(hover)))
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                        this.changes_file = Some(path.clone());
                        this.changes_scroll.scroll_to_item(0, gpui::ScrollStrategy::Top);
                        cx.notify();
                    }))
                    .child(file_icon(&name, cx))
                    .child(
                        div()
                            .flex()
                            .items_baseline()
                            .gap(px(6.))
                            .flex_1()
                            .min_w_0()
                            .overflow_hidden()
                            .child(div().flex_none().text_size(typography::TEXT_SM).text_color(name_color).child(name))
                            .children(folder.map(|folder| div().min_w_0().truncate().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(folder))),
                    )
                    .child(counts(file.additions, file.deletions))
                    .into_any_element(),
            );
        }
        let width = self.changes_width;
        let resizing = self.changes_drag.is_some();
        let line = colors.primary;
        let list = div()
            .relative()
            .flex_none()
            .w(px(width))
            .h_full()
            .flex()
            .flex_col()
            .border_r_1()
            .border_color(colors.divider)
            .child(list_header)
            .child(div().id("changes-files").flex_1().min_h_0().overflow_y_scroll().p(px(6.)).flex().flex_col().gap(px(1.)).children(rows))
            .child(
                // Drag to resize; double-click puts the width back.
                div()
                    .id("changes-resize")
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right(px(-3.))
                    .w(px(6.))
                    .flex()
                    .justify_center()
                    .cursor_col_resize()
                    .group("changes-resize")
                    .child(div().w(px(1.)).h_full().when(resizing, |this| this.bg(line)).group_hover("changes-resize", move |style| style.bg(line)))
                    .on_mouse_down(
                        gpui::MouseButton::Left,
                        cx.listener(|this, event: &gpui::MouseDownEvent, _, cx| {
                            this.changes_drag = Some((event.position.x, this.changes_width));
                            cx.stop_propagation();
                            cx.notify();
                        }),
                    )
                    .on_click(cx.listener(|this, event: &ClickEvent, _, cx| {
                        if event.click_count() == 2 {
                            this.changes_width = CHANGES_LIST_WIDTH;
                            cx.notify();
                        }
                    })),
            );

        // Right: the picked file, its whole diff filling the page (every edit, oldest first).
        let (file, edits) = files.into_iter().find(|(file, _)| file.path == selected).expect("the selected file is one of the changes");
        let name = name_of(&file.path);
        let folder = relative_folder(&file.path, root.as_deref());
        let open_path = file.path.clone();
        let header = div()
            .flex_none()
            .flex()
            .items_center()
            .gap(px(8.))
            .h(px(36.))
            .px(px(14.))
            .border_b_1()
            .border_color(colors.divider)
            .child(file_icon(&name, cx))
            .child(div().flex_none().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.foreground).child(name))
            .children(folder.map(|folder| div().min_w_0().truncate().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(folder)))
            .child(div().flex_1())
            .when(file.created, |this| this.child(ui::Badge::new("New").label_color(colors.git_added)))
            .when(file.status == ToolStatus::Failed, |this| this.child(ui::Badge::new("Failed").label_color(colors.destructive)))
            .when(edits.len() > 1, |this| this.child(div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(format!("{} edits", edits.len()))))
            .child(counts(file.additions, file.deletions).text_size(typography::TEXT_SM))
            .child(
                Button::icon("changes-open", IconName::SquareArrowUp)
                    .size(ButtonSize::XSmall)
                    .tooltip("Open file")
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.open_file(open_path.clone(), cx))),
            );

        let (rows, spans) = change_rows(&file.path, &edits);
        let (rows, spans): (std::rc::Rc<Vec<ChangeRow>>, crate::render::LineSpans) = (std::rc::Rc::new(rows), std::rc::Rc::new(spans));
        let widest = rows
            .iter()
            .enumerate()
            .max_by_key(|(_, row)| match row {
                ChangeRow::Diff(crate::diff::NumberedRow::Line { text, .. }) => text.len(),
                _ => 0,
            })
            .map(|(row, _)| row);
        let count = rows.len();
        let (row_colors, row_theme) = (colors.clone(), theme.clone());
        let diff = gpui::uniform_list("changes-diff", count, move |range: std::ops::Range<usize>, _, _| {
            range
                .filter_map(|index| {
                    Some(match rows.get(index)? {
                        ChangeRow::Edit(number, of) => div()
                            .flex()
                            .items_center()
                            .min_w_full()
                            .h(px(crate::render::DIFF_ROW_HEIGHT))
                            .px(px(10.))
                            .bg(row_colors.surface)
                            .text_color(row_colors.muted_foreground)
                            .child(format!("Edit {number} of {of}"))
                            .into_any_element(),
                        ChangeRow::Diff(row) => crate::render::diff_row(index, row, &spans, &row_colors, &row_theme),
                    })
                })
                .collect()
        })
        .with_horizontal_sizing_behavior(gpui::ListHorizontalSizingBehavior::Unconstrained)
        .with_width_from_item(widest)
        .track_scroll(&self.changes_scroll)
        .flex_1()
        .min_h_0();
        let diff = div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .bg(colors.background)
            .font_family(typography::MONO_FONT)
            .text_size(typography::TEXT_CAPTION)
            .line_height(px(crate::render::DIFF_ROW_HEIGHT))
            .child(ui::with_scrollbar(diff, ui::Scrollbar::uniform("changes-diff-scrollbar", &self.changes_scroll)));
        let detail = div().flex_1().min_w_0().h_full().flex().flex_col().child(header).child(diff);

        div()
            .id("session-changes")
            .flex_1()
            .min_h_0()
            .flex()
            .on_mouse_move(cx.listener(|this, event: &gpui::MouseMoveEvent, window, cx| {
                let Some((start_x, start_width)) = this.changes_drag else { return };
                if !event.dragging() {
                    this.changes_drag = None;
                    cx.notify();
                    return;
                }
                let max = (f32::from(window.viewport_size().width) * 0.6).max(CHANGES_LIST_MIN_WIDTH);
                this.changes_width = (start_width + f32::from(event.position.x - start_x)).clamp(CHANGES_LIST_MIN_WIDTH, max);
                cx.notify();
            }))
            .on_mouse_up(
                gpui::MouseButton::Left,
                cx.listener(|this, _: &gpui::MouseUpEvent, _, cx| {
                    if this.changes_drag.take().is_some() {
                        cx.notify();
                    }
                }),
            )
            .child(list)
            .child(detail)
            .into_any_element()
    }

    pub(crate) fn render_issues(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let theme = cx.theme().clone();
        let issues = linked_issues(&self.transcript);
        if issues.is_empty() {
            let empty = ui::EmptyState::new("No linked issues").icon(IconName::CircleDot).message("Issues this session links to, or that you add as context with @, show here.");
            return self.page("session-issues", div().w_full().flex().justify_center().pt(px(72.)).child(empty));
        }
        let open = self.open_issues.clone().unwrap_or_default();
        let count = issues.len();
        let rows: Vec<AnyElement> = issues
            .into_iter()
            .enumerate()
            .map(|(index, issue)| {
                let known = open.iter().find(|(number, _, url)| *number == issue.number && issue.url.as_deref().is_none_or(|linked| linked.starts_with(url.as_str())));
                let title = issue.title.clone().or_else(|| known.map(|(_, title, _)| title.clone()));
                // An issue of this project opens in Athas; another repository's on GitHub.
                let in_project = issue.url.is_none() || known.is_some();
                let label = issue.url.as_deref().and_then(repo_label).filter(|_| !in_project).map(|repo| format!("{repo}#{}", issue.number)).unwrap_or_else(|| format!("#{}", issue.number));
                let (number, url) = (issue.number, issue.url.clone());
                let tab_title = title.clone().map(|title| format!("#{number} {title}")).unwrap_or_else(|| format!("#{number}"));
                let hover = colors.accent;
                div()
                    .id(("session-issue", index))
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .min_h(px(44.))
                    .px(px(14.))
                    .when(index > 0, |this| this.border_t_1().border_color(colors.divider))
                    .hover(move |style| style.bg(hover))
                    .child(Icon::new(IconName::CircleDot).size(IconSize::Small).color(colors.git_added))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(typography::TEXT_SM)
                            .font_weight(typography::MEDIUM)
                            .text_color(if title.is_some() { colors.foreground } else { colors.muted_foreground })
                            .child(title.unwrap_or_else(|| format!("Issue {label}"))),
                    )
                    .child(div().flex_none().font_family(typography::MONO_FONT).text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(label))
                    .child(Icon::new(if in_project { IconName::ChevronRight } else { IconName::OpenExternal }).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .on_click(move |_, _, cx| match (&url, in_project) {
                        (Some(url), false) => cx.open_url(url),
                        _ => workbench_api::open_resource(cx, "github-issue", &number.to_string(), &tab_title),
                    })
                    .into_any_element()
            })
            .collect();
        let content = div()
            .flex()
            .flex_col()
            .gap(px(10.))
            .child(div().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.muted_foreground).child(format!("{count} linked {}", if count == 1 { "issue" } else { "issues" })))
            .child(div().rounded(metrics::RADIUS_LG).bg(colors.raised).shadow(theme.shadows.raised.clone()).overflow_hidden().children(rows));
        self.page("session-issues", content)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityKind {
    Started,
    Asked,
    Edited,
    Ran,
    Failed,
}

/// One line of the Activity timeline: what happened after its actor's name, as plain and
/// emphasized parts, and when.
#[derive(Clone, Debug, PartialEq)]
pub struct ActivityEvent {
    pub kind: ActivityKind,
    pub parts: Vec<(String, bool)>,
    pub at: Option<u64>,
}

/// The session's history, oldest first: each prompt, then what the agent did for it (the files
/// it changed, the commands it ran, the steps that failed).
pub fn activity(transcript: &Transcript) -> Vec<ActivityEvent> {
    fn clip(text: &str, max: usize) -> String {
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.chars().count() <= max { text } else { format!("{}…", text.chars().take(max).collect::<String>()) }
    }
    #[derive(Default)]
    struct Turn {
        files: Vec<String>,
        commands: usize,
        failed: Vec<(String, Option<u64>)>,
        at: Option<u64>,
    }
    fn flush(turn: &mut Turn, events: &mut Vec<ActivityEvent>) {
        let turn = std::mem::take(turn);
        if !turn.files.is_empty() {
            let mut parts = vec![("changed".to_string(), false)];
            let shown = turn.files.len().min(2);
            parts.push((turn.files[..shown].join(", "), true));
            if turn.files.len() > shown {
                parts.push((format!("and {} more", turn.files.len() - shown), false));
            }
            events.push(ActivityEvent { kind: ActivityKind::Edited, parts, at: turn.at });
        }
        if turn.commands > 0 {
            let label = format!("{} {}", turn.commands, if turn.commands == 1 { "command" } else { "commands" });
            events.push(ActivityEvent { kind: ActivityKind::Ran, parts: vec![("ran".into(), false), (label, true)], at: turn.at });
        }
        for (title, at) in turn.failed {
            events.push(ActivityEvent { kind: ActivityKind::Failed, parts: vec![("hit a failed step:".into(), false), (title, true)], at });
        }
    }

    let mut events = Vec::new();
    let mut turn = Turn::default();
    let mut prompts = 0;
    for entry in &transcript.entries {
        match entry {
            Entry::User(message) => {
                flush(&mut turn, &mut events);
                let text = clip(follow_ups::strip_context_preamble(&message.text), 90);
                if text.is_empty() {
                    continue;
                }
                let (kind, verb) = if prompts == 0 { (ActivityKind::Started, "started the session:") } else { (ActivityKind::Asked, "asked") };
                prompts += 1;
                events.push(ActivityEvent { kind, parts: vec![(verb.into(), false), (format!("“{text}”"), true)], at: message.sent_at });
            }
            Entry::ToolCall(call) => {
                turn.at = turn.at.or(call.started_at);
                if call.status == ToolStatus::Failed {
                    turn.failed.push((clip(&call.title, 70), call.started_at));
                    continue;
                }
                for part in &call.content {
                    if let ToolContent::Diff { path, .. } = part {
                        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
                        if !turn.files.contains(&name) {
                            turn.files.push(name);
                        }
                    }
                }
                if call.kind == crate::thread::ToolKind::Execute {
                    turn.commands += 1;
                }
            }
            _ => {}
        }
    }
    flush(&mut turn, &mut events);
    events
}

/// A timeline mark: a small icon in a soft circle.
fn activity_icon(name: IconName, tint: Hsla, colors: &theme::ThemeColors) -> AnyElement {
    div().size(px(20.)).flex().items_center().justify_center().rounded_full().bg(colors.segment_track).child(Icon::new(name).size(IconSize::XSmall).color(tint)).into_any_element()
}

/// "now", "5m ago", "2d ago".
fn ago(at: u64, now: u64) -> String {
    match workspace::relative_time(at, now) {
        now_label if now_label == "now" => "just now".into(),
        age => format!("{age} ago"),
    }
}

/// A row of the Changes page's diff: a divider before each edit of a file edited more than once,
/// or a diff row.
pub enum ChangeRow {
    Edit(usize, usize),
    Diff(crate::diff::NumberedRow),
}

/// Every edit of `path` as one run of rows, with each row's highlight spans.
fn change_rows(path: &std::path::Path, edits: &[FileEdit]) -> (Vec<ChangeRow>, Vec<Vec<(std::ops::Range<usize>, editor::SyntaxKind)>>) {
    use crate::diff::NumberedRow;
    let language = path.extension().map(|extension| extension.to_string_lossy().into_owned());
    let mut rows = Vec::new();
    let mut spans = Vec::new();
    for (number, edit) in edits.iter().enumerate() {
        if edits.len() > 1 {
            rows.push(ChangeRow::Edit(number + 1, edits.len()));
            spans.push(Vec::new());
        }
        let numbered = crate::diff::numbered_rows(&crate::diff::diff_rows(edit.old.as_deref().unwrap_or(""), &edit.new));
        // Highlighted as one text so tokens that depend on earlier lines stay right.
        let code = numbered.iter().map(|row| if let NumberedRow::Line { text, .. } = row { text.as_str() } else { "" }).collect::<Vec<_>>().join("\n");
        let highlights = crate::render::code_line_spans(language.as_deref(), &code);
        for (line, row) in numbered.into_iter().enumerate() {
            spans.push(highlights.get(line).cloned().unwrap_or_default());
            rows.push(ChangeRow::Diff(row));
        }
    }
    (rows, spans)
}

/// The folder of `path`, relative to the project when it is inside it.
fn relative_folder(path: &std::path::Path, root: Option<&std::path::Path>) -> Option<String> {
    let parent = path.parent()?;
    let shown = root.and_then(|root| parent.strip_prefix(root).ok()).unwrap_or(parent);
    let text = shown.display().to_string();
    (!text.is_empty()).then_some(text)
}

/// "repo" of a GitHub issue URL.
fn repo_label(url: &str) -> Option<String> {
    let path = url.split_once("github.com/")?.1;
    path.split('/').nth(1).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::UserMessage;

    #[test]
    fn reads_the_overview_through_fences_and_prose() {
        let text = "Here it is:\n```json\n{\"about\": \"Fixes the login.\", \"done\": [\"Found the bug\", \"\"], \"remaining\": [\"Tests\"]}\n```";
        let overview = parse(text).unwrap();
        assert_eq!(overview.about, "Fixes the login.");
        assert_eq!(overview.done, vec!["Found the bug"]);
        assert_eq!(overview.remaining, vec!["Tests"]);
        assert!(parse("{\"done\": []}").is_none());
    }

    #[test]
    fn links_issues_by_url_and_by_context() {
        let transcript = Transcript {
            entries: vec![
                Entry::User(UserMessage {
                    text: "Fix https://github.com/athasdev/athas/issues/12 please\nGitHub issue: Crash on save (#40)".into(),
                    issues: vec![(7, "#7 Slow start".into())],
                    ..Default::default()
                }),
                Entry::User(UserMessage { text: "GitHub issue: Same one (#12)".into(), ..Default::default() }),
            ],
            ..Default::default()
        };
        let issues = linked_issues(&transcript);
        assert_eq!(issues.iter().map(|issue| issue.number).collect::<Vec<_>>(), vec![12, 7, 40]);
        assert_eq!(issues[0].title.as_deref(), Some("Same one"));
        assert_eq!(issues[1].title.as_deref(), Some("Slow start"));
        assert_eq!(issues[2].title.as_deref(), Some("Crash on save"));
    }

    #[test]
    fn an_outside_agent_writes_with_its_own_command_line() {
        assert_eq!(AgentCli::for_agent("claude-code"), Some(AgentCli::Claude));
        assert_eq!(AgentCli::for_agent("codex-acp"), Some(AgentCli::Codex));
        assert_eq!(AgentCli::for_agent("gemini-cli"), Some(AgentCli::Gemini));
        assert_eq!(AgentCli::for_agent("athas"), None);
    }

    #[test]
    fn activity_groups_each_turn_after_its_prompt() {
        let transcript: Transcript = serde_json::from_value(serde_json::json!({ "entries": [
            { "type": "user", "text": "Fix the sync", "sentAt": 1 },
            { "type": "toolCall", "id": "a", "title": "Edit a.rs", "kind": "edit", "status": "completed",
              "content": [ { "type": "diff", "path": "/p/a.rs", "newText": "x" } ] },
            { "type": "toolCall", "id": "b", "title": "cargo test", "kind": "execute", "status": "completed" },
            { "type": "toolCall", "id": "c", "title": "cargo clippy", "kind": "execute", "status": "failed" },
            { "type": "user", "text": "Now the progress bar", "sentAt": 2 }
        ] }))
        .unwrap();
        let kinds: Vec<ActivityKind> = activity(&transcript).iter().map(|event| event.kind).collect();
        assert_eq!(kinds, [ActivityKind::Started, ActivityKind::Edited, ActivityKind::Ran, ActivityKind::Failed, ActivityKind::Asked]);
    }
}
