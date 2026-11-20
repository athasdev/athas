//! Runs an account-service call for a view: with the account's token on the background
//! executor, handing the result back to the view.

use account::{AccountStore, ApiError, Client};
use gpui::{AppContext, Context, Task};

pub fn call<V: 'static, T: Send + 'static>(
    cx: &mut Context<V>,
    request: impl FnOnce(&Client, &str) -> Result<T, ApiError> + Send + 'static,
    apply: impl FnOnce(&mut V, Result<T, ApiError>, &mut Context<V>) + 'static,
) {
    let session = AccountStore::global(cx).and_then(|store| {
        let store = store.read(cx);
        Some((store.client().clone(), store.token()?.to_string()))
    });
    let task = match session {
        Some((client, token)) => cx.background_spawn(async move { request(&client, &token) }),
        None => Task::ready(Err(ApiError::NotAuthenticated)),
    };
    cx.spawn(async move |this, cx| {
        let result = task.await;
        this.update(cx, |this, cx| apply(this, result, cx)).ok();
    })
    .detach();
}
