//! "Share to web" (`components/share-dialog.tsx`): uploads a session snapshot and copies its
//! link. Public links are free; email and organization links need Pro.

use account::{AccountStore, widgets};
use ui::scale::px;
use gpui::{
    AnyElement, App, ClipboardItem, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, ParentElement, Render,
    SharedString, Styled, Subscription, Window, div, prelude::*,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Switch, TextInput, TextInputEvent, WithScrollbar, typography};

use crate::{
    call::call,
    sharing::{self, Access, CreatedShare, MAX_SHARE_CHARS, ShareDraft, ShareKind, ShareOptions, Visibility},
};

/// Visibility choices as the access editors offer them.
pub fn visibility_picker<V: 'static>(
    id: &'static str,
    selected: Visibility,
    disabled: bool,
    cx: &mut Context<V>,
    on_pick: impl Fn(&mut V, Visibility, &mut Context<V>) + Clone + 'static,
) -> AnyElement {
    div()
        .flex()
        .flex_wrap()
        .gap(px(6.))
        .children(Visibility::CHOICES.into_iter().map(|visibility| {
            let on_pick = on_pick.clone();
            Button::new((id, visibility as u64), visibility.label())
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Small)
                .active(visibility == selected)
                .disabled(disabled)
                .on_click(cx.listener(move |this, _, _, cx| {
                    on_pick(this, visibility, cx);
                    cx.notify();
                }))
        }))
        .into_any_element()
}

/// The organizations a link can be limited to.
pub fn organization_picker<V: 'static>(
    id: &'static str,
    options: &ShareOptions,
    selected: Option<i64>,
    cx: &mut Context<V>,
    on_pick: impl Fn(&mut V, i64, &mut Context<V>) + Clone + 'static,
) -> AnyElement {
    div()
        .flex()
        .flex_wrap()
        .gap(px(6.))
        .children(options.organizations.iter().map(|organization| {
            let on_pick = on_pick.clone();
            let organization_id = organization.id;
            Button::new((id, organization.id as u64), organization.name.clone())
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Small)
                .active(selected == Some(organization.id))
                .on_click(cx.listener(move |this, _, _, cx| {
                    on_pick(this, organization_id, cx);
                    cx.notify();
                }))
        }))
        .into_any_element()
}

pub struct ShareDialog {
    draft: ShareDraft,
    options: Option<ShareOptions>,
    live: bool,
    visibility: Visibility,
    emails: Entity<TextInput>,
    workspace_id: Option<i64>,
    result: Option<CreatedShare>,
    error: Option<String>,
    busy: bool,
    copied: bool,
    /// Sent with the create request so a retry does not make a second link; a new one after
    /// any change.
    request_id: String,
    focus_handle: FocusHandle,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<DismissEvent> for ShareDialog {}

impl Focusable for ShareDialog {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

fn new_request_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl ShareDialog {
    pub fn new(draft: ShareDraft, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let emails = cx.new(|cx| TextInput::new(window, cx).placeholder("alex@example.com, sam@example.com"));
        let subscription = cx.subscribe(&emails, |this, _, event: &TextInputEvent, cx| {
            if let TextInputEvent::Changed(_) = event {
                this.request_id = new_request_id();
                cx.notify();
            }
        });
        let mut dialog = Self {
            draft,
            options: None,
            live: false,
            visibility: Visibility::Public,
            emails,
            workspace_id: None,
            result: None,
            error: None,
            busy: false,
            copied: false,
            request_id: new_request_id(),
            focus_handle: cx.focus_handle(),
            _subscriptions: vec![subscription],
        };
        dialog.load_options(cx);
        dialog
    }

    fn load_options(&mut self, cx: &mut Context<Self>) {
        call(cx, sharing::fetch_options, |this, result, cx| {
            match result {
                Ok(options) => this.options = Some(options),
                Err(error) => this.error = Some(error_message(&error)),
            }
            cx.notify();
        });
    }

    fn access(&self, cx: &App) -> Access {
        Access { visibility: self.visibility, emails: sharing::parse_emails(self.emails.read(cx).text()), workspace_id: self.workspace_id }
    }

    pub fn can_create(&self, cx: &App) -> bool {
        let pro = self.options.as_ref().is_some_and(|options| options.pro);
        let access = self.access(cx);
        !self.draft.content.is_empty()
            && self.draft.content.chars().count() <= MAX_SHARE_CHARS
            && (!access.visibility.is_restricted() || pro)
            && (access.visibility != Visibility::Email || !access.emails.is_empty())
            && (access.visibility != Visibility::Organization || access.workspace_id.is_some())
    }

    fn create(&mut self, cx: &mut Context<Self>) {
        if self.busy || !self.can_create(cx) {
            return;
        }
        self.busy = true;
        self.error = None;
        let body = sharing::create_body(&self.draft, &self.request_id, self.live, &self.access(cx));
        call(cx, move |client, token| sharing::create_share(client, token, &body), |this, result, cx| {
            this.busy = false;
            match result {
                Ok(share) => {
                    cx.write_to_clipboard(ClipboardItem::new_string(share.url.clone()));
                    this.copied = true;
                    this.result = Some(share);
                }
                Err(error) => this.error = Some(error_message(&error)),
            }
            cx.notify();
        });
        cx.notify();
    }

    fn revoke(&mut self, cx: &mut Context<Self>) {
        let Some(result) = &self.result else { return };
        if self.busy {
            return;
        }
        self.busy = true;
        let id = result.id.clone();
        call(cx, move |client, token| sharing::revoke_share(client, token, &id), |this, result, cx| {
            this.busy = false;
            match result {
                Ok(()) => cx.emit(DismissEvent),
                Err(error) => this.error = Some(error.to_string()),
            }
            cx.notify();
        });
        cx.notify();
    }

    fn render_options(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let busy = self.busy;
        let pro = self.options.as_ref().is_some_and(|options| options.pro);
        let mut fields = Vec::new();
        if self.draft.kind != ShareKind::Snippet && self.draft.source_id.is_some() {
            let this = cx.entity().downgrade();
            fields.push(
                div()
                    .flex()
                    .items_start()
                    .gap(px(16.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .gap(px(2.))
                            .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).child("Keep this link up to date"))
                            .child(div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(
                                "New responses and edits appear here while Athas is running. You can pause this in Settings.",
                            )),
                    )
                    .child(Switch::new("share-live", self.live).disabled(busy).on_change(move |live, _, cx| {
                        this.update(cx, |this, cx| {
                            this.live = live;
                            this.request_id = new_request_id();
                            cx.notify();
                        })
                        .ok();
                    }))
                    .into_any_element(),
            );
        }
        let picker = visibility_picker("share-visibility", self.visibility, busy, cx, |this: &mut Self, visibility, _| {
            this.visibility = visibility;
            this.request_id = new_request_id();
        });
        fields.push(widgets::field("Visibility", picker, None, cx));
        if self.visibility.is_restricted() && !pro {
            let pricing = account::urls(cx).pricing();
            fields.push(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child("Email and organization restrictions require Athas Pro."))
                    .child(Button::new("share-pro", "View Pro plan").size(ButtonSize::Small).on_click(move |_, _, cx| cx.open_url(&pricing)))
                    .into_any_element(),
            );
        } else if self.visibility == Visibility::Email {
            fields.push(widgets::field(
                "Allowed emails",
                self.emails.clone(),
                Some("Recipients sign in with Google or GitHub to verify their email.".into()),
                cx,
            ));
        } else if self.visibility == Visibility::Organization
            && let Some(options) = self.options.clone()
        {
            let hint: SharedString =
                if options.organizations.is_empty() { "Join an organization to use this visibility." } else { "Only active members can view this snapshot." }.into();
            let picker = organization_picker("share-organization", &options, self.workspace_id, cx, |this: &mut Self, id, _| {
                this.workspace_id = Some(id);
                this.request_id = new_request_id();
            });
            fields.push(widgets::field("Organization", picker, Some(hint), cx));
        }
        fields
    }
}

fn error_message(error: &account::ApiError) -> String {
    match error {
        account::ApiError::NotAuthenticated => "Sign in to your Athas account in Settings, then reopen Share.".into(),
        error => error.to_string(),
    }
}

impl Render for ShareDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let signed_in = AccountStore::global(cx).is_some_and(|store| store.read(cx).is_signed_in());
        let preview: String = self.draft.content.chars().take(600).collect();
        let mut body = vec![
            div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child("Share a read-only view on athas.dev.").into_any_element(),
            widgets::field(
                "Content",
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).child(self.draft.title.clone()))
                    .child(
                        div()
                            .id("share-preview")
                            .max_h(px(140.))
                            .overflow_y_scroll()
                            .p(px(10.))
                            .rounded(ui::metrics::radius_lg())
                            .bg(colors.field)
                            .border_1()
                            .border_color(colors.border)
                            .text_size(typography::text_caption())
                            .font_family(typography::MONO_FONT)
                            .text_color(colors.muted_foreground)
                            .child(preview)
                            .scrollbar(window, cx),
                    ),
                None,
                cx,
            ),
        ];
        if self.draft.content.is_empty() {
            body.push(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("There is no text to share.").into_any_element());
        }
        if self.draft.content.chars().count() > MAX_SHARE_CHARS {
            body.push(
                div()
                    .text_size(typography::text_sm())
                    .text_color(colors.subtle_foreground)
                    .child("Select less text. Snapshots support up to 500,000 characters.")
                    .into_any_element(),
            );
        }
        match &self.result {
            None => body.extend(self.render_options(cx)),
            Some(result) => body.push(widgets::field(
                "Share link",
                div()
                    .px(px(10.))
                    .py(px(6.))
                    .rounded(ui::metrics::radius_md())
                    .bg(colors.field)
                    .border_1()
                    .border_color(colors.border)
                    .text_size(typography::text_sm())
                    .child(result.url.clone()),
                self.copied.then(|| "Copied to the clipboard.".into()),
                cx,
            )),
        }
        if let Some(error) = &self.error {
            body.push(widgets::error_text(error.clone(), cx));
        } else if !signed_in {
            body.push(widgets::error_text("Sign in to your Athas account in Settings, then reopen Share.", cx));
        }

        let busy = self.busy;
        let footer: Vec<AnyElement> = match &self.result {
            None => vec![
                Button::new("share-cancel", "Cancel").on_click(cx.listener(|_, _, _, cx| cx.emit(DismissEvent))).into_any_element(),
                Button::new("share-create", if busy { "Creating link…" } else { "Create link" })
                    .variant(ButtonVariant::Accent)
                    .disabled(busy || !self.can_create(cx))
                    .on_click(cx.listener(|this, _, _, cx| this.create(cx)))
                    .into_any_element(),
            ],
            Some(result) => {
                let url = result.url.clone();
                let copy = result.url.clone();
                vec![
                    Button::new("share-revoke", "Revoke link")
                        .variant(ButtonVariant::Ghost)
                        .disabled(busy)
                        .on_click(cx.listener(|this, _, _, cx| this.revoke(cx)))
                        .into_any_element(),
                    div().flex_1().into_any_element(),
                    Button::new("share-open", "Open in browser").on_click(move |_, _, cx| cx.open_url(&url)).into_any_element(),
                    Button::new("share-copy", if self.copied { "Copied" } else { "Copy link" })
                        .variant(ButtonVariant::Accent)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()));
                            this.copied = true;
                            cx.notify();
                        }))
                        .into_any_element(),
                ]
            }
        };
        div()
            .id("share-dialog")
            .track_focus(&self.focus_handle)
            .occlude()
            .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" && !this.busy {
                    cx.emit(DismissEvent);
                }
            }))
            .child(widgets::dialog("Share to web", div().flex().flex_col().gap(px(12.)).children(body), footer, cx))
    }
}
