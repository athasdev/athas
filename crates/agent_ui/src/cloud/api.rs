//! The client of Athas's cloud agents service (`/api/cloud-agents`): start an agent run on a
//! GitHub repository, list runs, read a run's log and cancel it. Calls are blocking; run them off
//! the main thread.
//!
//! Ported from Athas's `cloud-agents/services/cloud-agents-api.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use account::{ApiError, Client, Method};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    #[default]
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    #[serde(other)]
    Unknown,
}

impl RunStatus {
    pub fn is_active(self) -> bool {
        matches!(self, RunStatus::Queued | RunStatus::Running)
    }

    pub fn label(self) -> &'static str {
        match self {
            RunStatus::Queued => "Queued",
            RunStatus::Running => "Running",
            RunStatus::Succeeded => "Succeeded",
            RunStatus::Failed => "Failed",
            RunStatus::Cancelled => "Cancelled",
            RunStatus::Unknown => "Unknown",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CloudRun {
    pub id: String,
    pub repo: String,
    pub base_branch: String,
    pub branch: String,
    pub title: String,
    /// `claude-code` or `codex`.
    pub agent: String,
    pub status: RunStatus,
    pub max_minutes: u64,
    pub billed_seconds: u64,
    pub charged_cents: u64,
    pub pr_url: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub prompt: Option<String>,
    /// `athas` (Athas credit) or `own-key`.
    pub billing: Option<String>,
    /// Credit spent so far, in millionths of a dollar.
    pub spent_micros: Option<u64>,
    pub spend_cap_micros: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LogLine {
    pub at: u64,
    /// `stdout`, `stderr` or `system`.
    pub stream: String,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRun {
    pub repo: String,
    pub base_branch: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub agent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_minutes: Option<u64>,
    /// The user's own key, when they chose to run on it instead of Athas credit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credentials: Option<Credentials>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai_api_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CloudRepo {
    pub full_name: String,
    pub default_branch: Option<String>,
    pub private: bool,
    pub pushed_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CloudError {
    SignedOut,
    /// The service answered with an error: `code` is one of `pro_required`,
    /// `github_not_connected`, `allowance_exhausted`, `spend_cap_reached`, `model_unavailable`.
    Http { status: u16, code: Option<String>, message: String },
    Unavailable(String),
}

impl std::fmt::Display for CloudError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CloudError::SignedOut => f.write_str("Sign in to Athas to run agents in the cloud."),
            CloudError::Http { message, .. } => f.write_str(message),
            CloudError::Unavailable(message) => f.write_str(message),
        }
    }
}

impl CloudError {
    fn from_api(error: ApiError) -> Self {
        match error {
            ApiError::NotAuthenticated => CloudError::SignedOut,
            ApiError::Http { status, code, message } => CloudError::Http { status, code, message },
            other => CloudError::Unavailable(format!("{other} Check your connection and try again.")),
        }
    }

    fn status(&self) -> Option<u16> {
        match self {
            CloudError::Http { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// What the user can do about it, when there is something.
    pub fn action(&self) -> Option<&'static str> {
        match self {
            CloudError::SignedOut => Some("Sign in"),
            CloudError::Http { code: Some(code), .. } => match code.as_str() {
                "pro_required" | "allowance_exhausted" | "spend_cap_reached" => Some("Manage billing"),
                "github_not_connected" => Some("Connect GitHub"),
                _ => None,
            },
            _ => None,
        }
    }
}

/// A client signed in with the account's token; without one every call fails with
/// [`CloudError::SignedOut`].
#[derive(Clone)]
pub struct CloudClient {
    client: Client,
    token: Option<String>,
}

fn parse<T: for<'de> Deserialize<'de>>(value: &Value, field: &str) -> Result<T, CloudError> {
    serde_json::from_value(value.get(field).cloned().unwrap_or(Value::Null))
        .map_err(|error| CloudError::Unavailable(format!("The cloud agents service answered unexpectedly: {error}")))
}

fn encode(segment: &str) -> String {
    segment
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

impl CloudClient {
    pub fn new(client: Client, token: Option<String>) -> Self {
        Self { client, token: token.filter(|token| !token.is_empty()) }
    }

    /// The signed-in account's client (signed out when there is no account).
    pub fn from_account(cx: &gpui::App) -> Self {
        match account::AccountStore::global(cx) {
            Some(store) => {
                let store = store.read(cx);
                Self::new(store.client().clone(), store.token().map(str::to_string))
            }
            None => Self::new(Client::new(account::urls(cx)), None),
        }
    }

    pub fn is_signed_in(&self) -> bool {
        self.token.is_some()
    }

    fn call(&self, method: Method, path: &str, body: Option<&Value>) -> Result<Value, CloudError> {
        let token = self.token.as_deref().ok_or(CloudError::SignedOut)?;
        self.client.authed(token, method, path, body, "Cloud agents are temporarily unavailable").map_err(CloudError::from_api)
    }

    pub fn list_runs(&self) -> Result<Vec<CloudRun>, CloudError> {
        parse(&self.call(Method::Get, "/api/cloud-agents/runs", None)?, "runs")
    }

    pub fn get_run(&self, id: &str) -> Result<CloudRun, CloudError> {
        parse(&self.call(Method::Get, &format!("/api/cloud-agents/runs/{}", encode(id)), None)?, "run")
    }

    pub fn start_run(&self, input: &StartRun) -> Result<CloudRun, CloudError> {
        let body = serde_json::to_value(input).unwrap_or_default();
        parse(&self.call(Method::Post, "/api/cloud-agents/runs", Some(&body))?, "run")
    }

    pub fn cancel_run(&self, id: &str) -> Result<CloudRun, CloudError> {
        parse(&self.call(Method::Post, &format!("/api/cloud-agents/runs/{}/cancel", encode(id)), None)?, "run")
    }

    /// Log lines after `cursor`, and the cursor to ask from next.
    pub fn logs(&self, id: &str, after: u64) -> Result<(Vec<LogLine>, u64), CloudError> {
        let value = self.call(Method::Get, &format!("/api/cloud-agents/runs/{}/logs?after={after}", encode(id)), None)?;
        let lines: Vec<LogLine> = parse(&value, "lines")?;
        let cursor = value.get("cursor").and_then(Value::as_u64).unwrap_or(after);
        Ok((lines, cursor))
    }

    /// The GitHub repositories a run can work on; servers without the cloud agents listing answer
    /// from the GitHub integration's list.
    pub fn repos(&self) -> Result<Vec<CloudRepo>, CloudError> {
        let value = match self.call(Method::Get, "/api/cloud-agents/repos", None) {
            Ok(value) => value,
            Err(error) if matches!(error.status(), Some(404 | 405)) => self.call(Method::Get, "/api/integrations/github/repos", None)?,
            Err(error) => return Err(error),
        };
        let repos = value.get("repos").and_then(Value::as_array).cloned().unwrap_or_default();
        Ok(repos
            .iter()
            .filter_map(|repo| {
                Some(CloudRepo {
                    full_name: repo.get("fullName")?.as_str()?.to_string(),
                    default_branch: repo.get("defaultBranch").and_then(Value::as_str).filter(|branch| !branch.is_empty()).map(str::to_string),
                    private: repo.get("private").and_then(Value::as_bool).unwrap_or(false),
                    pushed_at: repo.get("pushedAt").and_then(Value::as_str).map(str::to_string),
                })
            })
            .collect())
    }

    /// A repository's branches and its default one.
    pub fn branches(&self, repo: &str) -> Result<(Option<String>, Vec<String>), CloudError> {
        let value = self.call(Method::Get, &format!("/api/cloud-workspaces/branches?repo={}", encode(repo)), None)?;
        let branches = value
            .get("branches")
            .and_then(Value::as_array)
            .map(|branches| {
                branches
                    .iter()
                    .filter_map(|branch| branch.as_str().or_else(|| branch.get("name").and_then(Value::as_str)).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let default = value.get("defaultBranch").and_then(Value::as_str).map(str::to_string);
        Ok((default, branches))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_providers::test_support::{MockResponse, MockServer};
    use serde_json::json;

    fn client(server: &MockServer) -> CloudClient {
        CloudClient::new(Client::new(account::ServiceUrls::local(&server.url)), Some("tok".into()))
    }

    #[test]
    fn signed_out_calls_fail_without_a_request() {
        let server = MockServer::start();
        let signed_out = CloudClient::new(Client::new(account::ServiceUrls::local(&server.url)), None);
        assert_eq!(signed_out.list_runs(), Err(CloudError::SignedOut));
        assert_eq!(CloudError::SignedOut.action(), Some("Sign in"));
        assert!(server.requests().is_empty());
    }

    #[test]
    fn runs_start_list_log_and_cancel() {
        let server = MockServer::start();
        let run = json!({ "id": "r 1", "repo": "athasdev/athas", "baseBranch": "main", "branch": "athas/fix", "title": "Fix it",
            "agent": "claude-code", "status": "running", "maxMinutes": 30, "billedSeconds": 12, "chargedCents": 0,
            "prUrl": null, "error": null, "createdAt": "2026-11-11T10:00:00Z", "startedAt": null, "finishedAt": null });
        server.push(MockResponse::json(200, json!({ "run": run })));
        server.push(MockResponse::json(200, json!({ "runs": [run] })));
        server.push(MockResponse::json(200, json!({ "lines": [{ "at": 1, "stream": "stdout", "text": "cloning" }], "cursor": 7 })));
        server.push(MockResponse::json(200, json!({ "run": { "id": "r 1", "status": "cancelled" } })));
        let client = client(&server);

        let started = client
            .start_run(&StartRun { repo: "athasdev/athas".into(), base_branch: "main".into(), prompt: "Fix it".into(), agent: "claude-code".into(), ..Default::default() })
            .unwrap();
        assert_eq!((started.status, started.base_branch.as_str()), (RunStatus::Running, "main"));
        assert_eq!(client.list_runs().unwrap().len(), 1);
        let (lines, cursor) = client.logs("r 1", 0).unwrap();
        assert_eq!((lines[0].text.as_str(), cursor), ("cloning", 7));
        assert_eq!(client.cancel_run("r 1").unwrap().status, RunStatus::Cancelled);

        let requests = server.requests();
        assert_eq!((requests[0].method.as_str(), requests[0].path.as_str()), ("POST", "/api/cloud-agents/runs"));
        assert_eq!(requests[0].body["baseBranch"], "main");
        assert!(requests[0].body.get("title").is_none());
        assert_eq!(requests[0].header("authorization"), Some("Bearer tok"));
        assert_eq!(requests[2].path, "/api/cloud-agents/runs/r%201/logs?after=0");
        assert_eq!(requests[3].path, "/api/cloud-agents/runs/r%201/cancel");
    }

    #[test]
    fn errors_carry_the_services_code_and_repos_fall_back() {
        let server = MockServer::start();
        server.push(MockResponse::json(402, json!({ "error": "Cloud agents need Pro.", "code": "pro_required" })));
        server.push(MockResponse::json(404, json!({ "error": "Not found" })));
        server.push(MockResponse::json(200, json!({ "repos": [{ "fullName": "a/b", "defaultBranch": "main", "private": true }, { "name": "skip" }] })));
        let client = client(&server);
        let error = client.list_runs().unwrap_err();
        assert_eq!(error.to_string(), "Cloud agents need Pro.");
        assert_eq!(error.action(), Some("Manage billing"));
        let repos = client.repos().unwrap();
        assert_eq!(repos, vec![CloudRepo { full_name: "a/b".into(), default_branch: Some("main".into()), private: true, pushed_at: None }]);
        assert_eq!(server.requests()[2].path, "/api/integrations/github/repos");
    }
}
