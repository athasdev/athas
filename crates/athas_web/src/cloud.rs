//! Cloud workspaces from the web app at athas.dev/app: the website's account and workspace API,
//! the workspace tokens it hands out, and the steps that open, follow, resume and stop a cloud
//! workspace. The page then connects the workbench to the running workspace as it does to any
//! workspace server.
//!
//! Ported from Athas's `web-workbench/services/website-api.ts`, `website-links.ts` and
//! `cloud-workspace-controller.ts`. Requests are plain blocking calls through [`Fetch`], as the
//! rest of the web build makes them, so everything here is tested natively.

use std::time::Duration;

use serde_json::{Map, Value, json};
use web_protocol::WorkspaceSession;

/// A token this close to expiring is replaced before it is used to connect.
pub const TOKEN_MARGIN_MS: i64 = 30_000;
/// Tokens last ten minutes; the socket gets a fresh one well before that.
pub const TOKEN_RENEW: Duration = Duration::from_secs(4 * 60);
pub const STARTING_POLL: Duration = Duration::from_secs(2);

/// Pages of the website the web app links to; same-origin paths, since the app is served under
/// `/app` on the website.
pub mod pages {
    pub const DASHBOARD: &str = "/dashboard";
    pub const ACCOUNT: &str = "/dashboard/settings/account";
    pub const BILLING: &str = "/dashboard/settings/billing";
    pub const INTEGRATIONS: &str = "/dashboard/settings/integrations";
    pub const DOCS: &str = "/docs";
}

/// The sign-in page, returning to where the user is in the app afterwards (`getSignInUrl`).
pub fn sign_in_url(pathname: &str, search: &str) -> String {
    let next = if pathname.starts_with("/app") { format!("{pathname}{search}") } else { "/app".to_string() };
    format!("/auth/sign-in?next={}", encode_component(&next))
}

/// `encodeURIComponent`.
pub fn encode_component(text: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => encoded.push(byte as char),
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebsiteUser {
    pub id: i64,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plan {
    Free,
    Pro,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WebsiteAccount {
    SignedOut,
    SignedIn {
        user: WebsiteUser,
        plan: Plan,
        /// Pro with the cloud Worker configured: GitHub repositories open in a cloud workspace.
        cloud_editor: bool,
        github_connected: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GithubRepository {
    pub full_name: String,
    pub private: bool,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepositoryBranches {
    pub default_branch: Option<String>,
    pub branches: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceStatus {
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CloudWorkspace {
    pub id: String,
    pub repo: String,
    pub branch: String,
    pub status: WorkspaceStatus,
    pub stop_reason: Option<String>,
    pub error: Option<String>,
}

/// Whether the workspace is starting or running.
pub fn is_open_workspace(workspace: Option<&CloudWorkspace>) -> bool {
    workspace.is_some_and(|workspace| matches!(workspace.status, WorkspaceStatus::Starting | WorkspaceStatus::Running))
}

/// Why a workspace is no longer running, in words for the user.
pub fn ended_message(workspace: &CloudWorkspace) -> String {
    if workspace.status == WorkspaceStatus::Failed {
        return workspace.error.clone().unwrap_or_else(|| "The cloud workspace could not be started.".into());
    }
    match workspace.stop_reason.as_deref() {
        Some("idle") => "The cloud workspace stopped after 30 idle minutes.".into(),
        Some("limit") => "The cloud workspace reached its time limit.".into(),
        _ => "The cloud workspace stopped.".into(),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebsiteApiError {
    pub message: String,
    pub status: u16,
    pub code: Option<String>,
}

impl std::fmt::Display for WebsiteApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for WebsiteApiError {}

/// One same-origin request to the website, carrying its session cookie: the status and body, or
/// why it could not be made.
pub trait Fetch {
    fn fetch(&self, method: &str, path: &str, body: Option<&str>) -> Result<(u16, String), String>;
}

fn string_or_none(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).filter(|text| !text.is_empty()).map(String::from)
}

fn parse_user(value: Option<&Value>) -> Option<WebsiteUser> {
    let user = value?.as_object()?;
    Some(WebsiteUser {
        id: user.get("id")?.as_f64().map(|id| id as i64)?,
        email: user.get("email")?.as_str()?.to_string(),
        name: string_or_none(user.get("name")),
        avatar_url: string_or_none(user.get("avatarUrl")).or_else(|| string_or_none(user.get("avatar_url"))),
    })
}

fn parse_workspace(value: Option<&Value>) -> Result<CloudWorkspace, WebsiteApiError> {
    let unexpected = || WebsiteApiError { message: "The server sent an unexpected workspace.".into(), status: 502, code: None };
    let workspace = value.and_then(Value::as_object).ok_or_else(unexpected)?;
    let text = |name: &str| workspace.get(name).and_then(Value::as_str).map(String::from).ok_or_else(unexpected);
    let status = match workspace.get("status").and_then(Value::as_str) {
        Some("starting") => WorkspaceStatus::Starting,
        Some("running") => WorkspaceStatus::Running,
        Some("stopped") => WorkspaceStatus::Stopped,
        Some("failed") => WorkspaceStatus::Failed,
        _ => return Err(unexpected()),
    };
    Ok(CloudWorkspace {
        id: text("id")?,
        repo: text("repo")?,
        branch: text("branch")?,
        status,
        stop_reason: string_or_none(workspace.get("stopReason")),
        error: string_or_none(workspace.get("error")),
    })
}

/// The athas.dev APIs the web app calls.
pub struct WebsiteApi<F> {
    fetch: F,
}

impl<F: Fetch> WebsiteApi<F> {
    pub fn new(fetch: F) -> Self {
        Self { fetch }
    }

    fn request(&self, method: &str, path: &str, body: Option<Value>) -> Result<Map<String, Value>, WebsiteApiError> {
        let body = body.map(|body| body.to_string());
        let (status, text) = self
            .fetch
            .fetch(method, path, body.as_deref())
            .map_err(|error| WebsiteApiError { message: error, status: 0, code: None })?;
        let payload = serde_json::from_str::<Value>(&text).ok();
        let record = payload.and_then(|payload| match payload {
            Value::Object(map) => Some(map),
            _ => None,
        });
        if !(200..300).contains(&status) {
            let body = record.unwrap_or_default();
            return Err(WebsiteApiError {
                message: string_or_none(body.get("error")).unwrap_or_else(|| format!("The request failed ({status}).")),
                status,
                code: string_or_none(body.get("code")),
            });
        }
        Ok(record.unwrap_or_default())
    }

    fn github_connected(&self) -> bool {
        self.request("GET", "/api/integrations/github", None).is_ok_and(|body| body.get("connected") == Some(&Value::Bool(true)))
    }

    /// Who is signed in to athas.dev, and what the account may do in the app.
    pub fn account(&self) -> Result<WebsiteAccount, WebsiteApiError> {
        let Some(user) = parse_user(self.request("GET", "/api/auth/me", None)?.get("user")) else {
            return Ok(WebsiteAccount::SignedOut);
        };
        let subscription = match self.request("GET", "/api/auth/subscription", None) {
            Ok(subscription) => subscription,
            // The session ended between the two requests.
            Err(error) if error.status == 401 => return Ok(WebsiteAccount::SignedOut),
            Err(error) => return Err(error),
        };
        let plan = if subscription.get("status").and_then(Value::as_str) == Some("pro") { Plan::Pro } else { Plan::Free };
        let cloud_editor = subscription.get("capabilities").and_then(|capabilities| capabilities.get("cloudEditor")) == Some(&Value::Bool(true));
        Ok(WebsiteAccount::SignedIn { user, plan, cloud_editor, github_connected: cloud_editor && self.github_connected() })
    }

    pub fn sign_out(&self) -> Result<(), WebsiteApiError> {
        self.request("POST", "/api/auth/sign-out", None).map(|_| ())
    }

    pub fn list_repositories(&self) -> Result<Vec<GithubRepository>, WebsiteApiError> {
        let body = self.request("GET", "/api/integrations/github/repos", None)?;
        Ok(body
            .get("repos")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|repo| {
                let repo = repo.as_object()?;
                Some(GithubRepository {
                    full_name: repo.get("fullName")?.as_str()?.to_string(),
                    private: repo.get("private") == Some(&Value::Bool(true)),
                    description: string_or_none(repo.get("description")),
                })
            })
            .collect())
    }

    pub fn list_branches(&self, repo: &str) -> Result<RepositoryBranches, WebsiteApiError> {
        let body = self.request("GET", &format!("/api/cloud-workspaces/branches?repo={}", encode_component(repo)), None)?;
        let branches = body
            .get("branches")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|branch| branch.get("name")?.as_str().map(String::from))
            .collect();
        Ok(RepositoryBranches { default_branch: string_or_none(body.get("defaultBranch")), branches })
    }

    pub fn list_workspaces(&self) -> Result<Vec<CloudWorkspace>, WebsiteApiError> {
        let body = self.request("GET", "/api/cloud-workspaces", None)?;
        match body.get("workspaces") {
            Some(Value::Array(workspaces)) => workspaces.iter().map(|workspace| parse_workspace(Some(workspace))).collect(),
            _ => Ok(Vec::new()),
        }
    }

    /// Opens a workspace for the repository and branch, or returns the one already open.
    pub fn open_workspace(&self, repo: &str, branch: &str) -> Result<CloudWorkspace, WebsiteApiError> {
        parse_workspace(self.request("POST", "/api/cloud-workspaces", Some(json!({ "repo": repo, "branch": branch })))?.get("workspace"))
    }

    pub fn get_workspace(&self, id: &str) -> Result<CloudWorkspace, WebsiteApiError> {
        parse_workspace(self.request("GET", &format!("/api/cloud-workspaces/{}", encode_component(id)), None)?.get("workspace"))
    }

    pub fn stop_workspace(&self, id: &str) -> Result<CloudWorkspace, WebsiteApiError> {
        parse_workspace(self.request("POST", &format!("/api/cloud-workspaces/{}/stop", encode_component(id)), None)?.get("workspace"))
    }

    /// A fresh session for a running workspace: the Worker's URL and a ten-minute token.
    pub fn create_workspace_session(&self, id: &str) -> Result<WorkspaceSession, WebsiteApiError> {
        let body = self.request("POST", &format!("/api/cloud-workspaces/{}/token", encode_component(id)), None)?;
        body.get("session")
            .and_then(WorkspaceSession::parse)
            .filter(|session| session.workspace_id == id)
            .ok_or_else(|| WebsiteApiError { message: "The server sent an unexpected workspace session.".into(), status: 502, code: None })
    }
}

/// Hands out workspace tokens from the website's token endpoint: the cached one while it is
/// still good, a new one when it is about to expire or the Worker refused it
/// (`createWorkspaceTokenSource`).
pub struct TokenSource {
    workspace_id: String,
    latest: Option<WorkspaceSession>,
}

impl TokenSource {
    pub fn new(workspace_id: impl Into<String>) -> Self {
        Self { workspace_id: workspace_id.into(), latest: None }
    }

    pub fn session<F: Fetch>(&mut self, api: &WebsiteApi<F>) -> Result<WorkspaceSession, WebsiteApiError> {
        match &self.latest {
            Some(session) => Ok(session.clone()),
            None => self.refresh(api),
        }
    }

    pub fn refresh<F: Fetch>(&mut self, api: &WebsiteApi<F>) -> Result<WorkspaceSession, WebsiteApiError> {
        let session = api.create_workspace_session(&self.workspace_id)?;
        self.latest = Some(session.clone());
        Ok(session)
    }

    /// A token to connect with: the cached one unless `force` (the Worker refused it) or it
    /// expires within [`TOKEN_MARGIN_MS`] of `now_ms`.
    pub fn token<F: Fetch>(&mut self, api: &WebsiteApi<F>, force: bool, now_ms: i64) -> Result<String, WebsiteApiError> {
        if let Some(latest) = &self.latest
            && !force
            && latest.expires_at_ms().is_some_and(|expires| expires - now_ms > TOKEN_MARGIN_MS)
        {
            return Ok(latest.token.clone());
        }
        Ok(self.refresh(api)?.token)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Opening,
    Starting,
    Connecting,
    Connected,
    Stopping,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CloudState {
    pub phase: Phase,
    /// The workspace being opened or in use, as the website last reported it.
    pub workspace: Option<CloudWorkspace>,
    /// Why the last open failed or the workspace ended, in words for the user.
    pub error: Option<String>,
}

impl Default for CloudState {
    fn default() -> Self {
        Self { phase: Phase::Idle, workspace: None, error: None }
    }
}

/// A running workspace ready to connect to, with its first session.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadyWorkspace {
    pub workspace: CloudWorkspace,
    pub session: WorkspaceSession,
}

/// Opens one of the user's GitHub repositories in a cloud workspace: asks the website to start
/// (or reuse) a workspace, follows it while it starts, and hands back its session for the page
/// to connect with; stops it again. One workspace is in use at a time
/// (`createCloudWorkspaceController`). The page reports [`connected`](Self::connected) once the
/// workbench uses the workspace, and [`ended`](Self::ended) when its socket says it stopped.
pub struct CloudController<F> {
    pub api: WebsiteApi<F>,
    state: CloudState,
    generation: u64,
    pub poll: Duration,
}

impl<F: Fetch> CloudController<F> {
    pub fn new(api: WebsiteApi<F>) -> Self {
        Self { api, state: CloudState::default(), generation: 0, poll: STARTING_POLL }
    }

    pub fn state(&self) -> &CloudState {
        &self.state
    }

    /// The run a step belongs to; a newer run (or a stop) makes older steps give up.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    fn update(&mut self, phase: Option<Phase>, workspace: Option<Option<CloudWorkspace>>, error: Option<Option<String>>) {
        if let Some(phase) = phase {
            self.state.phase = phase;
        }
        if let Some(workspace) = workspace {
            self.state.workspace = workspace;
        }
        if let Some(error) = error {
            self.state.error = error;
        }
    }

    fn fail(&mut self, run: u64, error: WebsiteApiError, fallback: &str) -> Option<ReadyWorkspace> {
        if run == self.generation {
            let message = if error.message.is_empty() { fallback.to_string() } else { error.message };
            self.update(Some(Phase::Idle), None, Some(Some(message)));
        }
        None
    }

    /// Starts opening `repo` at `branch`, unless a workspace is already in use; the run to pass to
    /// [`open_step`](Self::open_step).
    pub fn begin_open(&mut self) -> Option<u64> {
        if self.state.phase != Phase::Idle {
            return None;
        }
        self.generation += 1;
        self.update(Some(Phase::Opening), Some(None), Some(None));
        Some(self.generation)
    }

    /// Asks the website for the workspace. A run stopped meanwhile stops the workspace it got.
    pub fn open_step(&mut self, run: u64, repo: &str, branch: &str) -> Result<Option<CloudWorkspace>, ()> {
        match self.api.open_workspace(repo, branch) {
            Ok(workspace) if run != self.generation => {
                // Stopped while the website was still starting it.
                let _ = self.api.stop_workspace(&workspace.id);
                Ok(None)
            }
            Ok(workspace) => Ok(Some(workspace)),
            Err(error) => {
                self.fail(run, error, "The cloud workspace could not be opened.");
                Err(())
            }
        }
    }

    /// Picks up a workspace that is already starting or running, after a reload: the run to
    /// follow it with, and the workspace.
    pub fn begin_resume(&mut self) -> Option<(u64, CloudWorkspace)> {
        if self.state.phase != Phase::Idle {
            return None;
        }
        let workspace = self.api.list_workspaces().unwrap_or_default().into_iter().find(|workspace| is_open_workspace(Some(workspace)))?;
        if self.state.phase != Phase::Idle {
            return None;
        }
        self.generation += 1;
        self.update(None, Some(Some(workspace.clone())), Some(None));
        Some((self.generation, workspace))
    }

    /// One look at a workspace being followed: `Continue` with the latest report while it starts
    /// (wait [`poll`](Self::poll) before the next look), `Ready` once it runs and has a session,
    /// `Done` when it never ran, failed or the run is stale.
    pub fn follow_step(&mut self, run: u64, workspace: CloudWorkspace, first: bool) -> FollowStep {
        if run != self.generation {
            return FollowStep::Done;
        }
        let workspace = if first {
            workspace
        } else {
            match self.api.get_workspace(&workspace.id) {
                Ok(latest) if run == self.generation => latest,
                Ok(_) => return FollowStep::Done,
                Err(error) => {
                    self.fail(run, error, "The cloud workspace could not be reached.");
                    return FollowStep::Done;
                }
            }
        };
        match workspace.status {
            WorkspaceStatus::Starting => {
                self.update(Some(Phase::Starting), Some(Some(workspace.clone())), None);
                FollowStep::Continue(workspace)
            }
            WorkspaceStatus::Running => {
                self.update(Some(Phase::Connecting), Some(Some(workspace.clone())), None);
                match self.api.create_workspace_session(&workspace.id) {
                    Ok(_) if run != self.generation => FollowStep::Done,
                    Ok(session) => FollowStep::Ready(ReadyWorkspace { workspace, session }),
                    Err(error) => {
                        self.fail(run, error, "The cloud workspace could not be reached.");
                        FollowStep::Done
                    }
                }
            }
            WorkspaceStatus::Stopped | WorkspaceStatus::Failed => {
                let message = ended_message(&workspace);
                self.update(Some(Phase::Idle), Some(Some(workspace)), Some(Some(message)));
                FollowStep::Done
            }
        }
    }

    /// Follows `workspace` until it runs, waiting with `sleep` between looks.
    pub async fn follow<S, Fut>(&mut self, run: u64, workspace: CloudWorkspace, mut sleep: S) -> Option<ReadyWorkspace>
    where
        S: FnMut(Duration) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let mut step = self.follow_step(run, workspace, true);
        loop {
            match step {
                FollowStep::Continue(workspace) => {
                    sleep(self.poll).await;
                    step = self.follow_step(run, workspace, false);
                }
                FollowStep::Ready(ready) => return Some(ready),
                FollowStep::Done => return None,
            }
        }
    }

    /// Opens `repo` at `branch` and follows it until it runs.
    pub async fn open<S, Fut>(&mut self, repo: &str, branch: &str, sleep: S) -> Option<ReadyWorkspace>
    where
        S: FnMut(Duration) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let run = self.begin_open()?;
        let workspace = self.open_step(run, repo, branch).ok()??;
        self.follow(run, workspace, sleep).await
    }

    /// Picks up a workspace that is already open and follows it until it runs.
    pub async fn resume<S, Fut>(&mut self, sleep: S) -> Option<ReadyWorkspace>
    where
        S: FnMut(Duration) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let (run, workspace) = self.begin_resume()?;
        self.follow(run, workspace, sleep).await
    }

    /// The workbench uses the workspace now.
    pub fn connected(&mut self, run: u64) {
        if run == self.generation {
            self.update(Some(Phase::Connected), None, None);
        }
    }

    /// Connecting failed: back to idle with why.
    pub fn connect_failed(&mut self, run: u64, error: impl Into<String>) {
        if run == self.generation {
            self.update(Some(Phase::Idle), None, Some(Some(error.into())));
        }
    }

    /// The workspace's socket said it stopped: back to idle, with why from the website's latest
    /// report, or the socket's own reason.
    pub fn ended(&mut self, socket_error: Option<String>) {
        self.generation += 1;
        let latest = self.state.workspace.as_ref().and_then(|workspace| self.api.get_workspace(&workspace.id).ok());
        let error = match &latest {
            Some(latest) => ended_message(latest),
            None => socket_error.unwrap_or_else(|| "The connection to the cloud workspace ended.".into()),
        };
        let workspace = latest.or_else(|| self.state.workspace.clone());
        self.update(Some(Phase::Idle), Some(workspace), Some(Some(error)));
    }

    /// Stops the workspace in use (and its billing). The page disconnects the workbench after.
    pub fn stop(&mut self) {
        if matches!(self.state.phase, Phase::Idle | Phase::Stopping) {
            return;
        }
        self.generation += 1;
        let Some(workspace) = self.state.workspace.clone() else {
            self.update(Some(Phase::Idle), None, Some(None));
            return;
        };
        self.update(Some(Phase::Stopping), None, Some(None));
        let (stopped, error) = match self.api.stop_workspace(&workspace.id) {
            Ok(stopped) => (Some(stopped), None),
            Err(error) => (None, Some(if error.message.is_empty() { "The cloud workspace could not be stopped.".into() } else { error.message })),
        };
        self.update(Some(Phase::Idle), Some(Some(stopped.unwrap_or(workspace))), Some(error));
    }
}

/// A row of the web app's account menu (`web-account-menu.tsx`), in groups split by separators.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AccountRow {
    /// The signed-in user: name, email and plan, over the rows.
    Header { name: String, email: String, plan: &'static str },
    Item { id: &'static str, label: String, trailing: Option<&'static str>, disabled: bool },
    Separator,
}

/// The account menu for `account` while the cloud workspace is in `phase`: Open GitHub
/// Repository (and Stop Cloud Workspace while one is in use), the website's account pages when
/// signed in, Settings and Documentation, then Sign In or Sign Out.
pub fn account_menu_rows(account: Option<&WebsiteAccount>, phase: Phase) -> Vec<AccountRow> {
    let item = |id, label: &str| AccountRow::Item { id, label: label.to_string(), trailing: None, disabled: false };
    let mut groups: Vec<Vec<AccountRow>> = Vec::new();
    let mut workspace = vec![item("open-github-repository", "Open GitHub Repository")];
    if phase != Phase::Idle {
        workspace.push(AccountRow::Item { id: "stop-cloud-workspace", label: "Stop Cloud Workspace".into(), trailing: None, disabled: phase == Phase::Stopping });
    }
    groups.push(workspace);
    let mut rows = Vec::new();
    let signed_in = match account {
        Some(WebsiteAccount::SignedIn { user, plan, github_connected, .. }) => {
            let plan = if *plan == Plan::Pro { "Pro" } else { "Free" };
            rows.push(AccountRow::Header { name: user.name.clone().unwrap_or_else(|| user.email.clone()), email: user.email.clone(), plan });
            groups.push(vec![
                item("dashboard", "Dashboard"),
                item("account", "Account"),
                AccountRow::Item { id: "billing", label: "Plan & Billing".into(), trailing: Some(plan), disabled: false },
                item("integrations", if *github_connected { "Integrations" } else { "Connect GitHub" }),
            ]);
            true
        }
        _ => false,
    };
    groups.push(vec![item("settings", "Settings"), item("docs", "Documentation")]);
    groups.push(vec![if signed_in { item("sign-out", "Sign Out") } else { item("sign-in", "Sign In") }]);
    for (index, group) in groups.into_iter().enumerate() {
        if index > 0 || signed_in {
            rows.push(AccountRow::Separator);
        }
        rows.extend(group);
    }
    rows
}

/// Why the GitHub Repository step cannot list repositories (`GithubRepositoryContent`'s gates):
/// title, message and the action's label; `None` once the account can open them.
pub fn repository_gate(account: Option<&WebsiteAccount>) -> Option<(&'static str, &'static str, &'static str)> {
    match account {
        None | Some(WebsiteAccount::SignedOut) => {
            Some(("Open your GitHub repositories", "Sign in to open your own repositories in a cloud workspace.", "Sign In"))
        }
        Some(WebsiteAccount::SignedIn { cloud_editor: false, .. }) => {
            Some(("Cloud workspaces are part of Athas Pro", "Pro opens any of your GitHub repositories in a cloud workspace.", "Upgrade to Pro"))
        }
        Some(WebsiteAccount::SignedIn { github_connected: false, .. }) => {
            Some(("Connect GitHub", "Connect your GitHub account to list your repositories.", "Connect GitHub"))
        }
        Some(WebsiteAccount::SignedIn { .. }) => None,
    }
}

/// What one look at a followed workspace found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FollowStep {
    Continue(CloudWorkspace),
    Ready(ReadyWorkspace),
    Done,
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, collections::VecDeque};

    use super::*;

    fn labels(rows: &[AccountRow]) -> Vec<String> {
        rows.iter()
            .map(|row| match row {
                AccountRow::Header { name, plan, .. } => format!("[{name} {plan}]"),
                AccountRow::Item { label, trailing, disabled, .. } => format!("{label}{}{}", trailing.map(|text| format!(" ({text})")).unwrap_or_default(), if *disabled { " -" } else { "" }),
                AccountRow::Separator => "--".into(),
            })
            .collect()
    }

    #[test]
    fn account_menu_follows_the_account_and_workspace() {
        assert_eq!(labels(&account_menu_rows(Some(&WebsiteAccount::SignedOut), Phase::Idle)), ["Open GitHub Repository", "--", "Settings", "Documentation", "--", "Sign In"]);
        let user = WebsiteUser { id: 1, email: "me@x.dev".into(), name: Some("Me".into()), avatar_url: None };
        let account = WebsiteAccount::SignedIn { user, plan: Plan::Pro, cloud_editor: true, github_connected: false };
        assert_eq!(
            labels(&account_menu_rows(Some(&account), Phase::Stopping)),
            [
                "[Me Pro]", "--", "Open GitHub Repository", "Stop Cloud Workspace -", "--", "Dashboard", "Account", "Plan & Billing (Pro)", "Connect GitHub", "--", "Settings",
                "Documentation", "--", "Sign Out"
            ]
        );
        assert_eq!(repository_gate(Some(&account)).map(|gate| gate.2), Some("Connect GitHub"));
        assert_eq!(repository_gate(None).map(|gate| gate.2), Some("Sign In"));
    }

    const ID: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";

    /// Answers requests from a script, in order, and records them.
    #[derive(Default)]
    struct Script {
        answers: RefCell<VecDeque<(&'static str, u16, Value)>>,
        requests: RefCell<Vec<String>>,
    }

    impl Script {
        fn answer(self, path: &'static str, status: u16, body: Value) -> Self {
            self.answers.borrow_mut().push_back((path, status, body));
            self
        }
    }

    impl Fetch for &Script {
        fn fetch(&self, method: &str, path: &str, body: Option<&str>) -> Result<(u16, String), String> {
            self.requests.borrow_mut().push(format!("{method} {path}{}", body.map(|body| format!(" {body}")).unwrap_or_default()));
            let (expected, status, body) = self.answers.borrow_mut().pop_front().ok_or_else(|| format!("unexpected request {path}"))?;
            assert_eq!(expected, path, "request order");
            Ok((status, body.to_string()))
        }
    }

    fn workspace(status: &str) -> Value {
        json!({ "id": ID, "repo": "athasdev/athas", "branch": "main", "status": status, "stopReason": null, "error": null })
    }

    fn session(expires_at: &str) -> Value {
        json!({ "session": { "workspaceId": ID, "endpoint": "https://cloud.athas.dev", "token": format!("token-{expires_at}"), "expiresAt": expires_at, "repo": "athasdev/athas", "branch": "main" } })
    }

    fn now() -> impl std::future::Future<Output = ()> {
        std::future::ready(())
    }

    #[test]
    fn reads_the_account_and_what_it_may_do() {
        let script = Script::default()
            .answer("/api/auth/me", 200, json!({ "user": { "id": 7, "email": "a@b.c", "name": "", "avatar_url": "https://x/a.png" } }))
            .answer("/api/auth/subscription", 200, json!({ "status": "pro", "capabilities": { "cloudEditor": true } }))
            .answer("/api/integrations/github", 200, json!({ "connected": true }));
        let api = WebsiteApi::new(&script);
        assert_eq!(
            api.account().unwrap(),
            WebsiteAccount::SignedIn {
                user: WebsiteUser { id: 7, email: "a@b.c".into(), name: None, avatar_url: Some("https://x/a.png".into()) },
                plan: Plan::Pro,
                cloud_editor: true,
                github_connected: true,
            }
        );

        let script = Script::default().answer("/api/auth/me", 200, json!({ "user": null }));
        assert_eq!(WebsiteApi::new(&script).account().unwrap(), WebsiteAccount::SignedOut);

        let script = Script::default()
            .answer("/api/auth/me", 200, json!({ "user": { "id": 7, "email": "a@b.c" } }))
            .answer("/api/auth/subscription", 401, json!({ "error": "Signed out" }));
        assert_eq!(WebsiteApi::new(&script).account().unwrap(), WebsiteAccount::SignedOut);

        let script = Script::default()
            .answer("/api/auth/me", 200, json!({ "user": { "id": 7, "email": "a@b.c" } }))
            .answer("/api/auth/subscription", 200, json!({ "status": "free" }));
        let WebsiteAccount::SignedIn { plan, cloud_editor, github_connected, .. } = WebsiteApi::new(&script).account().unwrap() else { panic!() };
        assert_eq!((plan, cloud_editor, github_connected), (Plan::Free, false, false));
    }

    #[test]
    fn lists_repositories_branches_and_workspaces() {
        let script = Script::default()
            .answer("/api/integrations/github/repos", 200, json!({ "repos": [{ "fullName": "a/b", "private": true, "description": "x" }, { "name": "skipped" }] }))
            .answer("/api/cloud-workspaces/branches?repo=a%2Fb", 200, json!({ "defaultBranch": "main", "branches": [{ "name": "main" }, { "name": "dev" }, 3] }))
            .answer("/api/cloud-workspaces", 200, json!({ "workspaces": [workspace("running")] }))
            .answer("/api/cloud-workspaces", 200, json!({ "workspaces": [{ "id": ID }] }));
        let api = WebsiteApi::new(&script);
        assert_eq!(api.list_repositories().unwrap(), vec![GithubRepository { full_name: "a/b".into(), private: true, description: Some("x".into()) }]);
        assert_eq!(api.list_branches("a/b").unwrap(), RepositoryBranches { default_branch: Some("main".into()), branches: vec!["main".into(), "dev".into()] });
        assert_eq!(api.list_workspaces().unwrap()[0].status, WorkspaceStatus::Running);
        assert_eq!(api.list_workspaces().unwrap_err(), WebsiteApiError { message: "The server sent an unexpected workspace.".into(), status: 502, code: None });
    }

    #[test]
    fn errors_carry_the_website_message_and_code() {
        let script = Script::default()
            .answer("/api/cloud-workspaces", 402, json!({ "error": "Cloud workspaces need Pro.", "code": "pro_required" }))
            .answer("/api/cloud-workspaces", 500, json!("oops"));
        let api = WebsiteApi::new(&script);
        assert_eq!(
            api.open_workspace("a/b", "main").unwrap_err(),
            WebsiteApiError { message: "Cloud workspaces need Pro.".into(), status: 402, code: Some("pro_required".into()) }
        );
        let sent = script.requests.borrow()[0].clone();
        assert!(sent.starts_with("POST /api/cloud-workspaces {"), "{sent}");
        let body: Value = serde_json::from_str(sent.trim_start_matches("POST /api/cloud-workspaces ")).unwrap();
        assert_eq!(body, json!({ "repo": "a/b", "branch": "main" }));
        assert_eq!(api.open_workspace("a/b", "main").unwrap_err().message, "The request failed (500).");
    }

    #[test]
    fn sessions_must_belong_to_the_workspace() {
        let mut other = session("2026-11-13T15:49:00.000Z");
        other["session"]["workspaceId"] = json!("1f8fad5b-d9cb-469f-a165-70867728950e");
        let script = Script::default().answer("/api/cloud-workspaces/0f8fad5b-d9cb-469f-a165-70867728950e/token", 200, other);
        assert_eq!(WebsiteApi::new(&script).create_workspace_session(ID).unwrap_err().message, "The server sent an unexpected workspace session.");
    }

    #[test]
    fn tokens_are_reused_until_they_near_expiry_or_are_refused() {
        let token_path = "/api/cloud-workspaces/0f8fad5b-d9cb-469f-a165-70867728950e/token";
        let script = Script::default()
            .answer(token_path, 200, session("1970-01-01T00:10:00.000Z"))
            .answer(token_path, 200, session("1970-01-01T00:20:00.000Z"))
            .answer(token_path, 200, session("1970-01-01T00:30:00.000Z"));
        let api = WebsiteApi::new(&script);
        let mut tokens = TokenSource::new(ID);
        assert_eq!(tokens.token(&api, false, 0).unwrap(), "token-1970-01-01T00:10:00.000Z");
        assert_eq!(tokens.token(&api, false, 60_000).unwrap(), "token-1970-01-01T00:10:00.000Z");
        // Within 30 seconds of expiring.
        assert_eq!(tokens.token(&api, false, 580_000).unwrap(), "token-1970-01-01T00:20:00.000Z");
        assert_eq!(tokens.token(&api, true, 580_000).unwrap(), "token-1970-01-01T00:30:00.000Z");
        assert_eq!(tokens.session(&api).unwrap().token, "token-1970-01-01T00:30:00.000Z");
    }

    #[test]
    fn opening_follows_a_starting_workspace_until_it_runs() {
        let script = Script::default()
            .answer("/api/cloud-workspaces", 200, json!({ "workspace": workspace("starting") }))
            .answer("/api/cloud-workspaces/0f8fad5b-d9cb-469f-a165-70867728950e", 200, json!({ "workspace": workspace("starting") }))
            .answer("/api/cloud-workspaces/0f8fad5b-d9cb-469f-a165-70867728950e", 200, json!({ "workspace": workspace("running") }))
            .answer("/api/cloud-workspaces/0f8fad5b-d9cb-469f-a165-70867728950e/token", 200, session("2026-11-13T15:49:00.000Z"));
        let mut controller = CloudController::new(WebsiteApi::new(&script));
        let sleeps = RefCell::new(0);
        let ready = futures::executor::block_on(controller.open("athasdev/athas", "main", |_| {
            *sleeps.borrow_mut() += 1;
            now()
        }))
        .unwrap();
        assert_eq!(*sleeps.borrow(), 2);
        assert_eq!(ready.session.base_url(), format!("https://cloud.athas.dev/workspaces/{ID}"));
        assert_eq!(controller.state().phase, Phase::Connecting);
        let run = controller.generation();
        controller.connected(run);
        assert_eq!(controller.state().phase, Phase::Connected);
        // One workspace at a time.
        assert!(controller.begin_open().is_none());
    }

    #[test]
    fn a_workspace_that_fails_to_start_says_why() {
        let mut failed = workspace("failed");
        failed["error"] = json!("The repository could not be cloned.");
        let script = Script::default().answer("/api/cloud-workspaces", 200, json!({ "workspace": failed }));
        let mut controller = CloudController::new(WebsiteApi::new(&script));
        assert!(futures::executor::block_on(controller.open("a/b", "main", |_| now())).is_none());
        assert_eq!(controller.state().phase, Phase::Idle);
        assert_eq!(controller.state().error.as_deref(), Some("The repository could not be cloned."));

        let script = Script::default().answer("/api/cloud-workspaces", 403, json!({}));
        let mut controller = CloudController::new(WebsiteApi::new(&script));
        assert!(futures::executor::block_on(controller.open("a/b", "main", |_| now())).is_none());
        assert_eq!(controller.state().error.as_deref(), Some("The request failed (403)."));
    }

    #[test]
    fn resumes_an_open_workspace_after_a_reload() {
        let mut stopped = workspace("stopped");
        stopped["id"] = json!("old");
        let script = Script::default()
            .answer("/api/cloud-workspaces", 200, json!({ "workspaces": [stopped, workspace("running")] }))
            .answer("/api/cloud-workspaces/0f8fad5b-d9cb-469f-a165-70867728950e/token", 200, session("2026-11-13T15:49:00.000Z"));
        let mut controller = CloudController::new(WebsiteApi::new(&script));
        let ready = futures::executor::block_on(controller.resume(|_| now())).unwrap();
        assert_eq!(ready.workspace.id, ID);

        let script = Script::default().answer("/api/cloud-workspaces", 200, json!({ "workspaces": [] }));
        let mut controller = CloudController::new(WebsiteApi::new(&script));
        assert!(futures::executor::block_on(controller.resume(|_| now())).is_none());
        assert_eq!(controller.state(), &CloudState::default());
    }

    #[test]
    fn stopping_and_ending_report_the_workspace() {
        let mut stopped = workspace("stopped");
        stopped["stopReason"] = json!("idle");
        let script = Script::default()
            .answer("/api/cloud-workspaces", 200, json!({ "workspace": workspace("running") }))
            .answer("/api/cloud-workspaces/0f8fad5b-d9cb-469f-a165-70867728950e/token", 200, session("2026-11-13T15:49:00.000Z"))
            .answer("/api/cloud-workspaces/0f8fad5b-d9cb-469f-a165-70867728950e", 200, json!({ "workspace": stopped }))
            .answer("/api/cloud-workspaces", 200, json!({ "workspace": workspace("running") }))
            .answer("/api/cloud-workspaces/0f8fad5b-d9cb-469f-a165-70867728950e/token", 200, session("2026-11-13T15:49:00.000Z"))
            .answer("/api/cloud-workspaces/0f8fad5b-d9cb-469f-a165-70867728950e/stop", 200, json!({ "workspace": workspace("stopped") }));
        let mut controller = CloudController::new(WebsiteApi::new(&script));
        futures::executor::block_on(controller.open("a/b", "main", |_| now())).unwrap();
        controller.ended(Some("socket closed".into()));
        assert_eq!(controller.state().phase, Phase::Idle);
        assert_eq!(controller.state().error.as_deref(), Some("The cloud workspace stopped after 30 idle minutes."));

        futures::executor::block_on(controller.open("a/b", "main", |_| now())).unwrap();
        controller.stop();
        assert_eq!(controller.state().phase, Phase::Idle);
        assert_eq!(controller.state().workspace.as_ref().map(|workspace| workspace.status), Some(WorkspaceStatus::Stopped));
        assert_eq!(controller.state().error, None);
    }

    #[test]
    fn ended_messages_and_links() {
        let mut ended = parse_workspace(Some(&workspace("stopped"))).unwrap();
        assert_eq!(ended_message(&ended), "The cloud workspace stopped.");
        ended.stop_reason = Some("limit".into());
        assert_eq!(ended_message(&ended), "The cloud workspace reached its time limit.");
        ended.status = WorkspaceStatus::Failed;
        assert_eq!(ended_message(&ended), "The cloud workspace could not be started.");
        assert!(is_open_workspace(Some(&parse_workspace(Some(&workspace("starting"))).unwrap())));
        assert!(!is_open_workspace(None));
        assert_eq!(sign_in_url("/app/x", "?a=1"), "/auth/sign-in?next=%2Fapp%2Fx%3Fa%3D1");
        assert_eq!(sign_in_url("/", ""), "/auth/sign-in?next=%2Fapp");
    }
}
