//! System notifications for agent events: the agent waits on the user (a permission, a question,
//! a sign-in) or finished a turn. Nothing is sent for a session the user is looking at in a
//! focused window; the rest follows the three Settings > AI toggles and the user's quiet hours.
//!
//! A banner says which session it is (its title), what happened to it (the agent's name and the
//! event) and what was said: the answer's own first words, the tool waiting for approval, the
//! question, the error. In the app bundle a click opens the session, and the follow-up actions
//! the answer ended with are buttons that send their prompt straight from the banner
//! (`native_notification.rs`).
//!
//! Ported from Athas's `services/agent-native-notifications.ts`.

use std::{collections::HashMap, time::Duration};

use web_time::Instant;

use gpui::{App, Global};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AttentionKind {
    Complete,
    Error,
    Permission,
    Question,
    Auth,
}

impl AttentionKind {
    /// The agent is stuck until the user answers.
    fn blocking(self) -> bool {
        matches!(self, AttentionKind::Permission | AttentionKind::Question | AttentionKind::Auth)
    }

    /// What happened, in the agent's name: "Claude Code finished".
    pub fn headline(self, agent: &str) -> String {
        let agent = if agent.trim().is_empty() { "The agent" } else { agent.trim() };
        match self {
            AttentionKind::Auth => format!("{agent} needs you to sign in"),
            AttentionKind::Question => format!("{agent} has a question"),
            AttentionKind::Permission => format!("{agent} needs your approval"),
            AttentionKind::Error => format!("{agent} stopped"),
            AttentionKind::Complete => format!("{agent} finished"),
        }
    }

    /// What to say when the event brought no words of its own.
    pub fn hint(self) -> &'static str {
        match self {
            AttentionKind::Auth => "Open Athas to sign in.",
            AttentionKind::Question => "Open Athas to answer it.",
            AttentionKind::Permission => "Open Athas to review the request.",
            AttentionKind::Error => "Open Athas to review the error.",
            AttentionKind::Complete => "Open Athas to review the result.",
        }
    }
}

/// A button on a banner: a label and the prompt a click sends to the session.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Action {
    pub label: String,
    pub prompt: String,
}

/// One event worth telling the user about, with everything the banner says.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Attention {
    pub session: String,
    /// The agent's display name, such as "Claude Code".
    pub agent: String,
    /// The session's title, as the sidebar shows it.
    pub title: String,
    /// The project folder's name, when the session has one.
    pub project: Option<String>,
    /// What was said: the answer, the tool waiting for approval, the question, the error.
    pub detail: Option<String>,
    /// The follow-up actions the answer ended with.
    pub actions: Vec<Action>,
}

impl Attention {
    pub fn new(session: impl Into<String>, agent: impl Into<String>) -> Self {
        Self { session: session.into(), agent: agent.into(), ..Default::default() }
    }

    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = title.into();
        self
    }

    pub fn project(mut self, project: Option<String>) -> Self {
        self.project = project;
        self
    }

    pub fn detail(mut self, detail: Option<String>) -> Self {
        self.detail = detail.map(|detail| summarize(&detail, BODY_LIMIT)).filter(|detail| !detail.is_empty());
        self
    }

    pub fn actions(mut self, actions: Vec<Action>) -> Self {
        self.actions = actions;
        self
    }

    /// The banner's three lines: which session, what happened, and what was said.
    pub fn banner(&self, kind: AttentionKind) -> (String, String, String) {
        let title = summarize(&self.title, TITLE_LIMIT);
        let headline = kind.headline(&self.agent);
        let subtitle = match (&self.project, title.is_empty()) {
            // Without a title the first line carries the event, so the second says where.
            (Some(project), true) => format!("in {project}"),
            (Some(project), false) => format!("{headline} · {project}"),
            (None, true) => String::new(),
            (None, false) => headline.clone(),
        };
        let body = self.detail.clone().unwrap_or_else(|| kind.hint().to_string());
        (if title.is_empty() { headline } else { title }, subtitle, body)
    }
}

/// How much of the title and of the answer a banner carries. macOS shows about two lines of body
/// text and cuts the rest; a couple of sentences is what fits.
const TITLE_LIMIT: usize = 64;
const BODY_LIMIT: usize = 220;

/// Text as one line a banner can show: fenced code goes, markdown marks go, and what is left is
/// cut at a word boundary.
pub fn summarize(text: &str, limit: usize) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut fenced = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with("```") || line.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced || line.is_empty() {
            continue;
        }
        let line = line.trim_start_matches(['#', '>', '-', '*', '+']).trim_start();
        // A numbered list item ("1. "), without eating a sentence that opens with a figure.
        let line = match line.split_once(". ") {
            Some((number, rest)) if !number.is_empty() && number.len() <= 2 && number.chars().all(|char| char.is_ascii_digit()) => rest,
            _ => line,
        };
        let line = line.replace("**", "").replace("__", "").replace('`', "");
        let line = line.trim();
        if !line.is_empty() {
            parts.push(line.to_string());
        }
        if parts.iter().map(String::len).sum::<usize>() > limit {
            break;
        }
    }
    clip(&parts.join(" "), limit)
}

/// `text` cut to `limit` characters at the last word boundary, with an ellipsis when it was cut.
fn clip(text: &str, limit: usize) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= limit {
        return text;
    }
    let cut: String = text.chars().take(limit).collect();
    let cut = match cut.rsplit_once(' ') {
        Some((head, _)) if head.chars().count() > limit / 2 => head,
        _ => cut.trim_end(),
    };
    format!("{}…", cut.trim_end_matches([',', '.', ';', ':']))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AttentionSettings {
    pub enabled: bool,
    /// Also when a turn finishes or fails, not only when the agent waits on the user.
    pub finished: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Notify,
    Disabled,
    Focused,
}

pub fn decide(kind: AttentionKind, settings: AttentionSettings, window_focused: bool, session_visible: bool) -> Decision {
    if !settings.enabled || (!kind.blocking() && !settings.finished) {
        return Decision::Disabled;
    }
    if window_focused && session_visible {
        return Decision::Focused;
    }
    Decision::Notify
}

const DEDUPE_WINDOW: Duration = Duration::from_secs(60);

#[derive(Default)]
struct Recent(HashMap<(AttentionKind, String), Instant>);

impl Global for Recent {}

/// Tells the user through the OS, unless the settings, the focus or a recent identical
/// notification say not to. `session_visible` is whether the session is on screen.
pub fn notify(kind: AttentionKind, event: &Attention, session_visible: bool, cx: &mut App) -> bool {
    record(kind, event, cx);
    let (settings, sound) = cx
        .try_global::<settings::SettingsStore>()
        .map(|_| {
            let settings = settings::get(cx);
            (AttentionSettings { enabled: settings.ai_agent_notifications, finished: settings.ai_agent_finish_notifications }, settings.ai_agent_notification_sound)
        })
        .unwrap_or((AttentionSettings { enabled: false, finished: false }, false));
    if decide(kind, settings, cx.active_window().is_some(), session_visible) != Decision::Notify {
        return false;
    }
    let now = Instant::now();
    let recent = &mut cx.default_global::<Recent>().0;
    recent.retain(|_, at| now.duration_since(*at) < DEDUPE_WINDOW);
    let key = (kind, event.session.clone());
    if recent.contains_key(&key) {
        return false;
    }
    recent.insert(key, now);
    if kind.blocking() && cx.active_window().is_none() {
        crate::native_notification::request_attention();
    }
    let (title, subtitle, body) = event.banner(kind);
    if crate::native_notification::available() {
        return notifications::can_send_os_notification(cx)
            && crate::native_notification::send(&crate::native_notification::Banner {
                title: &title,
                subtitle: &subtitle,
                body: &body,
                session: &event.session,
                sound,
                // Only a finished answer carries follow-ups, and they are what to do next.
                actions: if kind == AttentionKind::Complete { &event.actions } else { &[] },
            });
    }
    notifications::send_os_notification_with(cx, &title, Some(&subtitle), &body, sound)
}

/// Keeps the event in the notification list (`getAgentNotificationRecord`), where clicking it
/// opens the session.
fn record(kind: AttentionKind, event: &Attention, cx: &mut App) {
    let tone = match kind {
        AttentionKind::Error => notifications::NotificationKind::Error,
        _ if kind.blocking() => notifications::NotificationKind::Warning,
        _ => notifications::NotificationKind::Success,
    };
    let title = summarize(&event.title, TITLE_LIMIT);
    let description = match (&event.detail, title.is_empty()) {
        (Some(detail), true) => detail.clone(),
        (Some(detail), false) => format!("{title} — {detail}"),
        (None, true) => kind.hint().to_string(),
        (None, false) => title,
    };
    let id = event.session.clone();
    let open = notifications::NotificationAction::new("Open session", move |_, cx| workbench_api::request(cx, workbench_api::OpenRequest::Session { id: id.clone() }));
    notifications::record(
        cx,
        tone,
        notifications::NotificationCategory::Agent,
        kind.headline(&event.agent),
        Some(description.into()),
        format!("agent:{kind:?}:{}", event.session).into(),
        Some(open),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocking_events_notify_unless_the_session_is_in_view() {
        let on = AttentionSettings { enabled: true, finished: false };
        assert_eq!(decide(AttentionKind::Permission, on, false, true), Decision::Notify);
        assert_eq!(decide(AttentionKind::Permission, on, true, false), Decision::Notify);
        assert_eq!(decide(AttentionKind::Permission, on, true, true), Decision::Focused);
        assert_eq!(decide(AttentionKind::Complete, on, false, false), Decision::Disabled);
        assert_eq!(decide(AttentionKind::Complete, AttentionSettings { finished: true, ..on }, false, false), Decision::Notify);
        assert_eq!(decide(AttentionKind::Auth, AttentionSettings { enabled: false, finished: true }, false, false), Decision::Disabled);
    }

    #[test]
    fn the_banner_says_which_session_what_happened_and_what_was_said() {
        let event = Attention::new("s1", "Claude Code")
            .title("Fix the sidebar overflow")
            .project(Some("athas".into()))
            .detail(Some("## Done\n\nThe sidebar scrolls now; the `overflow` was on the wrong element.\n\n```rs\nlet x = 1;\n```".into()));
        assert_eq!(
            event.banner(AttentionKind::Complete),
            (
                "Fix the sidebar overflow".to_string(),
                "Claude Code finished · athas".to_string(),
                "Done The sidebar scrolls now; the overflow was on the wrong element.".to_string()
            )
        );
        assert_eq!(event.banner(AttentionKind::Permission).1, "Claude Code needs your approval · athas");
    }

    #[test]
    fn an_untitled_session_leads_with_the_event() {
        let event = Attention::new("s1", "Codex").project(Some("www".into()));
        assert_eq!(event.banner(AttentionKind::Error), ("Codex stopped".to_string(), "in www".to_string(), "Open Athas to review the error.".to_string()));
        assert_eq!(Attention::new("s1", "").banner(AttentionKind::Complete).0, "The agent finished");
    }

    #[test]
    fn long_answers_are_cut_at_a_word() {
        let long = "The refactor touches every call site ".repeat(20);
        let cut = summarize(&long, 60);
        assert!(cut.chars().count() <= 61, "{cut}");
        assert!(cut.ends_with('…'));
        assert!(!cut.contains("  "));
        assert_eq!(summarize("1. First step\n2. Second", 80), "First step Second");
        assert_eq!(summarize("", 80), "");
    }
}
