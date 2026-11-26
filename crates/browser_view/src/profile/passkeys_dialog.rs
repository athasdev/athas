//! The passkeys Athas keeps, by site, with a way to delete each one.

use gpui::{App, ClickEvent, Context, DismissEvent, EventEmitter, FocusHandle, Focusable, Window, div, prelude::*};
use ui::{Avatar, Button, ButtonVariant, Dialog, DialogLayout, DialogSize, EmptyState, IconName, Plane, metrics, prelude::*, scale::px};

use super::{passkey::Passkey, passkey_store, sheet::relative_time};

pub struct PasskeysDialog {
    passkeys: Vec<Passkey>,
    error: Option<String>,
    /// The passkey whose delete button asks once more.
    confirming: Option<Vec<u8>>,
    focus_handle: FocusHandle,
}

impl EventEmitter<DismissEvent> for PasskeysDialog {}

impl Focusable for PasskeysDialog {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl PasskeysDialog {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let (passkeys, error) = match passkey_store::all() {
            Ok(passkeys) => (sorted(passkeys), None),
            Err(error) => (Vec::new(), Some(error)),
        };
        Self { passkeys, error, confirming: None, focus_handle: cx.focus_handle() }
    }

    fn delete(&mut self, credential_id: Vec<u8>, cx: &mut Context<Self>) {
        if self.confirming.as_ref() != Some(&credential_id) {
            self.confirming = Some(credential_id);
            cx.notify();
            return;
        }
        self.confirming = None;
        match passkey_store::remove(&credential_id) {
            Ok(()) => self.passkeys.retain(|passkey| passkey.credential_id != credential_id),
            Err(error) => self.error = Some(error),
        }
        cx.notify();
    }
}

/// By site, then by account.
fn sorted(mut passkeys: Vec<Passkey>) -> Vec<Passkey> {
    passkeys.sort_by(|a, b| a.rp_id.cmp(&b.rp_id).then_with(|| a.account_name().to_lowercase().cmp(&b.account_name().to_lowercase())));
    passkeys
}

impl Render for PasskeysDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let entity = cx.entity().downgrade();
        let now = passkey_store::now();
        let mut body = div().flex().flex_col().p(px(8.));
        if self.passkeys.is_empty() {
            body = body.child(
                div().py(px(24.)).child(
                    EmptyState::new("No passkeys yet")
                        .icon(IconName::Key)
                        .message("When a site offers a passkey, Athas keeps it in your keychain and lists it here."),
                ),
            );
        }
        let mut last_site: Option<&str> = None;
        for (index, passkey) in self.passkeys.iter().enumerate() {
            if last_site != Some(passkey.rp_id.as_str()) {
                last_site = Some(passkey.rp_id.as_str());
                body = body.child(
                    div()
                        .px(px(8.))
                        .pt(px(if index == 0 { 4. } else { 12. }))
                        .pb(px(4.))
                        .text_size(typography::text_caption())
                        .font_weight(typography::MEDIUM)
                        .text_color(colors.muted_foreground)
                        .child(passkey.rp_id.clone()),
                );
            }
            let confirming = self.confirming.as_ref() == Some(&passkey.credential_id);
            let credential_id = passkey.credential_id.clone();
            let used = match passkey.last_used_at {
                Some(used) => format!("Used {}", relative_time(used, now)),
                None => format!("Saved {}", relative_time(passkey.created_at, now)),
            };
            let detail = if passkey.display_name.is_empty() || passkey.display_name == passkey.account_name() {
                used
            } else {
                format!("{} · {used}", passkey.display_name)
            };
            let group = format!("passkey-row-{index}");
            let delete = if confirming {
                Button::new(("passkey-delete", index), "Delete").variant(ButtonVariant::Destructive).plane(Plane::Overlay)
            } else {
                Button::icon(("passkey-delete", index), IconName::Trash).tooltip("Delete passkey")
            }
            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.delete(credential_id.clone(), cx)));
            body = body.child(
                div()
                    .id(("passkey-row", index))
                    .group(group.clone())
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .h(px(44.))
                    .px(px(8.))
                    .rounded(metrics::radius_md())
                    .hover(|style| style.bg(colors.accent))
                    .child(Avatar::new(passkey.account_name()).size(px(24.)))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().truncate().font_weight(typography::MEDIUM).child(passkey.account_name().to_string()))
                            .child(div().truncate().text_size(typography::text_caption()).text_color(colors.muted_foreground).child(detail)),
                    )
                    .child(div().flex_none().when(!confirming, |this| this.invisible().group_hover(group, |style| style.visible())).child(delete)),
            );
        }
        Dialog::new("browser-passkeys", "Passkeys")
            .icon(IconName::Key)
            .size(DialogSize::Md)
            .layout(DialogLayout::Flush)
            .track_focus(&self.focus_handle)
            .on_close(move |_, cx| {
                entity.update(cx, |_, cx| cx.emit(DismissEvent)).ok();
            })
            .child(body)
            .children(self.error.clone().map(|error| div().px(px(16.)).pb(px(12.)).text_color(colors.destructive).child(error)))
    }
}
