//! Archived Sessions, a tab of its own.
//!
//! Archiving is what you do to a session you are done with, so the list of them is long and dull
//! and belongs nowhere near the sessions you are working in. It used to be a section the sidebar
//! unfolded, a page at a time, under everything else. It is a row in the sidebar's footer now,
//! beside Usage and Accounts, and it opens here: every archived session at once, searchable, with
//! checkboxes and one bar of actions for whatever is ticked.

use gpui::{AnyElement, App, Context, IntoElement, ParentElement, SharedString, Styled, Window, div, prelude::*};
use theme::ActiveTheme;
use ui::scale::px;
use ui::{Button, ButtonSize, ButtonTone, ButtonVariant, Checkbox, EmptyState, Icon, IconName, IconSize, SidebarListItem};
use workspace::{SessionId, now_ms, relative_time};

use crate::Workbench;

impl Workbench {
    /// The archived sessions, newest first. Archiving is the last thing that happened to them,
    /// so that is what they are ordered by.
    fn archived_matches(&self) -> Vec<workspace::Session> {
        let mut found: Vec<workspace::Session> = self.state.sessions.iter().filter(|session| session.archived_at.is_some()).cloned().collect();
        found.sort_by_key(|session| std::cmp::Reverse(session.archived_at.unwrap_or(session.last_activity_at)));
        found
    }

    /// The Filter button the panel's heading carries, and the search inside it: the shape the
    /// Sessions list uses, so narrowing a list of sessions is the same gesture wherever it is.
    pub(crate) fn render_archived_filter(&self, cx: &mut Context<Self>) -> impl IntoElement {
        Button::icon("archived-filter", IconName::Filter)
            .size(ButtonSize::Small)
            .plane(ui::Plane::Page)
            .active(self.menu_is_open("archived-filter"))
            .tooltip("Find an archived session")
            .on_click(cx.listener(|this, event: &gpui::ClickEvent, window, cx| {
                let position = event.position();
                this.show_archived_filter_menu(gpui::point(position.x + px(8.), position.y + px(8.)), window, cx);
            }))
    }

    pub(crate) fn show_archived_filter_menu(&mut self, position: gpui::Point<gpui::Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let sessions = self.archived_matches();
        let now = now_ms();
        let weak = cx.weak_entity();
        // The rows a query answers with, wanted twice: once as the menu opens, with every
        // archived session in it, and again for each keystroke. A searchable menu falls back to
        // its own rows while nothing is typed, so opening one built with none at all showed an
        // empty list until you typed -- not what a filter should look like when it opens.
        let rows = move |query: &str| -> Vec<ui::MenuEntry> {
            let query = query.to_lowercase();
            sessions
                .iter()
                .filter(|session| session.title.to_lowercase().contains(&query) || session.agent.to_lowercase().contains(&query))
                .map(|session| {
                    let id = session.id.clone();
                    let weak = weak.clone();
                    ui::MenuItem::new(session.title.clone())
                        .icon(agent_ui::model_vendor::provider_icon(&session.agent))
                        .trailing_text(relative_time(session.archived_at.unwrap_or(session.last_activity_at), now))
                        // Opening one puts it back, as clicking its row does.
                        .on_select(move |window, cx| {
                            let id = id.clone();
                            weak.update(cx, |this, cx| {
                                this.update_state(cx, |state| state.archive_session(&id, false));
                                this.open_session(id, window, cx);
                            })
                            .ok();
                        })
                        .into()
                })
                .collect()
        };
        let all = rows("");
        self.show_menu("archived-filter", all, position, gpui::Anchor::TopRight, window, cx);
        self.make_menu_searchable("archived-filter", "Search archived sessions", "No matching sessions", cx);
        let Some(menu) = self.open_menu.as_ref().filter(|menu| menu.key.as_ref() == "archived-filter") else { return };
        menu.menu.update(cx, move |menu, _| {
            menu.set_query_source(std::rc::Rc::new(move |query: &str, _: &mut Window, _: &mut App| rows(query)));
        });
    }

    /// Asks before throwing the ticked sessions away, as deleting one of them does: deleting
    /// several at once is the last thing that should go without asking.
    fn confirm_delete_selected(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let count = self.archived_selected.len();
        if count == 0 {
            return;
        }
        let what = if count == 1 { "1 session".to_string() } else { format!("{count} sessions") };
        let weak = cx.weak_entity();
        let dialog = ui::AlertDialog::confirm(
            "Delete Sessions",
            format!("Delete {what}? This cannot be undone."),
            ui::ConfirmOptions { confirm_label: "Delete".into(), destructive: true, ..Default::default() },
            move |_, cx| {
                weak.update(cx, |this, cx| this.apply_to_selected(true, cx)).ok();
            },
            cx,
        );
        self.open_modal(dialog, window, cx);
    }

    /// Puts the ticked sessions back, or throws them away, then forgets the ticks.
    fn apply_to_selected(&mut self, delete: bool, cx: &mut Context<Self>) {
        let chosen: Vec<SessionId> = self.archived_selected.iter().cloned().collect();
        if chosen.is_empty() {
            return;
        }
        self.update_state(cx, |state| {
            for id in &chosen {
                match delete {
                    true => state.delete_session(id),
                    false => state.archive_session(id, false),
                }
            }
        });
        self.archived_selected.clear();
        let what = if chosen.len() == 1 { "session".to_string() } else { format!("{} sessions", chosen.len()) };
        notifications::info(cx, if delete { format!("Deleted {what}") } else { format!("Restored {what}") });
        cx.notify();
    }

    pub(crate) fn render_archived_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let sessions = self.archived_matches();
        // A tick on a session the search has hidden still counts: the bar says how many are
        // ticked, not how many of them are on screen.
        let picked = self.archived_selected.len();
        let now = now_ms();

        // The row only appears once something is ticked; narrowing lives in the heading's Filter.
        let filters = (picked > 0).then(|| {
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_end()
                .gap(px(6.))
                .px(px(8.))
                .pb(px(8.))
                .child(
                    Button::new("archived-restore", "Restore")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::XSmall)
                        .on_click(cx.listener(|this, _, _, cx| this.apply_to_selected(false, cx))),
                )
                .child(
                    Button::new("archived-delete", "Delete")
                        .variant(ButtonVariant::Ghost)
                        .tone(ButtonTone::Danger)
                        .size(ButtonSize::XSmall)
                        .on_click(cx.listener(|this, _, window, cx| this.confirm_delete_selected(window, cx))),
                )
                .into_any_element()
        });

        let rows: Vec<AnyElement> = sessions
            .iter()
            .map(|session| {
                let id = session.id.clone();
                let ticked = self.archived_selected.contains(&id);
                let when = session.archived_at.unwrap_or(session.last_activity_at);
                let (open_id, toggle_id) = (id.clone(), id.clone());
                let group = SharedString::from(format!("archived-{}", id.0));
                let toggle = {
                    let weak = cx.weak_entity();
                    move |cx: &mut App| {
                        let id = toggle_id.clone();
                        weak.update(cx, |this: &mut Workbench, cx| {
                            if !this.archived_selected.remove(&id) {
                                this.archived_selected.insert(id);
                            }
                            cx.notify();
                        })
                        .ok();
                    }
                };
                // The tick takes the icon's place rather than sitting beside it: under the
                // pointer, or once the row is ticked. A press on it picks the row instead of
                // opening it.
                let leading = div()
                    .id(SharedString::from(format!("archived-tick-{}", id.0)))
                    // The tick sits exactly where the icon did, so the title does not shift as
                    // the pointer crosses the row.
                    .relative()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(16.))
                    .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(move |_, _, cx| toggle(cx))
                    .map(|this| match ticked {
                        true => this.child(Checkbox::new(SharedString::from(format!("archived-pick-{}", id.0)), true)),
                        false => this
                            .child(
                                div()
                                    .group_hover(group.clone(), |style| style.invisible())
                                    .child(Icon::new(IconName::ChatBubbleText).size(IconSize::XSmall).color(colors.subtle_foreground)),
                            )
                            .child(
                                div()
                                    .absolute()
                                    .invisible()
                                    .group_hover(group.clone(), |style| style.visible())
                                    .child(Checkbox::new(SharedString::from(format!("archived-pick-{}", id.0)), false)),
                            ),
                    });
                div()
                    .group(group)
                    .relative()
                    .child(
                        SidebarListItem::new(SharedString::from(format!("archived-row-{}", id.0)), session.title.clone())
                            .leading(leading)
                            .trailing(relative_time(when, now))
                            .active(ticked)
                            // Opening one puts it back: a session you are reading is not archived.
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let id = open_id.clone();
                                this.update_state(cx, |state| state.archive_session(&id, false));
                                this.open_session(id, window, cx);
                            })),
                    )
                    .into_any_element()
            })
            .collect();

        let detail = (picked > 0).then(|| format!("{picked} selected"));
        let empty = EmptyState::new("Nothing archived").icon(IconName::Archive).message("Sessions you archive are kept here.");
        crate::secondary::panel(
            "archived-panel",
            "Archived",
            detail,
            vec![self.render_archived_filter(cx).into_any_element()],
            filters,
            crate::secondary::list("archived-list", rows, empty, &self.secondary_scroll, cx),
            cx,
        )
    }
}
