//! The card that drops over a page when it asks for a passkey: save one, pick the account to sign
//! in with, or say there is none. Continue hands over to Touch ID (Windows Hello), and only then
//! does the page get its answer.

use gpui::{
    AnyElement, App, ClickEvent, Context, DismissEvent, EventEmitter, FocusHandle, Focusable, KeyDownEvent, MouseButton, Window, div,
    prelude::*,
};
use ui::{Avatar, Button, ButtonVariant, Icon, IconName, IconSize, Plane, Spinner, metrics, prelude::*, scale::px};

use super::{
    passkey::{AssertionRequest, CreationRequest, Passkey, WebAuthnError},
    passkey_store,
    verify::{self, Verification},
};
use crate::host::HostRef;

enum Ask {
    Create { request: CreationRequest, replaces: Option<Passkey> },
    Get { request: AssertionRequest, candidates: Vec<Passkey>, selected: usize },
    /// The site already has a passkey from Athas for this account.
    Exists { rp_id: String },
}

/// A request checked and matched against the saved passkeys, ready to show.
pub struct Prepared(Ask);

pub struct PasskeySheet {
    request_id: u64,
    ask: Ask,
    host: HostRef,
    focus_handle: FocusHandle,
    /// Waiting on the system prompt.
    verifying: bool,
    error: Option<String>,
    answered: bool,
}

impl EventEmitter<DismissEvent> for PasskeySheet {}

impl Focusable for PasskeySheet {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl PasskeySheet {
    /// What the sheet asks for a page's request, or the error the page gets at once.
    pub fn prepare(create: bool, page_url: &str, options: &serde_json::Value) -> Result<Prepared, WebAuthnError> {
        let passkeys = passkey_store::all().map_err(|error| WebAuthnError::new("UnknownError", error))?;
        Ok(Prepared(if create {
            let request = CreationRequest::parse(page_url, options)?;
            if request.is_excluded(&passkeys) {
                Ask::Exists { rp_id: request.rp.id.clone() }
            } else {
                let replaces = request.replaces(&passkeys).cloned();
                Ask::Create { request, replaces }
            }
        } else {
            let request = AssertionRequest::parse(page_url, options)?;
            let candidates = request.candidates(&passkeys).into_iter().cloned().collect();
            Ask::Get { request, candidates, selected: 0 }
        }))
    }

    /// A sheet over made-up requests, for headless snapshots (`ATHAS_SNAPSHOT_PASSKEY`).
    #[cfg(debug_assertions)]
    pub fn preview(kind: &str) -> Option<Prepared> {
        use serde_json::json;
        let encode = |bytes: &[u8]| base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes);
        let create = CreationRequest::parse(
            "https://github.com/login",
            &json!({ "rp": { "id": "github.com", "name": "GitHub" }, "user": { "id": encode(b"1"), "name": "octocat", "displayName": "The Octocat" }, "challenge": encode(b"c") }),
        )
        .ok()?;
        match kind {
            "create" => Some(Prepared(Ask::Create { request: create, replaces: None })),
            _ => {
                let now = passkey_store::now();
                let (mut first, _) = create.create(true, now - 86_400 * 3).ok()?;
                first.last_used_at = Some(now - 3600 * 2);
                let (mut second, _) = create.create(true, now - 86_400 * 40).ok()?;
                second.user_name = "athas-bot".into();
                let request = AssertionRequest::parse("https://github.com/session", &json!({ "challenge": encode(b"c") })).ok()?;
                let candidates = if kind == "none" { Vec::new() } else { vec![first, second] };
                Some(Prepared(Ask::Get { request, candidates, selected: 0 }))
            }
        }
    }

    pub fn new(request_id: u64, prepared: Prepared, host: HostRef, cx: &mut Context<Self>) -> Self {
        Self { request_id, ask: prepared.0, host, focus_handle: cx.focus_handle(), verifying: false, error: None, answered: false }
    }

    pub fn request_id(&self) -> u64 {
        self.request_id
    }

    fn site(&self) -> &str {
        match &self.ask {
            Ask::Create { request, .. } => &request.rp.id,
            Ask::Get { request, .. } => &request.rp_id,
            Ask::Exists { rp_id } => rp_id,
        }
    }

    fn answer(&mut self, result: Result<serde_json::Value, WebAuthnError>, cx: &mut Context<Self>) {
        if self.answered {
            return;
        }
        self.answered = true;
        if let Some(native) = &self.host.borrow().native {
            native.resolve_passkey(self.request_id, result);
        }
        cx.emit(DismissEvent);
    }

    /// Turns the page down: the user closed the sheet.
    pub fn cancel(&mut self, cx: &mut Context<Self>) {
        let error = match self.ask {
            Ask::Exists { .. } => WebAuthnError::new("InvalidStateError", "A passkey for this account is already saved."),
            _ => WebAuthnError::not_allowed(),
        };
        self.answer(Err(error), cx);
    }

    fn can_continue(&self) -> bool {
        !self.verifying
            && match &self.ask {
                Ask::Create { .. } => true,
                Ask::Get { candidates, .. } => !candidates.is_empty(),
                Ask::Exists { .. } => false,
            }
    }

    fn confirm(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_continue() {
            if !self.verifying && matches!(self.ask, Ask::Exists { .. } | Ask::Get { .. }) {
                self.cancel(cx);
            }
            return;
        }
        let reason = match &self.ask {
            Ask::Create { request, .. } => format!("save a passkey for {}", request.rp.id),
            Ask::Get { request, .. } => format!("sign in to {}", request.rp_id),
            Ask::Exists { .. } => return,
        };
        self.verifying = true;
        self.error = None;
        cx.notify();
        let verification = verify::verify_user(&reason);
        cx.spawn_in(window, async move |this, cx| {
            let verification = verification.await.unwrap_or(Verification::Cancelled);
            this.update(cx, |this, cx| this.finish(verification, cx)).ok();
        })
        .detach();
    }

    fn finish(&mut self, verification: Verification, cx: &mut Context<Self>) {
        self.verifying = false;
        let verified = match verification {
            Verification::Verified => true,
            Verification::Unavailable => false,
            Verification::Cancelled => {
                cx.notify();
                return;
            }
        };
        let now = passkey_store::now();
        let result = match &self.ask {
            Ask::Create { request, .. } => request.create(verified, now).and_then(|(passkey, response)| {
                passkey_store::add(passkey).map_err(|error| WebAuthnError::new("UnknownError", error))?;
                Ok(response)
            }),
            Ask::Get { request, candidates, selected } => match candidates.get(*selected) {
                Some(passkey) => request.sign(passkey, verified).inspect(|_| passkey_store::mark_used(&passkey.credential_id, now)),
                None => Err(WebAuthnError::not_allowed()),
            },
            Ask::Exists { .. } => return,
        };
        match result {
            Ok(response) => {
                if let Ask::Create { request, .. } = &self.ask {
                    notifications::info(cx, format!("Passkey saved for {}", request.rp.id));
                }
                self.answer(Ok(response), cx);
            }
            // A key that won't save or sign stays on screen, so the user sees why.
            Err(error) => {
                self.error = Some(error.message);
                cx.notify();
            }
        }
    }

    fn select(&mut self, delta: isize, cx: &mut Context<Self>) {
        if let Ask::Get { candidates, selected, .. } = &mut self.ask
            && !candidates.is_empty()
        {
            *selected = (*selected as isize + delta).rem_euclid(candidates.len() as isize) as usize;
            cx.notify();
        }
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event.keystroke.key.as_str() {
            "escape" if !self.verifying => self.cancel(cx),
            "enter" => self.confirm(window, cx),
            "up" => self.select(-1, cx),
            "down" | "tab" => self.select(1, cx),
            _ => return,
        }
        cx.stop_propagation();
    }

    fn title(&self) -> String {
        match &self.ask {
            Ask::Create { .. } => format!("Save a passkey for {}", self.site()),
            Ask::Get { .. } => format!("Sign in to {}", self.site()),
            Ask::Exists { .. } => format!("Already saved for {}", self.site()),
        }
    }

    fn subtitle(&self) -> String {
        let method = verify::method_name();
        match &self.ask {
            Ask::Create { replaces: Some(_), .. } => format!("Replaces the passkey saved for this account. Confirm with {method}."),
            Ask::Create { .. } => format!("Kept in your keychain. Confirm with {method}."),
            Ask::Get { candidates, .. } if candidates.is_empty() => "No passkey saved in Athas for this site.".to_string(),
            Ask::Get { candidates, .. } if candidates.len() == 1 => format!("Confirm with {method}."),
            Ask::Get { .. } => format!("Choose an account, then confirm with {method}."),
            Ask::Exists { .. } => "Athas already has a passkey for this account.".to_string(),
        }
    }

    fn account_row(&self, id: (&'static str, usize), passkey: Option<&Passkey>, name: &str, detail: String, selected: bool, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let index = id.1;
        let selectable = passkey.is_some() && matches!(&self.ask, Ask::Get { candidates, .. } if candidates.len() > 1);
        div()
            .id(id)
            .flex()
            .items_center()
            .gap(px(10.))
            .h(px(48.))
            .px(px(10.))
            .rounded(metrics::radius_md())
            .map(|this| match (selectable, selected) {
                (false, _) => this.bg(colors.surface),
                (true, true) => this.bg(colors.accent),
                (true, false) => this.hover(|style| style.bg(colors.accent)),
            })
            .when(selectable, |this| {
                this.cursor_pointer().on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                    if let Ask::Get { selected, .. } = &mut this.ask {
                        *selected = index;
                    }
                    if event.click_count() > 1 {
                        this.confirm(window, cx);
                    }
                    cx.notify();
                }))
            })
            .child(Avatar::new(name).size(px(28.)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(div().truncate().font_weight(typography::MEDIUM).text_color(colors.foreground).child(name.to_string()))
                    .when(!detail.is_empty(), |this| {
                        this.child(div().truncate().text_size(typography::text_caption()).text_color(colors.muted_foreground).child(detail))
                    }),
            )
            .when(selected && selectable, |this| this.child(Icon::new(IconName::Check).size(IconSize::Small).color(colors.foreground)))
            .into_any_element()
    }

    fn body(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        match &self.ask {
            Ask::Create { request, .. } => {
                let name = if request.user.name.is_empty() { request.user.display_name.clone() } else { request.user.name.clone() };
                let detail = if request.user.display_name != name { request.user.display_name.clone() } else { String::new() };
                Some(self.account_row(("passkey-account", 0), None, &name, detail, false, cx))
            }
            Ask::Get { candidates, selected, .. } if !candidates.is_empty() => {
                let now = passkey_store::now();
                let rows: Vec<AnyElement> = candidates
                    .iter()
                    .enumerate()
                    .map(|(index, passkey)| {
                        let detail = match passkey.last_used_at {
                            Some(used) => format!("Used {}", relative_time(used, now)),
                            None => format!("Saved {}", relative_time(passkey.created_at, now)),
                        };
                        self.account_row(("passkey-account", index), Some(passkey), passkey.account_name(), detail, index == *selected, cx)
                    })
                    .collect();
                Some(div().flex().flex_col().gap(px(4.)).children(rows).into_any_element())
            }
            _ => None,
        }
    }
}

/// "just now", "5 minutes ago", "3 days ago".
pub fn relative_time(then: u64, now: u64) -> String {
    let seconds = now.saturating_sub(then);
    let (value, unit) = match seconds {
        0..60 => return "just now".into(),
        60..3600 => (seconds / 60, "minute"),
        3600..86_400 => (seconds / 3600, "hour"),
        86_400..2_592_000 => (seconds / 86_400, "day"),
        2_592_000..31_536_000 => (seconds / 2_592_000, "month"),
        _ => (seconds / 31_536_000, "year"),
    };
    format!("{value} {unit}{} ago", if value == 1 { "" } else { "s" })
}

impl Render for PasskeySheet {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let viewport = window.viewport_size();
        let closing_only = matches!(&self.ask, Ask::Exists { .. }) || matches!(&self.ask, Ask::Get { candidates, .. } if candidates.is_empty());
        let primary: AnyElement = if closing_only {
            Button::new("passkey-close", "Close").variant(ButtonVariant::Accent).on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.cancel(cx))).into_any_element()
        } else if self.verifying {
            Button::new("passkey-continue", "Continue")
                .variant(ButtonVariant::Accent)
                .disabled(true)
                .leading(Spinner::new("passkey-verifying").compact().color(colors.primary_foreground))
                .into_any_element()
        } else {
            Button::new("passkey-continue", if matches!(self.ask, Ask::Create { .. }) { "Save" } else { "Continue" })
                .variant(ButtonVariant::Accent)
                .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.confirm(window, cx)))
                .into_any_element()
        };
        div()
            .id("passkey-sheet")
            .key_context("PasskeySheet")
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::on_key_down))
            .occlude()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .flex()
            .flex_col()
            .gap(px(14.))
            .w(px(360.).min(viewport.width - px(32.)))
            .p(px(16.))
            .rounded(metrics::overlay_radius())
            .bg(colors.overlay)
            .shadow(theme.shadows.dialog.clone())
            .font_family(typography::ui_font())
            .text_size(typography::text_sm())
            .text_color(colors.foreground)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .justify_center()
                            .size(px(36.))
                            .rounded(metrics::radius_md())
                            .bg(colors.raised)
                            .shadow(theme.shadows.raised.clone())
                            .child(Icon::new(IconName::Key).size(IconSize::Custom(px(18.))).color(colors.foreground)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .min_w_0()
                            .gap(px(2.))
                            .child(div().truncate().text_size(typography::text_base()).font_weight(typography::MEDIUM).child(self.title()))
                            .child(div().text_color(colors.muted_foreground).child(self.subtitle())),
                    ),
            )
            .children(self.body(cx))
            .children(self.error.clone().map(|error| div().text_color(colors.destructive).child(error)))
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(8.))
                    .when(!closing_only, |this| {
                        this.child(
                            Button::new("passkey-cancel", "Cancel")
                                .plane(Plane::Overlay)
                                .disabled(self.verifying)
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.cancel(cx))),
                        )
                    })
                    .child(primary),
            )
    }
}
