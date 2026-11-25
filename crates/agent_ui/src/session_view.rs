//! One agent session in the centre: it starts the agent on the first prompt, streams the turn into
//! the transcript, asks the user what the agent asks, and saves the transcript as it goes.
//!
//! Ported from Athas's `features/ai/components/chat/ai-chat.tsx`, `stores/ai-chat/acp-actions.ts`
//! and `crates/ai/src/acp/bridge.rs`.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet, VecDeque},
    ops::Range,
    path::PathBuf,
    rc::Rc,
    sync::Arc,
    time::Duration,
};

use futures::{FutureExt as _, StreamExt, channel::oneshot};
use ui::scale::px;
use gpui::{
    App, AsyncApp, Context, Entity, EventEmitter, FocusHandle, Focusable, FollowMode, ListAlignment, ListOffset, ListState, Pixels, Subscription,
    Task, WeakEntity, Window, prelude::*,
};
use ui::OpenMenu;
use workspace::SessionStatus;

use crate::{
    SessionInfo, SessionViewEvent,
    builtin,
    acp::{
        self, OpenError,
        client::{AgentConnection, ClientEvent},
        rpc::RpcError,
        schema,
    },
    composer::{Composer, ComposerEvent},
    history,
    mentions::Attachment,
    session_input::{Completion, PromptSupport, Queued, QueuedEdit, prompt_blocks},
    markdown::{self, Block},
    persistence,
    selection::{SelectPhase, SpanPath, TextPoint, TextSelection},
    thread::{Applied, ConfigOption, Entry, NoticeKind, ToolStatus, Transcript},
    title,
};

/// Whether the agent process runs, and what it said about itself.
pub(crate) enum AgentState {
    /// Not started yet: the agent starts with the first prompt.
    Stopped,
    Starting,
    Ready(Rc<RunningAgent>),
    NotInstalled { name: String, hint: String },
}

/// One agent process per agent and folder, its connection shared by the sessions there
/// (`bridge_init.rs`); it stops once the last of them lets go.
#[cfg(not(target_family = "wasm"))]
pub(crate) struct SharedAgent {
    key: (String, PathBuf),
    connection: Arc<AgentConnection>,
    process: acp::process::AgentProcess,
    /// Stopped by the idle sweep; its sessions reconnect with their next prompt.
    idle_stopped: std::cell::Cell<bool>,
    _io: Task<()>,
}

#[cfg(not(target_family = "wasm"))]
#[derive(Default)]
struct SharedAgents(HashMap<(String, PathBuf), std::rc::Weak<SharedAgent>>);

#[cfg(not(target_family = "wasm"))]
impl gpui::Global for SharedAgents {}

/// How long a shared agent may sit with nothing going either way before it stops
/// (`ACP_IDLE_TIMEOUT`).
#[cfg(not(target_family = "wasm"))]
const AGENT_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
#[cfg(not(target_family = "wasm"))]
const IDLE_SWEEP_INTERVAL: Duration = Duration::from_secs(60);

#[cfg(not(target_family = "wasm"))]
struct IdleSweep {
    _task: Task<()>,
}

#[cfg(not(target_family = "wasm"))]
impl gpui::Global for IdleSweep {}

/// Stops shared agents idle long enough, once a minute (`sweep` in `bridge.rs`); agents that
/// cannot load their sessions again are left running.
#[cfg(not(target_family = "wasm"))]
fn start_idle_sweep(cx: &mut App) {
    if cx.has_global::<IdleSweep>() {
        return;
    }
    let task = cx.spawn(async move |cx| {
        loop {
            cx.background_executor().timer(IDLE_SWEEP_INTERVAL).await;
            cx.update(|cx| {
                let Some(agents) = cx.try_global::<SharedAgents>() else { return };
                let idle: Vec<_> = agents
                    .0
                    .iter()
                    .filter_map(|(key, shared)| Some((key.clone(), shared.upgrade()?)))
                    .filter(|(_, shared)| !shared.connection.is_closed() && shared.connection.is_idle(AGENT_IDLE_TIMEOUT))
                    .collect();
                for (key, shared) in idle {
                    shared.idle_stopped.set(true);
                    cx.default_global::<SharedAgents>().0.remove(&key);
                    shared.connection.close();
                }
                cx.default_global::<SharedAgents>().0.retain(|_, shared| shared.strong_count() > 0);
            });
        }
    });
    cx.set_global(IdleSweep { _task: task });
}


/// `session/close` is a courtesy while a session goes away, so it gets a short budget
/// (`ACP_SESSION_CLOSE_TIMEOUT`).
const SESSION_CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

pub(crate) struct RunningAgent {
    pub connection: Arc<AgentConnection>,
    pub session_id: String,
    #[cfg(not(target_family = "wasm"))]
    _process: Option<acp::process::AgentProcess>,
    /// The agent process this session shares with the others of its agent and folder.
    #[cfg(not(target_family = "wasm"))]
    shared: Option<Rc<SharedAgent>>,
    /// This session's events on a shared connection; it unroutes them when dropped.
    _route: Option<acp::client::SessionRoute>,
    /// The agent on the workspace server, stopped when this drops.
    #[cfg(target_family = "wasm")]
    _remote: Option<Box<dyn std::any::Any>>,
    /// The built-in agent, which runs in-process instead.
    _builtin: Option<Task<()>>,
    _io: Task<()>,
    _events: Task<()>,
}

/// A question the agent waits on.
pub(crate) struct PendingPermission {
    pub tool_call_id: String,
    pub title: String,
    pub options: Vec<schema::PermissionOption>,
    respond: Option<oneshot::Sender<Option<schema::PermissionOptionId>>>,
}

/// A question the agent asked through `elicitation/create`, with the answers given so far.
pub(crate) struct PendingElicitation {
    pub elicitation: crate::elicitation::Elicitation,
    pub answers: HashMap<String, crate::elicitation::Answer>,
    /// Text fields of the form's questions, made when their step is first shown.
    pub inputs: HashMap<String, Entity<ui::TextInput>>,
    pub step: usize,
    pub error: Option<String>,
    /// A URL-mode link was opened and accepted; the prompt waits for `elicitation/complete`.
    pub waiting: bool,
    respond: Option<oneshot::Sender<serde_json::Value>>,
}

/// How long the agent has to answer before the waiting marker says it is still waiting.
pub(crate) const STILL_WAITING: Duration = Duration::from_secs(20);
/// How long a stopped turn may take to wind down before it ends anyway.
const CANCEL_GRACE: Duration = Duration::from_secs(10);

pub struct SessionView {
    pub(crate) info: SessionInfo,
    pub(crate) composer: Entity<Composer>,
    pub(crate) transcript: Transcript,
    pub(crate) list: ListState,
    pub(crate) agent: AgentState,
    pub(crate) turn: Option<Task<()>>,
    /// The transcript index of the user message whose turn runs (or ran last): agent writes go
    /// into its checkpoint.
    current_turn: Option<usize>,
    /// When the running turn's prompt went out, for the waiting marker until the agent answers.
    pub(crate) turn_started_at: Option<web_time::Instant>,
    /// What the running turn changed of the session's state (mode, options, title, commands),
    /// the reply when that is all it did (`commandResultLabel`).
    turn_state_label: Option<String>,
    waiting_tick: Option<Task<()>>,
    /// Stop was pressed: the turn ends on its own when the agent does not within
    /// [`CANCEL_GRACE`].
    cancel_grace: Option<Task<()>>,
    /// The latest prompt, pinned to the top of the list while its reply grows beneath it.
    prompt_anchor: Option<usize>,
    /// Whether the pinned turn's reply has outgrown the room held for it, so the pin may go.
    anchor_filled: bool,
    /// The prompt was pinned before the list had room to put it at the top; the scroll is made
    /// again as soon as the room is there.
    anchor_pending: bool,
    /// The room under the pinned prompt for this frame, measured before the list lays out.
    pub(crate) anchor_room: Option<Pixels>,
    pub(crate) permissions: VecDeque<PendingPermission>,
    pub(crate) elicitations: VecDeque<PendingElicitation>,
    /// Commands the user ran from the composer with `!`, by transcript tool call id, while they run.
    pub(crate) user_commands: HashMap<String, Rc<crate::user_command::UserCommand>>,
    user_command_poll: Option<Task<()>>,
    /// Tool calls and thoughts the user opened, by key.
    pub(crate) expanded: HashSet<String>,
    /// Replies whose plan the user started executing (`executingStepIndex`).
    pub(crate) executing_plans: HashSet<usize>,
    /// Rows that open on their own (a failed step) which the user closed.
    pub(crate) collapsed: HashSet<String>,
    /// Redraws running steps' elapsed time once a second.
    elapsed_tick: Option<Task<()>>,
    pub(crate) plan_collapsed: bool,
    /// Parsed Markdown of agent messages, by entry, with the text length it was parsed at.
    markdown: RefCell<HashMap<usize, (usize, Rc<Vec<Block>>)>>,
    /// Text the user has selected across the transcript with the mouse.
    pub(crate) text_selection: Option<crate::selection::TextSelection>,
    /// The Copy/Quote card over that selection, while it is up.
    pub(crate) quote_card: Option<crate::quote::QuoteCard>,
    /// Keeps the card's reply field subscribed for as long as the card is up.
    pub(crate) quote_subscription: Option<gpui::Subscription>,
    /// The runs of text the transcript has drawn, which is what copying the selection reads.
    pub(crate) drawn_runs: RefCell<crate::selection::DrawnRuns>,
    /// Decoded thumbnails of the images sent with prompts, by their base64 data.
    pub(crate) thumbnails: RefCell<HashMap<String, Option<Arc<gpui::Image>>>>,
    /// The tool calls each cloud run's log shows so far, by the agent message the run fills.
    pub(crate) cloud_tool_calls: HashMap<usize, Vec<crate::cloud::transcript::CloudToolCall>>,
    pub(crate) open_menu: Option<OpenMenu>,
    pub(crate) effort_popover: Option<(gpui::Point<gpui::Pixels>, String)>,
    /// The `@` or `/` completion menu over the composer.
    pub(crate) completion: Option<Completion>,
    /// What goes along with the next prompt.
    pub(crate) attachments: Vec<Attachment>,
    pub(crate) open_attachment_group: Option<crate::attachment_groups::Kind>,
    /// Prompts sent while a turn runs, sent in order when it ends.
    pub(crate) queue: Vec<Queued>,
    pub(crate) queued_edit: Option<QueuedEdit>,
    /// A turn ended while its next queued prompt was being edited.
    pub(crate) queue_held_for_edit: bool,
    /// The turn stops for a "Send now": the queue goes on once it has.
    pub(crate) continue_queue: bool,
    pub(crate) send_now_at: Option<web_time::Instant>,
    /// Why an attachment could not be added.
    pub(crate) input_notice: Option<String>,
    pub(crate) project_files: Option<Arc<Vec<String>>>,
    pub(crate) loading_files: Option<Task<()>>,
    /// The query the project's file index was last asked about, with its files once found.
    pub(crate) file_search: Option<(String, Option<Arc<Vec<String>>>)>,
    pub(crate) searching_files: Option<Task<()>>,
    pub(crate) saved_sessions: Option<Arc<Vec<history::SavedSession>>>,
    pub(crate) shortcuts: crate::agent_shortcuts::ShortcutState,
    pub(crate) voice: Option<crate::voice::VoiceInput>,
    /// Skills for `/` completion, loaded the first time `/` is typed.
    pub(crate) skills: Option<Arc<Vec<crate::skills::Skill>>>,
    pub(crate) loading_skills: Option<Task<()>>,
    /// Codex's own skills and the errors of those it could not load, once asked.
    pub(crate) codex_skills: Option<Result<(Vec<crate::codex::CodexSkill>, Vec<String>), String>>,
    pub(crate) loading_codex_skills: Option<Task<()>>,
    /// When Codex's models were last read (the session's start, then each refresh), why the
    /// last refresh failed, and the refresh under way.
    pub(crate) codex_models_read: Option<web_time::Instant>,
    /// The Codex catalog the models and skills above were read from (`codex::catalog_generation`).
    pub(crate) codex_catalog: u64,
    pub(crate) codex_models_error: Option<String>,
    pub(crate) refreshing_codex_models: Option<Task<()>>,
    pub(crate) loading_sessions: Option<Task<()>>,
    /// The project's open issues and pull requests for Add context, once read.
    pub(crate) github_issues: Option<Vec<(u64, String, String, String)>>,
    pub(crate) github_prs: Option<Vec<github_panel::quick_open::ProjectPullRequest>>,
    pub(crate) loading_github: Option<Task<()>>,
    store_dir: Option<PathBuf>,
    save_task: Option<Task<()>>,
    status: SessionStatus,
    /// What the session's row shows: `status` with its branch's pull request laid over it.
    shown_status: SessionStatus,
    pub(crate) pull_request: Option<crate::pull_request::BranchPullRequest>,
    pub(crate) pull_request_poll: Option<Task<()>>,
    /// Follows the cloud run going now, in a session that runs in the cloud.
    pub(crate) cloud_poll: Option<Task<()>>,
    pub(crate) last_cloud_run: Option<crate::cloud::CloudRun>,
    /// Unreviewed agent changes: files, lines added, lines removed.
    pub(crate) review_totals: (usize, usize, usize),
    /// User messages whose turn changed files, so they can be restored.
    pub(crate) checkpoint_turns: Vec<usize>,
    /// Recomputing the review totals after the agent wrote a file.
    review_refresh: Option<Task<()>>,
    /// The project rules the built-in agent's next request carries, for the context meter: read
    /// off the main thread once per session and again after each turn.
    /// The project rules the meter counts, with the attached files they were read for.
    pub(crate) rules_budget: Option<(Vec<PathBuf>, String)>,
    pub(crate) rules_budget_task: Option<Task<()>>,
    /// The side column's boxes, made the first time the column shows.
    pub(crate) side_boxes: Option<Entity<crate::dock_view::SessionDockView>>,
    /// Whether the view was wide enough for the side column when last measured.
    pub(crate) side_wide: Option<bool>,
    /// Re-reads attached open files from their editors while any is attached.
    pub(crate) tab_watch: Option<crate::session_input::TabWatch>,
    /// When the session was last drawn in a focused window, for system notifications.
    pub(crate) seen_at: Option<web_time::Instant>,
    /// Whether the editor follows where the agent works.
    pub(crate) following: bool,
    follow_last: Option<crate::thread::Location>,
    follow_at: Option<web_time::Instant>,
    follow_pending: Option<Task<()>>,
    pub(crate) dev_servers: crate::dev_servers::DevServerWatch,
    /// MCP servers the agent left out because it cannot use their transport.
    pub(crate) skipped_mcp: Vec<String>,
    /// Queued prompts wait for the connection to come back; this checks for it.
    offline_hold: Option<Task<()>>,
    /// The prompt whose turn failed because the connection dropped, to send again.
    pub(crate) offline_prompt: Option<String>,
    /// Turn errors that came while the computer was offline (`isBrowserOffline` at failure),
    /// by entry index and text: they read "Offline" rather than a connection failure.
    pub(crate) offline_errors: HashSet<(usize, String)>,
    /// Why the agent process went away on its own, until it runs again.
    pub(crate) agent_disconnected: Option<String>,
    /// The session was taken over from the agent and its history has not arrived yet
    /// (`session/load` replays it). Until it does, the view says so rather than offering the
    /// blank "Where should we begin?" of a new chat.
    pub(crate) replaying: bool,
    /// The draft went to another window with the session; closing this view leaves it alone.
    draft_handed_off: bool,
    pub(crate) dismissed_notices: HashSet<String>,
    /// The composer notice's action is under way (`actionPending`).
    pub(crate) notice_action_pending: bool,
    /// The repositories a cloud session could run in, for its composer notice.
    pub(crate) cloud_targets: crate::cloud::composer_notice::CloudTargets,
    /// Edit calls' files as they were when the calls started, by call id (`edit-diff-capture.ts`).
    pub(crate) edit_snapshots: HashMap<String, Option<crate::edit_capture::EditSnapshot>>,
    /// Edit calls already diffed or given up on.
    pub(crate) edit_captured: HashSet<String>,
    /// The agent asked for sign-in: its methods and program, until one is picked.
    pub(crate) auth_choices: Option<(Vec<AuthChoice>, String)>,
    /// The method being signed in with while the agent starts again (`phase: "signing_in"`).
    pub(crate) auth_signing_in: Option<String>,
    /// Why the last sign-in failed, shown under the methods.
    pub(crate) auth_error: Option<String>,
    /// A terminal sign-in being waited on (`phase: "terminal"`): the method, and the wait for its
    /// command to exit. Dropping it stops waiting.
    pub(crate) auth_terminal: Option<(String, Task<()>)>,
    /// The Add context menu's Project files or Folders list, when open.
    /// Context being read before it attaches; it counts as attached (checked) meanwhile.
    pub(crate) pending_context: Vec<crate::context_refs::ContextRef>,
    pub(crate) message_search: Option<crate::message_search::MessageSearch>,
    /// The sent prompt being edited: sending replaces it and everything after it.
    pub(crate) editing_prompt: Option<usize>,
    /// The edited prompt the composer's own send is replacing, set just before it goes out: only
    /// that send rewrites history, not a queued prompt, Continue or a retry sent meanwhile.
    submitting_edit: Option<usize>,
    /// The method picked, tried when the agent next asks.
    pub(crate) preferred_auth: Option<String>,
    /// The workspace's other folders, which the agent's session covers too.
    workspace_folders: Vec<PathBuf>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<SessionViewEvent> for SessionView {}

impl Focusable for SessionView {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.composer.focus_handle(cx)
    }
}

/// `ATHAS_AGENT_FIXTURE=/path/to/transcript.json` shows that transcript in every session view
/// instead of the saved one, and saves nothing: for screenshots. Besides the transcript fields
/// the file may set `"running": true` and a `"permission"` (an ACP `session/request_permission`
/// request's params) or an `"elicitation"` (`elicitation/create` params) to show a turn in
/// progress, and the composer's state: `"agent"`,
/// `"composer"` (its text), `"attachments"` and `"queue"`; `"pinPrompt"` pins an entry to the top
/// of the list, as sending a prompt does, so the scroll anchor can be drawn.
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct Fixture {
    #[serde(flatten)]
    transcript: Transcript,
    running: bool,
    permission: Option<schema::RequestPermissionRequest>,
    elicitation: Option<serde_json::Value>,
    agent: Option<String>,
    composer: Option<String>,
    attachments: Vec<FixtureAttachment>,
    queue: Vec<String>,
    /// Sign-in methods the agent asked the user to pick from.
    #[serde(rename = "signIn")]
    sign_in: Vec<String>,
    /// Open the message search with this query.
    search: Option<String>,
    /// Project files mentioned in the composer, as chips after its text.
    mentions: Vec<String>,
    /// The pull request of the session's branch, instead of asking GitHub.
    #[serde(rename = "pullRequest")]
    pull_request: Option<FixturePullRequest>,
    /// Open the first group of attachments.
    #[serde(rename = "openAttachments")]
    open_attachments: bool,
    /// Pin this entry to the top of the list, as sending a prompt does.
    #[serde(rename = "pinPrompt")]
    pin_prompt: Option<usize>,
    /// The running turn has waited this long for the agent's first answer.
    #[serde(rename = "waitingSeconds")]
    waiting_seconds: Option<u64>,
    /// The cloud run the session sent last, instead of asking the service.
    #[serde(rename = "cloudRun")]
    cloud_run: Option<crate::cloud::CloudRun>,
    /// The session is being taken over from the agent and its history has not arrived yet.
    #[serde(default)]
    replaying: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixturePullRequest {
    number: i64,
    title: String,
    head_ref: String,
    state: String,
    #[serde(default)]
    draft: bool,
}

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum FixtureAttachment {
    File { path: PathBuf },
    Session { title: String },
    /// `data`: the PNG's base64, for its thumbnail.
    Image {
        name: String,
        #[serde(default)]
        data: String,
    },
    Skill { title: String },
    Folder { path: PathBuf },
    GitDiff { staged: bool },
    Problems,
    Tab { title: String, path: Option<PathBuf>, kind: Option<String>, id: Option<String> },
}

/// Every session view alive, for [`SessionView::any_busy`].
#[derive(Default)]
struct LiveSessions(Vec<gpui::WeakEntity<SessionView>>);

impl gpui::Global for LiveSessions {}

impl SessionView {
    pub fn new(info: SessionInfo, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let weak = cx.entity().downgrade();
        let live = cx.default_global::<LiveSessions>();
        live.0.retain(|session| session.upgrade().is_some());
        live.0.push(weak);
        let composer = cx.new(Composer::new);
        let review_events = crate::review::events(cx);
        let registry = crate::agent_registry::AgentRegistry::global(cx);
        let subscriptions = vec![
            cx.observe(&registry, |this: &mut Self, registry, cx| {
                // An agent that was missing may be installed now: the next prompt starts it.
                if let AgentState::NotInstalled { .. } = this.agent
                    && registry.read(cx).state(acp::agents::catalog_id(&this.info.agent)).is_installed()
                {
                    this.agent = AgentState::Stopped;
                }
                cx.notify();
            }),
            cx.subscribe_in(&composer, window, Self::on_composer_event),
            cx.on_release(|this: &mut Self, cx| {
                if this.draft_handed_off {
                    return;
                }
                let text = this.composer.read(cx).sent_text();
                crate::session_input::store_draft(cx, &this.info.id, crate::session_input::Draft { text, attachments: std::mem::take(&mut this.attachments) });
                this.release_agent_session(cx);
            }),
            cx.subscribe(&review_events, |this: &mut Self, _, event: &crate::review::ReviewEvent, cx| {
                if event.session == this.info.id {
                    // Diffs every file the session changed: off the UI thread, since the agent
                    // writes files in bursts. A newer refresh replaces one still running.
                    let id = this.info.id.clone();
                    this.review_refresh = Some(cx.spawn(async move |this, cx| {
                        let (totals, turns) = cx
                            .background_spawn(async move {
                                (crate::review::totals(&id), crate::review::checkpoints(&id).into_iter().map(|checkpoint| checkpoint.turn).collect::<Vec<_>>())
                            })
                            .await;
                        this.update(cx, |this, cx| {
                            this.review_totals = totals;
                            this.checkpoint_turns = turns;
                            this.review_refresh = None;
                            cx.notify();
                        })
                        .ok();
                    }));
                }
            }),
            cx.observe_window_activation(window, |_, window, cx| {
                if window.is_window_active() {
                    crate::intelligence_sync::window_focused(cx);
                }
            }),
        ];
        let fixture = std::env::var_os("ATHAS_AGENT_FIXTURE")
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<Fixture>(&text).ok());
        let store_dir = if fixture.is_some() { None } else { persistence::sessions_dir() };
        let mut info = info;
        let mut composer_text = None;
        let mut attachments = Vec::new();
        let mut queue = Vec::new();
        let mut elicitation = None;
        let mut sign_in = Vec::new();
        let mut search = None;
        let mut mentions = Vec::new();
        let mut fixture_pull_request = None;
        let mut open_attachments = false;
        let mut pinned_prompt = None;
        let mut waiting_seconds = None;
        let mut fixture_replaying = false;
        let mut fixture_cloud_run = None;
        let (transcript, running, permission) = match fixture {
            Some(fixture) => {
                if let Some(agent) = fixture.agent {
                    info.agent = agent;
                }
                composer_text = fixture.composer;
                attachments = fixture
                    .attachments
                    .into_iter()
                    .map(|attachment| match attachment {
                        FixtureAttachment::File { path } => Attachment::File(path),
                        FixtureAttachment::Session { title } => Attachment::Session { id: String::new(), title },
                        FixtureAttachment::Image { name, data } => Attachment::Image { name, media_type: "image/png".into(), data },
                        FixtureAttachment::Skill { title } => Attachment::Skill { title, content: String::new() },
                        FixtureAttachment::Folder { path } => {
                            let reference = crate::context_refs::ContextRef::Folder(path);
                            Attachment::Context { label: reference.label(None), reference, content: String::new() }
                        }
                        FixtureAttachment::GitDiff { staged } => {
                            let reference = crate::context_refs::ContextRef::GitDiff { staged };
                            Attachment::Context { label: reference.label(None), reference, content: String::new() }
                        }
                        FixtureAttachment::Problems => {
                            let reference = crate::context_refs::ContextRef::Problems;
                            Attachment::Context { label: reference.label(None), reference, content: String::new() }
                        }
                        FixtureAttachment::Tab { title, path, kind, id } => {
                            let reference = crate::context_refs::ContextRef::Tab { title, path, kind, id };
                            Attachment::Context { label: reference.label(None), reference, content: String::new() }
                        }
                    })
                    .collect();
                queue = fixture.queue.into_iter().map(|text| Queued::new(text, Vec::new())).collect();
                elicitation = fixture.elicitation;
                sign_in = fixture.sign_in;
                search = fixture.search;
                open_attachments = fixture.open_attachments;
                pinned_prompt = fixture.pin_prompt;
                mentions = fixture.mentions;
                fixture_pull_request = fixture.pull_request.map(|pull_request| crate::pull_request::BranchPullRequest {
                    number: pull_request.number,
                    title: pull_request.title,
                    head_ref: pull_request.head_ref,
                    state: crate::pull_request::read_state(&pull_request.state, None),
                    draft: pull_request.draft,
                });
                waiting_seconds = fixture.waiting_seconds;
                fixture_cloud_run = fixture.cloud_run;
                fixture_replaying = fixture.replaying;
                (fixture.transcript, fixture.running, fixture.permission)
            }
            None => {
                if let Some(draft) = crate::session_input::take_draft(cx, &info.id) {
                    composer_text = Some(draft.text);
                    attachments = draft.attachments;
                }
                (store_dir.as_ref().and_then(|dir| persistence::load(dir, &info.id)).unwrap_or_default(), false, None)
            }
        };
        let list = ListState::new(transcript.entries.len(), ListAlignment::Top, px(1200.));
        list.set_follow_mode(FollowMode::Tail);
        let mut this = Self {
            info,
            composer,
            transcript,
            list,
            agent: AgentState::Stopped,
            turn: None,
            current_turn: None,
            turn_started_at: None,
            turn_state_label: None,
            waiting_tick: None,
            cancel_grace: None,
            prompt_anchor: None,
            anchor_filled: false,
            anchor_pending: false,
            anchor_room: None,
            review_totals: (0, 0, 0),
            checkpoint_turns: Vec::new(),
            review_refresh: None,
            rules_budget: None,
            tab_watch: None,
            rules_budget_task: None,
            side_boxes: None,
            side_wide: None,
            seen_at: None,
            following: cx.try_global::<settings::SettingsStore>().is_some_and(|_| settings::get(cx).ai_follow_agent),
            follow_last: None,
            follow_at: None,
            follow_pending: None,
            dev_servers: Default::default(),
            skipped_mcp: Vec::new(),
            offline_hold: None,
            offline_prompt: None,
            offline_errors: HashSet::new(),
            agent_disconnected: None,
            replaying: fixture_replaying,
            draft_handed_off: false,
            dismissed_notices: HashSet::new(),
            notice_action_pending: false,
            cloud_targets: Default::default(),
            edit_snapshots: HashMap::new(),
            edit_captured: HashSet::new(),
            auth_choices: None,
            auth_signing_in: None,
            auth_error: None,
            auth_terminal: None,
            pending_context: Vec::new(),
            message_search: None,
            editing_prompt: None,
            submitting_edit: None,
            preferred_auth: None,
            workspace_folders: Vec::new(),
            permissions: VecDeque::new(),
            elicitations: VecDeque::new(),
            user_commands: HashMap::new(),
            user_command_poll: None,
            expanded: HashSet::new(),
            executing_plans: HashSet::new(),
            collapsed: HashSet::new(),
            elapsed_tick: None,
            plan_collapsed: false,
            markdown: RefCell::default(),
            text_selection: None,
            quote_card: None,
            quote_subscription: None,
            drawn_runs: RefCell::default(),
            thumbnails: RefCell::default(),
            cloud_tool_calls: HashMap::new(),
            open_menu: None,
            effort_popover: None,
            completion: None,
            open_attachment_group: if open_attachments { crate::attachment_groups::groups(&attachments).first().map(|group| group.kind) } else { None },
            attachments,
            queue,
            queued_edit: None,
            queue_held_for_edit: false,
            continue_queue: false,
            send_now_at: None,
            input_notice: None,
            project_files: None,
            loading_files: None,
            file_search: None,
            searching_files: None,
            saved_sessions: None,
            shortcuts: Default::default(),
            voice: None,
            loading_sessions: None,
            github_issues: None,
            github_prs: None,
            loading_github: None,
            skills: None,
            loading_skills: None,
            codex_skills: None,
            loading_codex_skills: None,
            codex_models_read: None,
            codex_catalog: crate::codex::catalog_generation(),
            codex_models_error: None,
            refreshing_codex_models: None,
            store_dir,
            save_task: None,
            status: SessionStatus::Idle,
            shown_status: SessionStatus::Idle,
            pull_request: None,
            pull_request_poll: None,
            cloud_poll: None,
            last_cloud_run: None,
            _subscriptions: subscriptions,
        };
        let weak = cx.weak_entity();
        // Deferred: the list calls this while it holds its own state, and `list_scrolled` reads it.
        this.list.set_scroll_handler(move |_, _, cx| {
            let weak = weak.clone();
            cx.defer(move |cx| {
                weak.update(cx, |this, _| this.list_scrolled()).ok();
            });
        });
        this.update_placeholder(cx);
        this.review_totals = crate::review::totals(&this.info.id);
        this.checkpoint_turns = crate::review::checkpoints(&this.info.id).into_iter().map(|checkpoint| checkpoint.turn).collect();
        if let Some(text) = composer_text {
            this.composer.update(cx, |composer, cx| composer.set_text(text, cx));
        }
        for relative in mentions {
            let name = relative.rsplit('/').next().unwrap_or(&relative).to_string();
            this.composer.update(cx, |composer, cx| {
                let end = composer.text().len();
                composer.insert_chip(end..end, &name, crate::composer::ChipTone::Accent, Some(format!("@{relative}")), cx);
            });
        }
        if fixture_cloud_run.is_some() {
            this.last_cloud_run = fixture_cloud_run;
        }
        match fixture_pull_request {
            Some(pull_request) => this.pull_request = Some(pull_request),
            None => this.watch_pull_request(cx),
        }
        if running {
            this.turn = Some(Task::ready(()));
            if let Some(seconds) = waiting_seconds {
                this.current_turn = this.transcript.entries.len().checked_sub(1);
                this.turn_started_at = web_time::Instant::now().checked_sub(Duration::from_secs(seconds));
            }
        }
        if let Some(request) = permission {
            let (respond, _) = oneshot::channel();
            this.on_permission(acp::client::PermissionRequest { tool_call: request.tool_call, options: request.options, respond }, cx);
        }
        if !sign_in.is_empty() {
            let methods = sign_in.into_iter().enumerate().map(|(index, name)| AuthChoice { id: index.to_string(), name, description: None, terminal: None }).collect();
            this.auth_choices = Some((methods, String::new()));
        }
        if let Some(index) = pinned_prompt.filter(|index| *index < this.transcript.entries.len()) {
            this.pin_prompt(index);
        }
        if let Some(query) = search {
            this.toggle_message_search(window, cx);
            if let Some(search) = &this.message_search {
                search.input.update(cx, |input, cx| input.set_text(query.clone(), cx));
            }
            let found = crate::message_search::matches(&this.transcript.entries, &query);
            if let Some(search) = &mut this.message_search {
                search.matches = found;
            }
        }
        if let Some(request) = elicitation {
            let (respond, _) = oneshot::channel();
            this.on_elicitation(acp::client::ElicitationRequest { request, respond }, cx);
        }
        this
    }

    /// The folders added to the session's workspace beside its project; an agent that takes
    /// them gets them as `additionalDirectories` when its session opens.
    pub fn set_workspace_folders(&mut self, folders: Vec<PathBuf>) {
        self.workspace_folders = folders;
    }

    pub fn info(&self) -> &SessionInfo {
        &self.info
    }

    pub fn transcript(&self) -> &Transcript {
        &self.transcript
    }

    /// The cloud run the session started last (its pull request in `pr_url`, its spend through
    /// `cloud::environment::run_spent_micros`), for the dock's folded summary row.
    pub fn last_cloud_run(&self) -> Option<&crate::cloud::CloudRun> {
        self.last_cloud_run.as_ref()
    }

    pub fn is_running(&self) -> bool {
        self.turn.is_some() || self.cloud_poll.is_some()
    }

    /// Whether any session is running a turn or starting its agent (`isAgentBusy`), so a
    /// continuous agent waits instead of starting beside it.
    pub fn any_busy(cx: &App) -> bool {
        cx.try_global::<LiveSessions>().is_some_and(|live| {
            live.0.iter().filter_map(|session| session.upgrade()).any(|session| {
                let session = session.read(cx);
                session.is_running() || matches!(session.agent, AgentState::Starting)
            })
        })
    }

    /// Why the session cannot move to another window now (`getAgentWindowTransferBlocker`).
    pub fn transfer_blocker(&self) -> Option<&'static str> {
        (self.is_running() || matches!(self.agent, AgentState::Starting) || !self.queue.is_empty())
            .then_some("Wait for this agent to finish, or stop it, before opening it in another window.")
    }

    /// Hands the composer's text and attachments to the session's next view, in another window.
    pub fn hand_off_draft(&mut self, cx: &mut Context<Self>) {
        let text = self.composer.read(cx).sent_text();
        crate::session_input::store_draft(cx, &self.info.id, crate::session_input::Draft { text, attachments: self.attachments.clone() });
        self.draft_handed_off = true;
    }

    /// Stops the agent process and starts it again on the same session (`restartAgent`).
    /// The session was deleted: the agent is asked to close it (`session/close`) and keeps serving
    /// its other sessions.
    pub fn close_agent_session(&mut self, cx: &mut Context<Self>) {
        let AgentState::Ready(agent) = &self.agent else { return };
        let timeout = cx.background_executor().timer(SESSION_CLOSE_TIMEOUT);
        if let Some(close) = agent.connection.close_session(&agent.session_id, Box::pin(async move { timeout.await; })) {
            cx.spawn(async move |_, _| close.await).detach();
        }
    }

    /// The session's tab closed (`useAgentTabSessionRelease`): an idle session the agent can bring
    /// back (`session/close` with `session/load` or `session/resume`) is closed, so a shared
    /// agent does not keep it; reopening the chat loads it again. A busy one, or one waiting
    /// on the user, stays.
    fn release_agent_session(&self, cx: &mut App) {
        let AgentState::Ready(agent) = &self.agent else { return };
        if self.is_running() || !self.permissions.is_empty() || !self.elicitations.is_empty() || !self.queue.is_empty() {
            return;
        }
        let connection = &agent.connection;
        let reattach = connection.agent_capabilities().is_some_and(|capabilities| capabilities.load_session) || connection.supports_session_capability("resume");
        if !reattach {
            return;
        }
        let timeout = cx.background_executor().timer(SESSION_CLOSE_TIMEOUT);
        if let Some(close) = connection.close_session(&agent.session_id, Box::pin(async move { timeout.await; })) {
            cx.foreground_executor().spawn(close).detach();
        }
    }

    /// Restarts the agent (`restartAgent`): the process this session shares is stopped for every
    /// session on it, this one starts it again with a new session, and the others join the new
    /// process with their next prompt, loading their own sessions.
    pub fn restart_agent(&mut self, cx: &mut Context<Self>) {
        self.restart_shared_agent(true, cx);
    }

    /// The restart itself; `new_session` drops this session's agent session id as the session's
    /// Restart does, while the inspector's process restart keeps it (`restartAgentProcess`).
    fn restart_shared_agent(&mut self, new_session: bool, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        if let AgentState::Ready(agent) = &self.agent
            && let Some(shared) = &agent.shared
        {
            let key = shared.key.clone();
            cx.default_global::<SharedAgents>().0.remove(&key);
            let me = cx.entity_id();
            let others: Vec<Entity<SessionView>> = cx
                .try_global::<LiveSessions>()
                .map(|live| live.0.iter().filter_map(|session| session.upgrade()).filter(|session| session.entity_id() != me).collect())
                .unwrap_or_default();
            for other in others {
                let on_it = matches!(&other.read(cx).agent, AgentState::Ready(agent) if agent.shared.as_ref().is_some_and(|shared| shared.key == key));
                if on_it {
                    other.update(cx, |this, cx| {
                        this.drop_agent_for_sign_in(cx);
                        let notice = this.transcript.push_notice(NoticeKind::Info, format!("Restarted {}", this.agent_name()));
                        this.entries_added(notice, cx);
                        cx.notify();
                    });
                }
            }
        }
        self.stop(cx);
        if self.turn.take().is_some() {
            self.finish_turn(None, cx);
        }
        self.agent_disconnected = None;
        self.agent = AgentState::Stopped;
        // A new agent session, as `setChatAcpSessionId(chatId, null)`: the old one may be what broke.
        if new_session {
            self.transcript.agent_session_id = None;
        }
        let index = self.transcript.push_notice(NoticeKind::Info, format!("Restarted {}", self.agent_name()));
        self.entries_added(index, cx);
        if !builtin::is_builtin(&self.info.agent) {
            self.warm_up(cx);
        }
        cx.notify();
    }

    /// Restarts the agent process `agent_id` (its catalog id) runs in `workspace`, as the ACP
    /// inspector's Restart agent does (`restartAgentProcess`): every session on it lets go, the
    /// first starts a new process and the others join it with their next prompt. How many
    /// sessions used it; none means there was nothing to restart.
    pub fn restart_agent_process(agent_id: &str, workspace: Option<&str>, cx: &mut App) -> usize {
        #[cfg(target_family = "wasm")]
        {
            let _ = (agent_id, workspace, cx);
            0
        }
        #[cfg(not(target_family = "wasm"))]
        {
            let sessions: Vec<Entity<SessionView>> = cx
                .try_global::<LiveSessions>()
                .map(|live| live.0.iter().filter_map(|session| session.upgrade()).collect())
                .unwrap_or_default();
            let sessions: Vec<Entity<SessionView>> = sessions
                .into_iter()
                .filter(|session| match &session.read(cx).agent {
                    AgentState::Ready(agent) => agent.shared.as_ref().is_some_and(|shared| {
                        acp::agents::catalog_id(&shared.key.0) == agent_id && workspace.is_none_or(|workspace| shared.key.1.to_string_lossy() == workspace)
                    }),
                    _ => false,
                })
                .collect();
            // The first restarts the shared process, which lets the others go.
            if let Some(first) = sessions.first() {
                first.update(cx, |this, cx| this.restart_shared_agent(false, cx));
            }
            sessions.len()
        }
    }

    /// Lets go of the running agent so the next start signs in afresh (a terminal sign-in
    /// happened outside its connection), without a Restarted notice.
    pub(crate) fn drop_agent_for_sign_in(&mut self, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        if let AgentState::Ready(agent) = &self.agent
            && let Some(shared) = &agent.shared
        {
            cx.default_global::<SharedAgents>().0.remove(&shared.key);
        }
        if matches!(self.agent, AgentState::Ready(_)) {
            self.stop(cx);
            if self.turn.take().is_some() {
                self.finish_turn(None, cx);
            }
            self.agent = AgentState::Stopped;
        }
    }

    /// Starts the agent after a sign-in; true once it runs (the built-in agent starts with its
    /// next prompt).
    pub(crate) async fn start_for_sign_in(this: &WeakEntity<Self>, cx: &mut AsyncApp) -> bool {
        let builtin = this.read_with(cx, |this, _| builtin::is_builtin(&this.info.agent)).unwrap_or(false);
        builtin || Self::ensure_agent(this, cx).await.is_some()
    }

    /// Starts the agent and opens its session before the first prompt, so it is ready (and an
    /// imported session's history shows) without waiting for a message.
    pub fn warm_up(&mut self, cx: &mut Context<Self>) {
        if !matches!(self.agent, AgentState::Stopped) || builtin::is_builtin(&self.info.agent) {
            return;
        }
        cx.spawn(async move |this, cx| {
            Self::ensure_agent(&this, cx).await;
        })
        .detach();
    }

    /// The running agent's connection for a catalog read, starting the agent when it is stopped
    /// and waiting while it starts (`startCodexComposer`); the caller bounds the wait. The flag
    /// says the session opened during the wait, so its catalog is fresh.
    pub(crate) async fn agent_connection(this: &WeakEntity<Self>, cx: &mut AsyncApp) -> Result<(Arc<AgentConnection>, bool), String> {
        let mut started = false;
        loop {
            let step = this
                .update(cx, |this, cx| match &this.agent {
                    AgentState::Ready(agent) if !agent.connection.is_closed() => Some(Ok(agent.connection.clone())),
                    AgentState::Starting => None,
                    AgentState::NotInstalled { name, hint } => Some(Err(format!("{name} is not installed. {hint}"))),
                    _ if started => Some(Err(format!("{} could not start.", this.agent_name()))),
                    _ => {
                        cx.spawn(async move |this, cx| {
                            Self::ensure_agent(&this, cx).await;
                        })
                        .detach();
                        None
                    }
                })
                .map_err(|_| "The session closed".to_string())?;
            match step {
                Some(result) => return result.map(|connection| (connection, started)),
                None => {
                    started = true;
                    cx.background_executor().timer(std::time::Duration::from_millis(50)).await;
                }
            }
        }
    }

    /// Takes over one of the agent's own sessions: the agent loads it and replays its history.
    pub fn import_agent_session(&mut self, session_id: String, cx: &mut Context<Self>) {
        if !self.transcript.entries.is_empty() {
            return;
        }
        self.transcript.agent_session_id = Some(session_id);
        // The agent replays the conversation as it loads it; until the first entry arrives the
        // view would otherwise read as a new chat. The built-in agent has no session of its own
        // to replay, so it never waits.
        self.replaying = !builtin::is_builtin(&self.info.agent);
        self.schedule_save(cx);
        self.warm_up(cx);
        cx.notify();
    }

    /// Puts a sent prompt back in the composer; sending it replaces that turn and what followed.
    pub(crate) fn edit_prompt(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Entry::User(message)) = self.transcript.entries.get(index) else { return };
        let text = message.text.clone();
        self.editing_prompt = Some(index);
        self.input_notice = Some("Editing a sent prompt: sending it replaces that turn and the replies after it.".into());
        self.composer.update(cx, |composer, cx| {
            composer.set_text(text, cx);
            composer.focus(window, cx);
        });
        cx.notify();
    }

    /// Drops the edited prompt's turn and everything after it, before the edit goes out.
    fn take_edited_turn(&mut self) {
        let Some(index) = self.submitting_edit.take() else { return };
        if index < self.transcript.entries.len() && !self.is_running() {
            self.transcript.entries.truncate(index);
            self.markdown.borrow_mut().retain(|entry, _| *entry < index);
            self.drawn_runs.borrow_mut().retain(|entry, _| *entry < index);
            self.text_selection = None;
            self.cloud_tool_calls.retain(|entry, _| *entry < index);
            self.executing_plans.retain(|entry| *entry < index);
            self.expanded.clear();
            self.list.reset(self.transcript.entries.len());
            // Checkpoints are named by their prompt's index: the dropped turns' fold into the
            // edited one, so a new turn landing on an old index finds none of theirs.
            crate::review::rewind(&self.info.id, index);
            self.checkpoint_turns = crate::review::checkpoints(&self.info.id).into_iter().map(|checkpoint| checkpoint.turn).collect();
        }
    }

    /// Files with unreviewed agent changes.
    pub fn review_files(&self) -> usize {
        self.review_totals.0
    }

    /// What the dock's boxes show about the session.
    pub fn summary(&self) -> crate::summary::SessionSummary {
        let mut summary = crate::summary::summarize(&self.transcript, self.info.cwd.as_deref(), self.agent_name(), self.is_running());
        summary.servers = self.dev_servers.live.iter().cloned().collect();
        summary
    }

    pub(crate) fn agent_name(&self) -> String {
        if builtin::is_builtin(&self.info.agent) {
            return builtin::NAME.to_string();
        }
        if crate::codex::is_codex(&self.info.agent) {
            return crate::codex::NAME.to_string();
        }
        acp::agents::display_name(&self.info.agent)
    }

    pub(crate) fn update_placeholder(&mut self, cx: &mut Context<Self>) {
        let placeholder = if self.transcript.cloud.is_some() { "Describe a task for the cloud agent" } else { "Ask anything, @ to add context" };
        self.composer.update(cx, |composer, cx| composer.set_placeholder(placeholder, cx));
    }

    fn on_composer_event(&mut self, _: &Entity<Composer>, event: &ComposerEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            ComposerEvent::Submit if self.composer.read(cx).text().trim().is_empty() && self.answer_permission_shortcut(schema::PermissionOptionKind::AllowOnce, cx) => {}
            ComposerEvent::Submit => self.submit(window, cx),
            ComposerEvent::SubmitNow if self.composer.read(cx).text().trim().is_empty() && self.answer_permission_shortcut(schema::PermissionOptionKind::AllowAlways, cx) => {}
            ComposerEvent::SubmitNow => self.submit_now(window, cx),
            ComposerEvent::CycleMode => self.cycle_mode(cx),
            ComposerEvent::Cancel if self.answer_permission_shortcut(schema::PermissionOptionKind::RejectOnce, cx) => {}
            ComposerEvent::Cancel if crate::user_command::composer_command(self.composer.read(cx).text()).is_some() => self.leave_terminal_mode(window, cx),
            ComposerEvent::Cancel if self.editing_prompt.is_some() => {
                self.cancel_prompt_edit(cx);
                self.composer.update(cx, |composer, cx| composer.take_text(cx));
            }
            ComposerEvent::Cancel => {
                if self.is_running() {
                    self.stop(cx);
                }
            }
            ComposerEvent::Changed => {
                // Emptying the composer drops the edit too.
                if self.editing_prompt.is_some() && self.composer.read(cx).text().trim().is_empty() {
                    self.cancel_prompt_edit(cx);
                }
                self.update_completion(cx)
            }
            ComposerEvent::Menu(key) => self.completion_key(*key, cx),
            ComposerEvent::PastedImage(image) => self.attach_image(image.clone(), cx),
            ComposerEvent::PastedPaths(paths) => self.attach_paths(paths.clone(), cx),
        }
    }

    /// Esc or Back to chat in terminal mode: the `!` goes and the rest stays as a prompt.
    pub(crate) fn leave_terminal_mode(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let text = self.composer.read(cx).text().trim_start().strip_prefix('!').unwrap_or_default().to_string();
        self.composer.update(cx, |composer, cx| {
            composer.set_text(text, cx);
            composer.focus(window, cx);
        });
    }

    /// Cmd-Enter (`handleInterruptAndSend`): while a turn runs, what the composer holds goes first
    /// in the queue and the turn stops so it starts at once; otherwise a plain send.
    pub(crate) fn submit_now(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let typed = !self.composer.read(cx).sent_text().trim().is_empty() || !self.attachments.is_empty();
        let queued = self.queue.len();
        self.submit(window, cx);
        if typed && self.is_running() && self.queue.len() > queued {
            self.send_queued_now(self.queue.len() - 1, cx);
        }
    }

    /// Sends what the composer holds, or queues it while a turn runs. With nothing typed, Enter
    /// sends the next queued prompt.
    pub(crate) fn submit(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let text = self.composer.read(cx).sent_text().trim().to_string();
        if text.is_empty() && self.attachments.is_empty() {
            if !self.is_running() && !self.queue.is_empty() {
                let next = self.queue.remove(0);
                self.send_queued(next, cx);
            }
            return;
        }
        if let Some(command) = crate::user_command::composer_command(&text) {
            if command.is_empty() {
                self.input_notice = Some("Enter a command first.".into());
                cx.notify();
                return;
            }
            if !crate::render::terminal_enabled(cx) {
                return;
            }
            let command = command.to_string();
            self.composer.update(cx, |composer, cx| composer.take_text(cx));
            self.input_notice = None;
            self.run_user_command(command, cx);
            return;
        }
        let mut text = text;
        if let Some((intent, prompt)) = crate::composer_modes::parse_leading_mode_command(&text, &self.transcript) {
            self.run_composer_action(crate::session_input::ComposerAction::Mode(intent), cx);
            if prompt.is_empty() && self.attachments.is_empty() {
                self.composer.update(cx, |composer, cx| composer.take_text(cx));
                return;
            }
            text = prompt;
        }
        // The built-in agent with no key for its provider sends nothing; the notice above the
        // composer says why (`isInputEnabled`).
        if self.transcript.cloud.is_none() && self.provider_blocked(cx) {
            return;
        }
        if self.transcript.cloud.is_some() && !self.is_running() {
            match self.send_to_cloud(text, cx) {
                Ok(()) => {
                    self.composer.update(cx, |composer, cx| composer.take_text(cx));
                    self.attachments.clear();
                    self.input_notice = None;
                }
                Err(blocker) => self.input_notice = Some(blocker.into()),
            }
            cx.notify();
            return;
        }
        self.composer.update(cx, |composer, cx| composer.take_text(cx));
        self.refresh_tab_attachments(cx);
        let attachments = std::mem::take(&mut self.attachments);
        self.tab_watch = None;
        self.input_notice = None;
        if self.is_running() {
            self.queue.push(Queued::new(text, attachments));
            if onboarding::contextual_tips::claim_contextual_tip(onboarding::contextual_tips::ContextualTip::AgentQueueControls) {
                let description = "It sends when this turn ends. Edit, reorder, or send it now from the queue above.";
                notifications::notify(cx, notifications::NotificationKind::Info, notifications::NotificationCategory::Agent, "Message queued", Some(description.into()), None);
            }
            cx.notify();
            return;
        }
        if !builtin::is_builtin(&self.info.agent)
            && attachments.is_empty()
            && let Some(command) = crate::user_command::direct_terminal_intent(&text)
        {
            let index = self.transcript.push_user(text, Vec::new());
            self.entries_added(index, cx);
            self.pin_prompt(index);
            workbench_api::run_in_terminal(cx, command.clone(), self.info.cwd.clone());
            self.transcript.entries.push(Entry::Agent(crate::thread::AgentMessage { message_id: None, text: format!("Opened terminal and ran `{command}`."), ..Default::default() }));
            self.entries_added(self.transcript.entries.len() - 1, cx);
            self.save_now();
            cx.notify();
            return;
        }
        if self.is_offline(cx) {
            self.queue.push(Queued::new(text, attachments));
            self.hold_queue_offline(cx);
            let description = "The message is queued and sends when the connection is back.";
            notifications::notify(cx, notifications::NotificationKind::Info, notifications::NotificationCategory::Agent, "You're offline", Some(description.into()), None);
            cx.notify();
            return;
        }
        self.submitting_edit = self.editing_prompt.take();
        self.send_with(text, attachments, cx);
    }

    /// Leaves an edit of a sent prompt without sending it: the turn stays as it was.
    fn cancel_prompt_edit(&mut self, cx: &mut Context<Self>) -> bool {
        if self.editing_prompt.take().is_none() {
            return false;
        }
        self.input_notice = None;
        cx.notify();
        true
    }

    /// The computer has no connection and the session's agent needs one (`isBrowserOffline`); a
    /// local Ollama model does not.
    fn is_offline(&self, cx: &App) -> bool {
        if self.store_dir.is_none() {
            return false;
        }
        if builtin::is_builtin(&self.info.agent) && cx.try_global::<settings::SettingsStore>().is_some() {
            let provider = builtin::session_provider(crate::intelligence::task_provider(settings::get(cx), "agent"), &self.transcript);
            if provider.provider_id == "ollama" {
                return false;
            }
        }
        !crate::connectivity::is_online()
    }

    /// Holds the queue until the connection is back, then sends its next prompt.
    fn hold_queue_offline(&mut self, cx: &mut Context<Self>) {
        if self.offline_hold.is_some() {
            return;
        }
        self.offline_hold = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(crate::connectivity::RECHECK).await;
                if cx.background_spawn(async { crate::connectivity::is_online() }).await {
                    break;
                }
            }
            this.update(cx, |this, cx| {
                this.offline_hold = None;
                if !this.is_running() && !this.queue.is_empty() && !this.queue_holds_for_edit() {
                    let next = this.queue.remove(0);
                    this.send_queued(next, cx);
                }
                cx.notify();
            })
            .ok();
        }));
    }

    pub(crate) fn send_queued(&mut self, queued: Queued, cx: &mut Context<Self>) {
        self.send_with(queued.text, queued.attachments, cx);
    }

    /// Adds the prompt to the transcript and runs a turn with it, starting the agent first when
    /// it is not running.
    /// Sends the prompt of the turn that failed at `index` again.
    pub(crate) fn retry_turn_before(&mut self, index: usize, cx: &mut Context<Self>) {
        let prompt = self.transcript.entries[..index.min(self.transcript.entries.len())].iter().rev().find_map(|entry| match entry {
            Entry::User(message) => Some(message.clone()),
            _ => None,
        });
        if let Some(prompt) = prompt {
            self.offline_prompt = None;
            if self.transcript.cloud.is_some() {
                self.send(prompt.text, cx);
                return;
            }
            // The images go again too: the retried turn is the one that failed, not its text alone.
            let images = prompt
                .images
                .iter()
                .enumerate()
                .map(|(position, image)| {
                    let extension = image.media_type.rsplit('/').next().unwrap_or("png");
                    Attachment::Image { name: format!("Pasted image {}.{extension}", position + 1), media_type: image.media_type.clone(), data: image.data.clone() }
                })
                .collect();
            self.send_with(prompt.text, images, cx);
        }
    }

    pub fn send(&mut self, text: String, cx: &mut Context<Self>) {
        if self.transcript.cloud.is_some() {
            if let Err(blocker) = self.send_to_cloud(text, cx) {
                self.input_notice = Some(blocker.into());
                cx.notify();
            }
            return;
        }
        self.send_with(text, Vec::new(), cx);
    }

    fn send_with(&mut self, text: String, attachments: Vec<Attachment>, cx: &mut Context<Self>) {
        if builtin::is_builtin(&self.info.agent) && attachments.is_empty() {
            match text.trim() {
                "/compact" => return self.compact(cx),
                "/clear" => return self.clear(cx),
                _ => {}
            }
        }
        self.take_edited_turn();
        let first = self.transcript.first_prompt().is_none();
        let shown: Vec<PathBuf> = attachments
            .iter()
            .map(|attachment| match attachment {
                Attachment::File(path) => path.clone(),
                Attachment::Session { title, .. } => PathBuf::from(format!("@{title}")),
                Attachment::Image { name, .. } => PathBuf::from(name),
                Attachment::Skill { title, .. } => PathBuf::from(format!("/{}", crate::skills::command_name(title))),
                Attachment::Context { reference, .. } => PathBuf::from(format!("@{}", reference.describe(None).0)),
            })
            .collect();
        let index = self.transcript.push_user(text.clone(), shown);
        if let Some(Entry::User(message)) = self.transcript.entries.get_mut(index) {
            message.images = attachments
                .iter()
                .filter_map(|attachment| match attachment {
                    Attachment::Image { media_type, data, .. } if !data.is_empty() => Some(crate::thread::MessageImage { media_type: media_type.clone(), data: data.clone() }),
                    _ => None,
                })
                .collect();
            message.issues = attachments
                .iter()
                .filter_map(|attachment| match attachment {
                    Attachment::Context { reference: crate::context_refs::ContextRef::Tab { kind: Some(kind), id: Some(id), title, .. }, .. } if kind == "github-issue" => {
                        Some((id.parse().ok()?, title.clone()))
                    }
                    _ => None,
                })
                .collect();
        }
        self.current_turn = Some(index);
        self.turn_started_at = Some(web_time::Instant::now());
        self.turn_state_label = None;
        self.cancel_grace = None;
        self.entries_added(index, cx);
        self.pin_prompt(index);
        if first && let Some(title) = title::title_from_prompt(&text) {
            self.set_title(title.clone(), cx);
            let chat_provider = (builtin::is_builtin(&self.info.agent) && cx.try_global::<settings::SettingsStore>().is_some())
                .then(|| builtin::session_provider(crate::intelligence::task_provider(settings::get(cx), "agent"), &self.transcript));
            if let Some(task) = title::generate_chat_title(text.clone(), chat_provider, cx) {
                cx.spawn(async move |this, cx| {
                    let Some(generated) = task.await else { return };
                    this.update(cx, |this, cx| {
                        if this.info.title == title && this.transcript.agent_title.is_none() {
                            this.set_title(generated, cx);
                            this.schedule_save(cx);
                        }
                    })
                    .ok();
                })
                .detach();
            }
        }
        self.update_placeholder(cx);
        self.set_status(SessionStatus::Running, cx);
        self.schedule_save(cx);

        let active_file = workbench_api::active_file(cx);
        let active_line = workbench_api::describe_active_file(cx);
        let active_tab = workbench_api::active_tab(cx).filter(|tab| tab.path.is_some());
        let context_files = attached_editor_files(&attachments);
        let info = self.info.clone();
        self.turn = Some(cx.spawn(async move |this, cx| {
            let agent = match Self::ensure_agent(&this, cx).await {
                Some(agent) => agent,
                None => {
                    this.update(cx, |this, cx| this.finish_turn(None, cx)).ok();
                    return;
                }
            };
            let support = agent
                .connection
                .agent_capabilities()
                .map(|capabilities| PromptSupport {
                    images: capabilities.prompt_capabilities.image,
                    embedded_context: capabilities.prompt_capabilities.embedded_context,
                })
                .unwrap_or_default();
            let project = info.cwd.clone();
            let team = cx.background_spawn(async move { project.and_then(|project| crate::team_context::instructions(&project)) }).await;
            let (preamble, meta) = prompt_context(&info, active_file.as_deref(), active_line.as_deref(), active_tab.as_ref(), &context_files, team.as_deref());
            // Agent slash commands must stay the first token of the prompt.
            let text = match preamble {
                _ if text.trim_start().starts_with('/') => text,
                Some(preamble) => format!("{preamble}\n\n{}\n\n{text}", crate::follow_ups::instruction()),
                None => format!("{}\n\n{text}", crate::follow_ups::instruction()),
            };
            let (prompt, notes) = cx.background_spawn(async move { prompt_blocks(&text, &attachments, support) }).await;
            if !notes.is_empty() {
                this.update(cx, |this, cx| {
                    for note in notes {
                        let index = this.transcript.push_notice(NoticeKind::Info, note);
                        this.entries_added(index, cx);
                    }
                })
                .ok();
            }
            let result = agent.connection.prompt_with_meta(&agent.session_id, prompt, meta).await;
            this.update(cx, |this, cx| this.finish_turn(Some(result), cx)).ok();
        }));
        cx.notify();
    }

    /// Summarises the earlier turns of an Athas Agent session; the agent starts again with the
    /// shorter history on the next prompt.
    pub fn compact(&mut self, cx: &mut Context<Self>) {
        let notice = match crate::compaction::compact(&self.transcript.entries) {
            Some((entries, count)) => {
                self.replace_entries(entries);
                format!("Summarised {count} earlier messages to free up context")
            }
            None => "Nothing earlier to summarise yet".to_string(),
        };
        let index = self.transcript.push_notice(NoticeKind::Info, notice);
        self.entries_added(index, cx);
        self.schedule_save(cx);
        cx.notify();
    }

    /// Empties an Athas Agent session. Unreviewed agent changes have to be kept or discarded first.
    pub fn clear(&mut self, cx: &mut Context<Self>) {
        if self.review_totals.0 > 0 {
            let index = self.transcript.push_notice(NoticeKind::Info, "Keep or discard the agent's changes in the review before clearing");
            self.entries_added(index, cx);
            cx.notify();
            return;
        }
        self.replace_entries(Vec::new());
        self.transcript.plan.clear();
        self.transcript.usage = None;
        self.update_placeholder(cx);
        self.schedule_save(cx);
        cx.notify();
    }

    fn replace_entries(&mut self, entries: Vec<Entry>) {
        let old = self.transcript.entries.len();
        self.prompt_anchor = None;
        self.transcript.entries = entries;
        self.list.splice(0..old, self.transcript.entries.len());
        self.markdown.borrow_mut().clear();
        self.cloud_tool_calls.clear();
        self.executing_plans.clear();
        self.expanded.clear();
        // The built-in agent holds the history it started with; the next prompt starts it again.
        self.agent = AgentState::Stopped;
    }

    /// Runs `command` in the session's folder and streams its output into the transcript; the
    /// agent does not see it.
    fn run_user_command(&mut self, command: String, cx: &mut Context<Self>) {
        let cwd = session_cwd(&self.info);
        let started = crate::user_command::UserCommand::start(&command, &cwd);
        let command_handle = match started {
            Ok(handle) => handle,
            Err(error) => {
                let index = self.transcript.push_notice(NoticeKind::Error, error);
                self.entries_added(index, cx);
                cx.notify();
                return;
            }
        };
        if self.transcript.entries.is_empty() {
            self.set_title(command.lines().next().unwrap_or_default().chars().take(80).collect(), cx);
        }
        let id = format!("{USER_COMMAND_PREFIX}{}", workspace::now_ms());
        let call = crate::thread::ToolCall {
            id: id.clone(),
            title: format!("$ {command}"),
            kind: crate::thread::ToolKind::Execute,
            status: ToolStatus::InProgress,
            raw_input: Some(serde_json::json!({ "command": command, "workingDirectory": cwd })),
            terminal_output: Some(String::new()),
            started_at: Some(crate::thread::now_ms()),
            ..Default::default()
        };
        self.transcript.entries.push(Entry::ToolCall(call));
        let index = self.transcript.entries.len() - 1;
        self.expanded.insert(id.clone());
        self.entries_added(index, cx);
        self.pin_prompt(index);
        self.user_commands.insert(id, Rc::new(command_handle));
        if self.user_command_poll.is_none() {
            self.user_command_poll = Some(cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor().timer(Duration::from_millis(100)).await;
                    let more = this.update(cx, |this, cx| this.poll_user_commands(cx)).unwrap_or(false);
                    if !more {
                        break;
                    }
                }
            }));
        }
        self.schedule_save(cx);
        cx.notify();
    }

    /// Copies the commands' output into their transcript entries; false once none runs.
    fn poll_user_commands(&mut self, cx: &mut Context<Self>) -> bool {
        self.schedule_dev_server_scan(cx);
        let mut finished = Vec::new();
        let commands: Vec<(String, Rc<crate::user_command::UserCommand>)> = self.user_commands.iter().map(|(id, command)| (id.clone(), command.clone())).collect();
        for (id, command) in &commands {
            command.tick();
            let (output, exit) = command.snapshot();
            let Some(index) = self.transcript.tool_call(id).map(|(index, _)| index) else {
                finished.push(id.clone());
                continue;
            };
            if let Some(Entry::ToolCall(call)) = self.transcript.entries.get_mut(index) {
                call.terminal_output = Some(output);
                if let Some(code) = exit {
                    call.exit_code = code.map(i64::from);
                    call.timed_out = command.timed_out();
                    call.set_status(match code {
                        _ if call.timed_out => ToolStatus::Failed,
                        _ if command.was_stopped() => ToolStatus::Canceled,
                        Some(0) => ToolStatus::Completed,
                        Some(_) => ToolStatus::Failed,
                        None => ToolStatus::Canceled,
                    });
                    finished.push(id.clone());
                }
            }
            self.entry_changed(index);
        }
        for id in finished {
            self.user_commands.remove(&id);
            self.schedule_save(cx);
        }
        cx.notify();
        if self.user_commands.is_empty() {
            self.user_command_poll = None;
            return false;
        }
        true
    }

    /// Stops one `!` command from its row (`stopChatTerminalCommand`).
    pub(crate) fn stop_user_command(&mut self, id: &str, cx: &mut Context<Self>) {
        if let Some(command) = self.user_commands.get(id) {
            command.stop();
            cx.notify();
        }
    }

    /// Whether a `!` command from the composer still runs.
    pub(crate) fn user_command_running(&self) -> bool {
        !self.user_commands.is_empty()
    }

    /// Stops the turn: the agent is told to cancel, and questions it asked are withdrawn.
    pub fn stop(&mut self, cx: &mut Context<Self>) {
        for command in self.user_commands.values() {
            command.stop();
        }
        if !self.is_running() {
            cx.notify();
            return;
        }
        if self.cloud_poll.is_some() {
            self.cancel_cloud_run(cx);
            cx.notify();
            return;
        }
        for mut permission in self.permissions.drain(..) {
            if let Some(respond) = permission.respond.take() {
                let _ = respond.send(None);
            }
        }
        for mut elicitation in self.elicitations.drain(..) {
            if let Some(respond) = elicitation.respond.take() {
                let _ = respond.send(crate::elicitation::response("cancel", None));
            }
        }
        match &self.agent {
            AgentState::Ready(agent) if !agent.connection.is_closed() => {
                agent.connection.cancel(&agent.session_id);
                self.turn_started_at = None;
                if self.cancel_grace.is_none() {
                    self.cancel_grace = Some(cx.spawn(async move |this, cx| {
                        cx.background_executor().timer(CANCEL_GRACE).await;
                        this.update(cx, |this, cx| {
                            this.cancel_grace = None;
                            if this.turn.is_some() {
                                this.finish_turn(Some(Ok(schema::PromptResponse::new(schema::StopReason::Cancelled))), cx);
                            }
                        })
                        .ok();
                    }));
                }
            }
            _ => {
                // Nothing to wait for: the agent was still starting or is gone.
                self.turn = None;
                self.agent = AgentState::Stopped;
                self.finish_turn(None, cx);
            }
        }
        cx.notify();
    }

    /// Hosted turns spend credit: the usage ring and balance follow, at once after a payment
    /// failure.
    fn refresh_hosted_credit(&self, payment_failed: bool, cx: &mut Context<Self>) {
        if !crate::builtin::is_builtin(&self.info.agent) || cx.try_global::<settings::SettingsStore>().is_none() {
            return;
        }
        // The connection the session's turns run on, `auto` routed as it was.
        let provider = builtin::session_provider(crate::intelligence::task_provider(settings::get(cx), "agent"), &self.transcript).provider_id;
        if ai_providers::catalog::provider(&provider).is_some_and(|provider| !provider.is_hosted()) || ai_providers::external::external_provider(&provider).is_some() {
            return;
        }
        let Some(store) = account::AccountStore::global(cx) else { return };
        store.update(cx, |store, cx| {
            if payment_failed {
                store.refresh_subscription(cx).detach();
            } else {
                store.schedule_subscription_refresh(cx);
            }
        });
    }

    fn finish_turn(&mut self, result: Option<Result<schema::PromptResponse, RpcError>>, cx: &mut Context<Self>) {
        // A turn may have changed the rules; the meter reads them again.
        self.rules_budget = None;
        self.turn_started_at = None;
        self.cancel_grace = None;
        let ended_normally = matches!(&result, Some(Ok(response)) if response.stop_reason == schema::StopReason::EndTurn);
        match &result {
            Some(Ok(response)) if response.stop_reason != schema::StopReason::Cancelled => self.call_attention(crate::attention::AttentionKind::Complete, cx),
            Some(Err(_)) => self.call_attention(crate::attention::AttentionKind::Error, cx),
            _ => {}
        }
        self.turn = None;
        self.permissions.clear();
        self.elicitations.clear();
        self.refresh_hosted_credit(matches!(&result, Some(Err(error)) if error.to_string().contains("402")), cx);
        let mut status = SessionStatus::Idle;
        match result {
            Some(Ok(response)) => {
                let turn = self.current_turn.and_then(|start| self.transcript.entries.get(start..)).unwrap_or_default();
                let notice = match response.stop_reason {
                    schema::StopReason::Cancelled => Some((NoticeKind::Stopped, "Stopped".to_string())),
                    reason => crate::stop_notice::for_stop(reason, turn).map(|notice| (NoticeKind::Warning, notice.text())),
                };
                self.record_turn_usage(&response);
                let athas_notices: Vec<String> = response
                    .meta
                    .as_ref()
                    .and_then(|meta| meta.get("athasNotices"))
                    .and_then(|notices| notices.as_array())
                    .map(|notices| notices.iter().filter_map(|notice| notice.as_str().map(str::to_string)).collect())
                    .unwrap_or_default();
                for text in athas_notices {
                    let index = self.transcript.push_notice(NoticeKind::Info, text);
                    self.entries_added(index, cx);
                }
                if let Some((kind, text)) = notice {
                    let index = self.transcript.push_notice(kind, text);
                    self.entries_added(index, cx);
                } else if !has_visible_response(turn_entries_after(&self.transcript.entries, self.current_turn)) {
                    // A turn that only changed the session's state says what changed; one that
                    // returned nothing at all is an error the user can retry.
                    match self.turn_state_label.take() {
                        Some(label) => {
                            self.transcript.entries.push(Entry::Agent(crate::thread::AgentMessage { text: label, ..Default::default() }));
                            self.entries_added(self.transcript.entries.len() - 1, cx);
                        }
                        None => {
                            status = SessionStatus::Failed;
                            let text = if builtin::is_builtin(&self.info.agent) {
                                "The selected provider did not return a visible response. Try another model or send the message again."
                            } else {
                                "The selected agent did not return a visible response. Try sending the message again."
                            };
                            let index = self.transcript.push_notice(NoticeKind::Error, text);
                            self.entries_added(index, cx);
                        }
                    }
                }
            }
            Some(Err(error)) => {
                status = SessionStatus::Failed;
                let text = if error.code == RpcError::DISCONNECTED {
                    match self.agent_stderr() {
                        Some(detail) => format!("The agent stopped unexpectedly: {detail}"),
                        None => "The agent stopped unexpectedly".to_string(),
                    }
                } else {
                    error.to_string()
                };
                if crate::composer_notice::is_connection_error(&text) {
                    self.offline_prompt = self.transcript.entries.iter().rev().find_map(|entry| match entry {
                        Entry::User(message) => Some(message.text.clone()),
                        _ => None,
                    });
                    self.dismissed_notices.remove("connection:back-online");
                }
                let offline = self.is_offline(cx);
                let index = self.transcript.push_notice(NoticeKind::Error, text.clone());
                if offline {
                    self.offline_errors.insert((index, text));
                }
                self.entries_added(index, cx);
            }
            None => {
                if matches!(self.status, SessionStatus::Failed) {
                    status = SessionStatus::Failed;
                }
                if !matches!(self.transcript.entries.last(), Some(Entry::Notice(_))) {
                    let index = self.transcript.push_notice(NoticeKind::Stopped, "Stopped");
                    self.entries_added(index, cx);
                }
            }
        }
        // A turn that ended on its own leaves its still-going steps going: a dev server or a
        // background command outlives the turn (`getToolCallPhase` "background"). Only a step
        // still asking for permission is over, since its prompt is gone.
        let cancelled = if ended_normally { self.transcript.cancel_waiting_tools() } else { self.transcript.cancel_running_tools() };
        for index in cancelled {
            self.entry_changed(index);
        }
        self.set_status(status, cx);
        self.save_now();
        // A turn that ended on its own, or stopped for "Send now", sends the next queued prompt;
        // after a stop or a failure the queue waits for the user, and it waits while its next
        // prompt is being edited.
        let continue_queue = std::mem::take(&mut self.continue_queue);
        if (ended_normally || continue_queue) && !self.queue.is_empty() && !self.queue_holds_for_edit() {
            if self.is_offline(cx) {
                self.hold_queue_offline(cx);
            } else {
                let next = self.queue.remove(0);
                self.send_queued(next, cx);
            }
        }
        cx.notify();
    }

    /// Keeps the turn's token usage, and the built-in agent's steps and cost, with its last reply
    /// for the footer under it.
    fn record_turn_usage(&mut self, response: &schema::PromptResponse) {
        let turn_usage = response.usage.as_ref().map(crate::thread::TurnUsage::from_schema);
        let usage = crate::thread::MessageUsage::from_meta(response.meta.as_ref());
        if turn_usage.is_none() && usage.is_none() {
            return;
        }
        let Some(index) = self.transcript.entries.iter().rposition(|entry| matches!(entry, Entry::Agent(_) | Entry::User(_))) else { return };
        if let Some(Entry::Agent(message)) = self.transcript.entries.get_mut(index) {
            message.turn_usage = turn_usage;
            message.usage = usage;
            self.entry_changed(index);
        }
    }

    fn agent_stderr(&self) -> Option<String> {
        #[cfg(not(target_family = "wasm"))]
        if let AgentState::Ready(agent) = &self.agent {
            return agent._process.as_ref().or(agent.shared.as_ref().map(|shared| &shared.process)).and_then(|process| process.stderr_hint());
        }
        None
    }

    /// The running agent, starting it (and opening or reopening its session) when needed.
    async fn ensure_agent(this: &WeakEntity<Self>, cx: &mut AsyncApp) -> Option<Rc<RunningAgent>> {
        // A start already under way (Restart agent, a menu that needed the agent) is waited for,
        // not raced: two starts would open two sessions and the prompt could go to the one the
        // transcript does not remember.
        let mut waited = false;
        loop {
            let state = this
                .update(cx, |this, _| match &this.agent {
                    AgentState::Ready(agent) if !agent.connection.is_closed() => Some(Some(agent.clone())),
                    AgentState::Starting => None,
                    _ => Some(None),
                })
                .ok()?;
            match state {
                Some(Some(agent)) => {
                    this.update(cx, |this, cx| {
                        if this.replaying {
                            this.replaying = false;
                            cx.notify();
                        }
                    })
                    .ok();
                    return Some(agent);
                }
                Some(None) if waited => return None,
                Some(None) => break,
                None => {
                    waited = true;
                    cx.background_executor().timer(std::time::Duration::from_millis(50)).await;
                }
            }
        }
        let (agent_id, cwd, resume, have_history, settings) = this
            .update(cx, |this, cx| {
                this.agent = AgentState::Starting;
                cx.notify();
                let have_history = this.transcript.entries.len() > 1;
                let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
                (this.info.agent.clone(), session_cwd(&this.info), this.transcript.agent_session_id.clone(), have_history, settings)
            })
            .ok()?;
        let started = if builtin::is_builtin(&agent_id) {
            Self::start_builtin(this, cwd, settings, cx).await
        } else if crate::codex::is_codex(&agent_id) {
            Self::start_codex(this, cwd, resume, have_history, cx).await
        } else {
            Self::start_agent(this, &agent_id, cwd, resume, have_history, settings, cx).await
        };
        match started {
            Ok(agent) => {
                this.update(cx, |this, cx| {
                    this.agent_disconnected = None;
                    // Whatever the agent replayed has arrived with the open; an empty session is
                    // an empty session now, not one still loading.
                    this.replaying = false;
                    cx.notify();
                })
                .ok();
                Some(agent)
            }
            Err(failure) => {
                this.update(cx, |this, cx| {
                    this.replaying = false;
                    this.agent_failed(failure, cx)
                })
                .ok();
                None
            }
        }
    }

    /// Starts Athas Agent in-process and opens its session. The saved conversation, model and mode
    /// go along, so a reopened session continues where it was.
    async fn start_builtin(this: &WeakEntity<Self>, cwd: PathBuf, settings: settings::Settings, cx: &mut AsyncApp) -> Result<Rc<RunningAgent>, StartFailure> {
        let (root, history, provider, mode) = this
            .update(cx, |this, _| {
                // The prompt about to go out is the last entry; the agent gets it with the turn.
                let earlier = &this.transcript.entries[..this.transcript.entries.len().saturating_sub(1)];
                (
                    this.info.cwd.clone(),
                    builtin::history_from_entries(earlier),
                    builtin::session_provider(crate::intelligence::task_provider(&settings, "agent"), &this.transcript),
                    builtin::session_mode(&settings.aidefault_session_mode, &this.transcript),
                )
            })
            .map_err(|_| StartFailure::Failed("The session closed".into()))?;
        let max_steps = ai_providers::agent::normalize_max_steps(settings.ai_agent_max_steps);
        let user_rules = settings.ai_user_rules.clone();
        let mcp_servers = cx.background_spawn(async move { builtin::mcp_servers(&settings) }).await;
        let (writes_tx, mut writes) = futures::channel::mpsc::unbounded::<crate::review::FileChange>();
        let weak = this.clone();
        cx.spawn(async move |cx| {
            while let Some(change) = writes.next().await {
                if weak.update(cx, |this, cx| this.on_agent_write(change, cx)).is_err() {
                    return;
                }
            }
        })
        .detach();
        let (unsaved_tx, mut unsaved_asks) = futures::channel::mpsc::unbounded::<(PathBuf, oneshot::Sender<bool>)>();
        cx.spawn(async move |cx| {
            while let Some((path, respond)) = unsaved_asks.next().await {
                let _ = respond.send(cx.update(|cx| has_unsaved_buffer(&path, cx)));
            }
        })
        .detach();
        let unsaved: builtin::UnsavedCheck = Arc::new(move |path| {
            let (respond, answer) = oneshot::channel();
            let asked = unsaved_tx.unbounded_send((path, respond)).is_ok();
            async move { asked && answer.await.unwrap_or(false) }.boxed()
        });
        let executor = cx.background_executor().clone();
        let sleep: builtin::Sleep = Arc::new(move |duration| {
            let timer = executor.timer(duration);
            async move {
                timer.await;
            }
            .boxed()
        });
        let config = builtin::BuiltinConfig {
            cwd: cwd.clone(),
            root,
            provider,
            mode,
            max_steps,
            user_rules,
            mcp_servers,
            history,
            secrets: Arc::new(ai_providers::Keychain::default()),
            sleep,
            on_write: Some(Arc::new(move |change| {
                let _ = writes_tx.unbounded_send(change);
            })),
            unsaved: Some(unsaved),
        };
        let (client_end, agent_end) = acp::rpc::Transport::pair();
        let server = cx.background_spawn(builtin::serve(agent_end, config));
        #[cfg(not(target_family = "wasm"))]
        let host: Option<Arc<dyn acp::host::ClientHost>> = Some(Arc::new(acp::host::LocalHost::new(cwd.clone(), vec![cwd.clone()])));
        #[cfg(target_family = "wasm")]
        let host = None;
        let (connection, events, io) = AgentConnection::new(client_end, host);
        let io = cx.background_spawn(io);
        let events = Self::pump_events(this.clone(), events, cx);
        let opened = acp::open_session(&connection, &cwd, None, false, &[]).await.map_err(|error| StartFailure::Failed(error.to_string()))?;
        let agent = Rc::new(RunningAgent {
            connection,
            session_id: opened.session_id.clone(),
            #[cfg(not(target_family = "wasm"))]
            _process: None,
            #[cfg(not(target_family = "wasm"))]
            shared: None,
            _route: None,
            #[cfg(target_family = "wasm")]
            _remote: None,
            _builtin: Some(server),
            _io: io,
            _events: events,
        });
        this.update(cx, |this, cx| {
            this.session_opened(opened, false, cx);
            this.agent = AgentState::Ready(agent.clone());
            cx.notify();
        })
        .map_err(|_| StartFailure::Failed("The session closed".into()))?;
        Ok(agent)
    }

    /// Starts `codex app-server` and opens (or resumes) its thread through the in-process ACP
    /// bridge. Host tools Codex calls run here, on the app.
    #[cfg(not(target_family = "wasm"))]
    async fn start_codex(
        this: &WeakEntity<Self>,
        cwd: PathBuf,
        resume: Option<String>,
        have_history: bool,
        cx: &mut AsyncApp,
    ) -> Result<Rc<RunningAgent>, StartFailure> {
        use crate::codex;
        let program = cx.background_spawn(async { codex::resolve() }).await.ok_or_else(|| StartFailure::NotInstalled {
            name: codex::NAME.to_string(),
            hint: codex::INSTALL_HINT.to_string(),
        })?;
        let command = acp::agents::AgentCommand { program, args: codex::ARGS.iter().map(|arg| arg.to_string()).collect(), env: Vec::new() };
        let _ = std::fs::create_dir_all(&cwd);
        let (process, codex_transport) =
            acp::process::AgentProcess::spawn(&command, &cwd).map_err(|error| StartFailure::Failed(error.to_string()))?;
        let (host_tx, mut host_calls) = futures::channel::mpsc::unbounded::<codex::HostCall>();
        let weak = this.clone();
        cx.spawn(async move |cx| {
            while let Some(call) = host_calls.next().await {
                let Ok(task) = weak.update(cx, |this, cx| this.run_codex_tool(call.tool, call.arguments, call.call_id, cx)) else { return };
                let respond = call.respond;
                cx.spawn(async move |_| {
                    let _ = respond.send(task.await);
                })
                .detach();
            }
        })
        .detach();
        let browser_tool = cx.update(|cx| codex::browser_tool(cx));
        let config = codex::CodexConfig {
            cwd: cwd.clone(),
            settings: codex::CodexSettings::load(),
            browser_tool,
            host: Some(host_tx),
            save_settings: Some(Arc::new(|settings: &codex::CodexSettings| settings.save())),
        };
        let (client_end, agent_end) = acp::rpc::Transport::pair();
        let server = cx.background_spawn(codex::serve(agent_end, codex_transport, config));
        let host: Arc<dyn acp::host::ClientHost> = Arc::new(acp::host::LocalHost::new(cwd.clone(), vec![cwd.clone()]));
        let (connection, events, io) = AgentConnection::new(client_end, Some(host));
        connection.set_preferred_auth(this.read_with(cx, |this, _| this.preferred_auth.clone()).ok().flatten());
        let io = cx.background_spawn(io);
        let events = Self::pump_events(this.clone(), events, cx);
        let opened = match acp::open_session(&connection, &cwd, resume.as_deref(), have_history, &[]).await {
            Ok(opened) => opened,
            Err(OpenError::AuthRequired(_, error)) => return Err(StartFailure::SignIn(Vec::new(), "codex login".into(), error)),
            Err(OpenError::Failed(error)) => {
                let detail = process.stderr_hint().filter(|_| error.code == RpcError::DISCONNECTED);
                return Err(StartFailure::Failed(match detail {
                    Some(detail) => format!("{error}. {detail}"),
                    None => error.to_string(),
                }));
            }
        };
        let agent = Rc::new(RunningAgent {
            connection,
            session_id: opened.session_id.clone(),
            _process: Some(process),
            shared: None,
            _route: None,
            _builtin: Some(server),
            _io: io,
            _events: events,
        });
        this.update(cx, |this, cx| {
            this.session_opened(opened, have_history, cx);
            this.agent = AgentState::Ready(agent.clone());
            cx.notify();
        })
        .map_err(|_| StartFailure::Failed("The session closed".into()))?;
        Ok(agent)
    }

    #[cfg(target_family = "wasm")]
    async fn start_codex(_: &WeakEntity<Self>, _: PathBuf, _: Option<String>, _: bool, _: &mut AsyncApp) -> Result<Rc<RunningAgent>, StartFailure> {
        Err(StartFailure::Failed("Codex runs in the desktop app".into()))
    }

    /// Runs a host tool Codex called; the answer is Codex's tool result.
    #[cfg_attr(target_family = "wasm", allow(dead_code))]
    fn run_codex_tool(&mut self, tool: String, arguments: serde_json::Value, call_id: String, cx: &mut Context<Self>) -> Task<serde_json::Value> {
        use crate::codex;
        match tool.as_str() {
            codex::OPEN_PULL_REQUEST_TOOL | codex::OPEN_ISSUE_TOOL => {
                let pull_request = tool == codex::OPEN_PULL_REQUEST_TOOL;
                let (resource, kind, label) = if pull_request { ("pull request", "github-pr", "Pull request") } else { ("issue", "github-issue", "Issue") };
                Task::ready(match codex::resource_number(&arguments, resource) {
                    Ok((number, title)) => {
                        let tab = title.map(|title| format!("#{number} {title}")).unwrap_or_else(|| format!("#{number}"));
                        workbench_api::open_resource(cx, kind, &number.to_string(), &tab);
                        codex::tool_result(format!("{label} #{number} opened in Athas."), true)
                    }
                    Err(error) => codex::tool_result(error, false),
                })
            }
            codex::BROWSER_TOOL => codex::run_browser_tool(arguments, call_id, Some(self.info.id.clone()), cx),
            other => Task::ready(codex::tool_result(format!("Unknown Athas tool: {other}"), false)),
        }
    }

    #[cfg(not(target_family = "wasm"))]
    async fn start_agent(
        this: &WeakEntity<Self>,
        agent_id: &str,
        cwd: PathBuf,
        resume: Option<String>,
        have_history: bool,
        settings: settings::Settings,
        cx: &mut AsyncApp,
    ) -> Result<Rc<RunningAgent>, StartFailure> {
        use acp::agents::Resolution;
        let display_name = acp::agents::display_name(agent_id);
        let catalog_id = acp::agents::catalog_id(agent_id).to_string();
        let agent_id = agent_id.to_string();
        let agent_key = agent_id.clone();
        let (resolution, mcp_servers) =
            cx.background_spawn(async move { (acp::agents::resolve(&agent_id), builtin::mcp_servers(&settings)) }).await;
        let command = match resolution {
            Resolution::Found(command) => command,
            Resolution::NotInstalled { name, hint } => return Err(StartFailure::NotInstalled { name, hint }),
        };
        let key = (agent_key, cwd.clone());
        let existing = cx.update(|cx| cx.try_global::<SharedAgents>().and_then(|agents| agents.0.get(&key)).and_then(std::rc::Weak::upgrade)).filter(|shared| !shared.connection.is_closed());
        let shared = match existing {
            Some(shared) => shared,
            None => {
                let _ = std::fs::create_dir_all(&cwd);
                let secrets = acp::traffic_secrets::secret_env_values(command.env.iter().map(|(name, value)| (name, value)));
                let tap = acp::traffic::Tap::start_with_secrets(&catalog_id, &display_name, Some(cwd.to_string_lossy().into_owned()), secrets);
                let (process, transport) =
                    acp::process::AgentProcess::spawn_recorded(&command, &cwd, Some(tap)).map_err(|error| StartFailure::Failed(error.to_string()))?;
                let folders = this.read_with(cx, |this, _| this.workspace_folders.clone()).unwrap_or_default();
                let extra = acp::client::additional_directories(&cwd, &folders);
                let roots = std::iter::once(cwd.clone()).chain(extra.iter().cloned()).collect();
                let host: Arc<dyn acp::host::ClientHost> = Arc::new(acp::host::LocalHost::new(cwd.clone(), roots));
                let (connection, _, io) = AgentConnection::new(transport, Some(host));
                connection.share();
                connection.read_open_buffers();
                connection.set_additional_directories(extra);
                let shared = Rc::new(SharedAgent { key: key.clone(), connection, process, idle_stopped: Default::default(), _io: cx.background_spawn(io) });
                cx.update(|cx| {
                    cx.default_global::<SharedAgents>().0.insert(key.clone(), Rc::downgrade(&shared));
                    start_idle_sweep(cx);
                });
                shared
            }
        };
        let connection = shared.connection.clone();
        connection.set_preferred_auth(this.read_with(cx, |this, _| this.preferred_auth.clone()).ok().flatten());
        match acp::open_session(&connection, &cwd, resume.as_deref(), have_history, &mcp_servers).await {
            Ok(opened) => {
                let (events, route) = connection.route_session(&opened.session_id);
                let events = Self::pump_events(this.clone(), events, cx);
                let agent = Rc::new(RunningAgent {
                    connection,
                    session_id: opened.session_id.clone(),
                    _process: None,
                    shared: Some(shared),
                    _route: Some(route),
                    _builtin: None,
                    _io: Task::ready(()),
                    _events: events,
                });
                this.update(cx, |this, cx| {
                    this.session_opened(opened, have_history, cx);
                    this.agent = AgentState::Ready(agent.clone());
                    cx.notify();
                })
                .map_err(|_| StartFailure::Failed("The session closed".into()))?;
                Ok(agent)
            }
            Err(OpenError::AuthRequired(methods, error)) => {
                let names = AuthChoice::from_methods(&methods, &command.args);
                Err(StartFailure::SignIn(names, command.program.display().to_string(), error))
            }
            Err(OpenError::Failed(error)) => {
                let detail = shared.process.stderr_hint().filter(|_| error.code == RpcError::DISCONNECTED);
                Err(StartFailure::Failed(match detail {
                    Some(detail) => format!("{error}. {detail}"),
                    None => error.to_string(),
                }))
            }
        }
    }

    /// Starts the agent on the workspace server and opens (or resumes) its session over the
    /// server's socket.
    #[cfg(target_family = "wasm")]
    async fn start_agent(
        this: &WeakEntity<Self>,
        agent_id: &str,
        cwd: PathBuf,
        resume: Option<String>,
        have_history: bool,
        settings: settings::Settings,
        cx: &mut AsyncApp,
    ) -> Result<Rc<RunningAgent>, StartFailure> {
        use acp::remote::RemoteError;
        let remote = acp::remote::remote_agents().ok_or_else(|| StartFailure::Failed("Agents run in the desktop app or on a workspace server".into()))?;
        let display_name = acp::agents::display_name(agent_id);
        let known = acp::agents::known_agent(agent_id);
        let program = known.map_or(acp::agents::catalog_id(agent_id), |known| known.binary);
        let args: Vec<String> = known.map(|known| known.args.iter().map(|arg| arg.to_string()).collect()).unwrap_or_default();
        let (transport, handle) = remote.start(agent_id, program, &args, &cwd).map_err(|error| match error {
            RemoteError::NotInstalled(hint) => StartFailure::NotInstalled { name: display_name.clone(), hint },
            RemoteError::Failed(message) => StartFailure::Failed(message),
        })?;
        let mcp_servers = builtin::mcp_servers(&settings);
        let (connection, events, io) = AgentConnection::new(transport, None);
        connection.set_preferred_auth(this.read_with(cx, |this, _| this.preferred_auth.clone()).ok().flatten());
        let io = cx.background_spawn(io);
        let events = Self::pump_events(this.clone(), events, cx);
        match acp::open_session(&connection, &cwd, resume.as_deref(), have_history, &mcp_servers).await {
            Ok(opened) => {
                let agent = Rc::new(RunningAgent {
                    connection,
                    session_id: opened.session_id.clone(),
                    _remote: Some(handle),
                    _route: None,
                    _builtin: None,
                    _io: io,
                    _events: events,
                });
                this.update(cx, |this, cx| {
                    this.session_opened(opened, have_history, cx);
                    this.agent = AgentState::Ready(agent.clone());
                    cx.notify();
                })
                .map_err(|_| StartFailure::Failed("The session closed".into()))?;
                Ok(agent)
            }
            Err(OpenError::AuthRequired(methods, error)) => {
                let names = AuthChoice::from_methods(&methods, &args);
                Err(StartFailure::SignIn(names, program.to_string(), error))
            }
            Err(OpenError::Failed(error)) => Err(StartFailure::Failed(error.to_string())),
        }
    }

    /// Hands the agent's updates and questions to the view, in order. When the stream ends the
    /// agent is gone; the next prompt starts it again.
    fn pump_events(
        this: WeakEntity<Self>,
        mut events: futures::channel::mpsc::UnboundedReceiver<ClientEvent>,
        cx: &mut AsyncApp,
    ) -> Task<()> {
        cx.spawn(async move |cx| {
            while let Some(event) = events.next().await {
                if this.update(cx, |this, cx| this.on_client_event(event, cx)).is_err() {
                    return;
                }
            }
            this.update(cx, |this, cx| {
                #[cfg(not(target_family = "wasm"))]
                if let AgentState::Ready(agent) = &this.agent
                    && agent.shared.as_ref().is_some_and(|shared| shared.idle_stopped.get())
                {
                    this.agent = AgentState::Stopped;
                    cx.notify();
                    return;
                }
                if matches!(this.agent, AgentState::Ready(_)) {
                    let reason = this.agent_stderr().map(|stderr| format!(" ({stderr})")).unwrap_or_default();
                    this.agent = AgentState::Stopped;
                    this.dismissed_notices.remove("agent:disconnected");
                    this.agent_disconnected = Some(format!("{} disconnected unexpectedly{reason}. Restart it, or send a message to start it again.", this.agent_name()));
                    cx.notify();
                }
            })
            .ok();
        })
    }

    fn session_opened(&mut self, opened: acp::OpenedSession, have_history: bool, cx: &mut Context<Self>) {
        self.auth_choices = None;
        self.auth_signing_in = None;
        self.auth_error = None;
        self.auth_terminal = None;
        if crate::codex::is_codex(&self.info.agent) {
            self.codex_models_read = Some(web_time::Instant::now());
            self.codex_catalog = crate::codex::catalog_generation();
            self.codex_models_error = None;
        }
        self.skipped_mcp = opened.skipped_mcp;
        self.transcript.agent_session_id = Some(opened.session_id);
        let saved_mode = self.transcript.modes.as_ref().map(|modes| modes.current.clone());
        let saved_options: Vec<(String, String)> = self.transcript.config_options.iter().map(|option| (option.id.clone(), option.current.clone())).collect();
        if let Some(modes) = opened.modes {
            self.transcript.modes = Some(modes.into());
        }
        if let Some(options) = opened.config_options {
            self.transcript.config_options = options.into_iter().filter_map(ConfigOption::from_acp).collect();
        }
        let (mode, options) = settings_to_restore(saved_mode.as_deref(), &saved_options, self.transcript.modes.as_ref(), &self.transcript.config_options);
        if mode.is_some() || !options.is_empty() {
            // The agent is ready once this update ends.
            cx.spawn(async move |this, cx| {
                this.update(cx, |this, cx| {
                    if let Some(mode) = mode {
                        this.set_mode(mode, cx);
                    }
                    for (config_id, value) in options {
                        this.set_config_option(config_id, value, cx);
                    }
                })
                .ok();
            })
            .detach();
        }
        if opened.context_lost && have_history {
            // Before the prompt that is about to go out; at the end when the agent started
            // without one (Restart, a menu that needed it).
            let last = self.transcript.entries.len().saturating_sub(1);
            let pending_prompt = self.current_turn == Some(last) && matches!(self.transcript.entries.get(last), Some(Entry::User(_)));
            let at = if pending_prompt { last } else { self.transcript.entries.len() };
            self.transcript.entries.insert(
                at,
                Entry::Notice(crate::thread::Notice {
                    kind: NoticeKind::Info,
                    text: "The agent started a new session and does not remember the messages above".into(),
                }),
            );
            self.list.splice(at..at, 1);
            // What pointed at the prompt follows it one place down, so the turn's checkpoint,
            // waiting row, Retry and pin keep finding the prompt.
            for index in [&mut self.current_turn, &mut self.prompt_anchor].into_iter().flatten() {
                if *index >= at {
                    *index += 1;
                }
            }
            self.markdown.borrow_mut().retain(|entry, _| *entry < at);
            self.drawn_runs.borrow_mut().retain(|entry, _| *entry < at);
        }
        self.schedule_save(cx);
    }

    fn agent_failed(&mut self, failure: StartFailure, cx: &mut Context<Self>) {
        let kind = if matches!(failure, StartFailure::SignIn(..)) { crate::attention::AttentionKind::Auth } else { crate::attention::AttentionKind::Error };
        self.auth_signing_in = None;
        self.auth_terminal = None;
        self.call_attention(kind, cx);
        let text = match &failure {
            StartFailure::NotInstalled { name, hint } => format!("{name} is not installed. {hint}"),
            StartFailure::SignIn(methods, program, _) => {
                let how = if methods.is_empty() { String::new() } else { format!(" ({})", methods.iter().map(|method| method.name.as_str()).collect::<Vec<_>>().join(", ")) };
                format!("{} needs you to sign in{how}. Sign in from a terminal with `{program}`, then send again.", self.agent_name())
            }
            StartFailure::Failed(error) => format!("Could not start {}: {error}", self.agent_name()),
        };
        self.agent = match failure {
            StartFailure::NotInstalled { name, hint } => AgentState::NotInstalled { name, hint },
            StartFailure::SignIn(methods, program, error) => {
                // A method that failed is not tried again on its own; the user picks again
                // (`choose` back to `choosing` with the error).
                if error.is_some() {
                    self.preferred_auth = None;
                }
                self.auth_choices = Some((methods, program));
                self.auth_signing_in = None;
                self.auth_error = error;
                AgentState::Stopped
            }
            StartFailure::Failed(_) => AgentState::Stopped,
        };
        let index = self.transcript.push_notice(NoticeKind::Error, text);
        self.entries_added(index, cx);
        self.set_status(SessionStatus::Failed, cx);
    }

    fn on_client_event(&mut self, event: ClientEvent, cx: &mut Context<Self>) {
        if matches!(event, ClientEvent::Update(_) | ClientEvent::TerminalChanged(_)) {
            self.schedule_dev_server_scan(cx);
        }
        match event {
            ClientEvent::Update(update) => {
                if self.turn.is_some()
                    && let Some(label) = state_update_label(&update)
                {
                    self.turn_state_label = Some(label);
                }
                let before = self.transcript.entries.len();
                let latest_edit = self.latest_edit();
                let Applied { entry, session } = self.transcript.apply(update);
                // The replay has started arriving; the view shows the conversation from here.
                if self.replaying && !self.transcript.entries.is_empty() {
                    self.replaying = false;
                }
                if let Some(previous) = latest_edit.filter(|previous| self.latest_edit() != Some(*previous)) {
                    self.entry_changed(previous);
                }
                if let Some(index) = entry
                    && let Some(Entry::ToolCall(call)) = self.transcript.entries.get(index)
                    && let Some(location) = call.locations.last().cloned()
                {
                    self.follow_to(location, cx);
                }
                if let Some(index) = entry {
                    if index >= before {
                        self.entries_added(index, cx);
                    } else {
                        self.entry_changed(index);
                    }
                    self.capture_tool_edit(index, cx);
                }
                if session && let Some(title) = self.transcript.agent_title.clone() {
                    self.set_title(title, cx);
                }
                self.schedule_save(cx);
                cx.notify();
            }
            ClientEvent::Permission(request) => self.on_permission(request, cx),
            ClientEvent::Elicitation(request) => self.on_elicitation(request, cx),
            ClientEvent::ElicitationComplete(id) => {
                let before = self.elicitations.len();
                self.elicitations.retain(|pending| !matches!(&pending.elicitation.mode, crate::elicitation::Mode::Url { elicitation_id, .. } if *elicitation_id == id));
                if self.elicitations.len() != before {
                    self.input_answered(cx);
                }
            }
            ClientEvent::OpenTerminal(command) => {
                workbench_api::run_in_terminal(cx, command.unwrap_or_default(), self.info.cwd.clone());
            }
            ClientEvent::SetTitle(title) => {
                // The agent names a chat once; later calls and a renamed chat keep their title.
                if !self.transcript.title_locked
                    && self.transcript.agent_title.is_none()
                    && let Some(title) = title::clean_chat_title(&title)
                {
                    self.transcript.agent_title = Some(title.clone());
                    self.set_title(title, cx);
                    self.schedule_save(cx);
                }
            }
            ClientEvent::BufferRead { path, respond } => {
                let _ = respond.send(workbench_api::buffer_text(&path, cx));
            }
            ClientEvent::FileWritten { path, previous, content } => {
                self.on_agent_write(crate::review::FileChange { path, previous, content: Some(content) }, cx)
            }
            ClientEvent::TerminalChanged(id) => {
                let index = self.transcript.entries.iter().position(|entry| {
                    matches!(entry, Entry::ToolCall(call) if call.content.iter().any(|content| matches!(content, crate::thread::ToolContent::Terminal { terminal_id } if *terminal_id == id)))
                });
                if let Some(index) = index {
                    self.entry_changed(index);
                    cx.notify();
                }
            }
        }
    }

    /// Logs a file the agent wrote, for review and the turn's checkpoint.
    fn on_agent_write(&mut self, change: crate::review::FileChange, cx: &mut Context<Self>) {
        let outcome = crate::review::record(&self.info.id, self.current_turn, change, cx);
        for notice in outcome.notices {
            let index = self.transcript.push_notice(NoticeKind::Info, notice);
            self.entries_added(index, cx);
        }
        cx.emit(SessionViewEvent::Activity);
    }

    /// Opens the review of this session's agent changes.
    pub(crate) fn open_review(&mut self, cx: &mut Context<Self>) {
        workbench_api::open_resource(cx, crate::review::RESOURCE_KIND, &self.info.id, &format!("Review: {}", self.info.title));
    }

    pub(crate) fn review_all(&mut self, keep: bool, cx: &mut Context<Self>) {
        let action = if keep { crate::review::ReviewAction::KeepAll } else { crate::review::ReviewAction::RejectAll };
        self.run_review(action, cx);
    }

    /// Puts the files back as they were before the turn the user message at `turn` started.
    pub(crate) fn restore_checkpoint(&mut self, turn: usize, cx: &mut Context<Self>) {
        self.run_review(crate::review::ReviewAction::Restore { turn, force: false }, cx);
    }

    fn run_review(&mut self, action: crate::review::ReviewAction, cx: &mut Context<Self>) {
        let restore = matches!(action, crate::review::ReviewAction::Restore { .. });
        let task = crate::review::apply(self.info.id.clone(), action, cx);
        cx.spawn(async move |this, cx| {
            let outcome = task.await;
            this.update(cx, |this, cx| {
                let mut notices = outcome.notices;
                if restore {
                    let count = outcome.restored.len();
                    notices.insert(0, match count {
                        0 => "Nothing to restore".to_string(),
                        1 => "Restored 1 file to before this turn".to_string(),
                        count => format!("Restored {count} files to before this turn"),
                    });
                }
                for notice in notices {
                    let index = this.transcript.push_notice(NoticeKind::Info, notice);
                    this.entries_added(index, cx);
                }
                this.schedule_save(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Turns following the agent on or off.
    pub fn toggle_follow(&mut self, cx: &mut Context<Self>) {
        self.following = !self.following;
        self.follow_last = None;
        self.follow_pending = None;
        cx.notify();
    }

    /// Stops following the agent while a turn runs, as input in another pane does
    /// (`interruptsAgentFollow`); whether it was following.
    pub fn stop_following(&mut self, cx: &mut Context<Self>) -> bool {
        if !self.following || !self.is_running() {
            return false;
        }
        self.toggle_follow(cx);
        true
    }

    /// Moves the editor to where the agent is, at most once per interval; the latest location
    /// waits for the end of the interval.
    fn follow_to(&mut self, mut location: crate::thread::Location, cx: &mut Context<Self>) {
        const INTERVAL: Duration = Duration::from_millis(300);
        // Lines are 1-based; a 0 means the agent named no line (`pickAgentFollowTarget`).
        location.line = location.line.filter(|line| *line > 0);
        if !self.following || !self.is_running() || self.follow_last.as_ref() == Some(&location) {
            return;
        }
        self.follow_last = Some(location.clone());
        let wait = self.follow_at.map(|at| INTERVAL.saturating_sub(at.elapsed())).unwrap_or_default();
        if wait.is_zero() {
            self.follow_at = Some(web_time::Instant::now());
            cx.emit(SessionViewEvent::FollowAgent { path: location.path, line: location.line });
            return;
        }
        self.follow_pending = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(wait).await;
            this.update(cx, |this, cx| {
                this.follow_pending = None;
                if this.following && this.is_running() && let Some(location) = this.follow_last.clone() {
                    this.follow_at = Some(web_time::Instant::now());
                    cx.emit(SessionViewEvent::FollowAgent { path: location.path, line: location.line });
                }
            })
            .ok();
        }));
    }

    /// Asks for the user's attention through the OS when they are not looking at the session.
    fn call_attention(&self, kind: crate::attention::AttentionKind, cx: &mut Context<Self>) {
        // A fixture session (screenshots) is not a real one.
        if self.store_dir.is_none() {
            return;
        }
        let visible = self.seen_at.is_some_and(|at| at.elapsed() < Duration::from_secs(2));
        crate::attention::notify(kind, &self.info.id, visible, cx);
    }

    fn on_permission(&mut self, request: acp::client::PermissionRequest, cx: &mut Context<Self>) {
        self.call_attention(crate::attention::AttentionKind::Permission, cx);
        let tool_call_id = request.tool_call.tool_call_id.0.to_string();
        let applied = {
            let before = self.transcript.entries.len();
            let applied = self.transcript.update_tool_call(request.tool_call);
            applied.entry.map(|index| (index, index >= before))
        };
        if let Some((index, added)) = applied {
            if added {
                self.entries_added(index, cx);
            } else {
                self.entry_changed(index);
            }
        }
        if let Some(index) = self.transcript.set_tool_status(&tool_call_id, ToolStatus::WaitingForPermission) {
            self.entry_changed(index);
        }
        let title = self.transcript.tool_call(&tool_call_id).map(|(_, call)| call.title.clone()).unwrap_or_default();
        self.permissions.push_back(PendingPermission { tool_call_id, title, options: request.options, respond: Some(request.respond) });
        self.set_status(SessionStatus::NeedsInput, cx);
        cx.notify();
    }

    fn on_elicitation(&mut self, request: acp::client::ElicitationRequest, cx: &mut Context<Self>) {
        let Some(elicitation) = crate::elicitation::Elicitation::parse(&request.request) else {
            let _ = request.respond.send(crate::elicitation::response("cancel", None));
            return;
        };
        self.call_attention(crate::attention::AttentionKind::Question, cx);
        let answers = match &elicitation.mode {
            crate::elicitation::Mode::Form { questions, .. } => {
                questions.iter().map(|question| (question.name.clone(), crate::elicitation::default_answer(question))).collect()
            }
            crate::elicitation::Mode::Url { .. } => HashMap::new(),
        };
        self.elicitations.push_back(PendingElicitation {
            elicitation,
            answers,
            inputs: HashMap::new(),
            step: 0,
            error: None,
            waiting: false,
            respond: Some(request.respond),
        });
        self.set_status(SessionStatus::NeedsInput, cx);
        cx.notify();
    }

    fn input_answered(&mut self, cx: &mut Context<Self>) {
        let waiting = self.elicitations.iter().any(|pending| pending.respond.is_some());
        if self.permissions.is_empty() && !waiting && self.is_running() {
            self.set_status(SessionStatus::Running, cx);
        }
        cx.notify();
    }

    /// Copies what the form's text fields hold into its answers.
    fn sync_elicitation_inputs(&mut self, cx: &App) {
        let Some(pending) = self.elicitations.front_mut() else { return };
        for (name, input) in &pending.inputs {
            pending.answers.entry(name.clone()).or_default().text = input.read(cx).text().to_string();
        }
    }

    /// Toggles (or, for single choice, picks) an option of the form's question `name`.
    pub(crate) fn choose_elicitation_option(&mut self, name: &str, value: &str, cx: &mut Context<Self>) {
        let Some(pending) = self.elicitations.front_mut() else { return };
        let multiple = matches!(&pending.elicitation.mode, crate::elicitation::Mode::Form { questions, .. }
            if questions.iter().any(|question| question.name == name && matches!(question.kind, crate::elicitation::QuestionKind::Choice { multiple: true, .. })));
        let answer = pending.answers.entry(name.to_string()).or_default();
        if multiple {
            if let Some(index) = answer.chosen.iter().position(|chosen| chosen == value) {
                answer.chosen.remove(index);
            } else {
                answer.chosen.push(value.to_string());
            }
        } else if answer.chosen.first().map(String::as_str) == Some(value) {
            answer.chosen.clear();
        } else {
            answer.chosen = vec![value.to_string()];
        }
        pending.error = None;
        cx.notify();
    }

    /// Moves the form to another step; going forward checks the current answer first, unless the
    /// step is skipped.
    pub(crate) fn elicitation_step(&mut self, forward: bool, skip: bool, cx: &mut Context<Self>) {
        self.sync_elicitation_inputs(cx);
        let Some(pending) = self.elicitations.front_mut() else { return };
        let crate::elicitation::Mode::Form { questions, .. } = &pending.elicitation.mode else { return };
        if !forward {
            pending.step = pending.step.saturating_sub(1);
            pending.error = None;
            cx.notify();
            return;
        }
        if let Some(question) = questions.get(pending.step) {
            if skip {
                pending.answers.insert(question.name.clone(), crate::elicitation::Answer::default());
                if let Some(input) = pending.inputs.get(&question.name) {
                    input.update(cx, |input, cx| input.set_text("", cx));
                }
            } else if let Some(error) = crate::elicitation::question_error(question, pending.answers.get(&question.name).unwrap_or(&Default::default())) {
                pending.error = Some(error);
                cx.notify();
                return;
            }
        }
        pending.error = None;
        pending.step = (pending.step + 1).min(questions.len().saturating_sub(1));
        cx.notify();
    }

    /// Answers the question in front: `accept` (with the form's answers), `decline` or `cancel`.
    pub(crate) fn answer_elicitation(&mut self, action: &str, cx: &mut Context<Self>) {
        self.sync_elicitation_inputs(cx);
        let Some(pending) = self.elicitations.front_mut() else { return };
        let content = match &pending.elicitation.mode {
            crate::elicitation::Mode::Form { questions, .. } if action == "accept" => {
                if let Some(error) = crate::elicitation::find_error(questions, &pending.answers) {
                    pending.error = Some(error);
                    cx.notify();
                    return;
                }
                Some(crate::elicitation::content(questions, &pending.answers))
            }
            _ => None,
        };
        if let Some(mut pending) = self.elicitations.pop_front()
            && let Some(respond) = pending.respond.take()
            && respond.send(crate::elicitation::response(action, content)).is_err()
        {
            notifications::notify(cx, notifications::NotificationKind::Error, notifications::NotificationCategory::Agent, "The agent stopped waiting for this answer.", None, None);
        }
        self.input_answered(cx);
    }

    /// Opens a URL-mode link in the system browser and tells the agent the user went there; the
    /// prompt stays until the agent says the flow finished.
    pub(crate) fn open_elicitation_link(&mut self, cx: &mut Context<Self>) {
        let Some(pending) = self.elicitations.front_mut() else { return };
        let crate::elicitation::Mode::Url { link: crate::elicitation::Link::Openable { href, .. }, .. } = &pending.elicitation.mode else { return };
        cx.open_url(href);
        pending.waiting = true;
        if let Some(respond) = pending.respond.take() {
            let _ = respond.send(crate::elicitation::response("accept", None));
        }
        self.input_answered(cx);
    }

    /// Hides a URL prompt whose link was already opened.
    pub(crate) fn dismiss_elicitation(&mut self, cx: &mut Context<Self>) {
        if self.elicitations.front().is_some_and(|pending| pending.waiting) {
            self.elicitations.pop_front();
        }
        cx.notify();
    }

    /// Enter allows once and Esc denies the permission request in front, when it offers that
    /// option. Returns whether it answered.
    fn answer_permission_shortcut(&mut self, kind: schema::PermissionOptionKind, cx: &mut Context<Self>) -> bool {
        let Some(permission) = self.permissions.front() else { return false };
        if permission.options.is_empty() {
            // The Deny and Allow stand-ins answer Esc and Enter.
            match kind {
                schema::PermissionOptionKind::AllowOnce => self.answer_permission_plainly(true, cx),
                schema::PermissionOptionKind::RejectOnce => self.answer_permission_plainly(false, cx),
                _ => return false,
            }
            return true;
        }
        let Some(option) = permission.options.iter().find(|option| option.kind == kind).map(|option| option.option_id.clone()) else {
            return false;
        };
        self.answer_permission(option, cx);
        true
    }

    /// Answers the question in front with one of its options.
    pub(crate) fn answer_permission(&mut self, option: schema::PermissionOptionId, cx: &mut Context<Self>) {
        let Some(permission) = self.permissions.front() else { return };
        let rejected = permission
            .options
            .iter()
            .find(|candidate| candidate.option_id == option)
            .is_some_and(|candidate| matches!(candidate.kind, schema::PermissionOptionKind::RejectOnce | schema::PermissionOptionKind::RejectAlways));
        self.finish_permission(Some(option), rejected, cx);
    }

    /// A plain yes or no for a request that came without options (the prompt's Deny and Allow
    /// stand-ins). As in Athas it may only pick a one-time option, and there is none on offer, so
    /// the agent hears that the request was cancelled.
    pub(crate) fn answer_permission_plainly(&mut self, approved: bool, cx: &mut Context<Self>) {
        let option = self.permissions.front().and_then(|permission| {
            let kind = if approved { schema::PermissionOptionKind::AllowOnce } else { schema::PermissionOptionKind::RejectOnce };
            permission.options.iter().find(|option| option.kind == kind).map(|option| option.option_id.clone())
        });
        self.finish_permission(option, !approved, cx);
    }

    fn finish_permission(&mut self, option: Option<schema::PermissionOptionId>, rejected: bool, cx: &mut Context<Self>) {
        let Some(mut permission) = self.permissions.pop_front() else { return };
        if let Some(respond) = permission.respond.take()
            && respond.send(option).is_err()
        {
            notifications::notify(cx, notifications::NotificationKind::Error, notifications::NotificationCategory::Agent, "The agent did not accept the answer. Stop the agent and try again.", None, None);
        }
        let status = if rejected { ToolStatus::Canceled } else { ToolStatus::InProgress };
        if let Some(index) = self.transcript.set_tool_status(&permission.tool_call_id, status) {
            self.entry_changed(index);
        }
        self.expanded.remove(&permission.tool_call_id);
        if self.permissions.is_empty() && !self.elicitations.iter().any(|pending| pending.respond.is_some()) && self.is_running() {
            self.set_status(SessionStatus::Running, cx);
        }
        cx.notify();
    }

    pub(crate) fn set_mode(&mut self, mode_id: String, cx: &mut Context<Self>) {
        if let Some(modes) = &mut self.transcript.modes {
            modes.current = mode_id.clone();
        }
        if let AgentState::Ready(agent) = &self.agent {
            let agent = agent.clone();
            cx.spawn(async move |_, _| {
                let _ = agent.connection.set_mode(&agent.session_id, &mode_id).await;
            })
            .detach();
        }
        self.schedule_save(cx);
        cx.notify();
    }

    pub(crate) fn set_config_option(&mut self, config_id: String, value: String, cx: &mut Context<Self>) {
        if let Some(option) = self.transcript.config_options.iter_mut().find(|option| option.id == config_id) {
            option.current = value.clone();
        }
        if let AgentState::Ready(agent) = &self.agent {
            let agent = agent.clone();
            cx.spawn(async move |this, cx| {
                if let Ok(response) = agent.connection.set_config_option(&agent.session_id, &config_id, &value).await {
                    this.update(cx, |this, cx| {
                        this.transcript.config_options =
                            response.config_options.into_iter().filter_map(ConfigOption::from_acp).collect();
                        cx.notify();
                    })
                    .ok();
                }
            })
            .detach();
        }
        self.schedule_save(cx);
        cx.notify();
    }

    /// Runs the session on the built-in agent with `provider`'s `model` (a provider row of the
    /// agent picker).
    pub(crate) fn choose_provider(&mut self, provider: &str, model: &str, cx: &mut Context<Self>) {
        if !builtin::is_builtin(&self.info.agent) {
            self.set_agent(builtin::AGENT_ID.to_string(), cx);
            if !builtin::is_builtin(&self.info.agent) {
                return;
            }
        }
        let value = format!("{provider}::{model}");
        if self.transcript.config_options.iter().any(|option| option.id == "model") {
            self.set_config_option("model".to_string(), value, cx);
            return;
        }
        self.transcript.config_options.push(ConfigOption {
            id: "model".to_string(),
            name: "Model".to_string(),
            category: Some("model".to_string()),
            current: value,
            choices: Vec::new(),
            default: None,
        });
        self.schedule_save(cx);
        cx.notify();
    }

    /// Switches the agent a session that has not started yet will run.
    pub(crate) fn set_agent(&mut self, agent: String, cx: &mut Context<Self>) {
        if !self.transcript.entries.is_empty() || matches!(self.agent, AgentState::Ready(_) | AgentState::Starting) {
            return;
        }
        self.info.agent = agent;
        self.agent = AgentState::Stopped;
        self.transcript.modes = None;
        self.transcript.config_options.clear();
        self.update_placeholder(cx);
        cx.notify();
    }

    /// Installs the session's agent with the user's npm or bun.
    pub(crate) fn install_agent(&mut self, cx: &mut Context<Self>) {
        let id = acp::agents::catalog_id(&self.info.agent).to_string();
        crate::agent_registry::AgentRegistry::global(cx).update(cx, |registry, cx| registry.install(&id, cx));
    }

    pub(crate) fn open_file(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        cx.emit(SessionViewEvent::OpenFile(path));
    }

    /// The project file a link in an answer names, relative, anchored to a line or by name
    /// alone; the project's file list loads for the next link when it has not yet.
    pub(crate) fn file_link(&mut self, href: &str, label: &str, cx: &mut Context<Self>) -> Option<crate::chat_link::FileLink> {
        let local = href.starts_with('/') || href.starts_with("file://");
        if self.project_files.is_none() && !local {
            self.load_project_files(cx);
        }
        let files = self.project_files.clone().unwrap_or_default();
        crate::chat_link::resolve_file_link(href, label, &files, self.info.cwd.as_deref(), |path| path.is_file())
    }

    /// Opens a file a tool call names at its line (`openToolPath`): `~/…` against the home
    /// folder, other relative paths against the session's folder; a file that cannot be read
    /// says so instead of opening an empty tab.
    pub(crate) fn open_location(&mut self, path: PathBuf, line: Option<u32>, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        let home = dirs::home_dir();
        #[cfg(target_family = "wasm")]
        let home: Option<PathBuf> = None;
        let path = resolve_tool_path(&path, self.info.cwd.as_deref(), home.as_deref());
        if !path.to_string_lossy().starts_with("remote://") {
            let problem = match std::fs::metadata(&path) {
                Ok(metadata) if metadata.is_dir() => Some("It is a folder, not a file.".to_string()),
                Ok(_) => None,
                Err(error) => Some(error.to_string()),
            };
            if let Some(problem) = problem {
                let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
                notifications::error(cx, format!("Could not open {name}"), Some(problem.into()));
                return;
            }
        }
        match line {
            Some(line) => workbench_api::open_file(cx, path, Some(line)),
            None => self.open_file(path, cx),
        }
    }

    /// A sent image, decoded once.
    pub(crate) fn thumbnail(&self, image: &crate::thread::MessageImage) -> Option<Arc<gpui::Image>> {
        use base64::Engine as _;
        let data = &image.data;
        let key = format!("{}:{}:{}", data.len(), &data[..data.len().min(96)], &data[data.len().saturating_sub(96)..]);
        self.thumbnails
            .borrow_mut()
            .entry(key)
            .or_insert_with(|| {
                let format = gpui::ImageFormat::from_mime_type(&image.media_type)?;
                let bytes = base64::engine::general_purpose::STANDARD.decode(data).ok()?;
                Some(Arc::new(gpui::Image::from_bytes(format, bytes)))
            })
            .clone()
    }

    pub(crate) fn toggle_expanded(&mut self, key: String, index: usize, cx: &mut Context<Self>) {
        if self.is_expanded(&key, index) {
            self.expanded.remove(&key);
            self.collapsed.insert(key);
        } else {
            self.collapsed.remove(&key);
            self.expanded.insert(key);
        }
        self.entry_changed(index);
        cx.notify();
    }

    /// Whether the row at `index` is open: only when the user opened it (nothing opens on its own).
    pub(crate) fn is_expanded(&self, key: &str, _index: usize) -> bool {
        self.expanded.contains(key)
    }

    /// The newest finished edit of the latest reply, whose diff opens on its own (`findLatestEdit`).
    pub(crate) fn latest_edit(&self) -> Option<usize> {
        for (index, entry) in self.transcript.entries.iter().enumerate().rev() {
            match entry {
                Entry::User(_) => return None,
                Entry::ToolCall(call) if call.diffs().next().is_some() => return Some(index),
                _ => {}
            }
        }
        None
    }

    /// How long the running turn has waited for the agent's first answer; `None` once anything
    /// came back (`awaitingFirstResponse`).
    pub(crate) fn awaiting_first_response(&self) -> Option<Duration> {
        let started = self.turn_started_at?;
        let index = self.current_turn?;
        // Notes the prompt brought along (an attachment the agent cannot take) are not answers.
        let answered = self.transcript.entries.get(index + 1..).is_none_or(|after| after.iter().any(|entry| !matches!(entry, Entry::Notice(_))));
        (self.turn.is_some() && !answered).then(|| started.elapsed())
    }

    /// Redraws the waiting marker each second while the agent has not answered.
    pub(crate) fn schedule_waiting_tick(&mut self, cx: &mut Context<Self>) {
        if self.waiting_tick.is_some() || self.awaiting_first_response().is_none() {
            return;
        }
        self.waiting_tick = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            this.update(cx, |this, cx| {
                this.waiting_tick = None;
                cx.notify();
            })
            .ok();
        }));
    }

    /// Retry on a stalled turn (`retryLastTurn`): stops it and sends its prompt again first.
    pub(crate) fn retry_stalled_turn(&mut self, cx: &mut Context<Self>) {
        let Some(Entry::User(prompt)) = self.current_turn.and_then(|index| self.transcript.entries.get(index)) else { return };
        let text = prompt.text.clone();
        if text.trim().is_empty() {
            return;
        }
        self.queue.insert(0, Queued::new(text, Vec::new()));
        self.send_now_at = None;
        self.send_queued_now(0, cx);
    }

    /// While steps run, redraws them each second so their elapsed time moves.
    pub(crate) fn schedule_elapsed_tick(&mut self, cx: &mut Context<Self>) {
        if self.elapsed_tick.is_some() {
            return;
        }
        let running: Vec<usize> = self
            .transcript
            .entries
            .iter()
            .enumerate()
            .filter(|(index, entry)| match entry {
                Entry::ToolCall(call) => call.status.is_running() && call.started_at.is_some(),
                Entry::Thought(_) => self.is_running() && index + 1 == self.transcript.entries.len(),
                _ => false,
            })
            .map(|(index, _)| index)
            .collect();
        if running.is_empty() {
            return;
        }
        self.elapsed_tick = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            this.update(cx, |this, cx| {
                this.elapsed_tick = None;
                for index in running {
                    if let Some(run) = crate::tool_groups::run_at(&this.transcript.entries, index) {
                        this.entry_changed(run.start);
                    }
                    this.entry_changed(index);
                }
                cx.notify();
            })
            .ok();
        }));
    }

    pub(crate) fn terminal_output(&self, id: &str) -> Option<acp::host::TerminalSnapshot> {
        match &self.agent {
            AgentState::Ready(agent) => agent.connection.terminal_snapshot(id),
            _ => None,
        }
    }

    pub(crate) fn markdown(&self, index: usize, text: &str) -> Rc<Vec<Block>> {
        let mut cache = self.markdown.borrow_mut();
        if let Some((len, blocks)) = cache.get(&index)
            && *len == text.len()
        {
            return blocks.clone();
        }
        let blocks = Rc::new(markdown::parse(&crate::assistant_markdown::normalize(text)));
        cache.insert(index, (text.len(), blocks.clone()));
        blocks
    }

    /// What a run of the transcript's text needs to draw itself selectable.
    pub(crate) fn selecting(&self, cx: &App) -> crate::selection::Selecting<'_> {
        use theme::ActiveTheme as _;
        crate::selection::Selecting::new(self.text_selection.as_ref(), &self.drawn_runs, cx.theme().colors.selection)
    }

    /// The runs an entry draws are noted as it is drawn, so they go before it is drawn again.
    pub(crate) fn forget_drawn_runs(&self, index: usize) {
        if let Some(runs) = self.drawn_runs.borrow_mut().get_mut(&index) {
            runs.clear();
        }
    }

    /// Starts, extends (with Shift) or drags the transcript's selection to `offset`, a byte of
    /// the run drawn at `path`. A second click takes the word there and a third the whole run.
    pub(crate) fn select_text(&mut self, path: SpanPath, offset: usize, phase: SelectPhase, cx: &mut Context<Self>) {
        let whole = |path: &SpanPath, range: Range<usize>| TextSelection {
            anchor: TextPoint { span: path.clone(), offset: range.start },
            head: TextPoint { span: path.clone(), offset: range.end },
            selecting: false,
        };
        match phase {
            SelectPhase::Start { clicks, .. } if clicks >= 3 => {
                let len = crate::selection::run_len(&self.drawn_runs.borrow(), &path);
                self.text_selection = Some(whole(&path, 0..len));
            }
            SelectPhase::Start { clicks, .. } if clicks == 2 => {
                let word = crate::selection::word_at(&self.drawn_runs.borrow(), &path, offset);
                let Some(word) = word.filter(|word| !word.is_empty()) else { return };
                self.text_selection = Some(whole(&path, word));
            }
            SelectPhase::Start { extend: true, .. } if self.text_selection.is_some() => {
                if let Some(selection) = &mut self.text_selection {
                    selection.head = TextPoint { span: path, offset };
                    selection.selecting = true;
                }
            }
            SelectPhase::Start { .. } => self.text_selection = Some(TextSelection::at(TextPoint { span: path, offset })),
            SelectPhase::Drag => match &mut self.text_selection {
                Some(selection) if selection.selecting => selection.head = TextPoint { span: path, offset },
                _ => return,
            },
        }
        cx.notify();
    }

    /// A press on anything that is not selectable text puts the selection away; Shift keeps it,
    /// as it is about to extend it.
    pub(crate) fn clear_text_selection(&mut self, shift: bool, cx: &mut Context<Self>) {
        if !shift && self.text_selection.take().is_some() {
            cx.notify();
        }
    }

    /// The mouse is up: the selection stays, but it stops following the mouse.
    pub(crate) fn end_text_selection(&mut self) {
        if let Some(selection) = &mut self.text_selection {
            selection.selecting = false;
        }
    }

    /// Cmd-C with text selected in the transcript copies it; with nothing selected the keystroke
    /// goes on to whatever else wants it.
    pub(crate) fn copy_text_selection(&mut self, _: &crate::selection::CopyTranscriptSelection, _: &mut Window, cx: &mut Context<Self>) {
        let text = self
            .text_selection
            .as_ref()
            .filter(|selection| !selection.is_empty())
            .map(|selection| crate::selection::selected_text(&self.drawn_runs.borrow(), selection))
            .filter(|text| !text.is_empty());
        match text {
            Some(text) => cx.write_to_clipboard(gpui::ClipboardItem::new_string(text)),
            None => cx.propagate(),
        }
    }

    pub(crate) fn entries_added(&mut self, index: usize, cx: &mut Context<Self>) {
        let count = self.list.item_count();
        if index >= count {
            self.list.splice(count..count, self.transcript.entries.len() - count);
            // A new step joins the group above it, which its first entry draws.
            if let Some(run) = crate::tool_groups::run_at(&self.transcript.entries, count)
                && run.start < count
            {
                self.list.splice(run.start..run.start + 1, 1);
            }
        }
        cx.emit(SessionViewEvent::Activity);
    }

    /// Pins the prompt at `index` to the top of the list, as the message scroller's scroll anchor
    /// does (`chat-messages.tsx`): the reply streams in under it instead of the list following
    /// the end, until the user scrolls to the end of a turn taller than the list.
    pub(crate) fn pin_prompt(&mut self, index: usize) {
        self.prompt_anchor = Some(index);
        self.anchor_filled = false;
        self.anchor_pending = true;
        self.anchor_room = None;
        self.list.set_follow_mode(FollowMode::Normal);
        self.list.scroll_to(ListOffset { item_ix: index, offset_in_item: Pixels::ZERO });
    }

    /// The height the last entry fills so the pinned prompt can sit at the top of the list.
    ///
    /// Only what the list has laid out can be measured, and that changes as the view scrolls: a
    /// sum taken while part of the turn is off screen comes up short, the room grows by that
    /// much, and the last entry jumps — the flicker while scrolling through a reply. So the room
    /// is only worked out when the whole turn can be measured, and otherwise stays as it was.
    pub(crate) fn anchor_min_height(&mut self, last: usize) -> Option<Pixels> {
        let Some(anchor) = self.prompt_anchor.filter(|anchor| *anchor <= last) else {
            self.anchor_room = None;
            return None;
        };
        let viewport = self.list.viewport_bounds().size.height;
        if viewport <= Pixels::ZERO {
            return self.anchor_room;
        }
        // Nothing is measured on the frame a turn is pinned: hold the whole viewport then, which
        // is what a reply about to be written needs anyway, and measure once it is drawn.
        let unmeasured = self.anchor_room.or(Some(viewport));
        let mut above = Pixels::ZERO;
        for index in anchor..last {
            let Some(bounds) = self.list.bounds_for_item(index) else { return unmeasured };
            above += bounds.size.height;
        }
        let Some(own) = self.list.bounds_for_item(last) else { return unmeasured };
        let room = (viewport - above).max(Pixels::ZERO);
        // The entry is at least `room` tall while pinned, so a taller one means the reply itself
        // has filled the room: the pin has done its work and the next scroll to the end drops it.
        self.anchor_filled = own.size.height > room + Pixels::from(1.);
        self.anchor_room = (room > Pixels::ZERO).then_some(room);
        // The scroll made when the prompt was pinned had nothing under it to scroll into and was
        // clamped; now that the room is there, put the prompt at the top once.
        if self.anchor_pending && self.anchor_room.is_some() {
            self.anchor_pending = false;
            self.list.scroll_to(ListOffset { item_ix: anchor, offset_in_item: Pixels::ZERO });
        }
        // A reply that outgrew the room while the view sat at the end: let go here too, so the
        // list follows the rest of it without waiting for the wheel to turn.
        if self.anchor_filled && self.list.is_scrolled_to_end() == Some(true) {
            self.release_anchor();
        }
        self.anchor_room
    }

    /// Lets the pinned prompt go and follows the tail again.
    fn release_anchor(&mut self) {
        self.prompt_anchor = None;
        self.anchor_pending = false;
        self.anchor_filled = false;
        self.anchor_room = None;
        self.list.set_follow_mode(FollowMode::Tail);
    }

    /// The pin goes once the reply has filled the room held for it and the user has scrolled to
    /// the end: from there the list follows the tail again. Scrolling anywhere else leaves both
    /// the pin and the scroll position alone.
    fn list_scrolled(&mut self) {
        let filled = self.anchor_filled || self.anchor_room.is_none();
        if self.prompt_anchor.is_some() && filled && self.list.is_scrolled_to_end() == Some(true) {
            self.release_anchor();
        }
    }

    pub(crate) fn entry_changed(&mut self, index: usize) {
        if index < self.list.item_count() {
            self.list.splice(index..index + 1, 1);
        }
        // A step of a group is drawn by the group's first entry.
        if let Some(run) = crate::tool_groups::run_at(&self.transcript.entries, index)
            && run.start != index
            && run.start < self.list.item_count()
        {
            self.list.splice(run.start..run.start + 1, 1);
        }
    }

    /// The user named the session.
    pub fn rename(&mut self, title: String) {
        self.transcript.agent_title = Some(title.clone());
        self.transcript.title_locked = true;
        self.info.title = title;
    }

    pub(crate) fn set_title(&mut self, title: String, cx: &mut Context<Self>) {
        if title != self.info.title {
            self.info.title = title.clone();
            cx.emit(SessionViewEvent::TitleChanged(title));
        }
    }

    fn set_status(&mut self, status: SessionStatus, cx: &mut Context<Self>) {
        self.status = status;
        self.show_status(cx);
    }

    pub(crate) fn set_running_status(&mut self, cx: &mut Context<Self>) {
        self.set_status(SessionStatus::Running, cx);
        self.schedule_save(cx);
    }

    pub(crate) fn finish_cloud_status(&mut self, failed: bool, cx: &mut Context<Self>) {
        self.set_status(if failed { SessionStatus::Failed } else { SessionStatus::Idle }, cx);
        self.call_attention(if failed { crate::attention::AttentionKind::Error } else { crate::attention::AttentionKind::Complete }, cx);
        self.schedule_save(cx);
        if !failed && !self.queue.is_empty() {
            let next = self.queue.remove(0);
            if let Err(blocker) = self.send_to_cloud(next.text.clone(), cx) {
                self.input_notice = Some(blocker.into());
                self.queue.insert(0, next);
            }
        }
        cx.notify();
    }

    pub(crate) fn show_status(&mut self, cx: &mut Context<Self>) {
        let shown = crate::pull_request::overlay(self.status, self.pull_request.as_ref().map(|pull_request| pull_request.state));
        if shown != self.shown_status {
            self.shown_status = shown;
            cx.emit(SessionViewEvent::StatusChanged(shown));
        }
    }

    /// Saves soon: streaming changes the transcript many times a second.
    pub(crate) fn schedule_save(&mut self, cx: &mut Context<Self>) {
        if self.store_dir.is_none() || self.save_task.is_some() {
            return;
        }
        self.save_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(800)).await;
            // Serializing and writing a long transcript takes tens of milliseconds: only the
            // copy happens here, the write on a background thread.
            let Ok(Some((dir, id, transcript, number))) = this.update(cx, |this, _| {
                this.save_task = None;
                let dir = this.store_dir.clone()?;
                (this.transcript != Transcript::default()).then(|| (dir, this.info.id.clone(), this.transcript.clone(), persistence::next_save()))
            }) else {
                return;
            };
            // Detached: closing the session right now must not cancel the write.
            cx.background_spawn(async move {
                let _ = persistence::save_numbered(&dir, &id, &transcript, number);
            })
            .detach();
        }));
    }

    fn save_now(&mut self) {
        self.save_task = None;
        let Some(dir) = &self.store_dir else { return };
        if self.transcript == Transcript::default() {
            return;
        }
        let _ = persistence::save_numbered(dir, &self.info.id, &self.transcript, persistence::next_save());
    }
}

impl Drop for SessionView {
    fn drop(&mut self) {
        if self.save_task.is_some() {
            self.save_now();
        }
    }
}

/// What goes with the user's words (`buildContextPrompt`): the team workspace's AI instructions
/// first, then for ACP agents the project, its folder and the file the user is editing (agents
/// read files themselves, so paths only). The built-in agent takes its context in `_meta`, for
/// its system prompt.
/// `active_line` names the file in front as `ai-context-builder` does (path, language, unsaved
/// changes); `active_tab` gives the built-in agent its language and whether it is unsaved.
/// The editor files the message attaches as open tabs or selections (`openBuffers`,
/// `editorSelections`), which scope the project rules like attached files do.
pub(crate) fn attached_editor_files(attachments: &[Attachment]) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = Vec::new();
    for attachment in attachments {
        let path = match attachment {
            Attachment::Context { reference: crate::context_refs::ContextRef::Tab { path: Some(path), .. } | crate::context_refs::ContextRef::Selection { path, .. }, .. } => path,
            _ => continue,
        };
        if !files.contains(path) {
            files.push(path.clone());
        }
    }
    files
}

/// `context_files` are the editor files the message attaches; the built-in agent counts them
/// among the files in play for project rules.
fn prompt_context(
    info: &SessionInfo,
    active_file: Option<&std::path::Path>,
    active_line: Option<&str>,
    active_tab: Option<&workbench_api::OpenTab>,
    context_files: &[PathBuf],
    team: Option<&str>,
) -> (Option<String>, Option<schema::Meta>) {
    if builtin::is_builtin(&info.agent) {
        let mut athas = serde_json::Map::new();
        if !context_files.is_empty() {
            athas.insert("openBuffers".into(), serde_json::json!(context_files));
        }
        if let Some(path) = active_file {
            athas.insert("activeFile".into(), serde_json::json!(path));
            if let Some(tab) = active_tab {
                if let Some(language) = &tab.language {
                    athas.insert("activeFileLanguage".into(), serde_json::json!(language));
                }
                athas.insert("activeFileDirty".into(), serde_json::json!(tab.dirty));
            }
        }
        if let Some(team) = team {
            athas.insert("teamInstructions".into(), serde_json::json!(team));
        }
        let meta = (!athas.is_empty()).then(|| {
            let mut meta = schema::Meta::new();
            meta.insert("athas".into(), serde_json::Value::Object(athas));
            meta
        });
        return (None, meta);
    }
    let team = team.map(crate::team_context::section);
    if crate::codex::is_codex(&info.agent) {
        return (team, None);
    }
    let mut lines: Vec<String> = team.into_iter().collect();
    lines.push(
        "Athas ACP client integrations:\n- If your adapter exposes client integration requests, use `_athas/open_terminal` and `_athas/set_chat_title`.\n- Invoke them only as ACP integration requests. Never imitate them with a shell command.\n".into(),
    );
    if let Some(root) = &info.cwd {
        let name = root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "Unknown Project".into());
        lines.push(format!("Project: {name}"));
        lines.push(format!("Working directory: {}", root.display()));
    }
    if let Some(line) = active_line {
        lines.push(format!("Currently editing: {line}"));
    }
    ((!lines.is_empty()).then(|| lines.join("\n")), None)
}

/// The mode and option values a reattached session gets back (`restoreChatSessionSettings`,
/// `getModeToRestore`, `getConfigOptionsToRestore`): the ones the session had that the agent
/// still offers and does not already have.
fn settings_to_restore(
    saved_mode: Option<&str>,
    saved_options: &[(String, String)],
    modes: Option<&crate::thread::ModeState>,
    options: &[ConfigOption],
) -> (Option<String>, Vec<(String, String)>) {
    let mode = saved_mode
        .zip(modes)
        .filter(|(saved, modes)| modes.current != *saved && modes.available.iter().any(|mode| mode.id == *saved))
        .map(|(saved, _)| saved.to_string());
    let options = options
        .iter()
        .filter_map(|option| {
            let (_, value) = saved_options.iter().find(|(id, _)| *id == option.id)?;
            (*value != option.current && option.choices.iter().any(|choice| choice.value == *value)).then(|| (option.id.clone(), value.clone()))
        })
        .collect();
    (mode, options)
}

/// A way the agent offers to sign in (`components/messages/acp-auth-choice.tsx`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AuthChoice {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// For a terminal method: how it runs in a terminal.
    pub terminal: Option<acp::TerminalLaunch>,
}

impl AuthChoice {
    /// `agent_args` are what the agent's program runs with, which a terminal method keeps.
    fn from_methods(methods: &[schema::AuthMethod], agent_args: &[String]) -> Vec<Self> {
        methods
            .iter()
            .map(|method| AuthChoice {
                id: method.id().0.to_string(),
                name: method.name().to_string(),
                description: method.description().map(str::to_string),
                terminal: acp::terminal_launch(method, agent_args),
            })
            .collect()
    }
}

pub(crate) enum StartFailure {
    NotInstalled { name: String, hint: String },
    /// The agent wants the user signed in: its sign-in methods, the program to sign in with, and
    /// why the method tried failed.
    SignIn(Vec<AuthChoice>, String, Option<String>),
    Failed(String),
}

/// The id of a transcript row a `!` command from the composer ran in.
pub(crate) const USER_COMMAND_PREFIX: &str = "user-command-";

/// The reply for a turn that only changed this part of the session (`commandResultLabel`).
fn state_update_label(update: &schema::SessionUpdate) -> Option<String> {
    Some(match update {
        schema::SessionUpdate::CurrentModeUpdate(update) => format!("Mode set to `{}`.", update.current_mode_id.0),
        schema::SessionUpdate::ConfigOptionUpdate(update) => {
            if update.config_options.len() == 1 { "Session option updated.".into() } else { "Session options updated.".into() }
        }
        schema::SessionUpdate::SessionInfoUpdate(update) => match &update.title {
            agent_client_protocol_schema::MaybeUndefined::Value(title) if !title.trim().is_empty() => format!("Session title updated to \"{}\".", title.trim()),
            _ => "Session metadata updated.".into(),
        },
        schema::SessionUpdate::AvailableCommandsUpdate(_) => "Slash commands refreshed.".into(),
        _ => return None,
    })
}

/// The entries a turn added after its prompt at `start`.
fn turn_entries_after(entries: &[Entry], start: Option<usize>) -> &[Entry] {
    start.and_then(|start| entries.get(start + 1..)).unwrap_or_default()
}

/// Whether a turn's entries show anything: text, images, a view, a step or a thought
/// (`hasVisibleResponse`).
fn has_visible_response(entries: &[Entry]) -> bool {
    entries.iter().any(|entry| match entry {
        Entry::Agent(message) => !message.text.trim().is_empty() || !message.images.is_empty() || !message.ui.is_empty(),
        Entry::ToolCall(_) | Entry::Thought(_) => true,
        Entry::User(_) | Entry::Notice(_) => false,
    })
}

/// Where the agent works: the project, or for a chat of no project a folder of Athas's own.
fn session_cwd(info: &SessionInfo) -> PathBuf {
    if let Some(cwd) = &info.cwd {
        return cwd.clone();
    }
    persistence::sessions_dir()
        .and_then(|dir| dir.parent().map(|parent| parent.join("chats")))
        .unwrap_or_else(std::env::temp_dir)
}

/// A tool call's path made absolute (`resolveWorkspacePath`): `~/…` against `home`, never joined
/// to the project (that made `<root>/~/…`), other relative paths against `cwd`; absolute and
/// `remote://` paths as they are.
pub(crate) fn resolve_tool_path(path: &std::path::Path, cwd: Option<&std::path::Path>, home: Option<&std::path::Path>) -> PathBuf {
    let text = path.to_string_lossy();
    if text == "~" || text.starts_with("~/") || text.starts_with("~\\") {
        return match home {
            Some(home) => home.join(text[1..].trim_start_matches(['/', '\\'])),
            None => path.to_path_buf(),
        };
    }
    if path.is_absolute() || text.starts_with("remote://") {
        return path.to_path_buf();
    }
    match cwd {
        Some(cwd) => cwd.join(path),
        None => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_paths_resolve_against_home_and_the_project() {
        let cwd = Some(std::path::Path::new("/code/athas"));
        let home = Some(std::path::Path::new("/Users/me"));
        let resolve = |path: &str| resolve_tool_path(std::path::Path::new(path), cwd, home);
        assert_eq!(resolve("~/notes/a.md"), PathBuf::from("/Users/me/notes/a.md"));
        assert_eq!(resolve("~"), PathBuf::from("/Users/me"));
        assert_eq!(resolve("src/main.rs"), PathBuf::from("/code/athas/src/main.rs"));
        assert_eq!(resolve("/etc/hosts"), PathBuf::from("/etc/hosts"));
        assert_eq!(resolve("remote://host/a"), PathBuf::from("remote://host/a"));
        assert_eq!(resolve_tool_path(std::path::Path::new("~/a"), cwd, None), PathBuf::from("~/a"));
    }

    #[test]
    fn the_screenshot_fixture_parses() {
        let fixture: Fixture = serde_json::from_str(include_str!("../fixtures/session.json")).unwrap();
        assert!(fixture.running);
        assert_eq!(fixture.permission.unwrap().options.len(), 3);
        assert_eq!(fixture.transcript.entries.len(), 9);
        assert_eq!(fixture.transcript.plan.len(), 4);
    }

    #[test]
    fn a_reattached_session_gets_its_mode_and_options_back() {
        use crate::thread::{ConfigChoice, Mode, ModeState};
        let mode = |id: &str| Mode { id: id.into(), name: id.into(), description: None };
        let modes = ModeState { current: "default".into(), available: vec![mode("default"), mode("plan")] };
        let choice = |value: &str| ConfigChoice { value: value.into(), name: value.into(), description: None, group: None };
        let options = vec![ConfigOption { id: "model".into(), name: "Model".into(), category: None, current: "a".into(), choices: vec![choice("a"), choice("b")], default: None }];
        let saved = vec![("model".to_string(), "b".to_string()), ("gone".to_string(), "x".to_string())];
        assert_eq!(settings_to_restore(Some("plan"), &saved, Some(&modes), &options), (Some("plan".into()), vec![("model".into(), "b".into())]));
        let saved = vec![("model".to_string(), "c".to_string())];
        assert_eq!(settings_to_restore(Some("missing"), &saved, Some(&modes), &options), (None, Vec::new()));
        assert_eq!(settings_to_restore(Some("default"), &[], Some(&modes), &options), (None, Vec::new()));
    }

    #[test]
    fn chats_of_no_project_work_in_a_folder_of_their_own() {
        let info = SessionInfo { id: "s".into(), title: String::new(), agent: "claude-code".into(), cwd: None };
        assert!(session_cwd(&info).ends_with("chats"));
        let info = SessionInfo { cwd: Some("/code/athas".into()), ..info };
        assert_eq!(session_cwd(&info), PathBuf::from("/code/athas"));
    }
}

/// Whether an open editor holds unsaved edits to `path` (`hasUnsavedBuffer`): paths compare with
/// `.` parts left out, and without case on macOS and Windows.
pub(crate) fn has_unsaved_buffer(path: &std::path::Path, cx: &App) -> bool {
    fn normalize(path: &std::path::Path) -> String {
        let text = path.to_string_lossy().replace('\\', "/").split('/').filter(|part| *part != ".").collect::<Vec<_>>().join("/");
        if cfg!(any(target_os = "macos", target_os = "windows")) { text.to_lowercase() } else { text }
    }
    let target = normalize(path);
    workbench_api::open_tabs(cx).iter().any(|tab| tab.dirty && tab.path.as_deref().is_some_and(|open| normalize(open) == target))
}
