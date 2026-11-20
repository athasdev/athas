//! System notifications for agent events: the agent waits on the user (a permission, a question,
//! a sign-in) or finished a turn. Nothing is sent for a session the user is looking at in a
//! focused window; the rest follows the three Settings > AI toggles and the user's quiet hours.
//! In the app bundle a click on the banner opens the session (`native_notification.rs`).
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

    pub fn content(self) -> (&'static str, &'static str) {
        match self {
            AttentionKind::Auth => ("Agent needs you to sign in", "Open Athas to sign in."),
            AttentionKind::Question => ("Agent has a question", "Open Athas to answer it."),
            AttentionKind::Permission => ("Agent needs your approval", "Open Athas to review the request."),
            AttentionKind::Error => ("Agent stopped", "Open Athas to review the error."),
            AttentionKind::Complete => ("Agent finished", "Open Athas to review the result."),
        }
    }
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
pub fn notify(kind: AttentionKind, session: &str, session_visible: bool, cx: &mut App) -> bool {
    record(kind, session, cx);
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
    let key = (kind, session.to_string());
    if recent.contains_key(&key) {
        return false;
    }
    recent.insert(key, now);
    if kind.blocking() && cx.active_window().is_none() {
        crate::native_notification::request_attention();
    }
    let (title, body) = kind.content();
    if crate::native_notification::available() {
        return notifications::can_send_os_notification(cx) && crate::native_notification::send(title, body, session, sound);
    }
    notifications::send_os_notification_with_sound(cx, title, body, sound)
}

/// Keeps the event in the notification list (`getAgentNotificationRecord`), where clicking it
/// opens the session.
fn record(kind: AttentionKind, session: &str, cx: &mut App) {
    let (title, body) = kind.content();
    let tone = match kind {
        AttentionKind::Error => notifications::NotificationKind::Error,
        _ if kind.blocking() => notifications::NotificationKind::Warning,
        _ => notifications::NotificationKind::Success,
    };
    let id = session.to_string();
    let open = notifications::NotificationAction::new("Open session", move |_, cx| workbench_api::request(cx, workbench_api::OpenRequest::Session { id: id.clone() }));
    notifications::record(cx, tone, notifications::NotificationCategory::Agent, title, Some(body.into()), format!("agent:{kind:?}:{session}").into(), Some(open));
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
}
