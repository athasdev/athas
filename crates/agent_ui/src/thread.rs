//! A session's transcript and the reducer that folds the agent's stream of ACP updates into it.
//! It is plain data, so it saves as JSON and reloads as it was.
//!
//! Ported from Athas's `features/ai/lib/acp-*` and `stores/ai-chat` handling of ACP events
//! (`acp-stream-handler.ts`), with the shape of Zed's `acp_thread`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use agent_client_protocol_schema::MaybeUndefined;

use crate::acp::schema as acp;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Transcript {
    pub entries: Vec<Entry>,
    /// The agent's current plan.
    pub plan: Vec<PlanEntry>,
    /// The agent's id for the session, for `session/load` after a restart.
    pub agent_session_id: Option<String>,
    /// The title the agent gave the session.
    pub agent_title: Option<String>,
    /// The user renamed the session, so the agent's titles no longer apply.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub title_locked: bool,
    pub modes: Option<ModeState>,
    pub config_options: Vec<ConfigOption>,
    pub commands: Vec<AvailableCommand>,
    pub usage: Option<Usage>,
    /// Where the session's prompts run when it runs in the cloud.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud: Option<crate::cloud::session::CloudEnvironment>,
    /// The session's browser opened itself on a dev server once (`autoOpened`), so it does not
    /// again after a restart.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub browser_auto_opened: bool,
    /// The model-written overview the session's Overview tab shows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overview: Option<crate::overview::SessionOverview>,
    /// The message ids of the last user and thought chunks (not saved).
    #[serde(skip)]
    pub chunk_ids: ChunkIds,
}

/// The ids an agent gives its user and thought chunks, which mark where one message ends and the
/// next starts (`startsNewMessage` in `acp-session-history.ts`); agent messages keep theirs on
/// the message. Two transcripts compare equal whatever these are.
#[derive(Clone, Debug, Default)]
pub struct ChunkIds {
    user: Option<String>,
    thought: Option<String>,
}

impl PartialEq for ChunkIds {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}

impl ChunkIds {
    /// Whether `id` differs from the one before it of the same kind, remembering it.
    fn starts_new(slot: &mut Option<String>, id: Option<&acp::MessageId>) -> bool {
        let Some(id) = id else { return false };
        let id = id.0.to_string();
        let previous = slot.replace(id.clone());
        previous.is_some_and(|previous| previous != id)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Entry {
    User(UserMessage),
    Agent(AgentMessage),
    Thought(Thought),
    ToolCall(ToolCall),
    Notice(Notice),
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UserMessage {
    pub text: String,
    /// Files mentioned or attached with the message.
    pub attachments: Vec<PathBuf>,
    /// Images pasted or dropped into the message, shown as thumbnails.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<MessageImage>,
    /// When the prompt was sent, in milliseconds since the epoch. A replayed prompt is stamped
    /// as it arrives, as Athas stamps a replay it has no end time for; older saves have none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent_at: Option<u64>,
    /// GitHub issues added as context with the message, as (number, title), for the session's
    /// Issues page.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub issues: Vec<(u64, String)>,
}

impl UserMessage {
    /// The hour and minute it was sent, as Athas's `formatTime` ("03:45 PM").
    pub fn time_of_day(&self) -> Option<String> {
        let at = chrono::DateTime::from_timestamp_millis(i64::try_from(self.sent_at?).ok()?)?;
        Some(at.with_timezone(&chrono::Local).format("%I:%M %p").to_string())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MessageImage {
    pub media_type: String,
    /// Base64.
    pub data: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AgentMessage {
    pub message_id: Option<String>,
    /// Markdown.
    pub text: String,
    /// Generative views drawn with the message (`message.ui`). Athas types and draws the field but
    /// nothing fills it (its agents show views through `show_view` tool output); here an ACP agent
    /// may send them in a chunk's `_meta.athasUi`, an extension of this port.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ui: Vec<Value>,
    /// Images the agent sent (`onImageChunk`), shown under the reply.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<MessageImage>,
    /// The tokens the turn used, when the agent reported them with its end (`turnUsage`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_usage: Option<TurnUsage>,
    /// The built-in agent's steps and cost for the turn (`usage`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<MessageUsage>,
}

/// A turn's token usage from the end of the turn (`AcpTurnUsage`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TurnUsage {
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub thought_tokens: Option<u64>,
    pub cached_read_tokens: Option<u64>,
    pub cached_write_tokens: Option<u64>,
}

impl TurnUsage {
    pub fn from_schema(usage: &acp::Usage) -> Self {
        Self {
            total_tokens: usage.total_tokens,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            thought_tokens: usage.thought_tokens,
            cached_read_tokens: usage.cached_read_tokens,
            cached_write_tokens: usage.cached_write_tokens,
        }
    }

    /// "1.2k tokens" (`formatTurnUsage`).
    pub fn label(&self) -> String {
        format!("{} tokens", crate::summary::format_token_count(self.total_tokens))
    }

    /// "1k input · 200 output · 50 reasoning · 800 cache read · 100 cache write", the last three
    /// only when there were any (`describeTurnUsage`).
    pub fn describe(&self) -> String {
        let parts = [
            (Some(self.input_tokens), "input"),
            (Some(self.output_tokens), "output"),
            (self.thought_tokens, "reasoning"),
            (self.cached_read_tokens, "cache read"),
            (self.cached_write_tokens, "cache write"),
        ];
        parts
            .iter()
            .enumerate()
            .filter(|(index, (tokens, _))| *index < 2 || tokens.unwrap_or_default() > 0)
            .map(|(_, (tokens, label))| format!("{} {label}", crate::summary::format_token_count(tokens.unwrap_or_default())))
            .collect::<Vec<_>>()
            .join(" · ")
    }
}

/// The built-in agent's turn footer (`MessageUsage`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MessageUsage {
    pub steps: Option<u64>,
    pub cost_cents: Option<f64>,
}

impl MessageUsage {
    /// The usage the built-in agent sends in its answer's `_meta` (`toMessageUsage`).
    pub fn from_meta(meta: Option<&acp::Meta>) -> Option<Self> {
        let meta = meta?;
        let steps = meta.get("steps").and_then(Value::as_u64).filter(|steps| *steps > 0);
        let cost_cents = meta.get("costUsd").and_then(Value::as_f64).filter(|cost| cost.is_finite()).map(|cost| (cost * 10_000.).round() / 100.);
        (steps.is_some() || cost_cents.is_some()).then_some(Self { steps, cost_cents })
    }

    /// "4 steps · $0.03", or `None` with nothing worth showing (`formatMessageUsage`).
    pub fn label(&self) -> Option<String> {
        let mut parts = Vec::new();
        if let Some(steps) = self.steps.filter(|steps| *steps > 1) {
            parts.push(format!("{steps} steps"));
        }
        if let Some(cents) = self.cost_cents.filter(|cents| *cents > 0.) {
            parts.push(if cents < 1. { "<$0.01".to_string() } else { format!("${:.2}", cents / 100.) });
        }
        (!parts.is_empty()).then(|| parts.join(" · "))
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Thought {
    pub text: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Read,
    Edit,
    Delete,
    Move,
    Search,
    Execute,
    Think,
    Fetch,
    SwitchMode,
    #[default]
    #[serde(other)]
    Other,
}

impl From<&acp::ToolKind> for ToolKind {
    fn from(kind: &acp::ToolKind) -> Self {
        match kind {
            acp::ToolKind::Read => ToolKind::Read,
            acp::ToolKind::Edit => ToolKind::Edit,
            acp::ToolKind::Delete => ToolKind::Delete,
            acp::ToolKind::Move => ToolKind::Move,
            acp::ToolKind::Search => ToolKind::Search,
            acp::ToolKind::Execute => ToolKind::Execute,
            acp::ToolKind::Think => ToolKind::Think,
            acp::ToolKind::Fetch => ToolKind::Fetch,
            acp::ToolKind::SwitchMode => ToolKind::SwitchMode,
            _ => ToolKind::Other,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    #[default]
    Pending,
    InProgress,
    /// The agent asked the user before going on.
    WaitingForPermission,
    Completed,
    Failed,
    /// The user denied it, or the turn stopped before it finished.
    Canceled,
}

impl From<&acp::ToolCallStatus> for ToolStatus {
    fn from(status: &acp::ToolCallStatus) -> Self {
        match status {
            acp::ToolCallStatus::Pending => ToolStatus::Pending,
            acp::ToolCallStatus::InProgress => ToolStatus::InProgress,
            acp::ToolCallStatus::Completed => ToolStatus::Completed,
            acp::ToolCallStatus::Failed => ToolStatus::Failed,
            _ => ToolStatus::Pending,
        }
    }
}

impl ToolStatus {
    pub fn is_running(self) -> bool {
        matches!(self, ToolStatus::Pending | ToolStatus::InProgress | ToolStatus::WaitingForPermission)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ToolContent {
    /// Text (Markdown) the tool produced.
    Text { text: String },
    Diff { path: PathBuf, old_text: Option<String>, new_text: String },
    /// A terminal the client runs for the agent (`terminal/create`).
    Terminal { terminal_id: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub path: PathBuf,
    pub line: Option<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub title: String,
    pub kind: ToolKind,
    pub status: ToolStatus,
    pub content: Vec<ToolContent>,
    pub locations: Vec<Location>,
    /// The tool's input, shown when the call has nothing else to show (a command, a query).
    pub raw_input: Option<Value>,
    /// The tool's raw output; generative views in it are drawn when the call has no content.
    pub raw_output: Option<Value>,
    /// Output of a command the agent ran itself and streamed through `_meta.terminal_output`.
    pub terminal_output: Option<String>,
    pub exit_code: Option<i64>,
    /// When the call started, in milliseconds since the epoch; `None` for calls that arrived
    /// already finished, as history replays do.
    pub started_at: Option<u64>,
    /// How long a finished call ran, when its start was seen.
    pub duration_ms: Option<u64>,
    /// A `!` command stopped by the 60 s limit ("Timed out after 60 seconds").
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub timed_out: bool,
}

pub(crate) fn now_ms() -> u64 {
    web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map_or(0, |duration| duration.as_millis() as u64)
}

impl ToolCall {
    /// Sets the status, recording how long the call ran when it finishes now.
    pub fn set_status(&mut self, status: ToolStatus) {
        if self.status.is_running() && !status.is_running() && self.duration_ms.is_none() {
            self.duration_ms = self.started_at.map(|start| now_ms().saturating_sub(start));
        }
        if status.is_running() && self.started_at.is_none() && self.duration_ms.is_none() {
            self.started_at = Some(now_ms());
        }
        self.status = status;
    }

    /// The shell command a call runs, from its input.
    pub fn command(&self) -> Option<String> {
        let input = self.raw_input.as_ref()?;
        let command = input.get("command").or_else(|| input.get("cmd"))?;
        match command {
            Value::String(command) if !command.trim().is_empty() => Some(crate::shell_command::unwrap_shell_command(command)),
            Value::Array(parts) if !parts.is_empty() => {
                let words: Vec<String> = parts.iter().filter_map(Value::as_str).map(str::to_string).collect();
                Some(crate::shell_command::unwrap_shell_words(&words))
            }
            _ => None,
        }
    }

    /// The row's label: a command as people read it (`bun dev` for `/bin/zsh -lc 'bun dev'`),
    /// anything else by its title.
    pub fn label(&self) -> String {
        match self.command().filter(|_| self.kind == ToolKind::Execute || self.title.trim().is_empty()) {
            Some(command) => crate::shell_command::clean_command(crate::shell_command::first_line(&command)),
            None if self.kind == ToolKind::Execute => crate::shell_command::clean_command(crate::shell_command::first_line(&self.title)),
            None => self.title.clone(),
        }
    }

    pub fn diffs(&self) -> impl Iterator<Item = (&PathBuf, Option<&str>, &str)> {
        self.content.iter().filter_map(|content| match content {
            ToolContent::Diff { path, old_text, new_text } => Some((path, old_text.as_deref(), new_text.as_str())),
            _ => None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoticeKind {
    Info,
    /// The turn ended early on a limit or a refusal (`AgentStopNotice`): a title, then what to
    /// do next on the following line.
    Warning,
    /// The turn stopped before the agent finished: the user stopped it, or a limit hit.
    Stopped,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub kind: NoticeKind,
    pub text: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    #[default]
    Pending,
    InProgress,
    Completed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    pub content: String,
    pub status: PlanStatus,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mode {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeState {
    pub current: String,
    pub available: Vec<Mode>,
}

impl From<acp::SessionModeState> for ModeState {
    fn from(state: acp::SessionModeState) -> Self {
        Self {
            current: state.current_mode_id.0.to_string(),
            available: state
                .available_modes
                .into_iter()
                .map(|mode| Mode { id: mode.id.0.to_string(), name: mode.name, description: mode.description })
                .collect(),
        }
    }
}

/// A choice the agent offers for the session, such as its model.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOption {
    pub id: String,
    pub name: String,
    /// `model`, `mode`, `thought_level` or the agent's own.
    pub category: Option<String>,
    pub current: String,
    pub choices: Vec<ConfigChoice>,
    /// The value the agent uses when none is picked (`_meta.defaultValue`), marked "Default".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChoice {
    pub value: String,
    pub name: String,
    pub description: Option<String>,
    pub group: Option<String>,
}

impl ConfigOption {
    /// The select options the client shows; other kinds are left out.
    pub fn from_acp(option: acp::SessionConfigOption) -> Option<Self> {
        let acp::SessionConfigKind::Select(select) = option.kind else { return None };
        let choice = |option: acp::SessionConfigSelectOption, group: Option<String>| ConfigChoice {
            value: option.value.0.to_string(),
            name: option.name,
            description: option.description,
            group,
        };
        let choices = match select.options {
            acp::SessionConfigSelectOptions::Ungrouped(options) => options.into_iter().map(|option| choice(option, None)).collect(),
            acp::SessionConfigSelectOptions::Grouped(groups) => groups
                .into_iter()
                .flat_map(|group| {
                    let name = group.name;
                    group.options.into_iter().map(move |option| choice(option, Some(name.clone())))
                })
                .collect(),
            _ => Vec::new(),
        };
        let category = option.category.map(|category| match category {
            acp::SessionConfigOptionCategory::Mode => "mode".to_string(),
            acp::SessionConfigOptionCategory::Model => "model".to_string(),
            acp::SessionConfigOptionCategory::ModelConfig => "model_config".to_string(),
            acp::SessionConfigOptionCategory::ThoughtLevel => "thought_level".to_string(),
            acp::SessionConfigOptionCategory::Other(other) => other,
            _ => "other".to_string(),
        });
        let default = option.meta.as_ref().and_then(|meta| meta.get("defaultValue")).and_then(|value| value.as_str()).filter(|value| !value.is_empty()).map(str::to_string);
        Some(Self { id: option.id.0.to_string(), name: option.name, category, current: select.current_value.0.to_string(), choices, default })
    }

    pub fn current_name(&self) -> &str {
        self.choices.iter().find(|choice| choice.value == self.current).map_or(self.current.as_str(), |choice| choice.name.as_str())
    }
}

/// A slash command the agent offers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableCommand {
    pub name: String,
    pub description: String,
    pub hint: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Usage {
    /// Tokens in the context window now.
    pub used: u64,
    /// The context window's size; 0 when the agent does not know it.
    pub size: u64,
    /// The session's cost so far, when the agent reports one.
    pub cost: Option<Cost>,
    /// Tokens the session read and wrote so far, when the agent reports them in `_meta`
    /// (`inputTokens`, `outputTokens`).
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cost {
    pub amount: f64,
    pub currency: String,
}

/// What an update changed, so the view can redraw only that.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Applied {
    /// The entry that changed or was added.
    pub entry: Option<usize>,
    /// The session's title, modes, options, commands or plan changed.
    pub session: bool,
}

impl Transcript {
    /// Folds one update from the agent into the transcript.
    pub fn apply(&mut self, update: acp::SessionUpdate) -> Applied {
        match update {
            acp::SessionUpdate::UserMessageChunk(chunk) => {
                let new_message = ChunkIds::starts_new(&mut self.chunk_ids.user, chunk.message_id.as_ref());
                // A replayed prompt's images come back as thumbnails, not "[image]".
                if let acp::ContentBlock::Image(image) = &chunk.content {
                    let applied = self.append_user(String::new(), new_message);
                    if let Some(Entry::User(message)) = self.entries.last_mut() {
                        message.images.push(MessageImage { media_type: image.mime_type.clone(), data: image.data.clone() });
                    }
                    return applied;
                }
                self.append_user(content_text(&chunk.content), new_message)
            }
            acp::SessionUpdate::AgentMessageChunk(chunk) => {
                let message_id = chunk.message_id.as_ref().map(|id| id.0.to_string());
                let image = match &chunk.content {
                    acp::ContentBlock::Image(image) => Some(MessageImage { media_type: image.mime_type.clone(), data: image.data.clone() }),
                    _ => None,
                };
                let text = if image.is_some() { String::new() } else { content_text(&chunk.content) };
                let applied = self.append_agent(message_id, &text);
                if let Some(image) = image
                    && let Some(Entry::Agent(message)) = self.entries.last_mut()
                {
                    message.images.push(image);
                }
                let views = match chunk.meta.as_ref().and_then(|meta| meta.get("athasUi")) {
                    Some(serde_json::Value::Array(views)) => views.clone(),
                    Some(view) if !view.is_null() => vec![view.clone()],
                    _ => Vec::new(),
                };
                if !views.is_empty()
                    && let Some(Entry::Agent(message)) = self.entries.last_mut()
                {
                    message.ui.extend(views);
                }
                applied
            }
            acp::SessionUpdate::AgentThoughtChunk(chunk) => {
                let new_thought = ChunkIds::starts_new(&mut self.chunk_ids.thought, chunk.message_id.as_ref());
                // Only text shows as reasoning.
                if !matches!(chunk.content, acp::ContentBlock::Text(_)) {
                    return Applied { entry: None, session: false };
                }
                self.append_thought(&content_text(&chunk.content), new_thought)
            }
            acp::SessionUpdate::ToolCall(call) => self.upsert_tool_call(call),
            acp::SessionUpdate::ToolCallUpdate(update) => self.update_tool_call(update),
            acp::SessionUpdate::Plan(plan) => {
                self.plan = plan
                    .entries
                    .into_iter()
                    .map(|entry| PlanEntry {
                        content: entry.content,
                        status: match entry.status {
                            acp::PlanEntryStatus::InProgress => PlanStatus::InProgress,
                            acp::PlanEntryStatus::Completed => PlanStatus::Completed,
                            _ => PlanStatus::Pending,
                        },
                    })
                    .collect();
                Applied { entry: None, session: true }
            }
            acp::SessionUpdate::AvailableCommandsUpdate(update) => {
                self.commands = update
                    .available_commands
                    .into_iter()
                    .map(|command| AvailableCommand {
                        name: command.name,
                        description: command.description,
                        hint: match command.input {
                            Some(acp::AvailableCommandInput::Unstructured(input)) => Some(input.hint),
                            _ => None,
                        },
                    })
                    .collect();
                Applied { entry: None, session: true }
            }
            acp::SessionUpdate::CurrentModeUpdate(update) => {
                if let Some(modes) = &mut self.modes {
                    modes.current = update.current_mode_id.0.to_string();
                }
                Applied { entry: None, session: true }
            }
            acp::SessionUpdate::ConfigOptionUpdate(update) => {
                self.config_options = update.config_options.into_iter().filter_map(ConfigOption::from_acp).collect();
                Applied { entry: None, session: true }
            }
            acp::SessionUpdate::SessionInfoUpdate(update) => {
                match update.title {
                    _ if self.title_locked => {}
                    MaybeUndefined::Value(title) => {
                        if let Some(title) = crate::title::clean_chat_title(&title) {
                            self.agent_title = Some(title)
                        }
                    }
                    MaybeUndefined::Null => self.agent_title = None,
                    _ => {}
                }
                Applied { entry: None, session: true }
            }
            acp::SessionUpdate::UsageUpdate(usage) => {
                let tokens = |key: &str| usage.meta.as_ref().and_then(|meta| meta.get(key)).and_then(Value::as_u64);
                self.usage = Some(Usage {
                    used: usage.used,
                    size: usage.size,
                    cost: usage.cost.map(|cost| Cost { amount: cost.amount, currency: cost.currency }),
                    input_tokens: tokens("inputTokens"),
                    output_tokens: tokens("outputTokens"),
                });
                Applied { entry: None, session: true }
            }
            _ => Applied::default(),
        }
    }

    /// Adds the user's prompt.
    pub fn push_user(&mut self, text: String, attachments: Vec<PathBuf>) -> usize {
        self.entries.push(Entry::User(UserMessage { text, attachments, sent_at: Some(now_ms()), ..Default::default() }));
        self.entries.len() - 1
    }

    pub fn push_notice(&mut self, kind: NoticeKind, text: impl Into<String>) -> usize {
        self.entries.push(Entry::Notice(Notice { kind, text: text.into() }));
        self.entries.len() - 1
    }

    /// Marks the tool calls a stopped turn left running as canceled. Returns the entries changed.
    pub fn cancel_running_tools(&mut self) -> Vec<usize> {
        let mut changed = Vec::new();
        for (index, entry) in self.entries.iter_mut().enumerate() {
            if let Entry::ToolCall(call) = entry
                && call.status.is_running()
            {
                call.set_status(ToolStatus::Canceled);
                changed.push(index);
            }
        }
        changed
    }

    /// Cancels the steps still waiting for a permission answer; returns their indices.
    pub fn cancel_waiting_tools(&mut self) -> Vec<usize> {
        let mut changed = Vec::new();
        for (index, entry) in self.entries.iter_mut().enumerate() {
            if let Entry::ToolCall(call) = entry
                && call.status == ToolStatus::WaitingForPermission
            {
                call.set_status(ToolStatus::Canceled);
                changed.push(index);
            }
        }
        changed
    }

    pub fn tool_call(&self, id: &str) -> Option<(usize, &ToolCall)> {
        self.entries.iter().enumerate().rev().find_map(|(index, entry)| match entry {
            Entry::ToolCall(call) if call.id == id => Some((index, call)),
            _ => None,
        })
    }

    pub fn set_tool_status(&mut self, id: &str, status: ToolStatus) -> Option<usize> {
        let index = self.tool_call(id)?.0;
        if let Entry::ToolCall(call) = &mut self.entries[index] {
            call.set_status(status);
        }
        Some(index)
    }

    /// The first thing the user asked, for a title.
    pub fn first_prompt(&self) -> Option<&str> {
        self.entries.iter().find_map(|entry| match entry {
            Entry::User(message) if !message.text.trim().is_empty() => Some(message.text.as_str()),
            _ => None,
        })
    }

    fn append_user(&mut self, text: String, new_message: bool) -> Applied {
        if !new_message && let Some(Entry::User(message)) = self.entries.last_mut() {
            message.text.push_str(&text);
        } else {
            self.entries.push(Entry::User(UserMessage { text, sent_at: Some(now_ms()), ..Default::default() }));
        }
        if let Some(Entry::User(message)) = self.entries.last_mut() {
            let own = crate::follow_ups::strip_context_preamble(&message.text);
            if own.len() != message.text.len() {
                message.text = own.to_string();
            }
        }
        Applied { entry: Some(self.entries.len() - 1), session: false }
    }

    fn append_agent(&mut self, message_id: Option<String>, text: &str) -> Applied {
        match self.entries.last_mut() {
            Some(Entry::Agent(message)) if message_id.is_none() || message.message_id.is_none() || message.message_id == message_id => {
                message.text.push_str(text);
                if message.message_id.is_none() {
                    message.message_id = message_id;
                }
            }
            _ => self.entries.push(Entry::Agent(AgentMessage { message_id, text: text.to_string(), ..Default::default() })),
        }
        Applied { entry: Some(self.entries.len() - 1), session: false }
    }

    fn append_thought(&mut self, text: &str, new_thought: bool) -> Applied {
        if !new_thought && let Some(Entry::Thought(thought)) = self.entries.last_mut() {
            thought.text.push_str(text);
        } else {
            self.entries.push(Entry::Thought(Thought { text: text.to_string() }));
        }
        Applied { entry: Some(self.entries.len() - 1), session: false }
    }

    fn upsert_tool_call(&mut self, call: acp::ToolCall) -> Applied {
        let mut tool = ToolCall {
            id: call.tool_call_id.0.to_string(),
            title: call.title,
            kind: ToolKind::from(&call.kind),
            status: ToolStatus::from(&call.status),
            content: call.content.into_iter().filter_map(tool_content).collect(),
            locations: call.locations.into_iter().map(|location| Location { path: location.path, line: location.line }).collect(),
            raw_input: call.raw_input,
            raw_output: call.raw_output,
            terminal_output: None,
            exit_code: None,
            started_at: None,
            duration_ms: None,
            timed_out: false,
        };
        apply_terminal_meta(&mut tool, call.meta.as_ref());
        match self.tool_call(&tool.id).map(|(index, _)| index) {
            Some(index) => {
                if let Entry::ToolCall(existing) = &mut self.entries[index] {
                    tool.terminal_output = tool.terminal_output.or(existing.terminal_output.take());
                    let status = tool.status;
                    tool.status = existing.status;
                    tool.started_at = existing.started_at;
                    tool.duration_ms = existing.duration_ms;
                    tool.set_status(status);
                    *existing = tool;
                }
                Applied { entry: Some(index), session: false }
            }
            None => {
                if tool.status.is_running() {
                    tool.started_at = Some(now_ms());
                }
                self.entries.push(Entry::ToolCall(tool));
                Applied { entry: Some(self.entries.len() - 1), session: false }
            }
        }
    }

    /// Applies a tool call update. An update for a call the transcript has not seen (a permission
    /// request's call, or one that started before a reload) adds it.
    pub fn update_tool_call(&mut self, update: acp::ToolCallUpdate) -> Applied {
        let id = update.tool_call_id.0.to_string();
        let index = match self.tool_call(&id) {
            Some((index, _)) => index,
            None => {
                self.entries.push(Entry::ToolCall(ToolCall { id: id.clone(), title: "Tool call".into(), started_at: Some(now_ms()), ..Default::default() }));
                self.entries.len() - 1
            }
        };
        let Entry::ToolCall(call) = &mut self.entries[index] else { return Applied::default() };
        let fields = update.fields;
        if let Some(title) = fields.title {
            call.title = title;
        }
        if let Some(kind) = &fields.kind {
            call.kind = ToolKind::from(kind);
        }
        if let Some(status) = &fields.status {
            call.set_status(ToolStatus::from(status));
        }
        if let Some(content) = fields.content {
            call.content = content.into_iter().filter_map(tool_content).collect();
        }
        if let Some(locations) = fields.locations {
            call.locations = locations.into_iter().map(|location| Location { path: location.path, line: location.line }).collect();
        }
        if let Some(raw_input) = fields.raw_input {
            call.raw_input = Some(raw_input);
        }
        if let Some(raw_output) = fields.raw_output {
            call.raw_output = Some(raw_output);
        }
        apply_terminal_meta(call, update.meta.as_ref());
        Applied { entry: Some(index), session: false }
    }
}

/// The `_meta` terminal extension the Claude and Codex adapters use: `terminal_output` (or
/// `terminal_output_delta`) appends a command's output, `terminal_exit` ends it.
fn apply_terminal_meta(call: &mut ToolCall, meta: Option<&acp::Meta>) {
    let Some(meta) = meta else { return };
    for key in ["terminal_output", "terminal_output_delta"] {
        if let Some(data) = meta.get(key).and_then(|value| value.get("data")).and_then(Value::as_str) {
            call.terminal_output.get_or_insert_with(String::new).push_str(data);
        }
    }
    if meta.contains_key("terminal_info") {
        call.terminal_output.get_or_insert_with(String::new);
    }
    if let Some(exit) = meta.get("terminal_exit") {
        call.exit_code = exit.get("exit_code").and_then(Value::as_i64);
    }
}

fn tool_content(content: acp::ToolCallContent) -> Option<ToolContent> {
    match content {
        acp::ToolCallContent::Content(content) => {
            let text = content_text(&content.content);
            (!text.is_empty()).then_some(ToolContent::Text { text })
        }
        acp::ToolCallContent::Diff(diff) => Some(ToolContent::Diff { path: diff.path, old_text: diff.old_text, new_text: diff.new_text }),
        acp::ToolCallContent::Terminal(terminal) => Some(ToolContent::Terminal { terminal_id: terminal.terminal_id.0.to_string() }),
        _ => None,
    }
}

/// The text a content block shows: its text, or a reference to what it holds.
pub fn content_text(block: &acp::ContentBlock) -> String {
    match block {
        acp::ContentBlock::Text(text) => text.text.clone(),
        acp::ContentBlock::ResourceLink(link) => format!("[{}]({})", link.title.as_deref().unwrap_or(&link.name), link.uri),
        acp::ContentBlock::Resource(resource) => match &resource.resource {
            acp::EmbeddedResourceResource::TextResourceContents(text) => format!("[@{}]({})", file_name(&text.uri), text.uri),
            acp::EmbeddedResourceResource::BlobResourceContents(blob) => format!("[@{}]({})", file_name(&blob.uri), blob.uri),
            _ => String::new(),
        },
        acp::ContentBlock::Image(_) => "[image]".into(),
        acp::ContentBlock::Audio(_) => "[audio]".into(),
        _ => String::new(),
    }
}

fn file_name(uri: &str) -> &str {
    uri.rsplit('/').next().unwrap_or(uri)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn update(value: Value) -> acp::SessionUpdate {
        serde_json::from_value(value).unwrap()
    }

    fn agent_chunk(text: &str) -> acp::SessionUpdate {
        update(json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": text } }))
    }

    #[test]
    fn streams_chunks_into_one_message_until_something_else_comes() {
        let mut transcript = Transcript::default();
        transcript.push_user("Fix the bug".into(), Vec::new());
        assert_eq!(transcript.apply(update(json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": "Let me " } }))).entry, Some(1));
        transcript.apply(update(json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": "look." } })));
        assert_eq!(transcript.apply(agent_chunk("Hello")).entry, Some(2));
        assert_eq!(transcript.apply(agent_chunk(", world")).entry, Some(2));
        transcript.apply(update(json!({ "sessionUpdate": "tool_call", "toolCallId": "t1", "title": "Read file", "kind": "read" })));
        assert_eq!(transcript.apply(agent_chunk("Done")).entry, Some(4));
        assert_eq!(transcript.entries[1], Entry::Thought(Thought { text: "Let me look.".into() }));
        assert_eq!(transcript.entries[2], Entry::Agent(AgentMessage { message_id: None, text: "Hello, world".into(), ..Default::default() }));
        assert!(matches!(&transcript.entries[4], Entry::Agent(message) if message.text == "Done"));
    }

    #[test]
    fn views_in_a_chunks_meta_go_with_the_message() {
        let mut transcript = Transcript::default();
        let view = json!({ "type": "card", "title": "Deploy" });
        transcript.apply(update(json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "Here" }, "_meta": { "athasUi": view } })));
        transcript.apply(agent_chunk(" it is"));
        let Entry::Agent(message) = &transcript.entries[0] else { panic!() };
        assert_eq!((message.text.as_str(), message.ui.clone()), ("Here it is", vec![view]));
        let saved = serde_json::to_value(&transcript.entries[0]).unwrap();
        assert_eq!(serde_json::from_value::<Entry>(saved).unwrap(), transcript.entries[0]);
    }

    #[test]
    fn images_the_agent_sends_go_under_its_reply() {
        let mut transcript = Transcript::default();
        transcript.apply(agent_chunk("A chart:"));
        transcript.apply(update(json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "image", "mimeType": "image/png", "data": "AAAA" } })));
        let Entry::Agent(message) = &transcript.entries[0] else { panic!() };
        assert_eq!(message.text, "A chart:");
        assert_eq!(message.images, [MessageImage { media_type: "image/png".into(), data: "AAAA".into() }]);
    }

    #[test]
    fn replayed_user_and_thought_chunks_split_on_their_ids() {
        let mut transcript = Transcript::default();
        let user = |id: &str, text: &str| update(json!({ "sessionUpdate": "user_message_chunk", "messageId": id, "content": { "type": "text", "text": text } }));
        let thought = |id: &str, text: &str| update(json!({ "sessionUpdate": "agent_thought_chunk", "messageId": id, "content": { "type": "text", "text": text } }));
        transcript.apply(user("u1", "First"));
        transcript.apply(user("u1", " prompt"));
        transcript.apply(user("u2", "Second"));
        transcript.apply(update(json!({ "sessionUpdate": "user_message_chunk", "messageId": "u2", "content": { "type": "image", "mimeType": "image/png", "data": "AAAA" } })));
        transcript.apply(thought("t1", "One"));
        transcript.apply(thought("t2", "Two"));
        transcript.apply(update(json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "image", "mimeType": "image/png", "data": "AAAA" } })));
        assert_eq!(transcript.entries.len(), 4);
        assert!(matches!(&transcript.entries[0], Entry::User(message) if message.text == "First prompt"));
        assert!(matches!(&transcript.entries[1], Entry::User(message) if message.text == "Second" && message.images.len() == 1));
        assert!(matches!(&transcript.entries[2], Entry::Thought(thought) if thought.text == "One"));
        assert!(matches!(&transcript.entries[3], Entry::Thought(thought) if thought.text == "Two"));
        // Replayed prompts are stamped as they arrive, in order, and read as a time of day.
        let (Entry::User(first), Entry::User(second)) = (&transcript.entries[0], &transcript.entries[1]) else { panic!() };
        assert!(first.sent_at.is_some() && first.sent_at <= second.sent_at);
        assert!(first.time_of_day().is_some_and(|time| time.contains(':')));
        assert_eq!(UserMessage::default().time_of_day(), None);
    }

    #[test]
    fn a_new_message_id_starts_a_new_message() {
        let mut transcript = Transcript::default();
        let chunk = |id: &str, text: &str| {
            update(json!({ "sessionUpdate": "agent_message_chunk", "messageId": id, "content": { "type": "text", "text": text } }))
        };
        transcript.apply(chunk("m1", "One"));
        transcript.apply(chunk("m1", " more"));
        transcript.apply(chunk("m2", "Two"));
        assert_eq!(transcript.entries.len(), 2);
    }

    #[test]
    fn tool_calls_take_their_updates() {
        let mut transcript = Transcript::default();
        transcript.apply(update(json!({
            "sessionUpdate": "tool_call", "toolCallId": "t1", "title": "Run tests", "kind": "execute",
            "status": "pending", "rawInput": { "command": "cargo test" },
            "_meta": { "terminal_info": { "terminal_id": "x" } }
        })));
        transcript.apply(update(json!({
            "sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "in_progress",
            "_meta": { "terminal_output": { "terminal_id": "x", "data": "running 3 tests\n" } }
        })));
        let applied = transcript.apply(update(json!({
            "sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed",
            "content": [
                { "type": "content", "content": { "type": "text", "text": "ok" } },
                { "type": "diff", "path": "/p/a.rs", "oldText": "a", "newText": "b" },
                { "type": "terminal", "terminalId": "term-1" }
            ],
            "_meta": { "terminal_exit": { "terminal_id": "x", "exit_code": 0 } }
        })));
        assert_eq!(applied.entry, Some(0));
        let Entry::ToolCall(call) = &transcript.entries[0] else { panic!() };
        assert_eq!(call.title, "Run tests");
        assert_eq!(call.kind, ToolKind::Execute);
        assert_eq!(call.status, ToolStatus::Completed);
        assert_eq!(call.command().as_deref(), Some("cargo test"));
        assert_eq!(call.terminal_output.as_deref(), Some("running 3 tests\n"));
        assert_eq!(call.exit_code, Some(0));
        assert_eq!(call.content.len(), 3);
        assert_eq!(call.diffs().count(), 1);
    }

    #[test]
    fn an_update_for_an_unknown_call_adds_it() {
        let mut transcript = Transcript::default();
        let applied = transcript.update_tool_call(
            serde_json::from_value(json!({ "toolCallId": "p1", "title": "Edit main.rs", "kind": "edit" })).unwrap(),
        );
        assert_eq!(applied.entry, Some(0));
        assert_eq!(transcript.set_tool_status("p1", ToolStatus::WaitingForPermission), Some(0));
        assert_eq!(transcript.cancel_running_tools(), vec![0]);
        let Entry::ToolCall(call) = &transcript.entries[0] else { panic!() };
        assert_eq!((call.title.as_str(), call.status), ("Edit main.rs", ToolStatus::Canceled));
    }

    #[test]
    fn keeps_the_sessions_plan_modes_options_commands_and_title() {
        let mut transcript = Transcript {
            modes: Some(ModeState { current: "default".into(), available: Vec::new() }),
            ..Default::default()
        };
        transcript.apply(update(json!({ "sessionUpdate": "plan", "entries": [
            { "content": "Read", "priority": "high", "status": "completed" },
            { "content": "Write", "priority": "low", "status": "in_progress" }
        ] })));
        transcript.apply(update(json!({ "sessionUpdate": "current_mode_update", "currentModeId": "plan" })));
        transcript.apply(update(json!({ "sessionUpdate": "config_option_update", "configOptions": [
            { "id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": "opus",
              "options": [ { "value": "opus", "name": "Opus" }, { "value": "sonnet", "name": "Sonnet" } ] },
            { "id": "fast", "name": "Fast", "type": "boolean", "currentValue": true }
        ] })));
        transcript.apply(update(json!({ "sessionUpdate": "available_commands_update", "availableCommands": [
            { "name": "review", "description": "Review changes", "input": { "hint": "branch" } }
        ] })));
        let applied = transcript.apply(update(json!({ "sessionUpdate": "session_info_update", "title": "Fix login" })));
        assert!(applied.session);
        assert_eq!(transcript.plan[1], PlanEntry { content: "Write".into(), status: PlanStatus::InProgress });
        assert_eq!(transcript.modes.as_ref().unwrap().current, "plan");
        assert_eq!(transcript.config_options.len(), 1);
        assert_eq!(transcript.config_options[0].current_name(), "Opus");
        assert_eq!(transcript.config_options[0].category.as_deref(), Some("model"));
        assert_eq!(transcript.commands[0].hint.as_deref(), Some("branch"));
        assert_eq!(transcript.agent_title.as_deref(), Some("Fix login"));
    }

    #[test]
    fn unknown_updates_change_nothing() {
        let mut transcript = Transcript::default();
        let applied = transcript.apply(update(json!({ "sessionUpdate": "usage_update", "used": 10, "size": 100 })));
        assert!(applied.session);
        assert_eq!(transcript.usage, Some(Usage { used: 10, size: 100, ..Default::default() }));
        transcript.apply(update(json!({
            "sessionUpdate": "usage_update", "used": 20, "size": 100,
            "cost": { "amount": 0.25, "currency": "USD" }, "_meta": { "inputTokens": 900, "outputTokens": 40 }
        })));
        let usage = transcript.usage.clone().unwrap();
        assert_eq!(usage.cost, Some(Cost { amount: 0.25, currency: "USD".into() }));
        assert_eq!((usage.input_tokens, usage.output_tokens), (Some(900), Some(40)));
        assert!(serde_json::from_value::<acp::SessionUpdate>(json!({ "sessionUpdate": "brand_new" })).is_err());
    }
}
