//! The Athas account (`features/auth`): desktop sign-in through the browser, the token in the
//! OS keychain, the user, plan, credits and team snapshot, Pro gates, the account menu, the
//! Settings "Account" page and the product feedback dialog.
//!
//! `init` creates the app's `AccountStore` and checks the saved session; views read it with
//! `AccountStore::global(cx)` and re-render through `cx.observe`.
//!
//! # Integrating (the workbench is not changed by this crate)
//!
//! - Start-up (`crates/athas`): `telemetry::install_panic_hook(telemetry::default_store_path())`
//!   early, then after `settings::init`: `account::init(cx)` and
//!   `telemetry::init(cx, telemetry::TelemetryConfig::new(account::urls(cx).api_base, version))`,
//!   then `collaboration::register_commands(cx)`. `account::init` registers
//!   `help.sendProductFeedback` (`SendFeedback`) and `workbench.openBrowserBilling`
//!   (`ManageBilling`) and handles `SignIn`, `SignOut`, `ManageAccount`, `ManageBilling` app-wide.
//! - Activity bar (`workbench/src/activity_bar.rs`, the `account` button): label the avatar with
//!   `account::avatar_name(cx)`; on click build `cx.new(|cx| AccountMenu::new(window, cx))` and
//!   float it like `ui::OpenMenu::render` does (`anchored()` at the button's top-right corner,
//!   `Anchor::BottomLeft`). Drop it on `DismissEvent`; on `AccountMenuEvent::OpenSettings(page)`
//!   call `open_settings_page(page, ..)`, on `AccountMenuEvent::OpenTeam` dispatch
//!   `collaboration::OpenTeam`. Observe `AccountStore::global(cx)` so the avatar follows sign-in.
//! - Settings (`settings_ui`, page `account`): keep one `cx.new(AccountSettings::new)` and one
//!   `cx.new(collaboration::SharingSettings::new)` and push both after the page's rows, as the
//!   `keyboard` page pushes its shortcut list.
//! - Feedback: on `SendFeedback`, `workbench.open_modal(cx.new(|cx| FeedbackDialog::new(version,
//!   window, cx)), ..)`; it emits `DismissEvent` when done.

mod account_menu;
mod account_settings;
pub mod api;
mod feedback;
pub mod linked_accounts;
pub mod gates;
pub mod service_urls;
pub mod settings_sync;
pub mod sign_in;
pub mod state;
mod store;
pub mod token_store;
pub mod widgets;

use std::sync::Arc;

use gpui::{App, actions};

pub use account_menu::{AccountMenu, AccountMenuEvent};
pub use account_settings::AccountSettings;
pub use api::{ApiError, AuthUser, Client, Method, SubscriptionInfo};
pub use feedback::{FeedbackDialog, FeedbackDraft, FeedbackEnvironment, issue_url};
pub use gates::{Capability, CreditUsage, ProFeatures};
pub use service_urls::ServiceUrls;
pub use store::{AccountEvent, AccountStore};
pub use token_store::{KeychainTokenStore, MemoryTokenStore, TokenStore};

actions!(
    account,
    [
        /// Starts the desktop sign-in in the browser.
        SignIn,
        SignOut,
        /// Opens the account dashboard on the website.
        ManageAccount,
        /// Opens plan and billing on the website.
        ManageBilling,
        /// Opens the product feedback dialog (the host opens `FeedbackDialog` as a modal).
        SendFeedback,
    ]
);

/// Creates the account with the keychain token store and the service URLs from the
/// environment, registers the commands, and handles the account actions app-wide.
pub fn init(cx: &mut App) {
    init_with(cx, ServiceUrls::from_env(), Arc::new(KeychainTokenStore));
    settings_sync::SettingsSync::init(cx, settings_sync::default_meta_path());
}

pub fn init_with(cx: &mut App, urls: ServiceUrls, tokens: Arc<dyn TokenStore>) {
    AccountStore::init(cx, urls, tokens);
    keymap::register(cx, "help.sendProductFeedback", SendFeedback);
    keymap::register(cx, "workbench.openBrowserBilling", ManageBilling);
    cx.on_action(|_: &SignIn, cx| with_store(cx, |store, cx| store.sign_in(cx)));
    cx.on_action(|_: &SignOut, cx| with_store(cx, |store, cx| store.sign_out(cx)));
    cx.on_action(|_: &ManageAccount, cx| open_service_url(cx, ServiceUrls::dashboard));
    cx.on_action(|_: &ManageBilling, cx| open_service_url(cx, ServiceUrls::billing));
}

fn with_store(cx: &mut App, update: impl FnOnce(&mut AccountStore, &mut gpui::Context<AccountStore>)) {
    if let Some(store) = AccountStore::global(cx) {
        store.update(cx, update);
    }
}

/// The service URLs in use: the account's, or the defaults before `init`.
pub fn urls(cx: &App) -> ServiceUrls {
    AccountStore::global(cx).map(|store| store.read(cx).urls().clone()).unwrap_or_else(ServiceUrls::from_env)
}

pub fn open_service_url(cx: &mut App, url: fn(&ServiceUrls) -> String) {
    let url = url(&urls(cx));
    cx.open_url(&url);
}

/// Whether the signed-in account may use `capability` (false while signed out).
pub fn allows(cx: &App, capability: Capability) -> bool {
    AccountStore::global(cx).is_some_and(|store| store.read(cx).features().allows(capability))
}

/// What the activity bar's avatar shows: the account's name, or "Account" while signed out.
pub fn avatar_name(cx: &App) -> String {
    AccountStore::global(cx)
        .filter(|store| store.read(cx).is_signed_in())
        .map(|store| store.read(cx).identity().0)
        .unwrap_or_else(|| "Account".to_string())
}
