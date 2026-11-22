//! The account menu under the activity bar's avatar (`components/account-menu.tsx`): who is
//! signed in, the plan and this period's AI credit, links to the dashboard, and sign in or out.

use std::rc::Rc;

use gpui::{
    AnyElement, App, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, ParentElement, Render,
    SharedString, Styled, Subscription, Window, div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{Avatar, Icon, IconName, IconSize, metrics, typography};

use crate::{
    AccountStore,
    gates::CreditUsage,
    service_urls::ServiceUrls,
    state::SignInFlow,
    widgets,
};

/// What the menu asks its host to do; the menu closes itself after each.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AccountMenuEvent {
    /// Open Settings, on a page when one is given (`account`).
    OpenSettings(Option<&'static str>),
    /// Open the Team view.
    OpenTeam,
}

type Handler = Rc<dyn Fn(&mut AccountMenu, &mut Window, &mut Context<AccountMenu>)>;

struct Item {
    id: &'static str,
    icon: IconName,
    label: SharedString,
    trailing: Option<SharedString>,
    shortcut: Option<SharedString>,
    external: bool,
    handler: Handler,
}

/// Settings' shortcut, as the item shows it (`useCommandShortcut("workbench.openSettings")`).
fn settings_shortcut(cx: &App) -> Option<SharedString> {
    let active = cx.try_global::<keymap::ActiveKeymap>()?;
    let binding = active.bindings.iter().find(|binding| binding.command == "workbench.openSettings" && binding.enabled != Some(false))?;
    Some(keymap::display_key(&binding.key).into())
}

impl Item {
    fn new(id: &'static str, icon: IconName, label: impl Into<SharedString>, handler: impl Fn(&mut AccountMenu, &mut Window, &mut Context<AccountMenu>) + 'static) -> Self {
        Self { id, icon, label: label.into(), trailing: None, shortcut: None, external: false, handler: Rc::new(handler) }
    }

    fn trailing(mut self, trailing: impl Into<SharedString>) -> Self {
        self.trailing = Some(trailing.into());
        self
    }

    fn open(id: &'static str, icon: IconName, label: &'static str, url: String) -> Self {
        let mut item = Self::new(id, icon, label, move |_, _, cx| cx.open_url(&url));
        item.external = true;
        item
    }
}

pub struct AccountMenu {
    store: Option<Entity<AccountStore>>,
    focus_handle: FocusHandle,
    /// The item the arrows or the pointer are on, counted over every section.
    highlighted: Option<usize>,
    dismissed_by_press: bool,
    _observe: Option<Subscription>,
    _linked: Subscription,
}

impl AccountMenu {
    /// Whether a press outside the menu closed it, rather than a pick or Escape.
    pub fn dismissed_by_press(&self) -> bool {
        self.dismissed_by_press
    }
}

impl EventEmitter<DismissEvent> for AccountMenu {}
impl EventEmitter<AccountMenuEvent> for AccountMenu {}

impl Focusable for AccountMenu {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl AccountMenu {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let store = AccountStore::global(cx);
        // A sign-in finished from the menu closes it, as the original's `onSignedIn`.
        let was_signed_in = std::cell::Cell::new(store.as_ref().is_some_and(|store| store.read(cx).is_signed_in()));
        let observe = store.as_ref().map(|store| {
            cx.observe(store, move |_, store, cx| {
                let signed_in = store.read(cx).is_signed_in();
                if signed_in && !was_signed_in.replace(signed_in) {
                    cx.emit(DismissEvent);
                }
                was_signed_in.set(signed_in);
                cx.notify();
            })
        });
        let focus_handle = cx.focus_handle();
        window.focus(&focus_handle, cx);
        // Opening the menu checks the linked GitHub account again.
        let linked = cx.observe_global::<crate::linked_accounts::LinkedGitHub>(|_, cx| cx.notify());
        crate::linked_accounts::refresh_github(cx);
        Self { store, focus_handle, highlighted: None, dismissed_by_press: false, _observe: observe, _linked: linked }
    }

    /// Arrow keys, Home and End move between items (wrapping, as Base UI menus do); Enter or
    /// Space picks the highlighted one.
    fn key_down(&mut self, event: &gpui::KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let items: Vec<Item> = self.items(&crate::urls(cx), cx).into_iter().flat_map(|(_, items)| items).collect();
        let count = items.len();
        if count == 0 {
            return;
        }
        let next = match event.keystroke.key.as_str() {
            "escape" => {
                cx.emit(DismissEvent);
                return;
            }
            "down" => self.highlighted.map_or(0, |index| (index + 1) % count),
            "up" => self.highlighted.map_or(count - 1, |index| (index + count - 1) % count),
            "home" => 0,
            "end" => count - 1,
            "enter" | "space" => {
                let Some(item) = self.highlighted.and_then(|index| items.into_iter().nth(index)) else { return };
                self.activate(item, window, cx);
                return;
            }
            _ => return,
        };
        self.highlighted = Some(next);
        cx.stop_propagation();
        cx.notify();
    }

    fn activate(&mut self, item: Item, window: &mut Window, cx: &mut Context<Self>) {
        // Signing in keeps the menu open, so its state (the page is open, cancel) shows.
        let keep_open = matches!(item.id, "sign-in" | "retry");
        (item.handler)(self, window, cx);
        if !keep_open {
            cx.emit(DismissEvent);
        }
    }

    fn update_store(&self, cx: &mut Context<Self>, update: impl FnOnce(&mut AccountStore, &mut Context<AccountStore>)) {
        if let Some(store) = &self.store {
            store.update(cx, update);
        }
    }

    fn items(&self, urls: &ServiceUrls, cx: &App) -> Vec<(Option<&'static str>, Vec<Item>)> {
        let store = self.store.as_ref().map(|store| store.read(cx));
        let signed_in = store.is_some_and(|store| store.is_signed_in());
        let mut settings = Item::new("settings", IconName::Settings, "Settings", |_, _, cx| cx.emit(AccountMenuEvent::OpenSettings(None)));
        settings.shortcut = settings_shortcut(cx);

        let account = if let Some(store) = store.filter(|_| signed_in) {
            // Connected while GitHub accepts the linked token (`useLinkedAccountState("github")`),
            // named by its login or the account's GitHub username.
            let username = store.user().and_then(|user| user.github_username.clone()).filter(|login| !login.is_empty());
            let github = match crate::linked_accounts::github(cx) {
                Some(linked) if linked.connected => linked.login.filter(|login| !login.is_empty()).or(username),
                Some(_) => None,
                None => username,
            };
            let mut items = vec![
                Item::open("profile", IconName::User, "Profile", urls.dashboard()),
                Item::open("billing", IconName::CreditCard, "Plan & Billing", urls.billing()).trailing(store.plan_label()),
                match github {
                    Some(login) => Item::open("github-profile", IconName::Github, "GitHub Profile", format!("https://github.com/{login}")).trailing("Connected"),
                    None => Item::open("github-connect", IconName::Github, "Connect GitHub", urls.integrations()),
                },
            ];
            if store.subscription().and_then(|subscription| subscription.team()).is_some() {
                items.push(Item::new("team", IconName::Users, "Team", |_, _, cx| cx.emit(AccountMenuEvent::OpenTeam)));
            }
            items.push(settings);
            items
        } else {
            vec![settings]
        };

        let sign_in = store.map(|store| store.state().sign_in.clone()).unwrap_or_default();
        let session = if signed_in {
            vec![Item::new("sign-out", IconName::SignOut, "Sign Out", |this, _, cx| this.update_store(cx, |store, cx| store.sign_out(cx)))]
        } else if sign_in == SignInFlow::Idle {
            let mut items = vec![Item::new("sign-in", IconName::SignIn, "Sign In", |this, _, cx| this.update_store(cx, |store, cx| store.sign_in(cx)))];
            if store.is_some_and(|store| store.session_check().is_some()) {
                items.push(Item::new("retry", IconName::ArrowClockwise, "Check Session Again", |this, _, cx| {
                    this.update_store(cx, |store, cx| store.retry_session_check(cx))
                }));
            }
            items
        } else {
            vec![
                Item::new("reopen-sign-in", IconName::SignIn, "Open sign-in page", |this, _, cx| this.update_store(cx, |store, cx| store.reopen_sign_in(cx))),
                Item::new("cancel-sign-in", IconName::X, "Cancel sign-in", |this, _, cx| this.update_store(cx, |store, cx| store.cancel_sign_in(cx))),
            ]
        };

        vec![(if signed_in { None } else { Some("Account") }, account), (None, session)]
    }

    fn render_item(&self, index: usize, item: Item, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let text = colors.foreground;
        let highlighted = self.highlighted == Some(index);
        let label = item.label.clone();
        let icon = item.icon;
        let trailing = item.trailing.clone();
        let shortcut = item.shortcut.clone();
        let external = item.external;
        let id = item.id;
        let item = std::cell::RefCell::new(Some(item));
        div()
            .id(id)
            .flex()
            .items_center()
            .gap(px(8.))
            .h(px(28.))
            .px(px(8.))
            .rounded(metrics::RADIUS_MD)
            .text_size(typography::TEXT_SM)
            .text_color(text)
            .when(highlighted, |this| this.bg(colors.accent))
            .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                if *hovered && this.highlighted != Some(index) {
                    this.highlighted = Some(index);
                    cx.notify();
                }
            }))
            .child(Icon::new(icon).size(IconSize::Small).color(colors.subtle_foreground))
            .child(div().flex_1().min_w_0().truncate().child(label))
            .children(trailing.map(|trailing| div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(trailing)))
            .children(shortcut.map(|shortcut| div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(shortcut)))
            .when(external, |this| this.child(Icon::new(IconName::OpenExternal).size(IconSize::Small).color(colors.subtle_foreground)))
            .on_click(cx.listener(move |this, _, window, cx| {
                if let Some(item) = item.borrow_mut().take() {
                    this.activate(item, window, cx);
                }
            }))
            .into_any_element()
    }

    fn render_header(&self, cx: &App) -> Option<AnyElement> {
        let store = self.store.as_ref()?.read(cx);
        let colors = &cx.theme().colors;
        if !store.is_signed_in() {
            let check = store.session_check()?;
            return Some(
                div()
                    .flex()
                    .gap(px(8.))
                    .px(px(8.))
                    .py(px(6.))
                    .text_size(typography::TEXT_CAPTION)
                    .text_color(colors.warning)
                    .child(Icon::new(IconName::CloudWarning).size(IconSize::Small).color(colors.warning))
                    .child(div().flex_1().child(format!("{} Trying again in {}s.", check.message, check.retry_in.as_secs())))
                    .into_any_element(),
            );
        }
        let (name, detail) = store.identity();
        let avatar = store.avatar_url();
        let usage = store.subscription().and_then(|subscription| subscription.credits.as_ref()).and_then(CreditUsage::from_credits);
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .px(px(8.))
                .py(px(6.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.))
                        .child(Avatar::new(&name).size(px(32.)).image(avatar))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w_0()
                                .child(div().truncate().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.foreground).child(name))
                                .children(detail.map(|detail| div().truncate().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(detail))),
                        )
                        .child(widgets::badge(store.plan_label(), None, cx)),
                )
                .children(usage.map(|usage| {
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .child(
                            div()
                                .flex()
                                .justify_between()
                                .text_size(typography::TEXT_CAPTION)
                                .text_color(colors.subtle_foreground)
                                .child("Included AI credit")
                                .child(usage.label),
                        )
                        .child(widgets::meter(usage.fraction, cx))
                        .children(usage.detail.map(|detail| div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(detail)))
                }))
                .children(store.state().error.clone().map(|error| div().text_size(typography::TEXT_CAPTION).text_color(colors.warning).child(error)))
                .into_any_element(),
        )
    }
}

impl Render for AccountMenu {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let urls = crate::urls(cx);
        let header = self.render_header(cx);
        let has_header = header.is_some();
        let sections = self.items(&urls, cx);
        let mut rows: Vec<AnyElement> = Vec::new();
        let mut index_of_item = 0;
        for (index, (label, items)) in sections.into_iter().enumerate() {
            if index > 0 || has_header {
                rows.push(div().my(px(4.)).mx(px(-4.)).h(px(1.)).bg(colors.divider).into_any_element());
            }
            if let Some(label) = label {
                rows.push(
                    div()
                        .px(px(8.))
                        .pt(px(6.))
                        .pb(px(2.))
                        .text_size(typography::TEXT_CAPTION)
                        .font_weight(typography::MEDIUM)
                        .text_color(colors.subtle_foreground)
                        .child(label)
                        .into_any_element(),
                );
            }
            for item in items {
                rows.push(self.render_item(index_of_item, item, cx));
                index_of_item += 1;
            }
        }

        div()
            .id("account-menu")
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::key_down))
            .on_mouse_down_out(cx.listener(|this, _, _, cx| {
                this.dismissed_by_press = true;
                cx.emit(DismissEvent);
            }))
            .flex()
            .flex_col()
            .w(px(288.))
            .p(px(4.))
            .rounded(metrics::RADIUS_LG)
            .bg(colors.overlay)
            .shadow(theme.shadows.popover.clone())
            .font_family(typography::UI_FONT)
            .children(header)
            .children(rows)
    }
}
