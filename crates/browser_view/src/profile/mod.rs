//! The browser profile's own data: passkeys Athas keeps for sites, and sign-ins imported from
//! other browsers. `PageProfile` is what a browser tab holds of it: the sheet or dialog open over
//! the page.

mod cbor;
pub mod import;
mod import_dialog;
pub mod passkey;
pub mod passkey_store;
mod passkeys_dialog;
mod sheet;
pub mod verify;

use gpui::{AnyElement, AppContext as _, Context, DismissEvent, Entity, Focusable as _, MouseButton, Subscription, Window, deferred, div, prelude::*};
use serde::Deserialize;
use serde_json::Value;
use ui::{prelude::*, scale::px};

use crate::{host::HostRef, page::BrowserPage};
use import_dialog::{ImportDialog, Imported};
use passkey::WebAuthnError;
use passkeys_dialog::PasskeysDialog;
use sheet::PasskeySheet;

/// The script that hands a page's passkey requests to Athas.
pub const PASSKEY_SCRIPT: &str = include_str!("passkeys.js");

/// A passkey report from a page's script. Pages can send anything; see `passkey` for the checks.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PasskeyMessage {
    Passkey { op: String, request_id: u64, origin: String, options: Value },
    PasskeyCancel { request_id: u64 },
}

enum Overlay {
    Sheet(Entity<PasskeySheet>),
    Import(Entity<ImportDialog>),
    Passkeys(Entity<PasskeysDialog>),
}

#[derive(Default)]
pub struct PageProfile {
    overlay: Option<(Overlay, Vec<Subscription>)>,
}

impl PageProfile {
    /// This build has passkeys and import.
    pub const AVAILABLE: bool = true;

    pub fn is_open(&self) -> bool {
        self.overlay.is_some()
    }

    fn close(&mut self, window: &mut Window, cx: &mut Context<BrowserPage>) {
        if self.overlay.take().is_some() {
            window.focus(&cx.focus_handle(), cx);
            cx.notify();
        }
    }

    fn show<V: Render + gpui::EventEmitter<DismissEvent> + gpui::Focusable>(
        &mut self,
        overlay: Overlay,
        view: &Entity<V>,
        mut subscriptions: Vec<Subscription>,
        window: &mut Window,
        cx: &mut Context<BrowserPage>,
    ) {
        let shown = view.entity_id();
        subscriptions.push(cx.subscribe_in(view, window, move |page: &mut BrowserPage, _, _: &DismissEvent, window, cx| {
            // A sheet that a newer one replaced closes on its own.
            if page.profile.overlay.as_ref().is_some_and(|(overlay, _)| overlay_id(overlay) == shown) {
                page.profile.close(window, cx);
            }
        }));
        window.focus(&view.focus_handle(cx), cx);
        self.overlay = Some((overlay, subscriptions));
        cx.notify();
    }

    /// A page asked for a passkey. The origin it claims must be the webview's own.
    pub fn passkey_request(
        &mut self,
        host: &HostRef,
        request_id: u64,
        create: bool,
        claimed_origin: &str,
        options: &Value,
        window: &mut Window,
        cx: &mut Context<BrowserPage>,
    ) {
        let reject = |error: WebAuthnError| {
            if let Some(native) = &host.borrow().native {
                native.resolve_passkey(request_id, Err(error));
            }
        };
        let Some(page_url) = host.borrow().native.as_ref().and_then(|native| native.url()) else { return };
        let actual_origin = url::Url::parse(&page_url).map(|url| url.origin().ascii_serialization()).unwrap_or_default();
        if actual_origin != claimed_origin {
            reject(WebAuthnError::new("SecurityError", "The request didn't come from this page."));
            return;
        }
        match &self.overlay {
            // The page asks again before the last answer: the newer request wins, as in browsers.
            Some((Overlay::Sheet(sheet), _)) => sheet.update(cx, |sheet, cx| sheet.cancel(cx)),
            Some(_) => {
                reject(WebAuthnError::not_allowed());
                return;
            }
            None => {}
        }
        let prepared = match PasskeySheet::prepare(create, &page_url, options) {
            Ok(prepared) => prepared,
            Err(error) => {
                reject(error);
                return;
            }
        };
        let host = host.clone();
        let sheet = cx.new(|cx| PasskeySheet::new(request_id, prepared, host, cx));
        self.show(Overlay::Sheet(sheet.clone()), &sheet, Vec::new(), window, cx);
    }

    /// Shows a made-up passkey request, for headless snapshots.
    #[cfg(debug_assertions)]
    pub fn preview_sheet(&mut self, host: &HostRef, kind: &str, window: &mut Window, cx: &mut Context<BrowserPage>) {
        let Some(prepared) = PasskeySheet::preview(kind) else { return };
        let host = host.clone();
        let sheet = cx.new(|cx| PasskeySheet::new(0, prepared, host, cx));
        self.show(Overlay::Sheet(sheet.clone()), &sheet, Vec::new(), window, cx);
    }

    /// The page gave up on `request_id`, or left: its sheet goes without an answer.
    pub fn passkey_cancel(&mut self, request_id: Option<u64>, window: &mut Window, cx: &mut Context<BrowserPage>) {
        if let Some((Overlay::Sheet(sheet), _)) = &self.overlay
            && request_id.is_none_or(|id| sheet.read(cx).request_id() == id)
        {
            self.close(window, cx);
        }
    }

    pub fn open_import(&mut self, host: &HostRef, window: &mut Window, cx: &mut Context<BrowserPage>) {
        self.cancel_sheet(cx);
        let host = host.clone();
        let dialog = cx.new(|cx| ImportDialog::new(host, window, cx));
        let imported = cx.subscribe(&dialog, |page: &mut BrowserPage, _, _: &Imported, cx| page.reload(cx));
        self.show(Overlay::Import(dialog.clone()), &dialog, vec![imported], window, cx);
    }

    pub fn open_passkeys(&mut self, window: &mut Window, cx: &mut Context<BrowserPage>) {
        self.cancel_sheet(cx);
        let dialog = cx.new(PasskeysDialog::new);
        self.show(Overlay::Passkeys(dialog.clone()), &dialog, Vec::new(), window, cx);
    }

    fn cancel_sheet(&mut self, cx: &mut Context<BrowserPage>) {
        if let Some((Overlay::Sheet(sheet), _)) = &self.overlay {
            sheet.update(cx, |sheet, cx| sheet.cancel(cx));
        }
    }

    /// The sheet or dialog over the page, dimming it.
    pub fn render(&self, cx: &mut Context<BrowserPage>) -> Option<AnyElement> {
        let (overlay, _) = self.overlay.as_ref()?;
        let scrim = cx.theme().colors.scrim;
        let (view, dismiss): (gpui::AnyView, Option<gpui::AnyEntity>) = match overlay {
            Overlay::Sheet(sheet) => (sheet.clone().into(), None),
            Overlay::Import(dialog) => (dialog.clone().into(), Some(dialog.clone().into())),
            Overlay::Passkeys(dialog) => (dialog.clone().into(), Some(dialog.clone().into())),
        };
        let sheet = dismiss.is_none();
        let page = cx.weak_entity();
        Some(
            deferred(
                div()
                    .id("browser-page-overlay")
                    .absolute()
                    .inset_0()
                    .flex()
                    .flex_col()
                    .items_center()
                    .px(px(16.))
                    .map(|this| if sheet { this.pt(px(56.)) } else { this.justify_center() })
                    .bg(scrim)
                    .occlude()
                    .child(ui::occluder())
                    .when(!sheet, |this| {
                        this.on_mouse_down(MouseButton::Left, move |_, window, cx| {
                            page.update(cx, |page, cx| page.profile.close(window, cx)).ok();
                        })
                    })
                    .child(view),
            )
            .with_priority(2)
            .into_any_element(),
        )
    }
}

fn overlay_id(overlay: &Overlay) -> gpui::EntityId {
    match overlay {
        Overlay::Sheet(view) => view.entity_id(),
        Overlay::Import(view) => view.entity_id(),
        Overlay::Passkeys(view) => view.entity_id(),
    }
}
