//! A failed turn as people read it: a headline, the next step, the raw details kept apart, and
//! what can be done about it (try again, restart the agent, finish its sign-in in a terminal).
//!
//! Ported from Athas's `lib/agent-turn-error.ts`, `lib/api-error.ts` (status and code reading) and
//! the `ChatErrorBlock` of `components/messages/chat-error-block.tsx`.

use serde_json::Value;

const AUTHENTICATION_PATTERNS: &[&str] = &["authentication required", "requires authentication", "not authenticated", "needs you to sign in"];
const CONFIGURATION_PATTERNS: &[&str] = &["google_cloud_project", "google_cloud_project_id", "requires setting the"];
const NETWORK_PATTERNS: &[&str] = &[
    "error sending request",
    "failed to fetch",
    "networkerror",
    "load failed",
    "dns error",
    "connection refused",
    "connection reset",
    "tcp connect error",
    "network is unreachable",
    "could not reach",
    "no internet",
];
const RETRYABLE_STATUSES: &[u16] = &[408, 425, 429, 500, 502, 503, 504];
const RETRYABLE_CODES: &[&str] = &["timeout", "offline", "network", "provider_rejected", "provider_unavailable", "connection_interrupted", "RECONNECT"];
const SERVER_CODES: &[&str] = &["allowance_exhausted", "insufficient_balance", "spending_limit_reached", "request_too_large", "provider_rejected", "timeout"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Retry,
    RestartAgent,
    OpenAgentTerminal,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnFailure {
    pub title: String,
    /// The next step.
    pub message: String,
    /// The raw error, shown on request; empty when it says no more than the message.
    pub details: String,
    /// An HTTP status or a client code such as `OFFLINE`, shown beside the title.
    pub code: Option<String>,
    pub actions: Vec<Action>,
    /// The line under the actions when the agent's own setup is unfinished.
    pub setup_hint: Option<&'static str>,
    /// The server's own reason, such as `insufficient_balance`.
    pub server_code: Option<String>,
    /// The billing page a hosted 402 points to, as the server sent it.
    pub billing_url: Option<String>,
    /// Whether the provider's recovery (`ApiErrorActions`) goes with it: every failure but an
    /// agent's unfinished setup (`provider_settings`).
    pub provider_settings: bool,
}

/// What the error card's main button does (`ApiErrorActions`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Recovery {
    StartNewChat,
    OpenBilling(Option<String>),
    SignIn,
    ConfigureProvider,
    ConfigureModels,
    Retry,
}

/// Server codes for a hosted request refused over billing, which the billing page resolves.
pub const HOSTED_BILLING_CODES: &[&str] = &["allowance_exhausted", "insufficient_balance", "spending_limit_reached", "entitlement_required", "payment_required"];

impl TurnFailure {
    /// The main button's action and label for `hosted` (the Athas provider), and whether the
    /// "Model settings" button goes beside it.
    pub fn recovery(&self, hosted: bool, can_retry: bool) -> (Recovery, &'static str, bool) {
        let code = self.code.as_deref().unwrap_or_default();
        let server_code = self.server_code.as_deref().unwrap_or_default();
        let authentication = code == "401";
        let too_large = server_code == "request_too_large" || code == "413";
        let payment = !too_large && (code == "402" || HOSTED_BILLING_CODES.contains(&server_code));
        let configure = authentication || code == "403" || payment;
        let (recovery, label) = if too_large {
            (Recovery::StartNewChat, "Start new chat")
        } else if hosted && payment {
            (Recovery::OpenBilling(self.billing_url.clone()), if matches!(server_code, "allowance_exhausted" | "insufficient_balance") { "Add credit" } else { "Manage billing" })
        } else if hosted && authentication {
            (Recovery::SignIn, "Sign in to Athas")
        } else if configure && !hosted {
            (Recovery::ConfigureProvider, "Configure provider")
        } else if hosted && code == "403" {
            (Recovery::ConfigureModels, "Configure models")
        } else if can_retry {
            (Recovery::Retry, "Try again")
        } else {
            (Recovery::ConfigureModels, "Configure models")
        };
        (recovery, label, label != "Configure models")
    }
}

/// The web billing page for a hosted billing failure: the server's `billingUrl` when it stays on
/// the API or website origin, else the configured billing page (`resolveBillingUrl`).
pub fn resolve_billing_url(billing_url: Option<&str>, api_base: &str, website: &str, default_billing: &str) -> String {
    fn origin(url: &str) -> Option<String> {
        let (scheme, rest) = url.split_once("://")?;
        let host = rest.split(['/', '?', '#']).next()?;
        (matches!(scheme, "http" | "https") && !host.is_empty()).then(|| format!("{scheme}://{host}"))
    }
    let Some(url) = billing_url.filter(|url| !url.is_empty()) else { return default_billing.to_string() };
    let absolute = if url.starts_with('/') { format!("{}{url}", api_base.trim_end_matches('/')) } else { url.to_string() };
    let trusted = [origin(api_base), origin(website)];
    match origin(&absolute) {
        Some(found) if trusted.iter().flatten().any(|trusted| *trusted == found) => absolute,
        _ => default_billing.to_string(),
    }
}

/// A headline and next step for a hosted request the server refused over billing.
fn hosted_billing_failure(code: Option<&str>, wallet_balance_cents: Option<f64>) -> Option<(&'static str, String)> {
    Some(match code? {
        "allowance_exhausted" => (
            "Included credit used up",
            match wallet_balance_cents.filter(|cents| *cents > 0.) {
                Some(cents) => format!(
                    "Your included Athas credit is used up and your pay-as-you-go balance ({}) doesn't cover this request. Add credit to continue, or choose another model.",
                    crate::hosted_usage::format_cents(cents.round() as i64)
                ),
                None => "Your included Athas credit for this month is used up. Add pay-as-you-go credit to keep going, or choose another model.".into(),
            },
        ),
        "insufficient_balance" => ("Not enough credit", "Your pay-as-you-go balance doesn't cover this request. Add credit to continue, or choose another model.".into()),
        "spending_limit_reached" => ("Spending limit reached", "You've reached the monthly spending limit set for Athas AI. Raise it in billing to continue, or choose another model.".into()),
        "entitlement_required" => ("Pro or credit required", "Athas models need Pro or pay-as-you-go credit. Upgrade or add credit in billing to use them.".into()),
        _ => return None,
    })
}

fn contains_any(text: &str, patterns: &[&str]) -> bool {
    let text = text.to_lowercase();
    patterns.iter().any(|pattern| text.contains(pattern))
}

fn status_from_server_code(code: &str) -> Option<u16> {
    if let Some(digits) = code.strip_prefix("http_").or_else(|| code.strip_prefix("HTTP_")) {
        return digits.parse().ok().filter(|_| digits.len() == 3);
    }
    Some(match code {
        "allowance_exhausted" | "insufficient_balance" | "spending_limit_reached" | "payment_required" | "entitlement_required" => 402,
        "request_too_large" => 413,
        "provider_rejected" => 502,
        "timeout" => 408,
        "unauthorized" => 401,
        "forbidden" => 403,
        _ => return None,
    })
}

/// The first three-digit number after `HTTP`, `error`, `status` or `status code`.
fn status_from_text(text: &str) -> Option<u16> {
    let lowered = text.to_lowercase();
    for marker in ["http", "status code", "error code", "status", "error"] {
        let mut from = 0;
        while let Some(at) = lowered[from..].find(marker) {
            let start = from + at + marker.len();
            let rest = lowered[start..].trim_start_matches([':', ' ']);
            let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
            let boundary = rest[digits.len()..].chars().next().is_none_or(|next| !next.is_alphanumeric());
            if digits.len() == 3 && boundary {
                return digits.parse().ok();
            }
            from = start;
        }
    }
    if lowered.contains("payment required") {
        Some(402)
    } else if lowered.contains("unauthorized") {
        Some(401)
    } else if lowered.contains("forbidden") {
        Some(403)
    } else {
        None
    }
}

fn code_from_text(text: &str) -> Option<String> {
    text.split(|char: char| !(char.is_ascii_alphanumeric() || char == '_'))
        .find(|word| SERVER_CODES.contains(word) || (word.starts_with("http_") && word.len() == 8 && word[5..].chars().all(|char| char.is_ascii_digit())))
        .map(str::to_string)
}

/// What a JSON error body such as `{ "error": { "code", "message" } }` says (`readErrorBody`).
#[derive(Default)]
struct ErrorBody {
    code: Option<String>,
    message: Option<String>,
    billing_url: Option<String>,
    wallet_balance_cents: Option<f64>,
}

fn read_error_body(body: &str) -> ErrorBody {
    let Ok(Value::Object(json)) = serde_json::from_str::<Value>(body) else { return ErrorBody::default() };
    let nested = json.get("error").and_then(Value::as_object);
    let text = |value: Option<&Value>| value.and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_string);
    let field = |key: &str| json.get(key).or_else(|| nested.and_then(|nested| nested.get(key)));
    ErrorBody {
        code: text(nested.and_then(|nested| nested.get("code"))).or_else(|| text(json.get("code"))).or_else(|| text(nested.and_then(|nested| nested.get("type")))),
        message: text(nested.and_then(|nested| nested.get("message"))).or_else(|| text(json.get("error"))).or_else(|| text(json.get("message"))),
        billing_url: text(json.get("billingUrl")).or_else(|| text(nested.and_then(|nested| nested.get("billingUrl")))),
        wallet_balance_cents: field("walletBalanceCents").and_then(Value::as_f64).filter(|cents| cents.is_finite()),
    }
}

/// How a failed turn reads. `error` is the agent's or provider's message, optionally followed by
/// `|||` and a raw body; `offline` is whether the computer is known to be offline.
pub fn describe(error: &str, is_acp: bool, offline: bool) -> TurnFailure {
    describe_for(error, is_acp, offline, false)
}

/// `describe` for a turn on the Athas provider when `hosted`: its sign-in and billing wording.
pub fn describe_for(error: &str, is_acp: bool, offline: bool, hosted: bool) -> TurnFailure {
    let mut parts = error.splitn(2, "|||");
    let main = parts.next().unwrap_or_default().trim().to_string();
    let mut details = parts.next().unwrap_or_default().to_string();
    let body = read_error_body(&details);
    let body_message = body.message.clone();
    let server_code = body.code.clone().or_else(|| code_from_text(error));
    let mut status = status_from_text(&main).or_else(|| server_code.as_deref().and_then(status_from_server_code));
    let too_large = server_code.as_deref() == Some("request_too_large") || status == Some(413);
    let (mut title, mut message) = match status {
        Some(429) => ("Rate Limit Exceeded", "The API is temporarily rate-limited. Please wait a moment and try again.".to_string()),
        Some(401) if hosted => ("Authentication Error", "Your Athas session has expired. Sign in to continue.".to_string()),
        Some(401) => ("Authentication Error", "The provider rejected your API key. Check its configuration to continue.".to_string()),
        _ if too_large => ("Conversation too large", "This conversation is too large for one request. Start a new chat, or remove attached files and long pasted text.".to_string()),
        Some(402) => match hosted.then(|| hosted_billing_failure(server_code.as_deref(), body.wallet_balance_cents)).flatten() {
            Some((title, message)) => (title, message),
            None => ("Payment required", "Check your balance and spending limits to continue, or choose another model.".to_string()),
        },
        Some(403) => ("Access Denied", "You don't have permission to access this resource.".to_string()),
        Some(408) => ("Request Timed Out", "The provider took too long to answer. Try again.".to_string()),
        _ if server_code.as_deref() == Some("timeout") => ("Request Timed Out", "The provider took too long to answer. Try again.".to_string()),
        Some(500) => ("Server Error", "The API server encountered an error. Please try again later.".to_string()),
        Some(400) => ("Bad Request", main.clone()),
        Some(_) => ("API Error", main.clone()),
        None => ("Error", main.clone()),
    };
    let explained_billing = hosted && status == Some(402) && hosted_billing_failure(server_code.as_deref(), body.wallet_balance_cents).is_some();
    if let Some(body_message) = body_message.filter(|_| status != Some(401) && !too_large && !explained_billing) {
        message = body_message;
    }
    let mut code = status.map(|status| status.to_string());
    let mut retry_code = server_code.clone();
    if offline || (status.is_none() && contains_any(&main, NETWORK_PATTERNS)) {
        title = if offline { "Offline" } else { "Connection Failed" };
        code = Some(if offline { "OFFLINE" } else { "NETWORK" }.to_string());
        retry_code = Some(if offline { "offline" } else { "network" }.to_string());
        status = None;
        message = if offline {
            "You're offline. Reconnect and try again; queued messages wait until then.".into()
        } else {
            "Could not reach the provider. Check your connection and try again.".into()
        };
    }
    let combined = format!("{main} {details}");
    let config = is_acp && contains_any(&combined, CONFIGURATION_PATTERNS);
    let auth = !config && is_acp && contains_any(&combined, AUTHENTICATION_PATTERNS);
    if config {
        title = "Agent Configuration Required";
        code = None;
        message = "The selected agent is authenticated, but its account configuration is incomplete.".into();
    } else if auth {
        title = "Authentication Required";
        code = None;
        message = "The selected agent needs external authentication before it can accept prompts.".into();
        if combined.contains("Method not implemented") {
            details = "This ACP adapter does not implement the protocol authenticate flow. Complete login in the underlying CLI/adapter, then try again.".into();
        } else if details.is_empty() {
            details = "Complete authentication in the underlying CLI/adapter, then try again.".into();
        }
    }
    let retryable = status.is_some_and(|status| RETRYABLE_STATUSES.contains(&status)) || retry_code.as_deref().is_some_and(|code| RETRYABLE_CODES.contains(&code));
    let mut actions = Vec::new();
    if retryable {
        actions.push(Action::Retry);
    }
    let mut setup_hint = None;
    if config || auth {
        actions.extend([Action::RestartAgent, Action::OpenAgentTerminal]);
        setup_hint = Some(if config { "Finish the agent setup, then restart the session." } else { "Complete login in the agent CLI, then restart the session." });
    }
    let details = if details.is_empty() { main.clone() } else { details };
    let details = if details == message || details == title { String::new() } else { format_details(&details) };
    let billing_url = body.billing_url.filter(|_| status == Some(402));
    TurnFailure { title: title.to_string(), message, details, code, actions, setup_hint, server_code, billing_url, provider_settings: !(config || auth) }
}

/// JSON details pretty-printed, anything else as it came.
fn format_details(details: &str) -> String {
    serde_json::from_str::<Value>(details).ok().and_then(|value| serde_json::to_string_pretty(&value).ok()).unwrap_or_else(|| details.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_statuses_into_a_headline_and_next_step() {
        let failure = describe("HTTP 429 Too Many Requests", false, false);
        assert_eq!((failure.title.as_str(), failure.code.as_deref()), ("Rate Limit Exceeded", Some("429")));
        assert_eq!(failure.actions, vec![Action::Retry]);
        assert_eq!(failure.details, "HTTP 429 Too Many Requests");
        let failure = describe("Request failed|||{\"error\":{\"code\":\"request_too_large\",\"message\":\"too big\"}}", false, false);
        assert_eq!(failure.title, "Conversation too large");
        assert!(failure.details.contains("\"request_too_large\""));
        let failure = describe("status: 500|||{\"error\":{\"message\":\"Upstream exploded\"}}", false, false);
        assert_eq!((failure.title.as_str(), failure.message.as_str()), ("Server Error", "Upstream exploded"));
    }

    #[test]
    fn hosted_billing_reads_its_reason_and_page() {
        let body = r#"{"error":{"code":"allowance_exhausted","message":"x","billingUrl":"/dashboard/billing?x=1"},"walletBalanceCents":250}"#;
        let failure = describe_for(&format!("Athas API error: 402|||{body}"), false, false, true);
        assert_eq!(failure.title, "Included credit used up");
        assert!(failure.message.contains("$2.50"));
        assert_eq!(failure.billing_url.as_deref(), Some("/dashboard/billing?x=1"));
        assert_eq!(failure.recovery(true, true), (Recovery::OpenBilling(Some("/dashboard/billing?x=1".into())), "Add credit", true));
        assert_eq!(failure.recovery(false, true).1, "Configure provider");
        let expired = describe_for("HTTP 401", false, false, true);
        assert_eq!(expired.message, "Your Athas session has expired. Sign in to continue.");
        assert_eq!(expired.recovery(true, false).1, "Sign in to Athas");
        assert_eq!(describe("HTTP 503", false, false).recovery(false, true), (Recovery::Retry, "Try again", true));
        assert_eq!(describe("HTTP 418", false, false).recovery(false, false), (Recovery::ConfigureModels, "Configure models", false));
        assert_eq!(resolve_billing_url(Some("/dashboard/billing"), "https://athas.dev", "https://athas.dev", "default"), "https://athas.dev/dashboard/billing");
        assert_eq!(resolve_billing_url(Some("https://evil.example/pay"), "https://athas.dev", "https://athas.dev", "default"), "default");
        assert_eq!(resolve_billing_url(None, "https://athas.dev", "https://athas.dev", "default"), "default");
    }

    #[test]
    fn tells_offline_from_unreachable() {
        let failure = describe("error sending request for url (https://api.example.com)", false, false);
        assert_eq!((failure.title.as_str(), failure.code.as_deref()), ("Connection Failed", Some("NETWORK")));
        assert_eq!(failure.actions, vec![Action::Retry]);
        let failure = describe("anything", false, true);
        assert_eq!(failure.title, "Offline");
    }

    #[test]
    fn agent_setup_errors_offer_restart_and_terminal() {
        let failure = describe("Authentication required: Method not implemented", true, false);
        assert_eq!(failure.title, "Authentication Required");
        assert_eq!(failure.actions, vec![Action::RestartAgent, Action::OpenAgentTerminal]);
        assert!(failure.details.starts_with("This ACP adapter"));
        let failure = describe("This model requires setting the GOOGLE_CLOUD_PROJECT env var", true, false);
        assert_eq!(failure.setup_hint, Some("Finish the agent setup, then restart the session."));
        let plain = describe("The agent stopped unexpectedly", true, false);
        assert_eq!((plain.title.as_str(), plain.message.as_str(), plain.details.as_str()), ("Error", "The agent stopped unexpectedly", ""));
    }
}
