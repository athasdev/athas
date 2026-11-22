//! Commit authors' pictures (`git-author-avatar.ts`): the signed-in account's picture for its own
//! addresses, else the GitHub picture of a `users.noreply.github.com` address. The matching lives
//! in `ui::avatar`, so a commit author and the same person in the team or on GitHub resolve to one
//! picture.

use gpui::App;
pub use ui::avatar::{AccountIdentity, set_account_lookup};
use ui::avatar::{Person, picture_for};

/// The picture of the author with `email`, if one is known.
pub fn author_avatar(email: &str, cx: &App) -> Option<String> {
    author_avatar_url(email, ui::avatar::account(cx).as_ref())
}

fn person(email: &str) -> Person {
    Person::new("").email(email.to_string())
}

/// The picture of the author with `email`, knowing the signed-in `account`.
/// Any other address asks GitHub for the picture of the account that commits with it.
pub fn author_avatar_url(email: &str, account: Option<&AccountIdentity>) -> Option<String> {
    picture_for(&person(email), account).or_else(|| commit_email_avatar(email))
}

fn commit_email_avatar(email: &str) -> Option<String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') {
        return None;
    }
    let encoded: String = email
        .bytes()
        .map(|byte| match byte {
            b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect();
    Some(format!("https://avatars.githubusercontent.com/u/e?email={encoded}&s=64"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noreply_addresses_and_the_account() {
        assert_eq!(author_avatar_url("1234+Octo@users.noreply.github.com", None).as_deref(), Some("https://github.com/Octo.png?size=64"));
        assert_eq!(author_avatar_url("octo@users.noreply.github.com", None).as_deref(), Some("https://github.com/octo.png?size=64"));
        assert_eq!(author_avatar_url("sam@example.com", None).as_deref(), Some("https://avatars.githubusercontent.com/u/e?email=sam%40example.com&s=64"));
        assert_eq!(author_avatar_url("", None), None);
        let account = AccountIdentity { email: "Sam@Example.com".into(), avatar_url: None, github_login: Some("sam".into()), ..Default::default() };
        assert_eq!(author_avatar_url(" sam@example.com", Some(&account)).as_deref(), Some("https://github.com/sam.png?size=64"));
        let account = AccountIdentity { avatar_url: Some("https://cdn/a.png".into()), ..account };
        assert_eq!(author_avatar_url("sam@example.com", Some(&account)).as_deref(), Some("https://cdn/a.png"));
        assert!(author_avatar_url("other@example.com", Some(&account)).unwrap().contains("email=other%40example.com"));
        // A teammate's commit signed with their GitHub address still finds their picture.
        assert_eq!(author_avatar_url("9+octo@users.noreply.github.com", Some(&account)).as_deref(), Some("https://github.com/octo.png?size=64"));
    }
}
