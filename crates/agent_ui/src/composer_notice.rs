//! The one notice over the composer (`lib/composer-notice.ts`, `components/input/composer-notice.tsx`):
//! account access first, then a missing key, billing that stops the chat, the connection, then
//! usage warnings. Each carries the action that fixes it; a dismissed notice gives way to the next.

use std::collections::HashSet;

use gpui::{AnyElement, App, ClickEvent, Context, IntoElement, ParentElement, Styled, div, prelude::*, px};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, typography};

use crate::SessionView;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoticeTone {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoticeAction {
    SignIn,
    ReopenSignIn,
    CancelSignIn,
    RetrySession,
    /// Reads the account's plan again (`retry-account`).
    RetryAccount,
    AddApiKey,
    ConfigureModels,
    OpenBilling,
    RetryTurn,
    RestartAgent,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ComposerNotice {
    /// Stable for one situation, so a dismissal hides that situation and nothing newer.
    pub id: String,
    pub tone: NoticeTone,
    pub icon: IconName,
    pub title: String,
    pub description: String,
    pub primary: Option<(NoticeAction, String)>,
    pub secondary: Option<(NoticeAction, String)>,
    pub dismissible: bool,
    /// The primary action is under way: it shows a spinner and cannot be pressed again.
    pub busy: bool,
}

/// Where the hosted credit stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UsageLevel {
    Normal,
    Low,
    IncludedExhausted,
    Exhausted,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Usage {
    pub used_percent: u32,
    pub remaining_cents: i64,
    pub allowance_cents: i64,
    pub wallet_balance_cents: Option<i64>,
    pub period_end: Option<String>,
}

impl Usage {
    pub fn level(&self) -> UsageLevel {
        let balance_empty = self.wallet_balance_cents.is_none_or(|balance| balance <= 0);
        if self.allowance_cents > 0 && self.remaining_cents > 0 {
            if self.used_percent >= 80 { UsageLevel::Low } else { UsageLevel::Normal }
        } else if balance_empty {
            UsageLevel::Exhausted
        } else {
            UsageLevel::IncludedExhausted
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NoticeInput {
    /// The built-in agent talks to Athas hosted models.
    pub hosted: bool,
    /// The built-in agent's provider has no key, so nothing can be sent.
    pub provider_blocked: bool,
    pub provider_name: String,
    pub loading: bool,
    pub signed_in: bool,
    pub has_subscription: bool,
    pub account_error: Option<String>,
    /// A saved session the server did not answer for: (title, message).
    pub session_check: Option<(String, String)>,
    pub signing_in: bool,
    pub sign_in_error: Option<String>,
    pub usage: Option<Usage>,
    /// The last turn failed because the connection dropped.
    pub last_turn_offline: bool,
    /// The agent process went away on its own: why.
    pub agent_disconnected: Option<String>,
    /// A notice action (reading the plan again) is under way.
    pub action_pending: bool,
}

fn notice(id: &str, tone: NoticeTone, icon: IconName, title: impl Into<String>, description: impl Into<String>) -> ComposerNotice {
    ComposerNotice { id: id.into(), tone, icon, title: title.into(), description: description.into(), primary: None, secondary: None, dismissible: false, busy: false }
}

fn action(action: NoticeAction, label: &str) -> Option<(NoticeAction, String)> {
    Some((action, label.to_string()))
}

fn auth_notice(input: &NoticeInput) -> Option<ComposerNotice> {
    if input.signing_in {
        let mut notice = notice("auth:signing-in", NoticeTone::Info, IconName::SignIn, "Finish signing in from your browser", "Athas opened a sign-in page. This chat unlocks once you're done.");
        notice.primary = action(NoticeAction::ReopenSignIn, "Open page again");
        notice.secondary = action(NoticeAction::CancelSignIn, "Cancel");
        return Some(notice);
    }
    if let Some((title, message)) = &input.session_check {
        let mut notice = notice(&format!("auth:session-check:{title}"), NoticeTone::Warning, IconName::CloudWarning, title.clone(), format!("{message} Your session is kept; retrying automatically."));
        notice.primary = action(NoticeAction::RetrySession, if input.loading { "Checking…" } else { "Retry now" });
        notice.busy = input.loading;
        return Some(notice);
    }
    if input.loading {
        return None;
    }
    if let Some(error) = &input.sign_in_error {
        let mut notice = notice("auth:sign-in-failed", NoticeTone::Error, IconName::SignIn, "Sign-in did not finish", error.clone());
        notice.primary = action(NoticeAction::SignIn, "Try again");
        return Some(notice);
    }
    if !input.signed_in {
        let mut notice = notice("auth:signed-out", NoticeTone::Info, IconName::SignIn, "Sign in to use Athas models", "Or switch to a model from a provider you have connected.");
        notice.primary = action(NoticeAction::SignIn, "Sign in");
        notice.secondary = action(NoticeAction::ConfigureModels, "Models");
        return Some(notice);
    }
    if !input.has_subscription {
        let mut notice = notice(
            "auth:plan-unavailable",
            NoticeTone::Warning,
            IconName::Warning,
            "Could not load your Athas plan",
            input.account_error.clone().unwrap_or_else(|| "Athas did not return your plan.".into()),
        );
        notice.primary = action(NoticeAction::RetryAccount, if input.action_pending { "Retrying…" } else { "Retry" });
        notice.busy = input.action_pending;
        return Some(notice);
    }
    None
}

fn reset_suffix(usage: &Usage) -> String {
    usage.period_end.as_ref().map(|end| format!(" Included credit resets {end}.")).unwrap_or_default()
}

fn billing_notice(usage: &Usage) -> Option<ComposerNotice> {
    if usage.level() != UsageLevel::Exhausted {
        return None;
    }
    let has_balance = usage.wallet_balance_cents.is_some();
    let description = if has_balance {
        format!("Add credit to keep using Athas models, or switch models.{}", reset_suffix(usage))
    } else {
        match &usage.period_end {
            Some(end) => format!("Switch models until your included credit resets {end}."),
            None => "Switch models until your included credit resets.".into(),
        }
    };
    let mut notice = notice("billing:exhausted", NoticeTone::Error, IconName::CreditCard, "Out of Athas credit", description);
    notice.primary = action(NoticeAction::OpenBilling, if has_balance { "Add credit" } else { "Manage billing" });
    notice.secondary = action(NoticeAction::ConfigureModels, "Models");
    Some(notice)
}

fn usage_notice(usage: &Usage) -> Option<ComposerNotice> {
    let balance = usage.wallet_balance_cents.map(account::gates::format_cents);
    match usage.level() {
        UsageLevel::Low => {
            let mut notice = notice(
                "usage:low",
                NoticeTone::Warning,
                IconName::CreditCard,
                format!("{}% of included credit used", usage.used_percent),
                format!(
                    "{} of {} left.{}{}",
                    account::gates::format_cents(usage.remaining_cents),
                    account::gates::format_cents(usage.allowance_cents),
                    balance.map(|balance| format!(" Then usage continues from your {balance} balance.")).unwrap_or_default(),
                    reset_suffix(usage)
                ),
            );
            notice.primary = action(NoticeAction::OpenBilling, "Manage billing");
            notice.dismissible = true;
            Some(notice)
        }
        UsageLevel::IncludedExhausted => {
            let mut notice = notice(
                "usage:balance",
                NoticeTone::Info,
                IconName::CreditCard,
                "Now using your balance",
                format!("Included credit is used up. {} left.{}", balance.unwrap_or_else(|| "$0.00".into()), reset_suffix(usage)),
            );
            notice.primary = action(NoticeAction::OpenBilling, "Add credit");
            notice.dismissible = true;
            Some(notice)
        }
        _ => None,
    }
}

/// The one notice to show, or `None`.
pub fn resolve(input: &NoticeInput, dismissed: &HashSet<String>) -> Option<ComposerNotice> {
    let hosted_account = input.hosted && input.signed_in;
    let candidates: [&dyn Fn() -> Option<ComposerNotice>; 6] = [
        &|| if input.hosted { auth_notice(input) } else { None },
        &|| {
            (!input.hosted && input.provider_blocked).then(|| {
                let mut notice = notice(
                    "provider:missing-key",
                    NoticeTone::Info,
                    IconName::Key,
                    format!("Add an API key for {}", input.provider_name),
                    "The key stays on this machine. Or switch to another model.",
                );
                notice.primary = action(NoticeAction::AddApiKey, "Add API key");
                notice.secondary = action(NoticeAction::ConfigureModels, "Models");
                notice
            })
        },
        &|| {
            input.agent_disconnected.as_ref().map(|reason| {
                let mut notice = notice("agent:disconnected", NoticeTone::Warning, IconName::WarningCircle, "Agent disconnected", reason.clone());
                notice.primary = action(NoticeAction::RestartAgent, "Restart agent");
                notice.dismissible = true;
                notice
            })
        },
        &|| if hosted_account { input.usage.as_ref().and_then(billing_notice) } else { None },
        &|| {
            input.last_turn_offline.then(|| {
                let mut notice = notice("connection:back-online", NoticeTone::Info, IconName::Info, "Connection lost", "The last prompt did not go through.");
                notice.primary = action(NoticeAction::RetryTurn, "Send again");
                notice.dismissible = true;
                notice
            })
        },
        &|| if hosted_account { input.usage.as_ref().and_then(usage_notice) } else { None },
    ];
    candidates.iter().filter_map(|candidate| candidate()).find(|notice| !dismissed.contains(&notice.id))
}

/// The command line a terminal method signs in with, as shown under it.
fn auth_command_line(program: &str, method: &crate::session_view::AuthChoice) -> Option<String> {
    let launch = method.terminal.as_ref()?;
    let program = launch.program.as_deref().unwrap_or(program);
    Some(std::iter::once(program).chain(launch.args.iter().map(String::as_str)).collect::<Vec<_>>().join(" "))
}

/// Runs a sign-in `command` in a terminal so its exit status lands in `status`
/// (`services/acp-terminal-auth.ts`): the code, or the signal that stopped it, HUP meaning the
/// terminal was closed first.
fn terminal_auth_command(command: &str, status: &std::path::Path) -> String {
    // The status file is the script's `$0`, so it needs no quoting inside the traps.
    let script = format!(
        "trap 'echo signal:SIGHUP > \"$0\"; exit 129' HUP; trap 'echo signal:SIGINT > \"$0\"; exit 130' INT; trap 'echo signal:SIGTERM > \"$0\"; exit 143' TERM; {command}; echo $? > \"$0\""
    );
    format!("sh -c {} {}", shell_quote(&script), shell_quote(&status.to_string_lossy()))
}

/// How a terminal sign-in ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TerminalAuthExit {
    Code(Option<i32>),
    Signal(String),
}

impl TerminalAuthExit {
    fn parse(text: &str) -> Self {
        let text = text.trim();
        match text.strip_prefix("signal:") {
            Some(signal) => TerminalAuthExit::Signal(signal.to_string()),
            None => TerminalAuthExit::Code(text.parse().ok()),
        }
    }

    /// Why it did not sign in (`describeAcpTerminalAuthFailure`); none when it exited cleanly.
    fn failure(&self) -> Option<String> {
        match self {
            TerminalAuthExit::Code(Some(0)) => None,
            TerminalAuthExit::Signal(signal) if signal == "SIGHUP" => Some("The sign-in tab was closed before signing in finished.".into()),
            TerminalAuthExit::Signal(signal) => Some(format!("The sign-in command was stopped ({signal}).")),
            TerminalAuthExit::Code(None) => Some("The sign-in command ended without an exit status.".into()),
            TerminalAuthExit::Code(Some(code)) => Some(format!("The sign-in command exited with code {code}.")),
        }
    }
}

/// Whether the latest prompt got no reply, so it goes again once the agent is signed in.
fn failed_prompt(entries: &[crate::thread::Entry]) -> bool {
    use crate::thread::Entry;
    match entries.iter().rposition(|entry| matches!(entry, Entry::User(_))) {
        Some(index) => !entries[index + 1..].iter().any(|entry| matches!(entry, Entry::Agent(_) | Entry::ToolCall(_) | Entry::Thought(_))),
        None => false,
    }
}

fn shell_quote(part: &str) -> String {
    if !part.is_empty() && part.chars().all(|ch| ch.is_ascii_alphanumeric() || "-_./=:@".contains(ch)) { part.to_string() } else { format!("'{}'", part.replace('\'', "'\\''")) }
}

/// Whether an error message reads as a dropped connection rather than a refusal.
pub fn is_connection_error(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    ["error sending request", "connection refused", "connection reset", "network", "dns error", "failed to lookup", "timed out", "offline", "could not connect", "connection closed"]
        .iter()
        .any(|needle| message.contains(needle))
}

fn session_check_title(reason: &account::api::CheckFailure) -> &'static str {
    match reason {
        account::api::CheckFailure::LocalServerDown => "Local Athas server is not running",
        account::api::CheckFailure::Timeout => "Athas is not responding",
        account::api::CheckFailure::ServerError => "Athas is having trouble",
        account::api::CheckFailure::Unreachable => "Can't reach Athas",
    }
}

impl SessionView {
    /// The built-in agent's provider for this session needs an API key and has none
    /// (`isInputEnabled` false): the composer does not send.
    pub(crate) fn provider_blocked(&self, cx: &App) -> bool {
        // Fixture runs stand in for the provider, so they never lack a key.
        if !crate::builtin::is_builtin(&self.info.agent) || cx.try_global::<settings::SettingsStore>().is_none() || std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() {
            return false;
        }
        let provider = crate::builtin::session_provider(crate::intelligence::task_provider(settings::get(cx), "agent"), &self.transcript);
        let provider = ai_providers::catalog::provider(&provider.provider_id).or_else(|| ai_providers::external::external_provider(&provider.provider_id));
        provider.is_some_and(|provider| {
            !provider.is_hosted() && provider.requires_api_key && ai_providers::secrets::api_key(&crate::ai_settings::KeychainRef, provider).is_none()
        })
    }

    fn notice_input(&self, cx: &App) -> NoticeInput {
        let builtin = crate::builtin::is_builtin(&self.info.agent);
        let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
        let provider = ai_providers::catalog::provider(&settings.ai_provider_id).or_else(|| ai_providers::external::external_provider(&settings.ai_provider_id));
        let hosted = builtin && provider.is_none_or(|provider| provider.is_hosted());
        let provider_blocked = builtin
            && !hosted
            && provider.is_some_and(|provider| {
                provider.requires_api_key && {
                    let secrets: &dyn ai_providers::SecretStore = if std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() { &ai_providers::MemorySecrets::default() } else { &crate::ai_settings::KeychainRef };
                    ai_providers::secrets::api_key(secrets, provider).is_none()
                }
            });
        let mut input = NoticeInput {
            hosted,
            provider_blocked,
            provider_name: provider.map_or_else(String::new, |provider| provider.name.to_string()),
            last_turn_offline: self.offline_prompt.is_some(),
            action_pending: self.notice_action_pending,
            agent_disconnected: self.agent_disconnected.clone(),
            signed_in: true,
            has_subscription: true,
            ..Default::default()
        };
        if hosted && let Some(store) = account::AccountStore::global(cx) {
            let store = store.read(cx);
            let state = store.state();
            input.loading = state.is_loading();
            input.signed_in = store.is_signed_in();
            input.has_subscription = store.subscription().is_some();
            input.account_error = state.error.clone();
            input.session_check = store.session_check().map(|check| (session_check_title(&check.reason).to_string(), check.message.clone()));
            input.signing_in = !matches!(state.sign_in, account::state::SignInFlow::Idle);
            input.sign_in_error = state.sign_in_error.clone();
            input.usage = store.subscription().and_then(|subscription| subscription.credits.as_ref()).map(|credits| {
                let used = credits.used_cents + credits.pending_cents;
                Usage {
                    used_percent: if credits.allowance_cents > 0 { ((used as f64 / credits.allowance_cents as f64) * 100.).round().clamp(0., 100.) as u32 } else { 100 },
                    remaining_cents: credits.remaining_cents,
                    allowance_cents: credits.allowance_cents,
                    wallet_balance_cents: credits.wallet_balance_cents,
                    period_end: credits.period_end.as_ref().map(|end| end.split('T').next().unwrap_or(end).to_string()),
                }
            });
        }
        input
    }

    fn run_notice_action(&mut self, action: NoticeAction, cx: &mut Context<Self>) {
        let store = account::AccountStore::global(cx);
        match action {
            NoticeAction::SignIn => {
                if let Some(store) = store {
                    store.update(cx, |store, cx| store.sign_in(cx));
                }
            }
            NoticeAction::ReopenSignIn => {
                if let Some(store) = store {
                    store.update(cx, |store, cx| store.reopen_sign_in(cx));
                }
            }
            NoticeAction::CancelSignIn => {
                if let Some(store) = store {
                    store.update(cx, |store, cx| store.cancel_sign_in(cx));
                }
            }
            NoticeAction::RetrySession => {
                if let Some(store) = store {
                    store.update(cx, |store, cx| store.retry_session_check(cx));
                }
            }
            NoticeAction::RetryAccount => {
                if let Some(store) = store
                    && !self.notice_action_pending
                {
                    self.notice_action_pending = true;
                    let refresh = store.update(cx, |store, cx| store.refresh_subscription(cx));
                    cx.spawn(async move |this, cx| {
                        refresh.await;
                        this.update(cx, |this, cx| {
                            this.notice_action_pending = false;
                            cx.notify();
                        })
                        .ok();
                    })
                    .detach();
                }
            }
            NoticeAction::AddApiKey => {
                let provider = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).ai_provider_id.clone());
                workbench_api::open_provider_api_key(cx, provider.as_deref());
            }
            NoticeAction::ConfigureModels => workbench_api::open_settings(cx, Some("ai"), None),
            NoticeAction::OpenBilling => account::open_service_url(cx, account::ServiceUrls::billing),
            NoticeAction::RestartAgent => self.restart_agent(cx),
            NoticeAction::RetryTurn => {
                if let Some(prompt) = self.offline_prompt.take() {
                    self.send(prompt, cx);
                }
            }
        }
        cx.notify();
    }

    /// Signs in with the method picked (`stores/acp-auth.store.ts choose`): an agent method on the
    /// next start; a terminal method runs the agent's sign-in command in a terminal, waits for it
    /// to exit and starts the agent again once it succeeded. The failed prompt then goes again.
    fn pick_auth(&mut self, index: usize, cx: &mut Context<Self>) {
        if self.auth_signing_in.is_some() || self.auth_terminal.is_some() {
            return;
        }
        let Some((methods, program)) = self.auth_choices.clone() else { return };
        let Some(method) = methods.get(index) else { return };
        match &method.terminal {
            Some(launch) => {
                // The method's environment goes in front through `env`; the line shown leaves it out.
                let env = launch.env.iter().map(|(name, value)| shell_quote(&format!("{name}={value}")));
                let env_prefix = if launch.env.is_empty() { Vec::new() } else { std::iter::once("env".to_string()).chain(env).collect() };
                let program = launch.program.as_deref().unwrap_or(program.as_str());
                let command = env_prefix
                    .into_iter()
                    .chain(std::iter::once(program).chain(launch.args.iter().map(String::as_str)).map(shell_quote))
                    .collect::<Vec<_>>()
                    .join(" ");
                if cfg!(windows) || cfg!(target_family = "wasm") {
                    workbench_api::run_in_terminal(cx, command, self.info.cwd.clone());
                    self.input_notice = Some("Finish signing in in the terminal, then send again.".into());
                    cx.notify();
                    return;
                }
                let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_nanos()).unwrap_or_default();
                let status = std::env::temp_dir().join(format!("athas-acp-auth-{}-{nanos}.status", std::process::id()));
                std::fs::remove_file(&status).ok();
                workbench_api::run_in_terminal(cx, terminal_auth_command(&command, &status), self.info.cwd.clone());
                self.auth_error = None;
                let method_id = method.id.clone();
                let wait = cx.spawn({
                    let method_id = method_id.clone();
                    async move |this, cx| {
                        let exit = loop {
                            cx.background_executor().timer(std::time::Duration::from_millis(500)).await;
                            let read = status.clone();
                            let text = cx.background_spawn(async move { std::fs::read_to_string(&read).ok() }).await;
                            if let Some(text) = text.filter(|text| text.ends_with('\n')) {
                                std::fs::remove_file(&status).ok();
                                break TerminalAuthExit::parse(&text);
                            }
                            if this.upgrade().is_none() {
                                std::fs::remove_file(&status).ok();
                                return;
                            }
                        };
                        this.update(cx, |this, cx| this.terminal_auth_exited(&method_id, exit, cx)).ok();
                    }
                });
                self.auth_terminal = Some((method_id, wait));
            }
            None => {
                // The methods stay up, the picked one reading "Signing in…", until the agent has
                // started signed in or failed again.
                self.preferred_auth = Some(method.id.clone());
                self.auth_signing_in = Some(method.id.clone());
                self.auth_error = None;
                self.resume_after_sign_in(cx);
            }
        }
        cx.notify();
    }

    fn terminal_auth_exited(&mut self, method_id: &str, exit: TerminalAuthExit, cx: &mut Context<Self>) {
        if self.auth_terminal.as_ref().is_none_or(|(active, _)| active != method_id) {
            return;
        }
        self.auth_terminal = None;
        match exit.failure() {
            Some(error) => self.auth_error = Some(error),
            None => {
                // The sign-in happened outside the agent's connection, so the agent starts again.
                self.auth_signing_in = Some(method_id.to_string());
                self.auth_error = None;
                self.restart_for_sign_in(cx);
            }
        }
        cx.notify();
    }

    /// Stops waiting on a terminal sign-in and lets the user pick again (`cancel`).
    fn stop_auth_wait(&mut self, cx: &mut Context<Self>) {
        self.auth_terminal = None;
        cx.notify();
    }

    fn restart_for_sign_in(&mut self, cx: &mut Context<Self>) {
        self.drop_agent_for_sign_in(cx);
        self.resume_after_sign_in(cx);
    }

    /// Starts the agent signed in, then sends the prompt that needed the sign-in again, if one did.
    fn resume_after_sign_in(&mut self, cx: &mut Context<Self>) {
        if !matches!(self.agent, crate::session_view::AgentState::Stopped) {
            return;
        }
        let failed = failed_prompt(&self.transcript.entries);
        cx.spawn(async move |this, cx| {
            if Self::start_for_sign_in(&this, cx).await && failed {
                this.update(cx, |this, cx| {
                    let end = this.transcript.entries.len();
                    this.retry_turn_before(end, cx);
                })
                .ok();
            }
        })
        .detach();
    }

    /// The error entry that carries the sign-in choice (`chat-error-block.tsx`, only the latest
    /// error offers sign-in since signing in retries its prompt): the last error notice with no
    /// prompt after it, while the agent waits for a sign-in.
    pub(crate) fn auth_choice_entry(&self) -> Option<usize> {
        self.auth_choices.as_ref()?;
        let entries = &self.transcript.entries;
        let last_user = entries.iter().rposition(|entry| matches!(entry, crate::thread::Entry::User(_)));
        entries
            .iter()
            .enumerate()
            .rev()
            .take_while(|(index, _)| last_user.is_none_or(|user| *index > user))
            .find(|(_, entry)| matches!(entry, crate::thread::Entry::Notice(notice) if notice.kind == crate::thread::NoticeKind::Error))
            .map(|(index, _)| index)
    }

    /// The sign-in methods inside the error card (`acp-auth-choice.tsx`): "Choose how to sign
    /// in.", each method with its description and command line, Stop waiting while a terminal
    /// sign-in runs, and a failed method's error.
    pub(crate) fn render_auth_choice_inline(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (methods, program) = self.auth_choices.as_ref()?;
        let colors = cx.theme().colors.clone();
        let waiting = self.auth_terminal.as_ref().map(|(method, _)| method.as_str());
        let busy = self.auth_signing_in.is_some() || waiting.is_some();
        let rows: Vec<AnyElement> = methods
            .iter()
            .enumerate()
            .map(|(index, method)| {
                let label = if waiting == Some(method.id.as_str()) {
                    "Finish signing in in the terminal…".to_string()
                } else if self.auth_signing_in.as_deref() == Some(method.id.as_str()) {
                    "Signing in…".to_string()
                } else {
                    method.name.clone()
                };
                let icon = if method.terminal.is_some() { IconName::TerminalWindow } else { IconName::Key };
                div()
                    .flex()
                    .flex_col()
                    .items_start()
                    .gap(px(2.))
                    .min_w_0()
                    .child(
                        Button::new(("auth-inline-method", index), label)
                            .leading_icon(icon)
                            .size(ButtonSize::Small)
                            .disabled(busy)
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.pick_auth(index, cx))),
                    )
                    .children(method.description.clone().map(|description| div().text_color(colors.subtle_foreground).child(description)))
                    .children(auth_command_line(program, method).map(|command| {
                        div().font_family(typography::MONO_FONT).text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(command)
                    }))
                    .into_any_element()
            })
            .collect();
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .min_w_0()
                .child(div().text_color(colors.foreground).child("Choose how to sign in."))
                .children(rows)
                .when(waiting.is_some(), |this| {
                    this.child(
                        div().child(
                            Button::new("auth-inline-stop-waiting", "Stop waiting")
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::Small)
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.stop_auth_wait(cx))),
                        ),
                    )
                })
                .children(self.auth_error.clone().map(|error| div().text_color(colors.destructive).child(error)))
                .into_any_element(),
        )
    }

    fn render_auth_choice(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if self.auth_choice_entry().is_some() {
            return None;
        }
        let (methods, program) = self.auth_choices.as_ref()?;
        let colors = cx.theme().colors.clone();
        let waiting = self.auth_terminal.as_ref().map(|(method, _)| method.as_str());
        let busy = self.auth_signing_in.is_some() || waiting.is_some();
        let mut buttons: Vec<AnyElement> = methods
            .iter()
            .enumerate()
            .take(3)
            .map(|(index, method)| {
                let label = if waiting == Some(method.id.as_str()) {
                    "Finish signing in in the terminal…".to_string()
                } else if self.auth_signing_in.as_deref() == Some(method.id.as_str()) {
                    "Signing in…".to_string()
                } else {
                    method.name.clone()
                };
                let icon = if method.terminal.is_some() { IconName::TerminalWindow } else { IconName::Key };
                let mut button = Button::new(("auth-method", index), label)
                    .leading_icon(icon)
                    .variant(if index == 0 { ButtonVariant::Default } else { ButtonVariant::Ghost })
                    .size(ButtonSize::Small)
                    .disabled(busy)
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.pick_auth(index, cx)));
                let tooltip = [method.description.clone(), auth_command_line(program, method)].into_iter().flatten().collect::<Vec<_>>().join("\n");
                if !tooltip.is_empty() {
                    button = button.tooltip(tooltip);
                }
                button.into_any_element()
            })
            .collect();
        if waiting.is_some() {
            buttons.push(
                Button::new("auth-stop-waiting", "Stop waiting")
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.stop_auth_wait(cx)))
                    .into_any_element(),
            );
        }
        let waiting_command = waiting.and_then(|id| methods.iter().find(|method| method.id == id)).and_then(|method| auth_command_line(program, method));
        let hint = match (&self.auth_error, waiting_command) {
            (Some(error), _) => div().text_size(typography::TEXT_CAPTION).text_color(colors.destructive).truncate().child(error.clone()),
            (None, Some(command)) => div().text_size(typography::TEXT_CAPTION).font_family(typography::MONO_FONT).text_color(colors.muted_foreground).truncate().child(command),
            (None, None) => div().text_size(typography::TEXT_CAPTION).text_color(colors.muted_foreground).truncate().child("Choose how to sign in. The chat continues once you're done."),
        };
        Some(
            div()
                .flex()
                .items_center()
                .gap(px(10.))
                .px(px(12.))
                .py(px(8.))
                .rounded(ui::metrics::ISLAND_RADIUS)
                .border_1()
                .border_color(colors.border)
                .bg(colors.raised)
                .child(Icon::new(IconName::SignIn).size(IconSize::Small).color(colors.primary))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(div().text_size(typography::TEXT_SM).text_color(colors.foreground).child(format!("Sign in to {}", self.agent_name())))
                        .child(hint),
                )
                .children(buttons)
                .into_any_element(),
        )
    }

    pub(crate) fn render_composer_notice(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if let Some(choice) = self.render_auth_choice(cx) {
            return Some(choice);
        }
        let notice = resolve(&self.notice_input(cx), &self.dismissed_notices)?;
        let colors = cx.theme().colors.clone();
        let tone = match notice.tone {
            NoticeTone::Info => colors.primary,
            NoticeTone::Warning => colors.warning,
            NoticeTone::Error => colors.destructive,
        };
        let busy = notice.busy;
        let button = |id: &'static str, (action, label): (NoticeAction, String), variant: ButtonVariant, cx: &mut Context<Self>| {
            let busy = busy && variant == ButtonVariant::Default;
            let mut button = Button::new(id, label.clone()).variant(variant).size(ButtonSize::Small).disabled(busy);
            if busy {
                button = button.leading(ui::Spinner::new("notice-busy").compact().label(label));
            }
            button.on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.run_notice_action(action, cx)))
        };
        let id = notice.id.clone();
        Some(
            div()
                .flex()
                .items_center()
                .gap(px(10.))
                .px(px(12.))
                .py(px(8.))
                .rounded(ui::metrics::ISLAND_RADIUS)
                .border_1()
                .border_color(colors.border)
                .bg(colors.raised)
                .child(Icon::new(notice.icon).size(IconSize::Small).color(tone))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(div().text_size(typography::TEXT_SM).text_color(colors.foreground).child(notice.title.clone()))
                        .child(div().text_size(typography::TEXT_CAPTION).text_color(colors.muted_foreground).truncate().child(notice.description.clone())),
                )
                .children(notice.secondary.clone().map(|secondary| button("notice-secondary", secondary, ButtonVariant::Ghost, cx)))
                .children(notice.primary.clone().map(|primary| button("notice-primary", primary, ButtonVariant::Default, cx)))
                .when(notice.dismissible, |this| {
                    this.child(
                        Button::icon("notice-dismiss", IconName::X).variant(ButtonVariant::Ghost).size(ButtonSize::Small).tooltip("Dismiss").on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                            this.dismissed_notices.insert(id.clone());
                            if id == "connection:back-online" {
                                this.offline_prompt = None;
                            }
                            cx.notify();
                        })),
                    )
                })
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hosted() -> NoticeInput {
        NoticeInput { hosted: true, signed_in: true, has_subscription: true, ..Default::default() }
    }

    #[test]
    fn a_missing_plan_retries_the_account_and_shows_it_busy() {
        let none = HashSet::new();
        let input = NoticeInput { has_subscription: false, ..hosted() };
        let notice = resolve(&input, &none).unwrap();
        assert_eq!((notice.primary.unwrap(), notice.busy), ((NoticeAction::RetryAccount, "Retry".to_string()), false));
        let pending = resolve(&NoticeInput { action_pending: true, ..input }, &none).unwrap();
        assert_eq!((pending.primary.unwrap().1.as_str(), pending.busy), ("Retrying…", true));
    }

    #[test]
    fn account_comes_first_then_billing_then_connection() {
        let none = HashSet::new();
        let signed_out = NoticeInput { signed_in: false, last_turn_offline: true, ..hosted() };
        assert_eq!(resolve(&signed_out, &none).unwrap().id, "auth:signed-out");
        let exhausted = NoticeInput { usage: Some(Usage { used_percent: 100, allowance_cents: 500, ..Default::default() }), last_turn_offline: true, ..hosted() };
        assert_eq!(resolve(&exhausted, &none).unwrap().id, "billing:exhausted");
        let offline = NoticeInput { last_turn_offline: true, ..hosted() };
        assert_eq!(resolve(&offline, &none).unwrap().primary.unwrap().0, NoticeAction::RetryTurn);
        let low = NoticeInput { usage: Some(Usage { used_percent: 85, remaining_cents: 75, allowance_cents: 500, ..Default::default() }), ..hosted() };
        let notice = resolve(&low, &none).unwrap();
        assert_eq!(notice.title, "85% of included credit used");
        assert!(resolve(&low, &HashSet::from([notice.id])).is_none());
    }

    #[test]
    fn a_disconnected_agent_offers_a_restart() {
        let input = NoticeInput { agent_disconnected: Some("Claude Agent disconnected unexpectedly.".into()), ..Default::default() };
        let notice = resolve(&input, &HashSet::new()).unwrap();
        assert_eq!(notice.primary.unwrap().0, NoticeAction::RestartAgent);
        assert!(notice.dismissible);
        assert!(resolve(&input, &HashSet::from([notice.id])).is_none());
    }

    #[test]
    fn a_provider_without_a_key_asks_for_one() {
        let input = NoticeInput { provider_blocked: true, provider_name: "OpenAI".into(), ..Default::default() };
        let notice = resolve(&input, &HashSet::new()).unwrap();
        assert_eq!(notice.title, "Add an API key for OpenAI");
        assert!(is_connection_error("error sending request for url (https://api.x)"));
        assert!(!is_connection_error("invalid api key"));
    }

    #[test]
    fn terminal_sign_in_reports_how_it_ended() {
        assert_eq!(TerminalAuthExit::parse("0\n").failure(), None);
        assert_eq!(TerminalAuthExit::parse("1\n").failure().as_deref(), Some("The sign-in command exited with code 1."));
        assert_eq!(TerminalAuthExit::parse("signal:SIGHUP\n").failure().as_deref(), Some("The sign-in tab was closed before signing in finished."));
        assert_eq!(TerminalAuthExit::parse("signal:SIGINT\n").failure().as_deref(), Some("The sign-in command was stopped (SIGINT)."));
        assert_eq!(TerminalAuthExit::parse("?\n").failure().as_deref(), Some("The sign-in command ended without an exit status."));
    }

    #[cfg(unix)]
    #[test]
    fn terminal_sign_in_command_writes_its_exit_status() {
        let dir = std::env::temp_dir().join(format!("athas-auth-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let status = dir.join("it's status");
        for (command, expected) in [("true", "0\n"), ("sh -c 'exit 3'", "3\n")] {
            let line = terminal_auth_command(command, &status);
            let ran = std::process::Command::new("sh").arg("-c").arg(&line).status().unwrap();
            assert!(ran.code().is_some());
            assert_eq!(std::fs::read_to_string(&status).unwrap(), expected);
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_an_unanswered_prompt_goes_again_after_sign_in() {
        use crate::thread::{AgentMessage, Entry, Notice, NoticeKind, UserMessage};
        let user = Entry::User(UserMessage { text: "hi".into(), ..Default::default() });
        let notice = Entry::Notice(Notice { kind: NoticeKind::Error, text: "sign in".into() });
        assert!(failed_prompt(&[user.clone(), notice.clone()]));
        assert!(!failed_prompt(&[user.clone(), Entry::Agent(AgentMessage::default()), notice.clone()]));
        assert!(!failed_prompt(&[notice]));
    }
}
