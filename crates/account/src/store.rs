//! The account for the life of the app: a GPUI entity that runs the state machine's I/O on the
//! background executor. Views read it through `AccountStore::global` and `cx.observe` it.

use std::{sync::Arc, time::Duration};

use gpui::{App, AppContext, AsyncApp, Context, Entity, EventEmitter, Global, Task, WeakEntity};

use crate::{
    api::{ApiError, AuthUser, Client, SubscriptionInfo},
    gates::{self, ProFeatures},
    service_urls::ServiceUrls,
    sign_in::{SIGN_IN_TIMEOUT, wait_for_token},
    state::{AccountState, Effect, SessionCheck},
    token_store::TokenStore,
};

const SUBSCRIPTION_REFRESH_DEBOUNCE: Duration = Duration::from_millis(1500);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AccountEvent {
    SignedIn,
    SignedOut,
}

pub struct AccountStore {
    state: AccountState,
    client: Client,
    tokens: Arc<dyn TokenStore>,
    token: Option<String>,
    sign_in_task: Option<Task<()>>,
    retry_task: Option<Task<()>>,
    refresh_task: Option<Task<()>>,
}

impl EventEmitter<AccountEvent> for AccountStore {}

struct GlobalAccountStore(Entity<AccountStore>);

impl Global for GlobalAccountStore {}

impl AccountStore {
    /// Creates the account, makes it the app's, and checks the saved session.
    pub fn init(cx: &mut App, urls: ServiceUrls, tokens: Arc<dyn TokenStore>) -> Entity<Self> {
        let store = cx.new(|cx| {
            let mut store = Self::new(urls, tokens);
            store.initialize(cx);
            store
        });
        cx.set_global(GlobalAccountStore(store.clone()));
        store
    }

    fn new(urls: ServiceUrls, tokens: Arc<dyn TokenStore>) -> Self {
        Self {
            state: AccountState::default(),
            client: Client::new(urls),
            tokens,
            token: None,
            sign_in_task: None,
            retry_task: None,
            refresh_task: None,
        }
    }

    pub fn global(cx: &App) -> Option<Entity<Self>> {
        cx.try_global::<GlobalAccountStore>().map(|global| global.0.clone())
    }

    pub fn state(&self) -> &AccountState {
        &self.state
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    pub fn urls(&self) -> &ServiceUrls {
        self.client.urls()
    }

    /// The account token, for other clients of the account service (sharing, the team).
    pub fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    pub fn user(&self) -> Option<&AuthUser> {
        self.state.user()
    }

    pub fn subscription(&self) -> Option<&SubscriptionInfo> {
        self.state.subscription()
    }

    pub fn is_signed_in(&self) -> bool {
        self.state.is_signed_in()
    }

    pub fn features(&self) -> ProFeatures {
        ProFeatures::resolve(self.user(), self.subscription())
    }

    pub fn plan_label(&self) -> &'static str {
        gates::plan_label(self.subscription(), self.is_signed_in())
    }

    /// The account's name and second line (email or GitHub login).
    pub fn identity(&self) -> (String, Option<String>) {
        gates::identity(self.user())
    }

    /// The picture for the avatar, when the account has one.
    pub fn avatar_url(&self) -> Option<String> {
        gates::avatar_url(self.user())
    }

    fn host(&self) -> String {
        self.client.urls().api_host()
    }

    /// Checks the saved token: signs in with it, signs out when the server rejects it, or keeps it
    /// unverified and checks again later when the server does not answer.
    pub fn initialize(&mut self, cx: &mut Context<Self>) {
        self.retry_task = None;
        let revision = self.state.begin_check();
        cx.notify();
        let tokens = self.tokens.clone();
        let client = self.client.clone();
        let check = cx.background_spawn(async move {
            let token = tokens.get().map_err(ApiError::Malformed)?;
            let Some(token) = token else { return Ok(None) };
            let user = client.fetch_me(&token)?;
            let subscription = client.fetch_subscription(&token);
            Ok(Some((token, user, subscription)))
        });
        cx.spawn(async move |this, cx| {
            let result = check.await;
            this.update(cx, |this, cx| {
                let host = this.host();
                let was_signed_in = this.is_signed_in();
                let effect = match result {
                    Ok(None) => {
                        this.state.no_token(revision);
                        Effect::None
                    }
                    Ok(Some((token, user, subscription))) => {
                        if revision == this.state.revision() {
                            this.token = Some(token);
                        }
                        this.state.loaded(revision, user, subscription, &host)
                    }
                    Err(error) => this.state.failed(revision, &error, &host),
                };
                this.apply(effect, cx);
                this.emit_session_change(was_signed_in, cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Checks an unverified session again, right now.
    pub fn retry_session_check(&mut self, cx: &mut Context<Self>) {
        if self.state.session_check().is_some() {
            self.initialize(cx);
        }
    }

    pub fn session_check(&self) -> Option<&SessionCheck> {
        self.state.session_check()
    }

    fn apply(&mut self, effect: Effect, cx: &mut Context<Self>) {
        match effect {
            Effect::None => {}
            Effect::RemoveToken => {
                self.token = None;
                let tokens = self.tokens.clone();
                cx.background_spawn(async move {
                    if let Err(error) = tokens.delete() {
                        eprintln!("account: could not remove the rejected token: {error}");
                    }
                })
                .detach();
            }
            Effect::RetryAfter(delay) => {
                self.retry_task = Some(cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(delay).await;
                    this.update(cx, |this, cx| this.initialize(cx)).ok();
                }));
            }
        }
    }

    fn emit_session_change(&self, was_signed_in: bool, cx: &mut Context<Self>) {
        match (was_signed_in, self.is_signed_in()) {
            (false, true) => cx.emit(AccountEvent::SignedIn),
            (true, false) => cx.emit(AccountEvent::SignedOut),
            _ => {}
        }
    }

    /// Opens the browser on a new sign-in session and waits for it to hand over a token. While a
    /// sign-in runs, this opens its page again instead.
    pub fn sign_in(&mut self, cx: &mut Context<Self>) {
        if !self.state.start_sign_in() {
            self.reopen_sign_in(cx);
            return;
        }
        cx.notify();
        let client = self.client.clone();
        self.sign_in_task = Some(cx.spawn(async move |this, cx| {
            let result = desktop_sign_in(&this, client, cx).await;
            this.update(cx, |this, cx| {
                this.sign_in_task = None;
                match result {
                    Ok(()) => this.state.sign_in_finished(),
                    Err(error) => {
                        let message = error.to_string();
                        this.state.sign_in_failed(message.clone());
                        notifications::error(cx, message, None);
                    }
                }
                cx.notify();
            })
            .ok();
        }));
    }

    pub fn cancel_sign_in(&mut self, cx: &mut Context<Self>) {
        self.sign_in_task = None;
        self.state.cancel_sign_in();
        cx.notify();
    }

    pub fn reopen_sign_in(&self, cx: &mut Context<Self>) {
        if let Some(url) = self.state.login_url() {
            cx.open_url(url);
        }
    }

    /// Saves a token from the browser and signs in with it.
    fn complete_sign_in(&mut self, token: String, cx: &mut Context<Self>) -> Task<Result<(), ApiError>> {
        self.retry_task = None;
        let revision = self.state.begin_check();
        let tokens = self.tokens.clone();
        let client = self.client.clone();
        let check = cx.background_spawn(async move {
            tokens.set(&token).map_err(ApiError::Malformed)?;
            let user = client.fetch_me(&token)?;
            let subscription = client.fetch_subscription(&token);
            Ok((token, user, subscription))
        });
        cx.spawn(async move |this, cx| {
            let result = check.await;
            this.update(cx, |this, cx| {
                let was_signed_in = this.is_signed_in();
                let host = this.host();
                let outcome = match result {
                    Ok((token, user, subscription)) => {
                        if revision == this.state.revision() {
                            this.token = Some(token);
                        } else if !this.is_signed_in() {
                            // Signed out (or cancelled) while this sign-in saved its token: the
                            // save may have landed after sign-out's delete, which would sign the
                            // next launch in again.
                            let tokens = this.tokens.clone();
                            cx.background_spawn(async move { tokens.delete().ok() }).detach();
                        }
                        let effect = this.state.loaded(revision, user, subscription, &host);
                        this.apply(effect, cx);
                        Ok(())
                    }
                    Err(error) => {
                        let effect = this.state.callback_failed(revision, &error);
                        this.apply(effect, cx);
                        Err(error)
                    }
                };
                this.emit_session_change(was_signed_in, cx);
                cx.notify();
                outcome
            })
            .unwrap_or(Ok(()))
        })
    }

    /// Signs out here and on the server, and forgets the token.
    pub fn sign_out(&mut self, cx: &mut Context<Self>) {
        let was_signed_in = self.is_signed_in();
        self.sign_in_task = None;
        self.retry_task = None;
        self.refresh_task = None;
        self.state.signed_out();
        let token = self.token.take();
        let client = self.client.clone();
        let tokens = self.tokens.clone();
        let revision = self.state.revision();
        // The token is forgotten here now, but revoked on the server a few seconds later: team
        // presence says "offline" with it first (it notices the sign-out within its 1.5 s tick),
        // which a revoked token could not, leaving the user shown online to the team.
        let executor = cx.background_executor().clone();
        let remove = cx.background_spawn(async move {
            let deleted = tokens.delete();
            if let Some(token) = token {
                executor.timer(std::time::Duration::from_secs(4)).await;
                client.logout(&token);
            }
            deleted
        });
        cx.spawn(async move |this, cx| {
            if let Err(error) = remove.await {
                this.update(cx, |this, cx| {
                    if this.state.revision() == revision {
                        this.state.error = Some(error);
                        cx.notify();
                    }
                })
                .ok();
            }
        })
        .detach();
        self.emit_session_change(was_signed_in, cx);
        cx.notify();
    }

    /// Shows a team snapshot the account service answered with (`setCollaborationSnapshot`).
    pub fn set_collaboration_snapshot(&mut self, collaboration: crate::api::Collaboration, cx: &mut Context<Self>) {
        if self.state.set_collaboration(collaboration) {
            cx.notify();
        }
    }

    /// Fetches the plan, credits and team again; resolves to whether it loaded.
    pub fn refresh_subscription(&mut self, cx: &mut Context<Self>) -> Task<bool> {
        let Some(token) = self.token.clone().filter(|_| self.is_signed_in()) else { return Task::ready(false) };
        let revision = self.state.revision();
        let client = self.client.clone();
        let fetch = cx.background_spawn(async move { client.fetch_subscription(&token) });
        cx.spawn(async move |this, cx| {
            let result = fetch.await;
            let loaded = result.is_ok();
            this.update(cx, |this, cx| {
                let was_signed_in = this.is_signed_in();
                let effect = this.state.subscription_refreshed(revision, result);
                this.apply(effect, cx);
                this.emit_session_change(was_signed_in, cx);
                cx.notify();
            })
            .ok();
            loaded
        })
    }

    /// Refreshes the plan after a short quiet period, so several changes in a row cost one
    /// request. Does nothing while signed out.
    pub fn schedule_subscription_refresh(&mut self, cx: &mut Context<Self>) {
        self.refresh_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(SUBSCRIPTION_REFRESH_DEBOUNCE).await;
            if let Ok(task) = this.update(cx, |this, cx| this.refresh_subscription(cx)) {
                task.await;
            }
        }));
    }
}

/// The desktop sign-in: start a session, open its page, poll for the token, sign in with it.
async fn desktop_sign_in(this: &WeakEntity<AccountStore>, client: Client, cx: &mut AsyncApp) -> Result<(), ApiError> {
    let begin = client.clone();
    let session = cx.background_spawn(async move { begin.begin_desktop_session() }).await?;
    this.update(cx, |this, cx| {
        this.state.sign_in_waiting(session.login_url.clone());
        cx.open_url(&session.login_url);
        cx.notify();
    })
    .map_err(|_| ApiError::Malformed("The account closed.".into()))?;
    let executor = cx.background_executor().clone();
    let token = wait_for_token(
        SIGN_IN_TIMEOUT,
        || {
            let client = client.clone();
            let session = session.clone();
            executor.spawn(async move { client.poll_desktop_session(&session) })
        },
        |duration| executor.timer(duration),
    )
    .await?;
    let complete = this
        .update(cx, |this, cx| this.complete_sign_in(token, cx))
        .map_err(|_| ApiError::Malformed("The account closed.".into()))?;
    complete.await
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use gpui::TestAppContext;
    use serde_json::json;
    use telemetry::mock_server::{MockServer, Response};

    use super::*;
    use crate::{state::Session, token_store::MemoryTokenStore};

    fn account_server(sign_in_polls_before_ready: usize) -> MockServer {
        let polls = Mutex::new(0);
        MockServer::start(move |request| match (request.method.as_str(), request.path.split('?').next().unwrap_or_default()) {
            ("POST", "/api/auth/desktop/session/init") => {
                Response::json(200, json!({ "sessionId": "s1", "pollSecret": "p1", "loginUrl": "http://login.test/s1" }))
            }
            ("GET", "/api/auth/desktop/session") => {
                let mut polls = polls.lock().unwrap();
                *polls += 1;
                if *polls > sign_in_polls_before_ready {
                    Response::json(200, json!({ "status": "ready", "token": "fresh" }))
                } else {
                    Response::json(200, json!({ "status": "pending" }))
                }
            }
            (_, "/api/auth/me") => match request.header("authorization") {
                Some("Bearer fresh") | Some("Bearer saved") => {
                    Response::json(200, json!({ "user": { "id": 3, "email": "sam@example.com", "name": "Sam" } }))
                }
                _ => Response::json(401, json!({ "error": "Unauthorized" })),
            },
            (_, "/api/auth/subscription") => Response::json(200, json!({ "status": "pro", "subscription": { "plan": "pro" } })),
            ("DELETE", "/api/auth/logout") => Response::json(200, json!({ "ok": true })),
            _ => Response::json(404, json!({})),
        })
    }

    fn init(cx: &mut TestAppContext, server: &MockServer, tokens: Arc<dyn TokenStore>) -> Entity<AccountStore> {
        cx.update(|cx| AccountStore::init(cx, ServiceUrls::local(server.url()), tokens))
    }

    #[gpui::test]
    fn signs_in_with_the_saved_token(cx: &mut TestAppContext) {
        let server = account_server(0);
        let store = init(cx, &server, Arc::new(MemoryTokenStore::with_token("saved")));
        cx.run_until_parked();
        store.read_with(cx, |store, _| {
            assert!(store.is_signed_in());
            assert_eq!(store.token(), Some("saved"));
            assert_eq!(store.plan_label(), "Pro");
            assert_eq!(store.identity().0, "Sam");
        });
    }

    #[gpui::test]
    fn a_rejected_token_is_forgotten(cx: &mut TestAppContext) {
        let server = account_server(0);
        let tokens = Arc::new(MemoryTokenStore::with_token("stale"));
        let store = init(cx, &server, tokens.clone());
        cx.run_until_parked();
        store.read_with(cx, |store, _| assert_eq!(store.state().session, Session::SignedOut));
        assert_eq!(tokens.get().unwrap(), None);
    }

    #[gpui::test]
    fn no_token_means_signed_out(cx: &mut TestAppContext) {
        let server = account_server(0);
        let store = init(cx, &server, Arc::new(MemoryTokenStore::default()));
        cx.run_until_parked();
        store.read_with(cx, |store, _| assert_eq!(store.state().session, Session::SignedOut));
        assert!(server.requests().is_empty());
    }

    #[gpui::test]
    fn desktop_sign_in_then_sign_out(cx: &mut TestAppContext) {
        let server = account_server(1);
        let tokens = Arc::new(MemoryTokenStore::default());
        let store = init(cx, &server, tokens.clone());
        cx.run_until_parked();
        store.update(cx, |store, cx| store.sign_in(cx));
        cx.run_until_parked();
        store.read_with(cx, |store, _| assert_eq!(store.state().login_url(), Some("http://login.test/s1")));
        assert_eq!(cx.opened_url().as_deref(), Some("http://login.test/s1"));

        cx.executor().advance_clock(Duration::from_secs(2));
        cx.run_until_parked();
        store.read_with(cx, |store, _| {
            assert!(store.is_signed_in());
            assert_eq!(store.token(), Some("fresh"));
            assert_eq!(store.state().login_url(), None);
        });
        assert_eq!(tokens.get().unwrap().as_deref(), Some("fresh"));

        store.update(cx, |store, cx| store.sign_out(cx));
        cx.run_until_parked();
        store.read_with(cx, |store, _| assert_eq!(store.state().session, Session::SignedOut));
        assert_eq!(tokens.get().unwrap(), None);
        // Revoked a few seconds later, once presence has said offline with it.
        cx.executor().advance_clock(Duration::from_secs(5));
        cx.run_until_parked();
        assert!(server.requests().iter().any(|request| request.path == "/api/auth/logout" && request.header("authorization") == Some("Bearer fresh")));
    }

    #[gpui::test]
    fn cancelling_stops_the_poll(cx: &mut TestAppContext) {
        let server = account_server(usize::MAX);
        let store = init(cx, &server, Arc::new(MemoryTokenStore::default()));
        cx.run_until_parked();
        store.update(cx, |store, cx| store.sign_in(cx));
        cx.run_until_parked();
        store.update(cx, |store, cx| store.cancel_sign_in(cx));
        let polls = server.requests().len();
        cx.executor().advance_clock(Duration::from_secs(30));
        cx.run_until_parked();
        assert_eq!(server.requests().len(), polls);
        store.read_with(cx, |store, _| assert!(!store.is_signed_in()));
    }

    #[gpui::test]
    fn an_unreachable_server_retries_later(cx: &mut TestAppContext) {
        let store = cx.update(|cx| AccountStore::init(cx, ServiceUrls::local("http://127.0.0.1:1"), Arc::new(MemoryTokenStore::with_token("saved"))));
        cx.run_until_parked();
        store.read_with(cx, |store, _| {
            let check = store.session_check().expect("unverified");
            assert_eq!(check.attempt, 1);
            assert_eq!(check.retry_in, Duration::from_secs(2));
        });
        cx.executor().advance_clock(Duration::from_secs(2));
        cx.run_until_parked();
        store.read_with(cx, |store, _| assert_eq!(store.session_check().map(|check| check.attempt), Some(2)));
    }
}
