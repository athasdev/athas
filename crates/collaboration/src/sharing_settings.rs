//! Sharing on the Settings "Account & Sync" page (`components/sharing-settings.tsx`): cloud
//! session sync, and every shared link with live updates, copy, access, open and revoke. The
//! access editor (`share-access-dialog.tsx`) opens inline under its row.

use account::{AccountStore, widgets};
use gpui::{
    AnyElement, App, ClipboardItem, Context, Entity, IntoElement, ParentElement, Render, SharedString, Styled, Subscription, Window, div,
    prelude::*, px,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonTone, ButtonVariant, Switch, TextInput, typography};

use crate::{
    call::call,
    share_dialog::{organization_picker, visibility_picker},
    sharing::{self, Access, ShareKind, ShareOptions, SharedItem, Visibility},
};

struct Editing {
    item: SharedItem,
    visibility: Visibility,
    workspace_id: Option<i64>,
    emails: Entity<TextInput>,
}

pub struct SharingSettings {
    options: Option<ShareOptions>,
    error: Option<String>,
    busy: bool,
    editing: Option<Editing>,
    _observe: Option<Subscription>,
}

impl SharingSettings {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let observe = AccountStore::global(cx).map(|store| {
            cx.observe(&store, |this, store, cx| {
                if store.read(cx).is_signed_in() {
                    if this.options.is_none() && !this.busy {
                        this.refresh(cx);
                    }
                } else {
                    this.options = None;
                }
                cx.notify();
            })
        });
        let mut view = Self { options: None, error: None, busy: false, editing: None, _observe: observe };
        view.refresh(cx);
        view
    }

    fn signed_in(cx: &App) -> bool {
        AccountStore::global(cx).is_some_and(|store| store.read(cx).is_signed_in())
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        if !Self::signed_in(cx) {
            return;
        }
        self.busy = true;
        call(cx, sharing::fetch_options, |this, result, cx| {
            this.busy = false;
            match result {
                Ok(options) => this.options = Some(options),
                Err(error) => this.error = Some(error.to_string()),
            }
            cx.notify();
        });
    }

    /// Runs a change, then loads the list again whatever happened.
    fn run(&mut self, cx: &mut Context<Self>, request: impl FnOnce(&account::Client, &str) -> Result<(), account::ApiError> + Send + 'static) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.error = None;
        call(cx, request, |this, result, cx| {
            this.busy = false;
            if let Err(error) = result {
                this.error = Some(error.to_string());
            }
            this.refresh(cx);
            cx.notify();
        });
        cx.notify();
    }

    fn edit(&mut self, item: SharedItem, window: &mut Window, cx: &mut Context<Self>) {
        let emails = cx.new(|cx| {
            let mut input = TextInput::new(window, cx).placeholder("alex@example.com, sam@example.com");
            input.set_text(item.emails.join(", "), cx);
            input
        });
        let visibility = if item.visibility == Visibility::Private { Visibility::Public } else { item.visibility };
        self.editing = Some(Editing { visibility, workspace_id: item.workspace_id, item, emails });
        cx.notify();
    }

    fn save_access(&mut self, cx: &mut Context<Self>) {
        let Some(editing) = self.editing.take() else { return };
        let access = Access { visibility: editing.visibility, emails: sharing::parse_emails(editing.emails.read(cx).text()), workspace_id: editing.workspace_id };
        let (id, revision) = (editing.item.id.clone(), editing.item.revision);
        self.run(cx, move |client, token| sharing::update_share(client, token, &id, revision, sharing::access_changes(&access)).map(|_| ()));
    }

    fn render_editor(&self, editing: &Editing, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let pro = self.options.as_ref().is_some_and(|options| options.pro);
        let mut fields = vec![widgets::field(
            "Who can open this link",
            visibility_picker("access-visibility", editing.visibility, false, cx, |this: &mut Self, visibility, _| {
                if let Some(editing) = &mut this.editing {
                    editing.visibility = visibility;
                }
            }),
            None,
            cx,
        )];
        match editing.visibility {
            Visibility::Email => fields.push(widgets::field("Allowed emails", editing.emails.clone(), None, cx)),
            Visibility::Organization => {
                if let Some(options) = self.options.clone() {
                    let picker = organization_picker("access-organization", &options, editing.workspace_id, cx, |this: &mut Self, id, _| {
                        if let Some(editing) = &mut this.editing {
                            editing.workspace_id = Some(id);
                        }
                    });
                    fields.push(widgets::field("Organization", picker, None, cx));
                }
            }
            _ => {}
        }
        if editing.visibility.is_restricted() && !pro {
            fields.push(div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child("Email and organization access require Athas Pro.").into_any_element());
        }
        div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .px(px(12.))
            .py(px(12.))
            .bg(colors.background)
            .children(fields)
            .child(
                div()
                    .flex()
                    .gap(px(6.))
                    .child(
                        Button::new("access-save", "Save access")
                            .variant(ButtonVariant::Accent)
                            .size(ButtonSize::Small)
                            .disabled(self.busy || (editing.visibility.is_restricted() && !pro))
                            .on_click(cx.listener(|this, _, _, cx| this.save_access(cx))),
                    )
                    .child(Button::new("access-cancel", "Cancel").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| {
                        this.editing = None;
                        cx.notify();
                    }))),
            )
            .into_any_element()
    }

    fn render_item(&self, index: usize, item: &SharedItem, cx: &mut Context<Self>) -> AnyElement {
        let busy = self.busy;
        let urls = account::urls(cx);
        let link = urls.share(&item.id);
        let open = link.clone();
        let mut controls: Vec<AnyElement> = Vec::new();
        if item.source_id.is_some() && item.kind != ShareKind::Snippet {
            let (id, revision) = (item.id.clone(), item.revision);
            let this = cx.entity().downgrade();
            controls.push(
                Switch::new(("share-live", index), item.live)
                    .disabled(busy)
                    .on_change(move |live, _, cx| {
                        let id = id.clone();
                        this.update(cx, |this, cx| {
                            this.run(cx, move |client, token| sharing::update_share(client, token, &id, revision, serde_json::json!({ "live": live })).map(|_| ()))
                        })
                        .ok();
                    })
                    .into_any_element(),
            );
        }
        controls.push(
            Button::new(("share-copy", index), "Copy link")
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Small)
                .disabled(busy)
                .on_click(move |_, _, cx| {
                    cx.write_to_clipboard(ClipboardItem::new_string(link.clone()));
                    notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, "Link copied", None, None);
                })
                .into_any_element(),
        );
        let edit_item = item.clone();
        controls.push(
            Button::new(("share-access", index), "Access")
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Small)
                .disabled(busy)
                .on_click(cx.listener(move |this, _, window, cx| this.edit(edit_item.clone(), window, cx)))
                .into_any_element(),
        );
        controls.push(
            Button::new(("share-open", index), "Open")
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Small)
                .on_click(move |_, _, cx| cx.open_url(&open))
                .into_any_element(),
        );
        let revoke_id = item.id.clone();
        controls.push(
            Button::new(("share-revoke", index), "Revoke")
                .variant(ButtonVariant::Outline)
                .tone(ButtonTone::Danger)
                .size(ButtonSize::Small)
                .disabled(busy)
                .on_click(cx.listener(move |this, _, _, cx| {
                    let id = revoke_id.clone();
                    this.run(cx, move |client, token| sharing::revoke_share(client, token, &id));
                }))
                .into_any_element(),
        );
        let description: SharedString = format!("{} · {}", item.visibility.short_label(), if item.live { "Live" } else { "Snapshot" }).into();
        let editor = self.editing.as_ref().filter(|editing| editing.item.id == item.id).map(|editing| self.render_editor(editing, cx));
        div()
            .flex()
            .flex_col()
            .child(widgets::row(item.title.clone(), Some(description), div().flex().flex_wrap().items_center().gap(px(6.)).children(controls), cx))
            .children(editor)
            .into_any_element()
    }
}

impl Render for SharingSettings {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !Self::signed_in(cx) {
            return div().into_any_element();
        }
        let colors = cx.theme().colors.clone();
        let busy = self.busy;
        let library = account::urls(cx).sharing_library();
        let sessions_enabled = self.options.as_ref().is_some_and(|options| options.sessions_enabled);
        let this = cx.entity().downgrade();
        let cloud = widgets::section(
            Some("Cloud Sessions"),
            vec![
                widgets::row(
                    "Sync Agent Sessions",
                    None,
                    Switch::new("sharing-session-sync", sessions_enabled).disabled(busy || self.options.is_none()).on_change(move |enabled, _, cx| {
                        this.update(cx, |this, cx| this.run(cx, move |client, token| sharing::set_session_sync(client, token, enabled).map(|_| ()))).ok();
                    }),
                    cx,
                ),
                widgets::row(
                    "Web Library",
                    None,
                    Button::new("sharing-library", "Open on web").variant(ButtonVariant::Outline).on_click(move |_, _, cx| cx.open_url(&library)),
                    cx,
                ),
            ],
            cx,
        );
        let items: Vec<SharedItem> =
            self.options.as_ref().map(|options| options.items.iter().filter(|item| item.visibility != Visibility::Private).cloned().collect()).unwrap_or_default();
        let rows: Vec<AnyElement> = match &self.options {
            None => vec![
                div()
                    .px(px(12.))
                    .py(px(12.))
                    .flex()
                    .items_center()
                    .justify_between()
                    .text_size(typography::TEXT_SM)
                    .text_color(if self.error.is_some() { colors.destructive } else { colors.subtle_foreground })
                    .child(self.error.clone().unwrap_or_else(|| "Loading shared items…".into()))
                    .when(self.error.is_some(), |this| {
                        this.child(Button::new("sharing-retry", "Retry").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| {
                            this.error = None;
                            this.refresh(cx);
                        })))
                    })
                    .into_any_element(),
            ],
            Some(_) if items.is_empty() => {
                vec![div().px(px(12.)).py(px(12.)).text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("No shared links").into_any_element()]
            }
            Some(_) => items.iter().enumerate().map(|(index, item)| self.render_item(index, item, cx)).collect(),
        };
        let shared = widgets::section(Some("Shared Items"), rows, cx);
        div()
            .flex()
            .flex_col()
            .gap(px(24.))
            .font_family(typography::UI_FONT)
            .child(cloud)
            .child(shared)
            .when(self.error.is_some() && self.options.is_some(), |this| {
                this.child(div().px(px(12.)).child(widgets::error_text(self.error.clone().unwrap_or_default(), cx)))
            })
            .into_any_element()
    }
}
