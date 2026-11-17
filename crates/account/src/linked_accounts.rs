//! Accounts of other services linked to the Athas account (`services/linked-accounts.ts`): the
//! GitHub panel registers GitHub, and the account menu shows it as connected only while GitHub
//! accepts its token, re-checked each time the menu opens.

use std::rc::Rc;

use gpui::{App, Global};

/// What the GitHub panel last found: whether a token works and whose it is.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LinkedGitHub {
    pub connected: bool,
    pub login: Option<String>,
}

impl Global for LinkedGitHub {}

struct GitHubRefresh(Rc<dyn Fn(&mut App)>);

impl Global for GitHubRefresh {}

/// Registers GitHub (`registerGitHubLinkedAccount`): `refresh` checks the token again and calls
/// [`set_github`] with the answer.
pub fn register_github(cx: &mut App, refresh: impl Fn(&mut App) + 'static) {
    cx.set_global(GitHubRefresh(Rc::new(refresh)));
}

/// The linked GitHub account, when GitHub is registered.
pub fn github(cx: &App) -> Option<LinkedGitHub> {
    cx.has_global::<GitHubRefresh>().then(|| cx.try_global::<LinkedGitHub>().cloned().unwrap_or_default())
}

pub fn set_github(cx: &mut App, state: LinkedGitHub) {
    if cx.try_global::<LinkedGitHub>() != Some(&state) {
        cx.set_global(state);
    }
}

/// Checks the linked GitHub account again (the menu does when it opens).
pub fn refresh_github(cx: &mut App) {
    if let Some(refresh) = cx.try_global::<GitHubRefresh>().map(|refresh| refresh.0.clone()) {
        refresh(cx);
    }
}
