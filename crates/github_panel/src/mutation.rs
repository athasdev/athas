//! Every change the views make on GitHub, as data: the view builds a [`Mutation`] from what the
//! user did, and [`Mutation::perform`] makes the one `athas-github` call it names. Keeping the
//! request apart from the call lets the tests check what would be sent without sending it.

use crate::gh::{IssueComment, IssueDetails, IssueListItem, PullRequest, PullRequestDetails, Release, ReleaseInput};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReviewEvent {
    Approve,
    RequestChanges,
}

impl ReviewEvent {
    pub fn api_value(self) -> &'static str {
        match self {
            ReviewEvent::Approve => "APPROVE",
            ReviewEvent::RequestChanges => "REQUEST_CHANGES",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MergeMethod {
    Squash,
    Merge,
    Rebase,
}

impl MergeMethod {
    pub const ALL: [MergeMethod; 3] = [MergeMethod::Squash, MergeMethod::Merge, MergeMethod::Rebase];

    pub fn api_value(self) -> &'static str {
        match self {
            MergeMethod::Squash => "squash",
            MergeMethod::Merge => "merge",
            MergeMethod::Rebase => "rebase",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            MergeMethod::Squash => "Squash",
            MergeMethod::Merge => "Merge",
            MergeMethod::Rebase => "Rebase",
        }
    }
}

/// The issue states the viewer offers, with GitHub's reason for each.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IssueState {
    Completed,
    NotPlanned,
    Reopened,
}

impl IssueState {
    pub fn state(self) -> &'static str {
        match self {
            IssueState::Reopened => "open",
            _ => "closed",
        }
    }

    pub fn reason(self) -> &'static str {
        match self {
            IssueState::Completed => "completed",
            IssueState::NotPlanned => "not_planned",
            IssueState::Reopened => "reopened",
        }
    }
}

/// Why a conversation is locked, as GitHub names the reasons.
pub const LOCK_REASONS: [(&str, &str); 4] =
    [("resolved", "Lock as resolved"), ("off-topic", "Lock as off-topic"), ("too heated", "Lock as too heated"), ("spam", "Lock as spam")];

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReleaseDraft {
    pub tag_name: String,
    pub target_commitish: String,
    pub name: String,
    pub body: String,
    pub prerelease: bool,
}

impl ReleaseDraft {
    pub fn of(release: &Release) -> Self {
        Self {
            tag_name: release.tag_name.clone(),
            target_commitish: release.target_commitish.clone(),
            name: release.name.clone().unwrap_or_default(),
            body: release.body.clone().unwrap_or_default(),
            prerelease: release.prerelease,
        }
    }

    pub fn is_valid(&self) -> bool {
        !self.tag_name.trim().is_empty() && !self.target_commitish.trim().is_empty()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Mutation {
    AddPrComment { number: i64, body: String },
    AddIssueComment { number: i64, body: String },
    EditComment { id: i64, body: String },
    DeleteComment { id: i64 },
    UpdatePr { number: i64, title: String, body: String, labels: Vec<String>, assignees: Vec<String> },
    SubmitReview { number: i64, event: ReviewEvent, body: String },
    Merge { number: i64, method: MergeMethod },
    ClosePr { number: i64 },
    UpdateIssue { number: i64, title: String, body: String, labels: Vec<String>, assignees: Vec<String>, milestone: Option<i64>, issue_type: Option<String> },
    SetIssueState { number: i64, state: IssueState },
    Lock { number: i64, reason: String },
    Unlock { number: i64 },
    CreatePr { title: String, body: String, head: String, base: String, draft: bool, labels: Vec<String>, assignees: Vec<String> },
    CreateIssue { title: String, body: String, labels: Vec<String>, assignees: Vec<String>, milestone: Option<i64>, issue_type: Option<String> },
    DispatchWorkflow { workflow_id: i64, reference: String },
    SaveRelease { id: Option<i64>, draft: ReleaseDraft },
    PublishRelease { id: i64, make_latest: bool },
    DeleteRelease { id: i64 },
    DeleteReleaseAsset { id: i64 },
    UploadReleaseAsset { release_id: i64, file: String },
    DeactivateDeployment { id: i64 },
}

/// What a mutation came back with.
pub enum Outcome {
    Pr(Box<PullRequestDetails>),
    Issue(Box<IssueDetails>),
    IssueComment(IssueComment),
    CreatedPr(PullRequest),
    CreatedIssue(IssueListItem),
    Release(Box<Release>),
    Done,
}

impl Mutation {
    /// Blocking: calls the API once (twice for a pull request edit, as `athas-github` does).
    pub fn perform(self, path: String, token: String) -> Result<Outcome, String> {
        let token = Some(token);
        Ok(match self {
            Mutation::AddPrComment { number, body } => {
                crate::gh::github_add_pr_comment(path, number, body, token)?;
                Outcome::Done
            }
            Mutation::AddIssueComment { number, body } => Outcome::IssueComment(crate::gh::github_add_issue_comment(path, number, body, token)?),
            Mutation::EditComment { id, body } => Outcome::IssueComment(crate::gh::github_update_issue_comment(path, id, body, token)?),
            Mutation::DeleteComment { id } => {
                crate::gh::github_delete_issue_comment(path, id, token)?;
                Outcome::Done
            }
            Mutation::UpdatePr { number, title, body, labels, assignees } => {
                Outcome::Pr(Box::new(crate::gh::github_update_pull_request(path, number, title, body, labels, assignees, token)?))
            }
            Mutation::SubmitReview { number, event, body } => {
                crate::gh::github_submit_pr_review(path, number, event.api_value().to_string(), body, token)?;
                Outcome::Done
            }
            Mutation::Merge { number, method } => Outcome::Pr(Box::new(crate::gh::github_merge_pull_request(path, number, method.api_value().to_string(), token)?)),
            Mutation::ClosePr { number } => Outcome::Pr(Box::new(crate::gh::github_close_pull_request(path, number, token)?)),
            Mutation::UpdateIssue { number, title, body, labels, assignees, milestone, issue_type } => {
                Outcome::Issue(Box::new(crate::gh::github_update_issue(path, number, title, body, labels, assignees, milestone, issue_type, token)?))
            }
            Mutation::SetIssueState { number, state } => {
                Outcome::Issue(Box::new(crate::gh::github_update_issue_state(path, number, state.state().to_string(), Some(state.reason().to_string()), token)?))
            }
            Mutation::Lock { number, reason } => {
                crate::gh::github_lock_issue(path, number, Some(reason), token)?;
                Outcome::Done
            }
            Mutation::Unlock { number } => {
                crate::gh::github_unlock_issue(path, number, token)?;
                Outcome::Done
            }
            Mutation::CreatePr { title, body, head, base, draft, labels, assignees } => {
                Outcome::CreatedPr(crate::gh::github_create_pull_request(path, title, body, head, base, draft, labels, assignees, token)?)
            }
            Mutation::CreateIssue { title, body, labels, assignees, milestone, issue_type } => {
                Outcome::CreatedIssue(crate::gh::github_create_issue(path, title, body, labels, assignees, milestone, issue_type, token)?)
            }
            Mutation::DispatchWorkflow { workflow_id, reference } => {
                crate::gh::github_dispatch_workflow(path, workflow_id, reference, token)?;
                Outcome::Done
            }
            Mutation::SaveRelease { id, draft } => {
                let input = ReleaseInput {
                    tag_name: draft.tag_name.trim().to_string(),
                    target_commitish: draft.target_commitish.trim().to_string(),
                    name: draft.name,
                    body: draft.body,
                    prerelease: draft.prerelease,
                };
                Outcome::Release(Box::new(crate::gh::github_save_release(path, id, input, token)?))
            }
            Mutation::PublishRelease { id, make_latest } => Outcome::Release(Box::new(crate::gh::github_publish_release(path, id, make_latest, token)?)),
            Mutation::DeleteRelease { id } => {
                crate::gh::github_delete_release(path, id, token)?;
                Outcome::Done
            }
            Mutation::DeleteReleaseAsset { id } => {
                crate::gh::github_delete_release_asset(path, id, token)?;
                Outcome::Done
            }
            Mutation::UploadReleaseAsset { release_id, file } => {
                crate::gh::github_upload_release_asset(path, release_id, file, token)?;
                Outcome::Done
            }
            Mutation::DeactivateDeployment { id } => {
                crate::gh::github_deactivate_deployment(path, id, token)?;
                Outcome::Done
            }
        })
    }
}

/// The edit that sets a pull request's labels and assignees, keeping its title and body.
pub fn update_pr(pr: &PullRequestDetails, title: Option<String>, body: Option<String>, labels: Option<Vec<String>>, assignees: Option<Vec<String>>) -> Mutation {
    Mutation::UpdatePr {
        number: pr.number,
        title: title.unwrap_or_else(|| pr.title.clone()),
        body: body.unwrap_or_else(|| pr.body.clone()),
        labels: labels.unwrap_or_else(|| pr.labels.iter().map(|label| label.name.clone()).collect()),
        assignees: assignees.unwrap_or_else(|| pr.assignees.iter().map(|user| user.login.clone()).collect()),
    }
}

/// What an issue edit changes; everything left `None` keeps its current value.
#[derive(Default)]
pub struct IssueChange {
    pub title: Option<String>,
    pub body: Option<String>,
    pub labels: Option<Vec<String>>,
    pub assignees: Option<Vec<String>>,
    pub milestone: Option<Option<i64>>,
    pub issue_type: Option<Option<String>>,
}

pub fn update_issue(issue: &IssueDetails, change: IssueChange) -> Mutation {
    Mutation::UpdateIssue {
        number: issue.number,
        title: change.title.unwrap_or_else(|| issue.title.clone()),
        body: change.body.unwrap_or_else(|| issue.body.clone()),
        labels: change.labels.unwrap_or_else(|| issue.labels.iter().map(|label| label.name.clone()).collect()),
        assignees: change.assignees.unwrap_or_else(|| issue.assignees.iter().map(|user| user.login.clone()).collect()),
        milestone: change.milestone.unwrap_or_else(|| issue.milestone.as_ref().map(|milestone| milestone.number)),
        issue_type: change.issue_type.unwrap_or_else(|| issue.issue_type.as_ref().map(|kind| kind.name.clone())),
    }
}

/// `current` with `name` added or removed.
pub fn toggle(current: &[String], name: &str) -> Vec<String> {
    if current.iter().any(|candidate| candidate == name) {
        current.iter().filter(|candidate| *candidate != name).cloned().collect()
    } else {
        let mut next = current.to_vec();
        next.push(name.to_string());
        next
    }
}

/// `current` plus the usernames typed in `draft` (split on commas and spaces, `@` dropped),
/// without repeats.
pub fn add_assignees(current: &[String], draft: &str) -> Vec<String> {
    let mut next = current.to_vec();
    for login in draft.split([',', ' ', '\t', '\n']).map(|part| part.trim().trim_start_matches('@')).filter(|part| !part.is_empty()) {
        if !next.iter().any(|existing| existing == login) {
            next.push(login.to_string());
        }
    }
    next
}

/// A review needs a note unless it approves.
pub fn review_ready(event: ReviewEvent, body: &str) -> bool {
    event == ReviewEvent::Approve || !body.trim().is_empty()
}

/// Whether `login` may edit and delete a comment by `author`.
pub fn can_manage(current_user: Option<&str>, author: &str) -> bool {
    current_user.is_some_and(|user| !user.is_empty() && user.eq_ignore_ascii_case(author))
}

/// Generated release notes added to what is written: the name only when empty, the body appended.
pub fn merge_generated_notes(draft: &mut ReleaseDraft, notes: &serde_json::Value) {
    let name = notes.get("name").and_then(|value| value.as_str()).unwrap_or_default();
    let body = notes.get("body").and_then(|value| value.as_str()).unwrap_or_default();
    if draft.name.is_empty() {
        draft.name = name.to_string();
    }
    draft.body = if draft.body.is_empty() { body.to_string() } else { format!("{}\n\n{body}", draft.body) };
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn issue() -> IssueDetails {
        serde_json::from_value(json!({
            "number": 7, "title": "Bug", "body": "Steps", "state": "OPEN", "url": "https://github.com/o/r/issues/7",
            "labels": [{"name": "bug", "color": "d73a4a"}], "assignees": [{"login": "ana"}],
            "milestone": {"number": 3, "title": "v1", "state": "open"}, "issueType": {"id": 1, "name": "Bug"}
        }))
        .unwrap()
    }

    #[test]
    fn issue_edits_keep_what_they_do_not_change() {
        let issue = issue();
        let change = update_issue(&issue, IssueChange { labels: Some(toggle(&["bug".into()], "ui")), ..Default::default() });
        assert_eq!(
            change,
            Mutation::UpdateIssue {
                number: 7,
                title: "Bug".into(),
                body: "Steps".into(),
                labels: vec!["bug".into(), "ui".into()],
                assignees: vec!["ana".into()],
                milestone: Some(3),
                issue_type: Some("Bug".into()),
            }
        );
        let cleared = update_issue(&issue, IssueChange { milestone: Some(None), issue_type: Some(None), ..Default::default() });
        assert!(matches!(cleared, Mutation::UpdateIssue { milestone: None, issue_type: None, .. }));
    }

    #[test]
    fn toggles_labels_and_parses_assignees() {
        let labels = vec!["bug".to_string(), "ui".to_string()];
        assert_eq!(toggle(&labels, "bug"), ["ui"]);
        assert_eq!(toggle(&labels, "docs"), ["bug", "ui", "docs"]);
        assert_eq!(add_assignees(&["ana".into()], "@lee, ana  @kim"), ["ana", "lee", "kim"]);
        assert_eq!(add_assignees(&[], " , "), Vec::<String>::new());
    }

    #[test]
    fn reviews_need_a_note_unless_approving() {
        assert!(review_ready(ReviewEvent::Approve, ""));
        assert!(!review_ready(ReviewEvent::RequestChanges, "  "));
        assert!(review_ready(ReviewEvent::RequestChanges, "Rename it"));
        assert_eq!(ReviewEvent::RequestChanges.api_value(), "REQUEST_CHANGES");
    }

    #[test]
    fn only_the_author_manages_a_comment() {
        assert!(can_manage(Some("Ana"), "ana"));
        assert!(!can_manage(Some("lee"), "ana"));
        assert!(!can_manage(None, "ana"));
        assert!(!can_manage(Some(""), ""));
    }

    #[test]
    fn issue_states_carry_their_reason() {
        assert_eq!((IssueState::NotPlanned.state(), IssueState::NotPlanned.reason()), ("closed", "not_planned"));
        assert_eq!((IssueState::Reopened.state(), IssueState::Reopened.reason()), ("open", "reopened"));
    }

    #[test]
    fn generated_notes_append_to_the_draft() {
        let mut draft = ReleaseDraft { tag_name: "v1".into(), target_commitish: "main".into(), body: "Intro".into(), ..Default::default() };
        merge_generated_notes(&mut draft, &json!({"name": "v1.0", "body": "## Changes"}));
        assert_eq!(draft.name, "v1.0");
        assert_eq!(draft.body, "Intro\n\n## Changes");
        draft.name = "Kept".into();
        merge_generated_notes(&mut draft, &json!({"name": "Other", "body": "More"}));
        assert_eq!(draft.name, "Kept");
        assert!(draft.is_valid());
        assert!(!ReleaseDraft::default().is_valid());
    }

    #[test]
    fn rejects_invalid_input_before_any_request() {
        let path = std::env::temp_dir().to_string_lossy().into_owned();
        let empty = Mutation::AddIssueComment { number: 1, body: "  ".into() }.perform(path.clone(), "t".into());
        assert_eq!(empty.err().as_deref(), Some("Comment body is required."));
        let untitled = Mutation::CreateIssue { title: " ".into(), body: String::new(), labels: vec![], assignees: vec![], milestone: None, issue_type: None }.perform(path.clone(), "t".into());
        assert_eq!(untitled.err().as_deref(), Some("Issue title is required."));
        let release = Mutation::SaveRelease { id: None, draft: ReleaseDraft::default() }.perform(path, "t".into());
        assert_eq!(release.err().as_deref(), Some("A release tag is required"));
    }
}
