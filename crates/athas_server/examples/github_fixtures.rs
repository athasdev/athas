//! `cargo run -p athas_server --example github_fixtures -- --root DIR --web DIR [--listen ADDR]`:
//! the workspace server with GitHub answered from fixtures, so the web workbench's GitHub views
//! can be looked at without a token or the network. Prints the address to open.

use std::{net::TcpListener, path::PathBuf, sync::Arc};

use anyhow::{Context as _, Result};
use athas_server::{ServerConfig, Workspace, serve};
use serde_json::{Value, json};
use web_protocol::github::{AuthState, GitHubCall};

fn crate_shape<T: serde::de::DeserializeOwned + serde::Serialize>(github: Value) -> Value {
    serde_json::to_value(serde_json::from_value::<T>(github).expect("fixture")).expect("fixture")
}

fn answer(call: GitHubCall) -> Result<Value, String> {
    let pr = |number: i64, title: &str, author: &str, draft: bool, decision: Value, updated: &str| {
        json!({ "number": number, "title": title, "state": "OPEN", "author": { "login": author }, "createdAt": "2026-11-10T08:00:00Z",
            "updatedAt": updated, "isDraft": draft, "reviewDecision": decision, "url": format!("https://github.com/acme/web/pull/{number}"),
            "headRefName": format!("feature-{number}"), "baseRefName": "main", "additions": number * 7, "deletions": number })
    };
    match call {
        GitHubCall::Auth => Ok(serde_json::to_value(AuthState::Authenticated { source: "ghCli".into() }).unwrap_or_default()),
        GitHubCall::CurrentUser => Ok(json!("mehmet")),
        GitHubCall::ListNotifications => Ok(json!([])),
        GitHubCall::ListPrs { .. } => Ok(crate_shape::<Vec<athas_github::PullRequest>>(json!([
            pr(42, "Relay GitHub through the workspace server", "mehmet", false, json!("APPROVED"), "2026-11-12T09:00:00Z"),
            pr(41, "Docker networks as rows", "ana", false, json!("REVIEW_REQUIRED"), "2026-11-11T15:00:00Z"),
            pr(40, "WIP: open a file at a commit", "lee", true, Value::Null, "2026-11-10T12:00:00Z"),
        ]))),
        GitHubCall::ListIssues { .. } => Ok(crate_shape::<Vec<athas_github::IssueListItem>>(json!([
            { "number": 17, "title": "GitHub views on the web", "state": "OPEN", "author": { "login": "ana" }, "updatedAt": "2026-11-12T08:00:00Z", "url": "https://github.com/acme/web/issues/17", "labels": [] }
        ]))),
        GitHubCall::ListWorkflowRuns { .. } => Ok(crate_shape::<Vec<athas_github::WorkflowRunListItem>>(json!([
            { "databaseId": 70, "displayTitle": "Relay GitHub", "name": "CI", "workflowName": "CI", "event": "push", "status": "completed", "conclusion": "success",
              "headBranch": "main", "createdAt": "2026-11-12T08:00:00Z", "updatedAt": "2026-11-12T08:10:00Z", "url": "https://github.com/acme/web/actions/runs/70" }
        ]))),
        GitHubCall::ListReleases { .. } | GitHubCall::ListDeployments { .. } => Ok(json!([])),
        other => Err(format!("No fixture for {}", other.to_method().0)),
    }
}

fn main() -> Result<()> {
    let mut root = std::env::current_dir()?;
    let mut web_dir = None;
    let mut listen = "127.0.0.1:0".to_string();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let value = args.next().with_context(|| format!("{arg} needs a value"))?;
        match arg.as_str() {
            "--root" => root = PathBuf::from(value),
            "--web" => web_dir = Some(PathBuf::from(value)),
            "--listen" => listen = value,
            other => anyhow::bail!("unknown argument {other}"),
        }
    }
    let workspace = Workspace::open(&root)?;
    workspace.set_github_backend(Arc::new(answer));
    let listener = TcpListener::bind(&listen)?;
    let token = "fixtures".to_string();
    println!("github_fixtures: open http://{}/?token={token}", listener.local_addr()?);
    serve(listener, workspace, Arc::new(ServerConfig { token, web_dir }))?;
    Ok(())
}
