//! The account's state machine (`auth.store.ts`, `desktop-sign-in.store.ts`) without any I/O:
//! each transition says what the store must do next. A revision number guards every answer, so
//! one that arrives after a sign-out or a newer check is ignored.

use std::time::Duration;

use crate::api::{ApiError, AuthUser, CheckFailure, Collaboration, SubscriptionInfo};

const RECONNECT_BACKOFF_SECS: [u64; 7] = [2, 5, 15, 30, 60, 120, 300];

/// How long to wait before checking an unverified session again after `attempt` failures.
pub fn reconnect_delay(attempt: u32) -> Duration {
    Duration::from_secs(RECONNECT_BACKOFF_SECS[(attempt as usize).min(RECONNECT_BACKOFF_SECS.len() - 1)])
}

/// A saved session the server did not answer for. It is kept and checked again with backoff;
/// it is not a sign-out.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionCheck {
    pub reason: CheckFailure,
    /// One line naming the host and what happened.
    pub message: String,
    /// How many checks in a row have failed.
    pub attempt: u32,
    pub retry_in: Duration,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Session {
    Loading,
    SignedOut,
    SignedIn {
        user: AuthUser,
        /// `None` while the plan could not be loaded; `error` says why.
        subscription: Option<SubscriptionInfo>,
    },
    Unverified(SessionCheck),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub enum SignInFlow {
    #[default]
    Idle,
    /// Asking the server for a sign-in session.
    Starting,
    /// The browser is open on `login_url`; polling for the token.
    Waiting { login_url: String },
}

/// What the store does after a transition.
#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    None,
    /// The token is no longer accepted: forget it.
    RemoveToken,
    /// Check the saved session again after this long.
    RetryAfter(Duration),
}

#[derive(Clone, Debug, PartialEq)]
pub struct AccountState {
    pub session: Session,
    /// A problem that does not change the session, such as a plan that failed to load.
    pub error: Option<String>,
    pub sign_in: SignInFlow,
    pub sign_in_error: Option<String>,
    revision: u64,
    reconnect_attempt: u32,
}

impl Default for AccountState {
    fn default() -> Self {
        Self { session: Session::Loading, error: None, sign_in: SignInFlow::Idle, sign_in_error: None, revision: 0, reconnect_attempt: 0 }
    }
}

impl AccountState {
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn user(&self) -> Option<&AuthUser> {
        match &self.session {
            Session::SignedIn { user, .. } => Some(user),
            _ => None,
        }
    }

    pub fn subscription(&self) -> Option<&SubscriptionInfo> {
        match &self.session {
            Session::SignedIn { subscription, .. } => subscription.as_ref(),
            _ => None,
        }
    }

    /// Replaces the team snapshot with a fresher one, such as a presence heartbeat's answer;
    /// returns whether there was a plan to put it in.
    pub fn set_collaboration(&mut self, collaboration: Collaboration) -> bool {
        match &mut self.session {
            Session::SignedIn { subscription: Some(subscription), .. } => {
                subscription.collaboration = Some(collaboration);
                true
            }
            _ => false,
        }
    }

    pub fn is_signed_in(&self) -> bool {
        matches!(self.session, Session::SignedIn { .. })
    }

    pub fn is_loading(&self) -> bool {
        self.session == Session::Loading
    }

    pub fn session_check(&self) -> Option<&SessionCheck> {
        match &self.session {
            Session::Unverified(check) => Some(check),
            _ => None,
        }
    }

    /// Starts checking the saved session (on launch, on retry, or with a new token); returns the
    /// revision its answer must carry.
    pub fn begin_check(&mut self) -> u64 {
        self.revision += 1;
        if !self.is_signed_in() {
            self.session = Session::Loading;
        }
        self.error = None;
        self.revision
    }

    /// No token is saved.
    pub fn no_token(&mut self, revision: u64) {
        if revision != self.revision {
            return;
        }
        self.reconnect_attempt = 0;
        self.session = Session::SignedOut;
    }

    /// The user loaded; the plan may not have. An invalid-session answer for the plan signs out.
    pub fn loaded(&mut self, revision: u64, user: AuthUser, subscription: Result<SubscriptionInfo, ApiError>, host: &str) -> Effect {
        if revision != self.revision {
            return Effect::None;
        }
        let (subscription, error) = match subscription {
            Ok(subscription) => (Some(subscription), None),
            Err(error) if error.is_auth_invalid() => return self.failed(revision, &error, host),
            Err(error) => (None, Some(error.to_string())),
        };
        self.reconnect_attempt = 0;
        self.session = Session::SignedIn { user, subscription };
        self.error = error;
        Effect::None
    }

    /// Checking the session failed. An invalid session signs out; any other failure keeps the
    /// session unverified and checks again later.
    pub fn failed(&mut self, revision: u64, error: &ApiError, host: &str) -> Effect {
        if revision != self.revision {
            return Effect::None;
        }
        if error.is_auth_invalid() {
            self.reconnect_attempt = 0;
            self.session = Session::SignedOut;
            self.error = None;
            return Effect::RemoveToken;
        }
        let attempt = self.reconnect_attempt;
        self.reconnect_attempt += 1;
        let (reason, message) = error.check_failure(host);
        let retry_in = reconnect_delay(attempt);
        self.session = Session::Unverified(SessionCheck { reason, message, attempt: attempt + 1, retry_in });
        self.error = None;
        Effect::RetryAfter(retry_in)
    }

    /// A token from the browser was not accepted.
    pub fn callback_failed(&mut self, revision: u64, error: &ApiError) -> Effect {
        if revision != self.revision {
            return Effect::None;
        }
        self.error = Some("Authentication failed. Please try again.".into());
        if error.is_auth_invalid() {
            self.session = Session::SignedOut;
            return Effect::RemoveToken;
        }
        if self.session == Session::Loading {
            self.session = Session::SignedOut;
        }
        Effect::None
    }

    /// Signs out locally; answers to earlier requests are ignored from here on.
    pub fn signed_out(&mut self) {
        self.revision += 1;
        self.reconnect_attempt = 0;
        self.session = Session::SignedOut;
        self.error = None;
        self.sign_in = SignInFlow::Idle;
    }

    /// The plan, refreshed. An invalid session signs out.
    pub fn subscription_refreshed(&mut self, revision: u64, result: Result<SubscriptionInfo, ApiError>) -> Effect {
        if revision != self.revision {
            return Effect::None;
        }
        match result {
            Ok(fresh) => {
                if let Session::SignedIn { subscription, .. } = &mut self.session {
                    *subscription = Some(fresh);
                }
                self.error = None;
                Effect::None
            }
            Err(error) if error.is_auth_invalid() => {
                self.signed_out();
                self.error = Some("Your session is no longer valid on this server. Sign in again.".into());
                Effect::RemoveToken
            }
            Err(error) => {
                self.error = Some(error.to_string());
                Effect::None
            }
        }
    }

    /// Starts a desktop sign-in; `false` while one is already running.
    pub fn start_sign_in(&mut self) -> bool {
        if self.sign_in != SignInFlow::Idle {
            return false;
        }
        self.sign_in = SignInFlow::Starting;
        self.sign_in_error = None;
        true
    }

    pub fn sign_in_waiting(&mut self, login_url: String) {
        if self.sign_in == SignInFlow::Starting {
            self.sign_in = SignInFlow::Waiting { login_url };
        }
    }

    pub fn sign_in_failed(&mut self, message: String) {
        self.sign_in = SignInFlow::Idle;
        self.sign_in_error = Some(message);
    }

    pub fn sign_in_finished(&mut self) {
        self.sign_in = SignInFlow::Idle;
    }

    pub fn cancel_sign_in(&mut self) {
        self.sign_in = SignInFlow::Idle;
        self.sign_in_error = None;
    }

    pub fn login_url(&self) -> Option<&str> {
        match &self.sign_in {
            SignInFlow::Waiting { login_url } => Some(login_url),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const HOST: &str = "athas.dev";

    fn user() -> AuthUser {
        AuthUser { id: 1, email: "sam@example.com".into(), ..Default::default() }
    }

    fn plan() -> SubscriptionInfo {
        SubscriptionInfo::parse(&json!({ "status": "pro" })).unwrap()
    }

    fn http(status: u16) -> ApiError {
        ApiError::Http { status, code: None, message: format!("HTTP {status}") }
    }

    fn unreachable() -> ApiError {
        ApiError::Unreachable { host: HOST.into(), local: false, detail: String::new() }
    }

    #[test]
    fn signs_in_with_a_saved_token() {
        let mut state = AccountState::default();
        assert!(state.is_loading());
        let revision = state.begin_check();
        assert_eq!(state.loaded(revision, user(), Ok(plan()), HOST), Effect::None);
        assert!(state.is_signed_in());
        assert!(state.subscription().is_some());
    }

    #[test]
    fn a_plan_that_fails_to_load_keeps_the_session() {
        let mut state = AccountState::default();
        let revision = state.begin_check();
        state.loaded(revision, user(), Err(http(500)), HOST);
        assert!(state.is_signed_in() && state.subscription().is_none());
        assert_eq!(state.error.as_deref(), Some("HTTP 500"));
        let revision = state.begin_check();
        assert_eq!(state.loaded(revision, user(), Err(http(401)), HOST), Effect::RemoveToken);
        assert_eq!(state.session, Session::SignedOut);
    }

    #[test]
    fn an_unreachable_server_keeps_the_session_and_backs_off() {
        let mut state = AccountState::default();
        let mut delays = Vec::new();
        for _ in 0..9 {
            let revision = state.begin_check();
            match state.failed(revision, &unreachable(), HOST) {
                Effect::RetryAfter(delay) => delays.push(delay.as_secs()),
                effect => panic!("unexpected {effect:?}"),
            }
        }
        assert_eq!(delays, vec![2, 5, 15, 30, 60, 120, 300, 300, 300]);
        let check = state.session_check().unwrap();
        assert_eq!((check.attempt, check.reason), (9, CheckFailure::Unreachable));
        assert_eq!(check.message, "Could not reach athas.dev.");

        let revision = state.begin_check();
        state.loaded(revision, user(), Ok(plan()), HOST);
        let revision = state.begin_check();
        assert_eq!(state.failed(revision, &unreachable(), HOST), Effect::RetryAfter(Duration::from_secs(2)));
    }

    #[test]
    fn an_invalid_session_signs_out() {
        let mut state = AccountState::default();
        let revision = state.begin_check();
        assert_eq!(state.failed(revision, &http(401), HOST), Effect::RemoveToken);
        assert_eq!(state.session, Session::SignedOut);
        assert_eq!(state.failed(revision + 1, &http(401), HOST), Effect::None);
    }

    #[test]
    fn answers_after_a_sign_out_are_ignored() {
        let mut state = AccountState::default();
        let revision = state.begin_check();
        state.signed_out();
        assert_eq!(state.loaded(revision, user(), Ok(plan()), HOST), Effect::None);
        assert_eq!(state.session, Session::SignedOut);
        state.no_token(revision);
        assert_eq!(state.subscription_refreshed(revision, Ok(plan())), Effect::None);
    }

    #[test]
    fn refreshing_the_plan() {
        let mut state = AccountState::default();
        let revision = state.begin_check();
        state.loaded(revision, user(), Err(http(502)), HOST);
        assert_eq!(state.subscription_refreshed(revision, Ok(plan())), Effect::None);
        assert!(state.subscription().is_some() && state.error.is_none());
        assert_eq!(state.subscription_refreshed(revision, Err(unreachable())), Effect::None);
        assert!(state.is_signed_in() && state.error.is_some());
        assert_eq!(state.subscription_refreshed(revision, Err(http(401))), Effect::RemoveToken);
        assert_eq!(state.session, Session::SignedOut);
        assert_eq!(state.error.as_deref(), Some("Your session is no longer valid on this server. Sign in again."));
    }

    #[test]
    fn the_sign_in_flow() {
        let mut state = AccountState::default();
        assert!(state.start_sign_in());
        assert!(!state.start_sign_in());
        state.sign_in_waiting("https://athas.dev/login".into());
        assert_eq!(state.login_url(), Some("https://athas.dev/login"));
        state.sign_in_failed("expired".into());
        assert_eq!((state.sign_in.clone(), state.sign_in_error.as_deref()), (SignInFlow::Idle, Some("expired")));
        assert!(state.start_sign_in());
        assert_eq!(state.sign_in_error, None);
        state.cancel_sign_in();
        state.sign_in_waiting("late".into());
        assert_eq!(state.sign_in, SignInFlow::Idle);
    }

    #[test]
    fn a_rejected_callback_token() {
        let mut state = AccountState::default();
        let revision = state.begin_check();
        assert_eq!(state.callback_failed(revision, &http(401)), Effect::RemoveToken);
        assert_eq!(state.session, Session::SignedOut);
        let revision = state.begin_check();
        assert_eq!(state.callback_failed(revision, &unreachable()), Effect::None);
        assert_eq!(state.error.as_deref(), Some("Authentication failed. Please try again."));
    }
}
