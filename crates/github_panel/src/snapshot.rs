//! Recorded pages for the headless snapshot example, so every state can be drawn without
//! touching GitHub: the store is filled before a view opens and the token is left missing.

use std::path::{Path, PathBuf};

use gpui::{AnyView, App, AppContext, Window};
use serde_json::json;

use crate::{
    auth::Auth,
    create_view::{CreateKind, CreateView},
    delivery_view::{DeliveryKind, DeliveryView},
    issue_view::IssueView,
    pr_view::PullRequestView,
    run_view::{RunView, details_key},
    store::{self, Metadata},
};

fn seed(root: &Path, cx: &mut App) {
    store::set_auth(Auth::Missing { gh_installed: true, rejected: false }, cx);
    store::put("github|current-user".into(), std::sync::Arc::new("mehmet".to_string()), cx);
    let metadata = Metadata {
        labels: serde_json::from_value(json!([
            {"name": "port", "color": "5319e7"}, {"name": "bug", "color": "d73a4a"}, {"name": "ui", "color": "0e8a16"}, {"name": "docs", "color": "0075ca"}
        ]))
        .unwrap(),
        milestones: serde_json::from_value(json!([{"number": 3, "title": "v0.17", "state": "open"}, {"number": 4, "title": "v0.18", "state": "open"}])).unwrap(),
        issue_types: serde_json::from_value(json!([{"id": 1, "name": "Bug"}, {"id": 2, "name": "Feature"}])).unwrap(),
    };
    store::put(store::metadata_key(&root.to_string_lossy()), std::sync::Arc::new(metadata), cx);
    let details = serde_json::from_value(json!({
        "number": 41, "title": "Port the GitHub panel to GPUI", "body": "## Summary\nPorts the sidebar and the resource pages.\n\n- [x] Lists\n- [ ] Write paths", "state": "OPEN",
        "author": {"login": "mehmet"}, "createdAt": "2026-11-10T08:00:00Z", "updatedAt": "2026-11-11T09:00:00Z",
        "isDraft": false, "reviewDecision": "REVIEW_REQUIRED", "url": "https://github.com/athasdev/athas/pull/41",
        "headRefName": "gpui-github", "baseRefName": "main", "additions": 900, "deletions": 12, "changedFiles": 14,
        "commits": [{"sha": "abcdef1234567", "message": "Add panel", "authoredDate": "2026-11-10T08:30:00Z", "url": "", "author": {"login": "mehmet", "name": "Mehmet"}}, {"sha": "1234567abcdef", "message": "Draw job logs with wrap and problem stepping", "authoredDate": "2026-11-11T09:30:00Z", "url": "", "author": {"login": "ana", "name": "Ana"}}],
        "statusCheckRollup": {"contexts": {"nodes": [{"name": "lint", "status": "COMPLETED", "conclusion": "SUCCESS"}, {"name": "test", "status": "COMPLETED", "conclusion": "SUCCESS"}]}},
        "reviewRequests": [{"login": "ana"}], "mergeStateStatus": "clean", "mergeable": "MERGEABLE",
        "reviews": [{"login": "lee", "state": "COMMENTED", "body": "Looks close", "submittedAt": "2026-11-10T11:00:00Z"}],
        "labels": [{"name": "port", "color": "5319e7"}], "assignees": [{"login": "mehmet"}]
    }))
    .unwrap();
    let comments = serde_json::from_value(json!([
        {"id": 11, "author": {"login": "mehmet"}, "body": "Comments and reviews land next.", "createdAt": "2026-11-10T09:30:00Z", "updatedAt": "2026-11-10T10:30:00Z", "url": "https://github.com/athasdev/athas/pull/41#issuecomment-11"},
        {"id": 12, "author": {"login": "ana"}, "body": "Nice, the **diff view** is fast.", "createdAt": "2026-11-10T12:30:00Z", "updatedAt": "2026-11-10T12:30:00Z", "url": "https://github.com/athasdev/athas/pull/41#issuecomment-12"}
    ]))
    .unwrap();
    PullRequestView::seed(root, details, comments, cx);
    let issue = serde_json::from_value(json!({
        "number": 7, "title": "Tabs lose focus after closing a split", "body": "Steps:\n1. Split\n2. Close the right pane", "state": "OPEN",
        "author": {"login": "ana"}, "createdAt": "2026-11-01T08:00:00Z", "updatedAt": "2026-11-11T08:00:00Z", "url": "https://github.com/athasdev/athas/issues/7",
        "labels": [{"name": "bug", "color": "d73a4a"}], "assignees": [], "milestone": {"number": 3, "title": "v0.17", "state": "open"},
        "issueType": {"id": 1, "name": "Bug"}, "locked": true, "activeLockReason": "resolved",
        "comments": [
            {"id": 21, "author": {"login": "mehmet"}, "body": "Reproduced on main.", "createdAt": "2026-11-02T08:00:00Z", "updatedAt": "2026-11-02T08:00:00Z", "url": "https://github.com/athasdev/athas/issues/7#issuecomment-21"}
        ]
    }))
    .unwrap();
    IssueView::seed(root, issue, cx);
    let release = serde_json::from_value(json!({
        "id": 5, "tag_name": "v0.16.0", "target_commitish": "main", "name": "Athas 0.16", "body": "## Highlights\n- Faster startup", "draft": true, "prerelease": false,
        "html_url": "https://github.com/athasdev/athas/releases/tag/v0.16.0", "created_at": "2026-11-08T00:00:00Z", "published_at": null, "author": {"login": "mehmet", "avatar_url": null},
        "assets": [{"id": 9, "name": "Athas_0.16.0_aarch64.dmg", "label": null, "size": 48234496, "download_count": 1290, "browser_download_url": "https://github.com/athasdev/athas/releases/download/v0.16.0/a.dmg", "content_type": "application/octet-stream", "state": "uploaded", "digest": "sha256:abc"}],
        "zipball_url": "https://api.github.com/repos/athasdev/athas/zipball/v0.16.0", "tarball_url": "https://api.github.com/repos/athasdev/athas/tarball/v0.16.0", "discussion_url": null
    }))
    .unwrap();
    DeliveryView::seed_release(root, release, cx);
    let deployment = serde_json::from_value(json!({
        "id": 3, "sha": "abcdef1234567890", "ref": "main", "task": "deploy", "environment": "production", "description": "Website",
        "created_at": "2026-11-10T00:00:00Z", "updated_at": "2026-11-10T00:00:00Z", "creator": {"login": "mehmet", "avatar_url": null}, "production_environment": true,
        "statuses": [
            {"id": 2, "state": "success", "description": "Deployed", "environment": "production", "environment_url": "https://athas.dev", "log_url": "https://github.com/athasdev/athas/actions/runs/1", "created_at": "2026-11-10T00:05:00Z", "creator": {"login": "github-actions", "avatar_url": null}},
            {"id": 1, "state": "in_progress", "description": null, "environment": "production", "environment_url": null, "log_url": null, "created_at": "2026-11-10T00:01:00Z", "creator": null}
        ]
    }))
    .unwrap();
    DeliveryView::seed_deployment(root, deployment, cx);
}

const RUN_LOG: &str = "2026-11-11T10:00:00.0000000Z ##[group]Run cargo test --workspace --all-features -- --nocapture
2026-11-11T10:00:01.0000000Z \x1b[1m\x1b[92m   Compiling\x1b[0m athas v0.1.0 (/home/runner/work/athas/athas/crates/athas)
2026-11-11T10:00:02.0000000Z ##[warning]unused import: `std::collections::HashMap` in crates/github_panel/src/run_view.rs:4 — remove it or use it, the lint is denied in release builds and the job will fail there
2026-11-11T10:00:03.0000000Z test logs::tests::parses_timestamps_levels_and_colours ... ok
2026-11-11T10:00:04.0000000Z test logs::tests::steps_through_problems ... ok
2026-11-11T10:00:05.0000000Z test run_view::tests::wraps_long_lines ... FAILED
2026-11-11T10:00:06.0000000Z ##[error]thread 'run_view::tests::wraps_long_lines' panicked at crates/github_panel/src/run_view.rs:812:9: assertion `left == right` failed: the wrapped row should be taller than one line of text when the job log has a very long line like this one
2026-11-11T10:00:07.0000000Z test result: FAILED. 41 passed; 1 failed; 0 ignored
2026-11-11T10:00:08.0000000Z ##[error]Process completed with exit code 101.
2026-11-11T10:00:09.0000000Z ##[endgroup]
";

/// The view a scene draws, and a hook that puts it in its state once it has settled.
pub type Settle = Box<dyn FnOnce(&mut Window, &mut App)>;

/// `scene` is `<view>[:<state>]`: `pr`, `issue`, `create-pr`, `create-issue`, `create-action`,
/// `release`, `release-new`, `deployment`.
pub fn scene(scene: &str, root: PathBuf, window: &mut Window, cx: &mut App) -> Option<(AnyView, Settle)> {
    seed(&root, cx);
    let (view, state) = scene.split_once(':').unwrap_or((scene, ""));
    let state = state.to_string();
    Some(match view {
        "pr" => {
            let view = cx.new(|cx| PullRequestView::new(root, 41, None, window, cx));
            let handle = view.clone();
            (view.into(), Box::new(move |window: &mut Window, cx: &mut App| handle.update(cx, |view, cx| view.snapshot(&state, window, cx))) as Settle)
        }
        "run" => {
            let details: crate::gh::WorkflowRunDetails = serde_json::from_value(json!({
                "databaseId": 77, "name": "CI", "displayTitle": "Port the GitHub panel to GPUI", "workflowName": "CI", "event": "pull_request",
                "status": "completed", "conclusion": "failure", "createdAt": "2026-11-11T10:00:00Z", "updatedAt": "2026-11-11T10:04:00Z",
                "runStartedAt": "2026-11-11T10:00:00Z", "runNumber": 512, "runAttempt": 1, "actor": {"login": "mehmet"},
                "url": "https://github.com/athasdev/athas/actions/runs/77", "headBranch": "gpui-github", "headSha": "abcdef1234567",
                "jobs": [{"id": 9001, "name": "test", "status": "completed", "conclusion": "failure", "startedAt": "2026-11-11T10:00:00Z",
                    "completedAt": "2026-11-11T10:04:00Z", "url": "https://github.com/athasdev/athas/actions/runs/77/job/9001", "runnerName": "macos-14",
                    "steps": [{"name": "Run cargo test", "status": "completed", "conclusion": "failure", "number": 1, "startedAt": "2026-11-11T10:00:00Z", "completedAt": "2026-11-11T10:04:00Z"}]}]
            }))
            .unwrap();
            store::put(details_key(&root, 77), std::sync::Arc::new(details), cx);
            let view = cx.new(|cx| RunView::new(root, 77, window, cx));
            let handle = view.clone();
            (view.into(), Box::new(move |_: &mut Window, cx: &mut App| handle.update(cx, |view, cx| view.snapshot(&state, RUN_LOG, cx))) as Settle)
        }
        "issue" => {
            let view = cx.new(|cx| IssueView::new(root, 7, window, cx));
            let handle = view.clone();
            (view.into(), Box::new(move |window: &mut Window, cx: &mut App| handle.update(cx, |view, cx| view.snapshot(&state, window, cx))) as Settle)
        }
        "create-pr" | "create-issue" | "create-action" => {
            let kind = match view {
                "create-pr" => CreateKind::PullRequest,
                "create-issue" => CreateKind::Issue,
                _ => CreateKind::Action,
            };
            let view = cx.new(|cx| CreateView::new(root, kind, window, cx));
            let handle = view.clone();
            (view.into(), Box::new(move |window: &mut Window, cx: &mut App| handle.update(cx, |view, cx| view.snapshot(&state, window, cx))) as Settle)
        }
        "release" | "release-new" | "deployment" => {
            let (kind, id) = match view {
                "release" => (DeliveryKind::Release, Some(5)),
                "release-new" => (DeliveryKind::Release, None),
                _ => (DeliveryKind::Deployment, Some(3)),
            };
            let view = cx.new(|cx| DeliveryView::new(root, kind, id, window, cx));
            let handle = view.clone();
            (view.into(), Box::new(move |window: &mut Window, cx: &mut App| handle.update(cx, |view, cx| view.snapshot(&state, window, cx))) as Settle)
        }
        _ => return None,
    })
}
