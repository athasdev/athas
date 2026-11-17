//! What GitHub returned, kept for the life of the app so lists and pages reopen at once and then
//! refresh in the background; and the token, found once and shared by every view.

use std::{any::Any, collections::HashMap, sync::Arc};

use gpui::{App, AppContext, AsyncApp, Context, Global, Task};

use crate::gh::{IssueMilestone, IssueType, Label};

use crate::{
    auth::{self, Auth},
    mutation::{Mutation, Outcome},
};

#[derive(Default)]
pub struct Store {
    auth: Option<Auth>,
    entries: HashMap<String, Arc<dyn Any + Send + Sync>>,
}

impl Global for Store {}

pub fn get<T: Send + Sync + 'static>(key: &str, cx: &App) -> Option<Arc<T>> {
    cx.try_global::<Store>()?.entries.get(key)?.clone().downcast::<T>().ok()
}

pub fn put<T: Send + Sync + 'static>(key: String, value: Arc<T>, cx: &mut App) {
    cx.default_global::<Store>().entries.insert(key, value);
}

pub fn forget(key: &str, cx: &mut App) {
    cx.default_global::<Store>().entries.remove(key);
}

#[cfg(feature = "snapshot")]
pub fn set_auth(auth: Auth, cx: &mut App) {
    cx.default_global::<Store>().auth = Some(auth);
}

pub fn auth(cx: &App) -> Option<Auth> {
    cx.try_global::<Store>()?.auth.clone()
}

/// Finds and checks the token on the background executor. `force` checks again even when an
/// answer is known.
pub fn check_auth(force: bool, cx: &mut App) -> Task<Auth> {
    if !force && let Some(auth) = auth(cx).filter(|auth| *auth != Auth::Checking) {
        return Task::ready(auth);
    }
    let preference = crate::gh::TokenSourcePreference::from_setting(
        cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).github_token_source.as_str()),
    );
    let check = cx.background_spawn(async move { auth::check(preference) });
    cx.spawn(async move |cx: &mut AsyncApp| {
        let auth = check.await;
        cx.update(|cx| cx.default_global::<Store>().auth = Some(auth.clone()));
        auth
    })
}

/// Why there is no token, as a view's error says it.
pub fn auth_message(auth: &Auth) -> String {
    match auth {
        Auth::Unavailable(error) => error.clone(),
        Auth::Missing { rejected: true, .. } => "GitHub rejected the token. Run `gh auth login` again, or set GITHUB_TOKEN.".to_string(),
        _ => "GitHub is not authenticated. Run `gh auth login` in a terminal, or set GITHUB_TOKEN.".to_string(),
    }
}

/// Runs `fetch` with the token on the background executor, then hands its result to `apply`.
pub fn fetch<V: 'static, T: Send + 'static>(
    cx: &mut Context<V>,
    fetch: impl FnOnce(String) -> Result<T, String> + Send + 'static,
    apply: impl FnOnce(&mut V, Result<T, String>, &mut Context<V>) + 'static,
) {
    let auth = check_auth(false, cx);
    cx.spawn(async move |this, cx| {
        let auth = auth.await;
        let result = match auth.token() {
            Some(token) => cx.background_executor().spawn(async move { fetch(token) }).await,
            None => Err(auth_message(&auth)),
        };
        this.update(cx, |this, cx| apply(this, result, cx)).ok();
    })
    .detach();
}

/// Makes `mutation` with the token on the background executor, then hands its outcome to `apply`.
pub fn mutate<V: 'static>(cx: &mut Context<V>, path: String, mutation: Mutation, apply: impl FnOnce(&mut V, Result<Outcome, String>, &mut Context<V>) + 'static) {
    fetch(cx, move |token| mutation.perform(path, token), apply);
}

/// The signed-in account's login, asked once and kept, for "is this my comment".
pub fn current_user(cx: &mut App) -> Task<Option<String>> {
    if let Some(login) = get::<String>(CURRENT_USER, cx) {
        return Task::ready(Some((*login).clone()));
    }
    let auth = check_auth(false, cx);
    cx.spawn(async move |cx: &mut AsyncApp| {
        let token = auth.await.token()?;
        let login = cx.background_executor().spawn(async move { crate::gh::github_get_current_user(Some(token)) }).await.ok()?;
        cx.update(|cx| put(CURRENT_USER.to_string(), Arc::new(login.clone()), cx));
        Some(login)
    })
}

const CURRENT_USER: &str = "github|current-user";

/// The repository's labels, milestones and issue types, for the pickers.
pub struct Metadata {
    pub labels: Vec<Label>,
    pub milestones: Vec<IssueMilestone>,
    pub issue_types: Vec<IssueType>,
}

pub fn metadata_key(path: &str) -> String {
    format!("{path}|metadata")
}

/// Blocking. Issue types exist only for organisation repositories; elsewhere GitHub answers 404.
pub fn fetch_metadata(path: String, token: String) -> Result<Metadata, String> {
    let labels = crate::gh::github_list_labels(path.clone(), Some(token.clone()))?;
    let milestones = crate::gh::github_list_milestones(path.clone(), Some(token.clone()))?;
    let issue_types = crate::gh::github_list_issue_types(path, Some(token)).unwrap_or_default();
    Ok(Metadata { labels, milestones, issue_types })
}

/// The cached metadata at once, then fresh metadata through `apply`.
pub fn load_metadata<V: 'static>(cx: &mut Context<V>, path: String, apply: impl FnOnce(&mut V, Result<Arc<Metadata>, String>, &mut Context<V>) + 'static) -> Option<Arc<Metadata>> {
    let cached = get::<Metadata>(&metadata_key(&path), cx);
    let key = metadata_key(&path);
    fetch(cx, move |token| fetch_metadata(path, token), move |this, result, cx| {
        let result = result.map(|metadata| {
            let metadata = Arc::new(metadata);
            put(key, metadata.clone(), cx);
            metadata
        });
        apply(this, result, cx);
    });
    cached
}

/// Counts the changes made from Athas, so the sidebar re-reads its lists after one.
#[derive(Default)]
pub struct Revision(pub usize);

impl Global for Revision {}

pub fn bump(cx: &mut App) {
    cx.default_global::<Revision>().0 += 1;
}
