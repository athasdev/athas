//! Commit authors' pictures (`git-author-avatar.ts`): the signed-in account's picture for its own
//! email, else the GitHub picture of a `users.noreply.github.com` address.

use std::rc::Rc;

use gpui::{App, Global};

/// The signed-in account, as far as author pictures need it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AuthorAccount {
    pub email: String,
    pub avatar_url: Option<String>,
    pub github_username: Option<String>,
}

type AccountLookup = Rc<dyn Fn(&App) -> Option<AuthorAccount>>;

struct GlobalAccountLookup(AccountLookup);

impl Global for GlobalAccountLookup {}

/// Tells the views how to find the signed-in account; the workbench sets it.
pub fn set_account_lookup(cx: &mut App, lookup: impl Fn(&App) -> Option<AuthorAccount> + 'static) {
    cx.set_global(GlobalAccountLookup(Rc::new(lookup)));
}

/// The picture of the author with `email`, if one is known.
pub fn author_avatar(email: &str, cx: &App) -> Option<String> {
    let account = cx.try_global::<GlobalAccountLookup>().and_then(|lookup| (lookup.0)(cx));
    author_avatar_url(email, account.as_ref())
}

fn github_login_from_email(email: &str) -> Option<&str> {
    let local = email.strip_suffix("@users.noreply.github.com")?;
    let login = match local.split_once('+') {
        Some((id, login)) if !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()) => login,
        _ => local,
    };
    (!login.is_empty()).then_some(login)
}

fn github_avatar_url(login: &str) -> String {
    let login: String = login
        .bytes()
        .map(|byte| match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect();
    format!("https://github.com/{login}.png?size=64")
}

pub fn author_avatar_url(email: &str, account: Option<&AuthorAccount>) -> Option<String> {
    let email = email.trim().to_lowercase();
    if let Some(account) = account
        && !email.is_empty()
        && email == account.email.trim().to_lowercase()
    {
        if let Some(url) = account.avatar_url.as_deref().map(str::trim).filter(|url| !url.is_empty()) {
            return Some(url.to_string());
        }
        if let Some(login) = account.github_username.as_deref().map(str::trim).filter(|login| !login.is_empty()) {
            return Some(github_avatar_url(login));
        }
    }
    github_login_from_email(&email).map(github_avatar_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noreply_addresses_and_the_account() {
        assert_eq!(author_avatar_url("1234+Octo@users.noreply.github.com", None).as_deref(), Some("https://github.com/octo.png?size=64"));
        assert_eq!(author_avatar_url("octo@users.noreply.github.com", None).as_deref(), Some("https://github.com/octo.png?size=64"));
        assert_eq!(author_avatar_url("sam@example.com", None), None);
        let account = AuthorAccount { email: "Sam@Example.com".into(), avatar_url: None, github_username: Some("sam".into()) };
        assert_eq!(author_avatar_url(" sam@example.com", Some(&account)).as_deref(), Some("https://github.com/sam.png?size=64"));
        let account = AuthorAccount { avatar_url: Some("https://cdn/a.png".into()), ..account };
        assert_eq!(author_avatar_url("sam@example.com", Some(&account)).as_deref(), Some("https://cdn/a.png"));
        assert_eq!(author_avatar_url("other@example.com", Some(&account)), None);
    }
}
