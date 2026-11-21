//! Commit authors' pictures (`git-author-avatar.ts`): the signed-in account's picture for its own
//! addresses, else the GitHub picture of a `users.noreply.github.com` address. The matching lives
//! in `ui::avatar`, so a commit author and the same person in the team or on GitHub resolve to one
//! picture.

use gpui::App;
pub use ui::avatar::{AccountIdentity, set_account_lookup};
use ui::avatar::{Person, picture_for};

/// The picture of the author with `email`, if one is known.
pub fn author_avatar(email: &str, cx: &App) -> Option<String> {
    picture_for(&person(email), ui::avatar::account(cx).as_ref())
}

fn person(email: &str) -> Person {
    Person::new("").email(email.to_string())
}

/// The picture of the author with `email`, knowing the signed-in `account`.
pub fn author_avatar_url(email: &str, account: Option<&AccountIdentity>) -> Option<String> {
    picture_for(&person(email), account)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noreply_addresses_and_the_account() {
        assert_eq!(author_avatar_url("1234+Octo@users.noreply.github.com", None).as_deref(), Some("https://github.com/Octo.png?size=64"));
        assert_eq!(author_avatar_url("octo@users.noreply.github.com", None).as_deref(), Some("https://github.com/octo.png?size=64"));
        assert_eq!(author_avatar_url("sam@example.com", None), None);
        let account = AccountIdentity { email: "Sam@Example.com".into(), avatar_url: None, github_login: Some("sam".into()), ..Default::default() };
        assert_eq!(author_avatar_url(" sam@example.com", Some(&account)).as_deref(), Some("https://github.com/sam.png?size=64"));
        let account = AccountIdentity { avatar_url: Some("https://cdn/a.png".into()), ..account };
        assert_eq!(author_avatar_url("sam@example.com", Some(&account)).as_deref(), Some("https://cdn/a.png"));
        assert_eq!(author_avatar_url("other@example.com", Some(&account)), None);
        // A teammate's commit signed with their GitHub address still finds their picture.
        assert_eq!(author_avatar_url("9+octo@users.noreply.github.com", Some(&account)).as_deref(), Some("https://github.com/octo.png?size=64"));
    }
}
