//! The Settings "Account" page content (`tabs/account-settings.tsx`): who is signed in,
//! the plan, this period's AI credit and the settings sync gate. `settings_ui` hosts it as a
//! child view on the `account` page; the sharing list (`collaboration::SharingSettings`) goes
//! under it.

use ui::scale::px;
use gpui::{AnyElement, App, Context, Entity, IntoElement, ParentElement, Render, SharedString, Styled, Subscription, Window, div, prelude::*,};
use theme::ActiveTheme;
use ui::{Button, ButtonVariant, Switch, typography};

use crate::{
    AccountStore,
    settings_sync::{SettingsSync, Status},
    gates::{self, CreditUsage},
    service_urls::ServiceUrls,
    state::{Session, SignInFlow},
    widgets,
};

pub struct AccountSettings {
    store: Option<Entity<AccountStore>>,
    sync: Option<Entity<SettingsSync>>,
    _observe: Vec<Subscription>,
}

impl AccountSettings {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let store = AccountStore::global(cx);
        let sync = SettingsSync::global(cx);
        let mut observe: Vec<Subscription> = store.iter().map(|store| cx.observe(store, |_, _, cx| cx.notify())).collect();
        observe.extend(sync.iter().map(|sync| cx.observe(sync, |_, _, cx| cx.notify())));
        Self { store, sync, _observe: observe }
    }

    /// Runs a sync step and reports how it went (`handleToggleSettingsSync`, `handleSyncNow`, …).
    fn run_sync(&self, step: fn(&mut SettingsSync, &mut Context<SettingsSync>) -> gpui::Task<Result<(), String>>, success: &'static str, cx: &mut App) {
        let Some(sync) = self.sync.clone() else { return };
        let task = sync.update(cx, step);
        cx.spawn(async move |cx| {
            let result = task.await;
            cx.update(|cx| match result {
                Ok(()) => notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, success, None, None),
                Err(message) => notifications::notify(cx, notifications::NotificationKind::Error, notifications::NotificationCategory::Athas, message, None, None),
            });
        })
        .detach();
    }

    fn account_section(&self, store: &AccountStore, urls: &ServiceUrls, cx: &App) -> AnyElement {
        let entity = self.store.clone();
        let update = move |cx: &mut App, change: fn(&mut AccountStore, &mut Context<AccountStore>)| {
            if let Some(store) = &entity {
                store.update(cx, change);
            }
        };
        let mut rows = Vec::new();
        match &store.state().session {
            Session::SignedIn { user, .. } => {
                let dashboard = urls.dashboard();
                let update = update.clone();
                rows.push(widgets::row(
                    "Signed In",
                    Some(user.email.clone().into()),
                    div()
                        .flex()
                        .gap(px(6.))
                        .child(Button::new("account-dashboard", "Dashboard").variant(ButtonVariant::Outline).on_click(move |_, _, cx| cx.open_url(&dashboard)))
                        .child(Button::new("account-sign-out", "Sign Out").variant(ButtonVariant::Outline).on_click(move |_, _, cx| update(cx, |store, cx| store.sign_out(cx)))),
                    cx,
                ));
                let features = store.features();
                let paid = gates::is_paid(&features, store.subscription());
                let plan_url = if paid { urls.billing() } else { urls.pricing() };
                rows.push(widgets::row(
                    "Plan",
                    store.subscription().and_then(|subscription| subscription.subscription.as_ref()).and_then(|plan| {
                        plan.ends_at.as_deref().map(|ends| format!("Ends {}", &ends[..ends.len().min(10)])).or_else(|| {
                            plan.renews_at.as_deref().map(|renews| format!("Renews {}", &renews[..renews.len().min(10)]))
                        })
                    }).map(SharedString::from),
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(widgets::badge(store.plan_label(), paid.then(|| cx.theme().colors.primary), cx))
                        .child(
                            Button::new("account-plan", if paid { "Manage Plan" } else { "Upgrade" })
                                .variant(if paid { ButtonVariant::Outline } else { ButtonVariant::Accent })
                                .on_click(move |_, _, cx| cx.open_url(&plan_url)),
                        ),
                    cx,
                ));
                if let Some(usage) = store.subscription().and_then(|subscription| subscription.credits.as_ref()).and_then(CreditUsage::from_credits) {
                    rows.push(widgets::row(
                        "Included AI Credit",
                        Some(match usage.detail {
                            Some(detail) => format!("{} · {detail}", usage.label).into(),
                            None => usage.label.into(),
                        }),
                        div().w(px(160.)).child(widgets::meter(usage.fraction, cx)),
                        cx,
                    ));
                }
            }
            session => {
                let signing_in = store.state().sign_in != SignInFlow::Idle;
                let description: SharedString = match session {
                    Session::Unverified(check) => format!("{} Trying again in {}s.", check.message, check.retry_in.as_secs()).into(),
                    Session::Loading => "Checking your session…".into(),
                    _ => "Sign in for Pro, Athas AI, and settings sync".into(),
                };
                let unverified = matches!(session, Session::Unverified(_));
                let update_retry = update.clone();
                rows.push(widgets::row(
                    "Account",
                    Some(description),
                    div()
                        .flex()
                        .gap(px(6.))
                        .when(unverified, |this| {
                            this.child(
                                Button::new("account-retry", "Retry")
                                    .variant(ButtonVariant::Outline)
                                    .on_click(move |_, _, cx| update_retry(cx, |store, cx| store.retry_session_check(cx))),
                            )
                        })
                        .when(signing_in, |this| {
                            let update = update.clone();
                            this.child(
                                Button::new("account-cancel-sign-in", "Cancel")
                                    .variant(ButtonVariant::Outline)
                                    .on_click(move |_, _, cx| update(cx, |store, cx| store.cancel_sign_in(cx))),
                            )
                        })
                        .child(
                            Button::new("account-sign-in", if signing_in { "Signing In..." } else { "Sign In" })
                                .variant(ButtonVariant::Accent)
                                .disabled(signing_in)
                                .on_click(move |_, _, cx| update(cx, |store, cx| store.sign_in(cx))),
                        ),
                    cx,
                ));
            }
        }
        widgets::section(Some("Account"), rows, cx)
    }

    fn sync_section(&self, allowed: bool, cx: &mut Context<Self>) -> AnyElement {
        let sync = self.sync.as_ref().map(|sync| sync.read(cx));
        let enabled = allowed && sync.is_some_and(SettingsSync::enabled);
        let syncing = sync.is_some_and(SettingsSync::is_syncing);
        let description: SharedString = match sync {
            Some(sync) if sync.status == Status::Error && sync.error.is_some() => sync.error.clone().unwrap_or_default().into(),
            _ if !allowed => "Included with Pro".into(),
            Some(sync) => match &sync.meta().last_synced_at {
                Some(at) => {
                    let when = chrono::DateTime::parse_from_rfc3339(at)
                        .map(|time| time.with_timezone(&chrono::Local).format("%-m/%-d/%Y, %-I:%M:%S %p").to_string())
                        .unwrap_or_else(|_| at.clone());
                    match sync.meta().last_sync_source {
                        Some(source) => format!("Last synced {when} from {}", source.label()).into(),
                        None => format!("Last synced {when}").into(),
                    }
                }
                None => "Sync settings across your devices".into(),
            },
            None => "Sync settings across your devices".into(),
        };
        let this = cx.entity().downgrade();
        let toggle = move |checked: bool, cx: &mut App| {
            this.update(cx, |this, cx| {
                if checked {
                    this.run_sync(SettingsSync::enable, "Cloud settings sync enabled", cx);
                } else if let Some(sync) = this.sync.clone() {
                    sync.update(cx, |sync, cx| sync.disable(cx));
                    notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, "Cloud settings sync disabled", None, None);
                }
            })
            .ok();
        };
        let controls = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .when(enabled, |this| {
                this.child(
                    Button::new("account-sync-now", if syncing { "Syncing..." } else { "Sync Now" })
                        .variant(ButtonVariant::Outline)
                        .disabled(syncing)
                        .on_click(cx.listener(|this, _, _, cx| this.run_sync(SettingsSync::sync_now, "Settings synced to cloud", cx))),
                )
                .child(
                    Button::new("account-sync-restore", "Restore")
                        .variant(ButtonVariant::Outline)
                        .disabled(syncing)
                        .tooltip("Replace this device's settings with the cloud copy")
                        .on_click(cx.listener(|this, _, _, cx| this.run_sync(SettingsSync::restore, "Settings restored from cloud", cx))),
                )
            })
            .child(Switch::new("account-settings-sync", enabled).disabled(!allowed || self.sync.is_none()).on_change(move |checked, _, cx| toggle(checked, cx)));
        widgets::section(Some("Settings Sync"), vec![widgets::row("Cloud Settings Sync", Some(description), controls, cx)], cx)
    }
}

impl Render for AccountSettings {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let urls = crate::urls(cx);
        let Some(store) = self.store.clone() else {
            return div()
                .text_size(typography::text_sm())
                .text_color(cx.theme().colors.muted_foreground)
                .child("Accounts are not available in this build.")
                .into_any_element();
        };
        let (signed_in, allowed, error) = {
            let store = store.read(cx);
            (store.is_signed_in(), store.features().settings_sync, store.state().error.clone())
        };
        let mut sections = vec![self.account_section(store.read(cx), &urls, cx)];
        if signed_in {
            sections.push(self.sync_section(allowed, cx));
        }
        if let Some(error) = error {
            sections.push(div().px(px(12.)).child(widgets::error_text(error, cx)).into_any_element());
        }
        div()
            .flex()
            .flex_col()
            .gap(px(24.))
            .font_family(typography::ui_font())
            .children(sections)
            .into_any_element()
    }
}
