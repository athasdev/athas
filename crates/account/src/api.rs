//! The account service's REST API (`features/auth/services/auth-api.ts`): the desktop sign-in
//! session, the signed-in user, the plan with its capabilities, credits and team snapshot, and
//! sign out. Calls block, so callers run them on the background executor.

use std::{fmt, time::Duration};

use serde::{Deserialize, Deserializer, de::DeserializeOwned};
use serde_json::Value;

use crate::service_urls::{ServiceUrls, is_local};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const LOGOUT_TIMEOUT: Duration = Duration::from_secs(5);
pub const DESKTOP_SESSION_SECRET_HEADER: &str = "X-Desktop-Session-Secret";

/// Codes a 403 carries when the saved session itself is no longer accepted.
const INVALID_SESSION_CODES: &[&str] = &["invalid_session", "session_invalid", "session_revoked", "session_expired", "token_revoked"];

/// Reads a list, skipping items an older or newer server shaped differently.
fn lenient_vec<'de, D: Deserializer<'de>, T: DeserializeOwned>(deserializer: D) -> Result<Vec<T>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Array(items) => items.into_iter().filter_map(|item| serde_json::from_value(item).ok()).collect(),
        _ => Vec::new(),
    })
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct AuthUser {
    pub id: i64,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub provider: Option<String>,
    pub github_username: Option<String>,
    pub subscription_status: Option<String>,
    #[serde(rename = "subscriptionStatus")]
    pub subscription_status_camel: Option<String>,
    pub created_at: Option<String>,
}

impl AuthUser {
    /// Whether the user record itself says Pro, before the plan has loaded.
    pub fn is_pro_snapshot(&self) -> bool {
        self.subscription_status.as_deref() == Some("pro") || self.subscription_status_camel.as_deref() == Some("pro")
    }
}

/// What the plan unlocks (`ProductCapability`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Capabilities {
    pub intelligence: bool,
    pub hosted_ai: bool,
    pub settings_sync: bool,
    pub cloud_workspaces: bool,
    pub cloud_agents: bool,
    pub previews: bool,
    pub collaboration: bool,
    pub enterprise_policy: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct PlanSnapshot {
    pub plan: String,
    pub renews_at: Option<String>,
    pub ends_at: Option<String>,
}

/// This period's included hosted AI credit and the prepaid balance, in USD cents.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct IntelligenceCredits {
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub allowance_cents: i64,
    pub used_cents: i64,
    pub pending_cents: i64,
    pub remaining_cents: i64,
    pub requests_count: i64,
    pub usage_markup: Option<f64>,
    pub wallet_balance_cents: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct Enterprise {
    pub has_access: bool,
    pub is_admin: bool,
    pub policy: Option<EnterprisePolicy>,
}

/// The organization's rules for Athas (`EnterprisePolicy`), which admins change in Settings > Team.
#[derive(Clone, Debug, Default, PartialEq, Deserialize, serde::Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EnterprisePolicy {
    pub managed_mode: bool,
    pub require_extension_allowlist: bool,
    pub allowed_extension_ids: Vec<String>,
    pub allow_byok: bool,
    pub ai_completion_enabled: bool,
    pub ai_chat_enabled: bool,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TeamWorkspace {
    pub id: i64,
    pub name: String,
    pub slug: String,
    pub role: String,
    pub visibility: String,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TeamMember {
    pub id: i64,
    pub user_id: Option<i64>,
    pub name: String,
    pub email: String,
    pub role: String,
    pub status: String,
    pub last_seen_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TeamInvitation {
    pub id: i64,
    pub email: String,
    pub role: String,
    pub status: String,
    pub expires_at: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewState {
    Requested,
    Approved,
    ChangesRequested,
    #[default]
    #[serde(other)]
    None,
}

/// An agent session a teammate shared with the team.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TeamSharedSession {
    pub share_id: String,
    pub title: String,
    pub owner_user_id: i64,
    pub owner_name: String,
    pub live: bool,
    pub revision: i64,
    pub updated_at: Option<String>,
    pub comment_count: i64,
    pub review_state: ReviewState,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InboxKind {
    Handoff,
    ReviewRequest,
    Review,
    #[default]
    #[serde(other)]
    Mention,
}

/// A mention, hand-off or review request for this user.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TeamInboxItem {
    pub id: i64,
    pub kind: InboxKind,
    pub actor_user_id: Option<i64>,
    pub actor_name: String,
    pub share_id: Option<String>,
    pub session_title: Option<String>,
    pub body: String,
    pub created_at: Option<String>,
    pub read_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TeamPresence {
    pub id: i64,
    pub user_id: Option<i64>,
    pub following_user_id: Option<i64>,
    pub device_id: String,
    pub status: String,
    pub active_file_path: Option<String>,
    pub cursor_label: Option<String>,
    pub heartbeat_at: Option<String>,
}

/// A file shared with the team for realtime presence (`collaboration.documents`).
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TeamDocument {
    pub id: i64,
    pub path: String,
    pub base_version: i64,
    pub updated_at: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TeamCapabilities {
    pub can_invite: bool,
    pub can_manage_members: bool,
    pub can_share_projects: bool,
    pub can_share_sessions: bool,
    pub activity_feed: bool,
    pub presence: bool,
    pub realtime_documents: bool,
}

/// The team snapshot the plan carries; every list is there even when an older server leaves it
/// out (`parseCollaborationSnapshot`).
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Collaboration {
    pub enabled: bool,
    pub workspace: Option<TeamWorkspace>,
    #[serde(deserialize_with = "lenient_vec")]
    pub members: Vec<TeamMember>,
    #[serde(deserialize_with = "lenient_vec")]
    pub invitations: Vec<TeamInvitation>,
    #[serde(deserialize_with = "lenient_vec")]
    pub shared_sessions: Vec<TeamSharedSession>,
    #[serde(deserialize_with = "lenient_vec")]
    pub inbox: Vec<TeamInboxItem>,
    #[serde(deserialize_with = "lenient_vec")]
    pub presence: Vec<TeamPresence>,
    #[serde(deserialize_with = "lenient_vec")]
    pub documents: Vec<TeamDocument>,
    pub capabilities: TeamCapabilities,
    /// The workspace's shared rules (`settings.sharedSettings`: invite policy, seat and update
    /// limits), as the server sends them.
    pub settings: Option<Value>,
}

impl Collaboration {
    pub fn parse(value: &Value) -> Option<Self> {
        value.get("enabled").and_then(Value::as_bool)?;
        serde_json::from_value(value.clone()).ok()
    }
}

/// `/api/auth/subscription`: the plan, what it unlocks, the credits and the team.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SubscriptionInfo {
    /// `free` or `pro`.
    pub status: String,
    pub capabilities: Capabilities,
    pub subscription: Option<PlanSnapshot>,
    pub collaboration: Option<Collaboration>,
    pub enterprise: Enterprise,
    pub credits: Option<IntelligenceCredits>,
}

impl SubscriptionInfo {
    /// Reads the answer, filling in the capabilities an older server does not report from the
    /// plan (`parseSubscriptionInfoResponse`). `None` when it is not a subscription at all.
    pub fn parse(payload: &Value) -> Option<Self> {
        let status = payload.get("status").and_then(Value::as_str).filter(|status| matches!(*status, "free" | "pro"))?;
        let pro = status == "pro";
        let collaboration = payload.get("collaboration").and_then(Collaboration::parse);
        let enterprise: Enterprise = payload.get("enterprise").and_then(|value| serde_json::from_value(value.clone()).ok()).unwrap_or_default();
        let reported = payload.get("capabilities").cloned().unwrap_or(Value::Null);
        let flag = |name: &str| reported.get(name).and_then(Value::as_bool);
        let capabilities = Capabilities {
            intelligence: flag("intelligence").or(flag("hostedAi")).unwrap_or(pro),
            hosted_ai: flag("hostedAi").or(flag("intelligence")).unwrap_or(pro),
            settings_sync: flag("settingsSync").unwrap_or(pro),
            cloud_workspaces: flag("cloudWorkspaces").unwrap_or(pro),
            // Servers from before cloud agents and previews, or without them set up, do not offer them.
            cloud_agents: flag("cloudAgents") == Some(true),
            previews: flag("previews") == Some(true),
            collaboration: flag("collaboration").unwrap_or(collaboration.as_ref().is_some_and(|team| team.enabled)),
            enterprise_policy: flag("enterprisePolicy").unwrap_or(enterprise.has_access),
        };
        let subscription = payload
            .get("subscription")
            .filter(|value| value.get("plan").is_some_and(Value::is_string))
            .and_then(|value| serde_json::from_value(value.clone()).ok());
        let credits = payload
            .get("intelligence")
            .and_then(|value| value.get("credits"))
            .filter(|value| value.is_object())
            .and_then(|value| serde_json::from_value(value.clone()).ok());
        Some(Self { status: status.to_string(), capabilities, subscription, collaboration, enterprise, credits })
    }

    pub fn plan(&self) -> Option<&str> {
        self.subscription.as_ref().map(|plan| plan.plan.as_str())
    }

    /// The team, when the plan includes one.
    pub fn team(&self) -> Option<&Collaboration> {
        self.collaboration.as_ref().filter(|team| team.enabled)
    }
}

/// A sign-in session the browser completes (`/api/auth/desktop/session/init`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopSession {
    pub session_id: String,
    pub poll_secret: String,
    pub login_url: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PollStatus {
    Pending,
    Ready(String),
    Expired,
    Missing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopAuthCode {
    EndpointUnavailable,
    Expired,
    Timeout,
    Failed,
}

/// Why a check of the saved session did not answer whether it is valid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CheckFailure {
    Unreachable,
    LocalServerDown,
    Timeout,
    ServerError,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ApiError {
    /// No token is saved.
    NotAuthenticated,
    /// The server answered with an error status. `message` is the server's own when it sent one.
    Http { status: u16, code: Option<String>, message: String },
    Timeout { host: String },
    Unreachable { host: String, local: bool, detail: String },
    Malformed(String),
    DesktopAuth { code: DesktopAuthCode, message: String },
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAuthenticated => write!(f, "Sign in to your Athas account first."),
            Self::Http { message, .. } => write!(f, "{message}"),
            Self::Timeout { host } => write!(f, "{host} did not answer in time."),
            Self::Unreachable { host, local: true, .. } => write!(f, "Nothing is answering at {host}."),
            Self::Unreachable { host, .. } => write!(f, "Could not reach {host}."),
            Self::Malformed(message) | Self::DesktopAuth { message, .. } => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for ApiError {}

impl ApiError {
    /// Whether the saved session is gone. A plain 403 is a permission answer (a plan, a team
    /// policy) and must not sign the user out; only 401, or a 403 whose body marks the session
    /// invalid, does.
    pub fn is_auth_invalid(&self) -> bool {
        match self {
            Self::Http { status: 401, .. } => true,
            Self::Http { status: 403, code: Some(code), .. } => INVALID_SESSION_CODES.contains(&code.as_str()),
            _ => false,
        }
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            Self::Http { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// Why the session could not be checked, and one line saying what happened.
    pub fn check_failure(&self, host: &str) -> (CheckFailure, String) {
        match self {
            Self::Http { status, .. } if *status >= 500 => (CheckFailure::ServerError, format!("{host} had a server error ({status}).")),
            Self::Http { status, .. } => (CheckFailure::ServerError, format!("{host} gave an unexpected answer ({status}).")),
            Self::Timeout { .. } => (CheckFailure::Timeout, format!("{host} did not answer in time.")),
            Self::Unreachable { local: true, .. } => (CheckFailure::LocalServerDown, format!("Nothing is answering at {host}.")),
            _ => (CheckFailure::Unreachable, format!("Could not reach {host}.")),
        }
    }
}

/// The server's error code from a response body, when it sent one.
fn error_code(body: &Value) -> Option<String> {
    let nested = body.get("error").filter(|error| error.is_object());
    let code = nested.and_then(|error| error.get("code")).or_else(|| body.get("code")).and_then(Value::as_str);
    match code {
        Some(code) if !code.is_empty() => Some(code.to_string()),
        _ => (body.get("sessionInvalid") == Some(&Value::Bool(true))).then(|| "invalid_session".to_string()),
    }
}

/// The server's error message (`{ "error": "..." }`), when it sent one.
fn error_message(body: &Value) -> Option<String> {
    let error = body.get("error")?;
    error.as_str().or_else(|| error.get("message").and_then(Value::as_str)).map(str::to_string)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl Method {
    fn name(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Patch => "PATCH",
            Self::Delete => "DELETE",
        }
    }
}

/// One call to the service, sent by the platform's transport.
struct Request {
    method: Method,
    url: String,
    headers: Vec<(&'static str, String)>,
    body: Option<String>,
    timeout: Duration,
}

impl Request {
    fn new(method: Method, url: String) -> Self {
        Self { method, url, headers: Vec::new(), body: None, timeout: REQUEST_TIMEOUT }
    }

    fn header(mut self, name: &'static str, value: impl Into<String>) -> Self {
        self.headers.push((name, value.into()));
        self
    }
}

/// A client of the account service. Cheap to clone.
#[derive(Clone)]
pub struct Client {
    urls: ServiceUrls,
    #[cfg(not(target_family = "wasm"))]
    http: reqwest::blocking::Client,
}

impl Client {
    pub fn new(urls: ServiceUrls) -> Self {
        #[cfg(not(target_family = "wasm"))]
        let http = reqwest::blocking::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent(concat!("Athas/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default();
        Self {
            urls,
            #[cfg(not(target_family = "wasm"))]
            http,
        }
    }

    pub fn urls(&self) -> &ServiceUrls {
        &self.urls
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.urls.api_base)
    }

    #[cfg(not(target_family = "wasm"))]
    fn transport_error(&self, error: reqwest::Error) -> ApiError {
        let host = self.urls.api_host();
        if error.is_timeout() {
            ApiError::Timeout { host }
        } else {
            ApiError::Unreachable { host, local: is_local(&self.urls.api_base), detail: error.to_string() }
        }
    }

    /// Sends a request and reads the JSON answer, whatever its status. `Value::Null` stands for
    /// an empty or non-JSON body.
    #[cfg(not(target_family = "wasm"))]
    fn send(&self, request: Request) -> Result<(u16, Value), ApiError> {
        let method = reqwest::Method::from_bytes(request.method.name().as_bytes()).unwrap_or(reqwest::Method::GET);
        let mut builder = self.http.request(method, &request.url).timeout(request.timeout);
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        let response = builder.send().map_err(|error| self.transport_error(error))?;
        let status = response.status().as_u16();
        let text = response.text().map_err(|error| self.transport_error(error))?;
        Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
    }

    /// The browser's synchronous XMLHttpRequest: callers already treat calls as blocking, and the
    /// single-threaded web build runs the background executor on the page's own thread.
    #[cfg(target_family = "wasm")]
    fn send(&self, request: Request) -> Result<(u16, Value), ApiError> {
        let unreachable = |detail: String| ApiError::Unreachable { host: self.urls.api_host(), local: is_local(&self.urls.api_base), detail };
        let detail = |error: wasm_bindgen::JsValue| format!("{error:?}");
        let xhr = web_sys::XmlHttpRequest::new().map_err(|error| unreachable(detail(error)))?;
        xhr.open_with_async(request.method.name(), &request.url, false).map_err(|error| unreachable(detail(error)))?;
        for (name, value) in &request.headers {
            xhr.set_request_header(name, value).map_err(|error| unreachable(detail(error)))?;
        }
        xhr.send_with_opt_str(request.body.as_deref()).map_err(|error| unreachable(detail(error)))?;
        let status = xhr.status().map_err(|error| unreachable(detail(error)))?;
        if status == 0 {
            return Err(unreachable(String::new()));
        }
        let text = xhr.response_text().ok().flatten().unwrap_or_default();
        Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
    }

    /// A call with the account token. Error statuses become `ApiError::Http` with the server's
    /// message, or `failure` and the status when it sent none.
    pub fn authed(&self, token: &str, method: Method, path: &str, body: Option<&Value>, failure: &str) -> Result<Value, ApiError> {
        let mut request = Request::new(method, self.url(path))
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json");
        request.body = body.map(Value::to_string);
        let (status, payload) = self.send(request)?;
        if (200..300).contains(&status) {
            return Ok(payload);
        }
        Err(ApiError::Http {
            status,
            code: error_code(&payload),
            message: error_message(&payload).unwrap_or_else(|| format!("{failure}: {status}")),
        })
    }

    /// `PATCH /api/enterprise/policy` (`updateEnterprisePolicy`): changes some of the policy, for
    /// admins, and answers with all of it.
    pub fn update_enterprise_policy(&self, token: &str, patch: &Value) -> Result<EnterprisePolicy, ApiError> {
        let payload = self.authed(token, Method::Patch, "/api/enterprise/policy", Some(patch), "Failed to update enterprise policy")?;
        payload
            .get("policy")
            .and_then(|policy| serde_json::from_value(policy.clone()).ok())
            .ok_or_else(|| ApiError::Malformed("Failed to update enterprise policy.".into()))
    }

    pub fn fetch_me(&self, token: &str) -> Result<AuthUser, ApiError> {
        let payload = self.authed(token, Method::Get, "/api/auth/me", None, "Failed to fetch user")?;
        let user = payload.get("user").filter(|user| user.is_object()).ok_or_else(|| ApiError::Http {
            status: 401,
            code: None,
            message: "Authentication token did not resolve to a user.".into(),
        })?;
        serde_json::from_value(user.clone()).map_err(|error| ApiError::Malformed(format!("Unexpected user record: {error}")))
    }

    pub fn fetch_subscription(&self, token: &str) -> Result<SubscriptionInfo, ApiError> {
        let payload = self.authed(token, Method::Get, "/api/auth/subscription", None, "Failed to fetch subscription")?;
        SubscriptionInfo::parse(&payload).ok_or_else(|| ApiError::Malformed("Subscription response was malformed.".into()))
    }

    /// Ends the session on the server. Failures are ignored: the local token goes either way.
    pub fn logout(&self, token: &str) {
        let mut request = Request::new(Method::Delete, self.url("/api/auth/logout")).header("Authorization", format!("Bearer {token}"));
        request.timeout = LOGOUT_TIMEOUT;
        let _ = self.send(request);
    }

    fn unavailable_message(&self) -> String {
        if is_local(&self.urls.api_base) {
            format!(
                "Could not reach local auth server at {}. Start the local web app/server first, then try sign-in again.",
                self.urls.api_base
            )
        } else {
            format!("Could not reach auth server at {}.", self.urls.api_base)
        }
    }

    pub fn begin_desktop_session(&self) -> Result<DesktopSession, ApiError> {
        let failed = |message: String| ApiError::DesktopAuth { code: DesktopAuthCode::Failed, message };
        let request = Request::new(Method::Post, self.url("/api/auth/desktop/session/init")).header("Content-Type", "application/json");
        let (status, payload) = self.send(request).map_err(|_| failed(self.unavailable_message()))?;
        if status == 404 {
            return Err(ApiError::DesktopAuth {
                code: DesktopAuthCode::EndpointUnavailable,
                message: "Desktop sign-in is unavailable on this server.".into(),
            });
        }
        if !(200..300).contains(&status) {
            return Err(failed(format!("Desktop sign-in failed ({status}).")));
        }
        let field = |name: &str| payload.get(name).and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_string);
        match (field("sessionId"), field("pollSecret"), field("loginUrl")) {
            (Some(session_id), Some(poll_secret), Some(login_url)) => Ok(DesktopSession { session_id, poll_secret, login_url }),
            _ => Err(failed("Invalid desktop sign-in response.".into())),
        }
    }

    /// Asks once whether the browser finished signing in.
    pub fn poll_desktop_session(&self, session: &DesktopSession) -> Result<PollStatus, ApiError> {
        let failed = |message: String| ApiError::DesktopAuth { code: DesktopAuthCode::Failed, message };
        let query: String = url::form_urlencoded::Serializer::new(String::new()).append_pair("session", &session.session_id).finish();
        let request = Request::new(Method::Get, format!("{}?{query}", self.url("/api/auth/desktop/session")))
            .header(DESKTOP_SESSION_SECRET_HEADER, session.poll_secret.clone());
        let (status, payload) = self.send(request).map_err(|error| failed(format!("{} {error}", self.unavailable_message())))?;
        if status == 410 {
            return Err(ApiError::DesktopAuth { code: DesktopAuthCode::Expired, message: "Desktop sign-in session expired.".into() });
        }
        // A server answers an unknown session with `{ status: "missing" }` (200 now, 404 on older
        // servers), which is not a missing endpoint.
        let parsed = match payload.get("status").and_then(Value::as_str) {
            Some("pending") => Some(PollStatus::Pending),
            Some("expired") => Some(PollStatus::Expired),
            Some("missing") => Some(PollStatus::Missing),
            Some("ready") => payload.get("token").and_then(Value::as_str).filter(|token| !token.is_empty()).map(|token| PollStatus::Ready(token.into())),
            _ => None,
        };
        if status == 404 && parsed.is_none() {
            return Err(ApiError::DesktopAuth {
                code: DesktopAuthCode::EndpointUnavailable,
                message: "Desktop auth session endpoint is unavailable on this server.".into(),
            });
        }
        if !(200..300).contains(&status) && status != 404 {
            return Err(failed(format!("Desktop sign-in failed ({status}).")));
        }
        parsed.ok_or_else(|| failed("Invalid desktop sign-in response.".into()))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use telemetry::mock_server::{MockServer, Response};

    use super::*;

    fn client(server: &MockServer) -> Client {
        Client::new(ServiceUrls::local(server.url()))
    }

    #[test]
    fn fills_capabilities_an_older_server_leaves_out() {
        let info = SubscriptionInfo::parse(&json!({ "status": "pro", "subscription": { "plan": "pro" } })).unwrap();
        assert!(info.capabilities.intelligence && info.capabilities.settings_sync && info.capabilities.cloud_workspaces);
        assert!(!info.capabilities.cloud_agents && !info.capabilities.previews && !info.capabilities.collaboration);
        assert_eq!(info.plan(), Some("pro"));

        let reported = SubscriptionInfo::parse(&json!({
            "status": "free",
            "capabilities": { "hostedAi": true, "cloudAgents": true },
            "collaboration": { "enabled": true, "members": [{ "id": 1, "name": "Sam" }, "not a member"] },
            "enterprise": { "has_access": true },
            "intelligence": { "credits": { "allowanceCents": 2000, "usedCents": 500, "remainingCents": 1500 } },
        }))
        .unwrap();
        assert!(reported.capabilities.intelligence && reported.capabilities.hosted_ai && reported.capabilities.cloud_agents);
        assert!(!reported.capabilities.settings_sync);
        assert!(reported.capabilities.collaboration && reported.capabilities.enterprise_policy);
        let team = reported.team().unwrap();
        assert_eq!(team.members.len(), 1);
        assert!(team.inbox.is_empty() && team.shared_sessions.is_empty());
        assert_eq!(reported.credits.unwrap().used_cents, 500);

        assert_eq!(SubscriptionInfo::parse(&json!({ "status": "gold" })), None);
    }

    #[test]
    fn tells_an_invalid_session_from_a_permission_answer() {
        let http = |status, code: Option<&str>| ApiError::Http { status, code: code.map(Into::into), message: String::new() };
        assert!(http(401, None).is_auth_invalid());
        assert!(http(403, Some("session_revoked")).is_auth_invalid());
        assert!(!http(403, None).is_auth_invalid());
        assert!(!http(403, Some("plan_required")).is_auth_invalid());
        assert!(!http(500, None).is_auth_invalid());
        assert_eq!(error_code(&json!({ "error": { "code": "token_revoked" } })).as_deref(), Some("token_revoked"));
        assert_eq!(error_code(&json!({ "sessionInvalid": true })).as_deref(), Some("invalid_session"));
    }

    #[test]
    fn fetches_the_user_and_plan_with_the_token() {
        let server = MockServer::start(|request| match request.path.as_str() {
            "/api/auth/me" => Response::json(200, json!({ "user": { "id": 7, "email": "sam@example.com", "name": "Sam" } })),
            "/api/auth/subscription" => Response::json(200, json!({ "status": "pro", "subscription": { "plan": "teams" } })),
            _ => Response::json(404, json!({})),
        });
        let client = client(&server);
        let user = client.fetch_me("tok").unwrap();
        assert_eq!((user.id, user.name.as_deref()), (7, Some("Sam")));
        assert_eq!(client.fetch_subscription("tok").unwrap().plan(), Some("teams"));
        let requests = server.requests();
        assert!(requests.iter().all(|request| request.header("authorization") == Some("Bearer tok")));
    }

    #[test]
    fn reports_server_errors_with_their_code() {
        let server = MockServer::start(|_| Response::json(403, json!({ "error": { "code": "session_expired", "message": "Expired" } })));
        let error = client(&server).fetch_me("tok").unwrap_err();
        assert!(error.is_auth_invalid());
        assert_eq!(error.to_string(), "Expired");
        let empty = MockServer::start(|_| Response::json(200, json!({ "user": null })));
        assert!(client(&empty).fetch_me("tok").unwrap_err().is_auth_invalid());
    }

    #[test]
    fn an_unreachable_server_is_not_an_invalid_session() {
        let client = Client::new(ServiceUrls::local("http://127.0.0.1:1"));
        let error = client.fetch_me("tok").unwrap_err();
        assert!(!error.is_auth_invalid());
        let (reason, message) = error.check_failure("127.0.0.1:1");
        assert_eq!(reason, CheckFailure::LocalServerDown);
        assert_eq!(message, "Nothing is answering at 127.0.0.1:1.");
    }

    #[test]
    fn starts_and_polls_a_desktop_session() {
        let server = MockServer::start(|request| match (request.method.as_str(), request.path.as_str()) {
            ("POST", "/api/auth/desktop/session/init") => {
                Response::json(200, json!({ "sessionId": "s 1", "pollSecret": "secret", "loginUrl": "https://example.com/login" }))
            }
            ("GET", path) if path.starts_with("/api/auth/desktop/session?session=s") => {
                if request.header(DESKTOP_SESSION_SECRET_HEADER) == Some("secret") {
                    Response::json(200, json!({ "status": "ready", "token": "tok" }))
                } else {
                    Response::json(200, json!({ "status": "missing" }))
                }
            }
            _ => Response::json(404, json!({})),
        });
        let client = client(&server);
        let session = client.begin_desktop_session().unwrap();
        assert_eq!(session.login_url, "https://example.com/login");
        assert_eq!(client.poll_desktop_session(&session).unwrap(), PollStatus::Ready("tok".into()));
        assert_eq!(server.requests()[1].path, "/api/auth/desktop/session?session=s+1");
        let wrong = DesktopSession { poll_secret: "nope".into(), ..session };
        assert_eq!(client.poll_desktop_session(&wrong).unwrap(), PollStatus::Missing);
    }

    #[test]
    fn desktop_sign_in_errors() {
        let gone = MockServer::start(|_| Response::json(404, json!({ "error": "Not found" })));
        let error = client(&gone).begin_desktop_session().unwrap_err();
        assert!(matches!(error, ApiError::DesktopAuth { code: DesktopAuthCode::EndpointUnavailable, .. }));
        let session = DesktopSession { session_id: "s".into(), poll_secret: "p".into(), login_url: "u".into() };
        let expired = MockServer::start(|_| Response::json(410, json!({})));
        assert!(matches!(client(&expired).poll_desktop_session(&session), Err(ApiError::DesktopAuth { code: DesktopAuthCode::Expired, .. })));
        let old = MockServer::start(|_| Response::json(404, json!({ "status": "missing" })));
        assert_eq!(client(&old).poll_desktop_session(&session).unwrap(), PollStatus::Missing);
    }
}
