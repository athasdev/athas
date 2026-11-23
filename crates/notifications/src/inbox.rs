//! The Inbox: the notification history as a second sidebar beside the main one, opened from the
//! bell in the activity bar. Newest first, filtered by who sent it; a row opens to its full text
//! with Copy and Delete, or runs its action (a pull request, an agent's session).

use std::collections::HashSet;

use ui::scale::px;
use gpui::{
    App, ClipboardItem, Context, DismissEvent, EventEmitter, FocusHandle, Focusable, Hsla, IntoElement, ParentElement,
    SharedString, Styled, Window, div, prelude::*, relative,
};
use theme::ActiveTheme;
use ui::{
    Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, WithScrollbar, metrics,
    pane_actions, typography,
};
use workspace::{now_ms, relative_time};

use crate::{CATEGORIES, Notification, NotificationCategory, NotificationKind, Notifications, category_label, notification_text};

/// How wide the Inbox opens beside the sidebar.
pub fn inbox_width() -> gpui::Pixels { px(320.) }

pub struct InboxPanel {
    focus: FocusHandle,
    category: Option<NotificationCategory>,
    /// The notification whose full text is open.
    open: Option<SharedString>,
    /// Unread when the Inbox opened or arrived while it is open: these keep their dot.
    fresh: HashSet<SharedString>,
    copied: Option<SharedString>,
    _observe: gpui::Subscription,
}

impl EventEmitter<DismissEvent> for InboxPanel {}

impl Focusable for InboxPanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl InboxPanel {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let mut panel = Self {
            focus: cx.focus_handle(),
            category: None,
            open: None,
            fresh: HashSet::new(),
            copied: None,
            _observe: cx.observe_global::<Notifications>(|this: &mut Self, cx| {
                this.take_unread(cx);
                cx.notify();
            }),
        };
        panel.take_unread(cx);
        panel
    }

    /// Notes what is unread as fresh, then marks it read: the Inbox is where it gets seen.
    fn take_unread(&mut self, cx: &mut App) {
        // Read without `default_global`: taking the store mutably counts as a change, which
        // would wake this observer again, forever.
        let unread: Vec<SharedString> =
            cx.try_global::<Notifications>().map(|store| store.items.iter().filter(|item| !item.read).map(|item| item.id.clone()).collect()).unwrap_or_default();
        if unread.is_empty() {
            return;
        }
        self.fresh.extend(unread);
        crate::mark_all_read(cx);
    }

    fn dismiss(&mut self, cx: &mut Context<Self>) {
        cx.emit(DismissEvent);
    }

    fn toggle(&mut self, id: SharedString, cx: &mut Context<Self>) {
        self.open = if self.open.as_ref() == Some(&id) { None } else { Some(id) };
        cx.notify();
    }

    fn copy(&mut self, item: &Notification, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(notification_text(item)));
        let id = item.id.clone();
        self.copied = Some(id.clone());
        cx.notify();
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(std::time::Duration::from_secs(1)).await;
            this.update(cx, |this, cx| {
                if this.copied.as_ref() == Some(&id) {
                    this.copied = None;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    fn render_filters(&self, items: &[Notification], cx: &mut Context<Self>) -> impl IntoElement {
        div().flex().flex_none().items_center().gap(px(2.)).px(px(8.)).pb(px(6.)).children(CATEGORIES.iter().enumerate().map(|(index, (label, category))| {
            let category = *category;
            let count = items.iter().filter(|item| category.is_none_or(|category| item.category == category)).count();
            let label = if count > 0 && category.is_some() { format!("{label} {count}") } else { (*label).to_string() };
            Button::new(("inbox-filter", index), label)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .active(self.category == category)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.category = category;
                    cx.notify();
                }))
        }))
    }

    /// One notification in two lines: what happened, then where it comes from, with its age on
    /// the right. Delete and Open take the age's place under the pointer; a row without an
    /// action opens to its full text and Copy.
    fn render_row(&self, index: usize, item: &Notification, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let colors = cx.theme().colors.clone();
        let open = self.open.as_ref() == Some(&item.id);
        let fresh = self.fresh.contains(&item.id);
        let (icon, color): (IconName, Hsla) = match (item.kind, item.category) {
            (NotificationKind::Error, _) => (IconName::Xcircle, colors.destructive),
            (NotificationKind::Warning, _) => (IconName::WarningCircle, colors.warning),
            (_, NotificationCategory::GitHub) => (IconName::Github, colors.muted_foreground),
            (_, NotificationCategory::Agent) => (IconName::Sparkle, colors.primary),
            (NotificationKind::Success, _) => (IconName::CheckCircle, colors.success),
            (NotificationKind::Info, _) => (IconName::Info, colors.muted_foreground),
        };
        let subtitle: SharedString = item
            .description
            .as_ref()
            .and_then(|description| description.lines().map(str::trim).find(|line| !line.is_empty()).map(|line| SharedString::from(line.to_string())))
            .unwrap_or_else(|| category_label(item.category).into());
        let id = item.id.clone();
        let action = item.action.clone();
        let has_action = action.is_some();
        let age = relative_time(item.created_at, now_ms());
        let deletable = item.category != NotificationCategory::GitHub;
        let copy_item = item.clone();
        let delete_id = item.id.clone();
        let copied = self.copied.as_ref() == Some(&item.id);
        let full_description = item.description.clone().filter(|_| open);

        let icon_box = div()
            .relative()
            .flex_none()
            .size(px(28.))
            .flex()
            .items_center()
            .justify_center()
            .rounded(metrics::radius_md())
            .bg(colors.accent)
            .child(Icon::new(icon).size(IconSize::Small).color(color))
            .when(fresh, |this| {
                this.child(div().absolute().top(px(-2.)).right(px(-2.)).size(px(8.)).rounded_full().bg(colors.primary).border_2().border_color(colors.surface))
            });

        let actions = div()
            .absolute()
            .right(px(6.))
            .top(px(6.))
            .flex()
            .items_center()
            .gap(px(2.))
            .invisible()
            .group_hover("inbox-row", |style| style.visible())
            .when(has_action, |this| this.child(Icon::new(IconName::OpenExternal).size(IconSize::XSmall).color(colors.subtle_foreground)))
            .when(deletable, |this| {
                this.child(
                    Button::icon(("inbox-delete", index), IconName::X)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::XSmall)
                        .tooltip("Delete")
                        .on_click(cx.listener(move |this, _, _, cx| {
                            cx.stop_propagation();
                            crate::remove(cx, &delete_id);
                            this.fresh.remove(&delete_id);
                            cx.notify();
                        })),
                )
            });

        div()
            .id(("inbox-row", index))
            .group("inbox-row")
            .relative()
            .flex()
            .flex_col()
            .px(px(8.))
            .py(px(6.))
            .rounded(metrics::radius_lg())
            .when(open, |this| this.bg(colors.accent.opacity(0.6)))
            .hover(|style| style.bg(colors.accent.opacity(0.6)))
            .on_click(cx.listener(move |this, _, window, cx| match &action {
                Some(action) => (action.handler)(window, cx),
                None => this.toggle(id.clone(), cx),
            }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .min_w_0()
                    .child(icon_box)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .flex()
                                    .items_baseline()
                                    .gap(px(8.))
                                    .min_w_0()
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_w_0()
                                            .truncate()
                                            .text_size(typography::text_sm())
                                            .line_height(px(18.))
                                            .font_weight(if fresh { typography::MEDIUM } else { gpui::FontWeight::NORMAL })
                                            .text_color(colors.foreground)
                                            .child(item.message.clone()),
                                    )
                                    .child(
                                        div()
                                            .flex_none()
                                            .text_size(typography::text_caption())
                                            .text_color(colors.subtle_foreground)
                                            .group_hover("inbox-row", |style| style.invisible())
                                            .child(age),
                                    ),
                            )
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .text_size(typography::text_caption())
                                    .line_height(px(16.))
                                    .text_color(colors.subtle_foreground)
                                    .child(subtitle),
                            ),
                    ),
            )
            .when(open, |this| {
                this.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .pl(px(38.))
                        .pt(px(6.))
                        .children(full_description.map(|description| {
                            div().text_size(typography::text_sm()).line_height(px(18.)).text_color(colors.muted_foreground).child(description)
                        }))
                        .child(
                            div().flex().child(
                                Button::new(("inbox-copy", index), if copied { "Copied" } else { "Copy" })
                                    .leading_icon(if copied { IconName::Check } else { IconName::Copy })
                                    .variant(ButtonVariant::Ghost)
                                    .size(ButtonSize::XSmall)
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        cx.stop_propagation();
                                        this.copy(&copy_item, cx);
                                    })),
                            ),
                        ),
                )
            })
            .child(actions)
    }

    /// Placeholder rows while a source fetches its first list.
    fn render_loading(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let _ = cx;
        div().flex().flex_col().gap(px(2.)).px(px(6.)).children((0..5usize).map(|index| {
            div()
                .flex()
                .items_center()
                .gap(px(12.))
                .px(px(8.))
                .py(px(6.))
                .child(ui::Skeleton::new(("inbox-skeleton-icon", index)).size(px(28.)))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .gap(px(6.))
                        .child(ui::Skeleton::new(("inbox-skeleton-title", index)).h(px(10.)).w(relative(0.45 + 0.1 * (index % 3) as f32)))
                        .child(ui::Skeleton::new(("inbox-skeleton-detail", index)).h(px(8.)).w(relative(0.3 + 0.15 * ((index + 1) % 3) as f32))),
                )
        }))
    }
}

impl Render for InboxPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let items: Vec<Notification> = cx.try_global::<Notifications>().map(|store| store.items.clone()).unwrap_or_default();
        let shown: Vec<&Notification> = items.iter().filter(|item| self.category.is_none_or(|category| item.category == category)).collect();
        let has_local = items.iter().any(|item| item.category != NotificationCategory::GitHub);
        let fresh = items.iter().filter(|item| self.fresh.contains(&item.id)).count();

        let loading = cx.try_global::<Notifications>().is_some_and(|store| store.is_loading(self.category));
        let header = ui::PanelHeader::new("Inbox")
            .when(fresh > 0, |header| header.detail(format!("{fresh} new")))
            .trailing(
                pane_actions()
                    .when(loading && !shown.is_empty(), |this| this.child(ui::Spinner::new("inbox-loading").label("Loading").compact()))
                    .when(has_local, |this| {
                        this.child(
                            Button::icon("inbox-clear", IconName::Trash)
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::Small)
                                .tooltip("Clear local notifications")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    crate::clear(cx);
                                    this.fresh.clear();
                                    this.open = None;
                                    cx.notify();
                                })),
                        )
                    })
            );

        let body = if shown.is_empty() && loading {
            self.render_loading(cx).into_any_element()
        } else if shown.is_empty() {
            let (title, message) = match self.category {
                None => ("You're all caught up", "Agent, GitHub and Athas updates show up here."),
                Some(category) => ("Nothing here", match category {
                    NotificationCategory::Athas => "Saves, updates and other Athas messages show up here.",
                    NotificationCategory::Agent => "Agents that finish or need you show up here.",
                    NotificationCategory::GitHub => "Your pull requests and workflow runs show up here.",
                }),
            };
            div().flex().flex_1().items_center().justify_center().p(px(16.)).child(EmptyState::new(title).icon(IconName::Bell).message(message)).into_any_element()
        } else {
            let rows: Vec<_> = shown.iter().enumerate().map(|(index, item)| self.render_row(index, item, cx).into_any_element()).collect();
            div()
                .id("inbox-list")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .px(metrics::sidebar_inset())
                .pb(px(8.))
                .gap(px(2.))
                .children(rows)
                .scrollbar(window, cx)
                .into_any_element()
        };

        // It is a sidebar tool now, not a panel floating beside one: the sidebar sets the
        // surface, so this takes no island, no rounding and no rule under its header.
        div()
            .id("inbox")
            .flex()
            .flex_col()
            .key_context("Inbox")
            .track_focus(&self.focus)
            .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    this.dismiss(cx);
                    cx.stop_propagation();
                }
            }))
            .size_full()
            .min_h_0()
            .child(header)
            .child(self.render_filters(&items, cx))
            .child(div().flex().flex_col().flex_1().min_h_0().pt(px(4.)).child(body))
    }
}
