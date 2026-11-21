use std::rc::Rc;

use gpui::{App, Global, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, img, prelude::FluentBuilder, px};
use theme::ActiveTheme;

use crate::typography;

/// A person's GitHub picture, at the size avatars are drawn. One spelling for the whole app, so
/// the same person is never fetched from two different URLs.
pub fn github_avatar_url(login: &str) -> String {
    let login: String = login
        .bytes()
        .map(|byte| match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect();
    format!("https://github.com/{login}.png?size=64")
}

/// The login of a `…@users.noreply.github.com` address, with or without its numeric id.
fn github_login_from_email(email: &str) -> Option<&str> {
    let local = email.strip_suffix("@users.noreply.github.com")?;
    let login = match local.split_once('+') {
        Some((id, login)) if !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()) => login,
        _ => local,
    };
    (!login.is_empty()).then_some(login)
}

/// The signed-in account, as far as pictures need it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AccountIdentity {
    pub user_id: i64,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
    pub github_login: Option<String>,
}

impl AccountIdentity {
    fn login(&self) -> Option<&str> {
        self.github_login.as_deref().map(str::trim).filter(|login| !login.is_empty())
    }

    /// Whether `person` is this account, by any of the things it is known by.
    fn is_me(&self, person: &Person) -> bool {
        if person.user_id.is_some_and(|id| id != 0 && id == self.user_id) {
            return true;
        }
        let same = |a: &str, b: &str| !a.trim().is_empty() && a.trim().eq_ignore_ascii_case(b.trim());
        if person.email.as_deref().is_some_and(|email| same(email, &self.email)) {
            return true;
        }
        let Some(login) = self.login() else { return false };
        // GitHub hides a commit address behind the login that signed it, so `sam` and
        // `1+sam@users.noreply.github.com` are the same person as the account linked to `sam`.
        person.login().or_else(|| person.email.as_deref().and_then(github_login_from_email)).is_some_and(|other| same(other, login))
    }

    /// This account's own picture: the one it stores, else its GitHub one.
    pub fn picture(&self) -> Option<String> {
        if let Some(url) = self.avatar_url.as_deref().map(str::trim).filter(|url| !url.is_empty()) {
            return Some(url.to_string());
        }
        self.login().map(github_avatar_url)
    }
}

type AccountLookup = Rc<dyn Fn(&App) -> Option<AccountIdentity>>;

struct GlobalAccountLookup(AccountLookup);

impl Global for GlobalAccountLookup {}

/// Tells the views how to find the signed-in account; the workbench sets it once.
pub fn set_account_lookup(cx: &mut App, lookup: impl Fn(&App) -> Option<AccountIdentity> + 'static) {
    cx.set_global(GlobalAccountLookup(Rc::new(lookup)));
}

/// The signed-in account, when there is one.
pub fn account(cx: &App) -> Option<AccountIdentity> {
    cx.try_global::<GlobalAccountLookup>().and_then(|lookup| (lookup.0)(cx))
}

/// Who a view is drawing, in whatever it happens to know: a commit holds an email, the team holds
/// a user id, GitHub holds a login. Any of them is enough to find a picture.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Person {
    pub name: SharedString,
    pub email: Option<SharedString>,
    pub github_login: Option<SharedString>,
    pub user_id: Option<i64>,
}

impl Person {
    pub fn new(name: impl Into<SharedString>) -> Self {
        Self { name: name.into(), ..Default::default() }
    }

    pub fn email(mut self, email: impl Into<SharedString>) -> Self {
        self.email = Some(email.into());
        self
    }

    pub fn github_login(mut self, login: impl Into<SharedString>) -> Self {
        self.github_login = Some(login.into());
        self
    }

    pub fn user_id(mut self, id: i64) -> Self {
        self.user_id = Some(id);
        self
    }

    fn login(&self) -> Option<&str> {
        self.github_login.as_deref().map(str::trim).filter(|login| !login.is_empty())
    }

    /// Their picture, if one can be found.
    pub fn picture(&self, cx: &App) -> Option<SharedString> {
        picture_for(self, account(cx).as_ref()).map(SharedString::from)
    }
}

/// The picture of `person`, knowing the signed-in `account`.
pub fn picture_for(person: &Person, account: Option<&AccountIdentity>) -> Option<String> {
    if let Some(account) = account
        && account.is_me(person)
        && let Some(url) = account.picture()
    {
        return Some(url);
    }
    if let Some(login) = person.login() {
        return Some(github_avatar_url(login));
    }
    person.email.as_deref().and_then(github_login_from_email).map(github_avatar_url)
}

/// A person's initial in a circle, until their picture loads.
#[derive(IntoElement)]
pub struct Avatar {
    initial: SharedString,
    size: gpui::Pixels,
    image: Option<SharedString>,
}

impl Avatar {
    pub fn new(name: &str) -> Self {
        let initial = name.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
        Self { initial: initial.into(), size: px(20.), image: None }
    }

    /// Someone Athas knows: their picture when it can be found, their initial until then.
    pub fn person(person: &Person, cx: &App) -> Self {
        Self::new(&person.name).image(person.picture(cx))
    }

    pub fn size(mut self, size: gpui::Pixels) -> Self {
        self.size = size;
        self
    }

    /// A picture's URL; the initial shows while it loads and when it cannot.
    pub fn image(mut self, url: Option<impl Into<SharedString>>) -> Self {
        self.image = url.map(Into::into);
        self
    }
}

impl RenderOnce for Avatar {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(self.size)
            .rounded_full()
            .bg(colors.selected)
            .text_size(typography::TEXT_CAPTION)
            .font_weight(typography::SEMIBOLD)
            .text_color(colors.foreground)
            .relative()
            .overflow_hidden()
            .child(self.initial)
            .when_some(self.image, |this, url| this.child(img(url).absolute().inset_0().size_full().rounded_full()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn me() -> AccountIdentity {
        AccountIdentity {
            user_id: 7,
            name: "Sam".into(),
            email: "Sam@Example.com".into(),
            avatar_url: Some("https://cdn/a.png".into()),
            github_login: Some("sam".into()),
        }
    }

    #[test]
    fn the_account_is_recognised_by_id_email_or_login() {
        let account = me();
        for person in [
            Person::new("Sam").user_id(7),
            Person::new("Sam").email(" sam@example.com "),
            Person::new("Sam").github_login("SAM"),
            Person::new("Sam").email("1234+sam@users.noreply.github.com"),
        ] {
            assert_eq!(picture_for(&person, Some(&account)).as_deref(), Some("https://cdn/a.png"), "{person:?}");
        }
    }

    #[test]
    fn without_a_stored_picture_the_account_falls_back_to_github() {
        let account = AccountIdentity { avatar_url: None, ..me() };
        assert_eq!(picture_for(&Person::new("Sam").user_id(7), Some(&account)).as_deref(), Some("https://github.com/sam.png?size=64"));
    }

    #[test]
    fn other_people_come_from_their_login_or_a_noreply_address() {
        let account = Some(me());
        assert_eq!(picture_for(&Person::new("Octo").github_login("octo"), account.as_ref()).as_deref(), Some("https://github.com/octo.png?size=64"));
        assert_eq!(
            picture_for(&Person::new("Octo").email("1234+Octo@users.noreply.github.com"), None).as_deref(),
            Some("https://github.com/Octo.png?size=64")
        );
        assert_eq!(picture_for(&Person::new("Nobody").email("nobody@example.com"), account.as_ref()), None);
        assert_eq!(picture_for(&Person::new("Nobody"), account.as_ref()), None);
    }

    #[test]
    fn a_login_that_needs_escaping_stays_a_url() {
        assert_eq!(github_avatar_url("a b"), "https://github.com/a%20b.png?size=64");
    }
}
