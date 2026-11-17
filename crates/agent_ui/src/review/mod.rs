//! Agent edit review and checkpoints: every file an agent writes is logged per session, with how
//! it was before each turn, so the user can keep or reject each hunk, all of a file or everything,
//! and put the files back as they were before a turn.
//!
//! # For the editor (inline accept/reject lenses)
//!
//! - [`hunks_for_path`] (or [`pending_hunks`] with a session id) gives the unreviewed hunks for a
//!   file; `Hunk::current_lines_range()` is where to draw them in the buffer, `Hunk::base_lines`
//!   what the lines were.
//! - [`apply`] with `ReviewAction::KeepHunk` / `RejectHunk` keeps or rejects one; it writes the
//!   file on disk, so a clean buffer reloads it. Subscribe to [`events`] to redraw when a
//!   session's review changes (`ReviewEvent::session`).
//! - The actions [`KeepAgentHunk`] and [`RejectAgentHunk`] (`ai.keepAgentHunk`,
//!   `ai.rejectAgentHunk`, Cmd-Y / Cmd-N in Athas) should be bound in the editor's own key
//!   context while the cursor's line has a hunk; the editor handles them by calling `apply`.

pub mod hunks;
mod store;
pub(crate) mod view;

use std::path::{Path, PathBuf};

use gpui::{App, AppContext as _, Context, Entity, EventEmitter, Global, Task, actions};

pub use hunks::{FileChange, Hunk};
pub use store::{CheckpointSummary, FileReview, Outcome, ReviewAction, Store};
pub use view::ReviewView;

/// The centre view kind of a session's review; its id is the session id.
pub const RESOURCE_KIND: &str = "agent-review";

actions!(
    ai,
    [
        /// Keeps the agent hunk at the cursor (or the one selected in the review).
        KeepAgentHunk,
        /// Rejects the agent hunk at the cursor (or the one selected in the review).
        RejectAgentHunk,
        KeepAllAgentChanges,
        RejectAllAgentChanges,
        /// Opens the review of the active session's agent changes.
        ReviewAgentChanges,
    ]
);

/// A session's review changed: files were written, kept, rejected or restored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReviewEvent {
    pub session: String,
}

/// Where review changes are announced.
pub struct ReviewEvents;

impl EventEmitter<ReviewEvent> for ReviewEvents {}

struct GlobalReviewEvents(Entity<ReviewEvents>);

impl Global for GlobalReviewEvents {}

/// The entity that emits [`ReviewEvent`]s; subscribe to it.
pub fn events(cx: &mut App) -> Entity<ReviewEvents> {
    if let Some(events) = cx.try_global::<GlobalReviewEvents>() {
        return events.0.clone();
    }
    let events = cx.new(|_| ReviewEvents);
    cx.set_global(GlobalReviewEvents(events.clone()));
    events
}

fn announce(sessions: &[String], cx: &mut App) {
    let events = events(cx);
    events.update(cx, |_, cx: &mut Context<ReviewEvents>| {
        for session in sessions {
            cx.emit(ReviewEvent { session: session.clone() });
        }
    });
}

/// Logs an agent write for `session`, in the checkpoint of `turn` (the user message's transcript
/// index), and tells views.
pub fn record(session: &str, turn: Option<usize>, change: FileChange, cx: &mut App) -> Outcome {
    let outcome = Store::global().record(session, turn, change);
    announce(&outcome.changed, cx);
    outcome
}

/// Runs a review action off the main thread (it reads and writes files), then tells views.
pub fn apply(session: String, action: ReviewAction, cx: &mut App) -> Task<Outcome> {
    cx.spawn(async move |cx| {
        let outcome = cx.background_spawn(async move { Store::global().apply(&session, action) }).await;
        cx.update(|cx| announce(&outcome.changed, cx));
        outcome
    })
}

/// The unreviewed hunks a session's agent left in `path`.
pub fn pending_hunks(session: &str, path: &Path) -> Vec<Hunk> {
    Store::global().pending_hunks(session, path)
}

/// Every open session's unreviewed hunks in `path`, by session.
pub fn hunks_for_path(path: &Path) -> Vec<(String, Vec<Hunk>)> {
    Store::global().hunks_for_path(path)
}

/// The session's files with unreviewed changes.
pub fn files(session: &str) -> Vec<FileReview> {
    Store::global().files(session)
}

/// Folds the checkpoints of turns after `turn` into it, after the prompt at `turn` was edited.
pub fn rewind(session: &str, turn: usize) {
    Store::global().rewind(session, turn)
}

pub fn checkpoints(session: &str) -> Vec<CheckpointSummary> {
    Store::global().checkpoints(session)
}

/// Totals for the "Review changes" bar: files, lines added, lines removed.
pub fn totals(session: &str) -> (usize, usize, usize) {
    let files = files(session);
    let (added, removed) = files.iter().fold((0, 0), |(added, removed), file| (added + file.added, removed + file.removed));
    (files.len(), added, removed)
}

/// The hunk at a 0-based buffer line, for the editor's Cmd-Y / Cmd-N.
pub fn hunk_at_line(path: &Path, line: usize) -> Option<(String, Hunk)> {
    hunks_for_path(path).into_iter().find_map(|(session, hunks)| {
        hunks
            .into_iter()
            .find(|hunk| hunk.current_lines_range().contains(&line) || (hunk.current_lines.is_empty() && hunk.current_start == line))
            .map(|hunk| (session.clone(), hunk))
    })
}

/// A short path for the review's rows.
pub(crate) fn display_path(path: &PathBuf, root: Option<&Path>) -> String {
    root.and_then(|root| path.strip_prefix(root).ok()).unwrap_or(path).display().to_string()
}
