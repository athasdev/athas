//! Sharing and the team (`features/sharing`, `features/collaboration`): share an agent session
//! as a link, manage shared links, and the Team view with shared sessions, reviews, hand-offs
//! and the inbox. Everything goes through the account's token (`account::AccountStore`).
//!
//! # Integrating (the workbench is not changed by this crate)
//!
//! - Call `register_commands(cx)` once; it maps `team.open`, `share.agent`, `team.shareSession`,
//!   `team.stopSharingSession`, `team.handOffSession` and `team.requestReview` to this crate's
//!   actions. The workbench handles them, since they need the session in front.
//! - `OpenTeam`: open a centre resource tab (`state.open_resource("team", "", "Team")`) and in
//!   `centre_views.rs` build `cx.new(TeamView::new)`. On `TeamViewEvent::OpenSession { share_id,
//!   title }` open `open_resource("team-session", share_id, title)`, built with
//!   `TeamSessionView::new(share_id, title, None, window, cx)`. On
//!   `TeamSessionEvent::Continue(detail)` start a local agent session from `detail.messages`.
//! - `ShareSession`: `sharing::agent_draft_from_disk(&agent_ui::persistence::sessions_dir()?,
//!   session_id, title)` and `open_modal(cx.new(|cx| ShareDialog::new(draft, window, cx)))`.
//! - `ShareSessionWithTeam` / `StopSharingSession`: `share_with_team(draft, cx)` and
//!   `stop_sharing_with_team(session_id, cx)`; toast the result.
//! - `HandOffSession` / `RequestReview`: `find_team_share(session_id, cx)`, then open the
//!   `team-session` tab with `Some(SendTo::HandOff)` or `Some(SendTo::Review)`.

mod call;
#[cfg(not(target_family = "wasm"))]
pub mod live_share;
#[cfg(not(target_family = "wasm"))]
pub mod presence;
pub mod realtime;
#[cfg(not(target_family = "wasm"))]
mod room;
mod share_dialog;
pub mod sharing;
mod sharing_settings;
pub mod team;
mod team_session_view;
mod team_view;

use account::{AccountStore, ApiError};
use gpui::{App, AppContext, Task, actions};

pub use share_dialog::ShareDialog;
pub use sharing_settings::SharingSettings;
pub use team_session_view::{SendTo, TeamSessionEvent, TeamSessionView};
pub use team_view::{TeamView, TeamViewEvent, document_stream_summary, following_user, set_following};

use crate::sharing::{Access, ShareDraft, SharedItem, ShareKind, Visibility};

actions!(
    collaboration,
    [
        /// Open the Team view in the centre.
        OpenTeam,
        /// Share the session in front to the web (the host opens `ShareDialog`).
        ShareSession,
        /// Share the file in front to the web as a read-only snapshot.
        ShareBuffer,
        /// Share the selected code of the file in front to the web.
        ShareSelection,
        /// Share the session in front with the team, live.
        ShareSessionWithTeam,
        StopSharingSession,
        /// Pass the session in front to a teammate (`TeamSessionView` with `SendTo::HandOff`).
        HandOffSession,
        /// Ask a teammate to review the session in front (`SendTo::Review`).
        RequestReview,
    ]
);

/// Registers the team and sharing commands under their Athas command ids. Their handlers need
/// the session in front, so the workbench handles the actions.
pub fn register_commands(cx: &mut App) {
    keymap::register(cx, "team.open", OpenTeam);
    keymap::register(cx, "share.agent", ShareSession);
    keymap::register(cx, "share.buffer", ShareBuffer);
    keymap::register(cx, "share.selection", ShareSelection);
    keymap::register(cx, "team.shareSession", ShareSessionWithTeam);
    keymap::register(cx, "team.stopSharingSession", StopSharingSession);
    keymap::register(cx, "team.handOffSession", HandOffSession);
    keymap::register(cx, "team.requestReview", RequestReview);
}

/// Whether this device's live team share is `item`'s, for the session `session_id`.
fn is_team_share(item: &SharedItem, session_id: &str, device_id: &str) -> bool {
    item.kind == ShareKind::Agent
        && item.live
        && item.visibility == Visibility::Organization
        && item.source_id.as_deref() == Some(session_id)
        && item.device_id.as_deref() == Some(device_id)
}

fn session(cx: &App) -> Result<(account::Client, String, Option<i64>), ApiError> {
    let store = AccountStore::global(cx).ok_or(ApiError::NotAuthenticated)?;
    let store = store.read(cx);
    let token = store.token().ok_or(ApiError::NotAuthenticated)?.to_string();
    let workspace = store.subscription().and_then(|subscription| subscription.team()).and_then(|team| team.workspace.as_ref()).map(|workspace| workspace.id);
    Ok((store.client().clone(), token, workspace))
}

/// Shares an agent session with the team as a live share; resolves to the share id. An
/// existing team share of the session is reused.
pub fn share_with_team(draft: ShareDraft, cx: &mut App) -> Task<Result<String, ApiError>> {
    let (client, token, workspace) = match session(cx) {
        Ok(session) => session,
        Err(error) => return Task::ready(Err(error)),
    };
    let Some(workspace) = workspace else {
        return Task::ready(Err(ApiError::Malformed("Sharing with a team needs a Team plan.".into())));
    };
    let Some(source_id) = draft.source_id.clone() else { return Task::ready(Err(ApiError::Malformed("There is nothing to share.".into()))) };
    let task = cx.background_spawn(async move {
        let device = sharing::device_id();
        let options = sharing::fetch_options(&client, &token)?;
        if let Some(existing) = options.items.iter().find(|item| is_team_share(item, &source_id, &device)) {
            return Ok(existing.id.clone());
        }
        let access = Access { visibility: Visibility::Organization, emails: Vec::new(), workspace_id: Some(workspace) };
        let body = sharing::create_body(&draft, &format!("team-{source_id}"), true, &access);
        Ok(sharing::create_share(&client, &token, &body)?.id)
    });
    cx.spawn(async move |cx| {
        let result = task.await;
        if result.is_ok() {
            cx.update(refresh_team);
        }
        result
    })
}

/// The id of this device's live team share of `session_id`, if it has one.
pub fn find_team_share(session_id: String, cx: &mut App) -> Task<Result<Option<String>, ApiError>> {
    let (client, token, _) = match session(cx) {
        Ok(session) => session,
        Err(error) => return Task::ready(Err(error)),
    };
    cx.background_spawn(async move {
        let device = sharing::device_id();
        let options = sharing::fetch_options(&client, &token)?;
        Ok(options.items.into_iter().find(|item| is_team_share(item, &session_id, &device)).map(|item| item.id))
    })
}

/// Stops sharing a session with the team; resolves to whether there was a share to stop.
pub fn stop_sharing_with_team(session_id: String, cx: &mut App) -> Task<Result<bool, ApiError>> {
    let (client, token, _) = match session(cx) {
        Ok(session) => session,
        Err(error) => return Task::ready(Err(error)),
    };
    let task = cx.background_spawn(async move {
        let device = sharing::device_id();
        let options = sharing::fetch_options(&client, &token)?;
        let Some(item) = options.items.into_iter().find(|item| is_team_share(item, &session_id, &device)) else { return Ok(false) };
        sharing::revoke_share(&client, &token, &item.id)?;
        Ok(true)
    });
    cx.spawn(async move |cx| {
        let result = task.await;
        if result == Ok(true) {
            cx.update(refresh_team);
        }
        result
    })
}

/// Fetches the team snapshot again: shared sessions, the inbox and who is online.
pub fn refresh_team(cx: &mut App) {
    if let Some(store) = AccountStore::global(cx) {
        store.update(cx, |store, cx| store.refresh_subscription(cx)).detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_only_this_devices_live_team_share() {
        let item = SharedItem {
            id: "a".into(),
            kind: ShareKind::Agent,
            live: true,
            visibility: Visibility::Organization,
            source_id: Some("s1".into()),
            device_id: Some("d1".into()),
            ..Default::default()
        };
        assert!(is_team_share(&item, "s1", "d1"));
        assert!(!is_team_share(&item, "s1", "d2"));
        assert!(!is_team_share(&SharedItem { live: false, ..item.clone() }, "s1", "d1"));
        assert!(!is_team_share(&SharedItem { visibility: Visibility::Public, ..item }, "s1", "d1"));
    }
}
