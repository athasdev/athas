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
use ui::{Button, ButtonSize, ButtonTone, ButtonVariant, Checkbox, EmptyState, Icon, IconName, IconSize, SidebarListItem, TextInput, typography};
use workspace::{SessionId, now_ms, relative_time};

use crate::Workbench;

impl Workbench {
    /// The archived sessions the search leaves, newest first. Archiving is the last thing that
    /// happened to them, so that is what they are ordered by.
    fn archived_matches(&self, cx: &App) -> Vec<workspace::Session> {
        let query = self.archived_search.as_ref().map(|search| search.read(cx).text().trim().to_lowercase()).unwrap_or_default();
        let mut found: Vec<workspace::Session> = self
            .state
            .sessions
            .iter()
            .filter(|session| session.archived_at.is_some())
            .filter(|session| query.is_empty() || session.title.to_lowercase().contains(&query) || session.agent.to_lowercase().contains(&query))
            .cloned()
            .collect();
        found.sort_by_key(|session| std::cmp::Reverse(session.archived_at.unwrap_or(session.last_activity_at)));
        found
    }

    /// How many sessions are archived, for the sidebar's footer row.
    pub(crate) fn archived_count(&self) -> usize {
        self.state.sessions.iter().filter(|session| session.archived_at.is_some()).count()
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

    /// Its search field, built before the tab draws: `render_group` hands the body a `&self`.
    pub(crate) fn ensure_archived_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.archived_search.is_none() {
            let search = cx.new(|cx| TextInput::new(window, cx).placeholder("Search archived sessions").leading_icon(IconName::Search).clearable());
            // The list follows what is typed.
            cx.observe(&search, |_, _, cx| cx.notify()).detach();
            self.archived_search = Some(search);
        }
    }

    pub(crate) fn render_archived_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(search) = self.archived_search.clone() else { return div().into_any_element() };
        let sessions = self.archived_matches(cx);
        let total = self.archived_count();
        // A tick on a session the search has hidden still counts: the bar says how many are
        // ticked, not how many of them are on screen.
        let picked = self.archived_selected.len();
        let all_shown_picked = !sessions.is_empty() && sessions.iter().all(|session| self.archived_selected.contains(&session.id));
        let now = now_ms();

        // The filter row every panel in this column has: here it is the search, and the tick that
        // takes everything the search left.
        let filters = div()
            .flex()
            .flex_none()
            .flex_col()
            .gap(px(4.))
            .px(px(8.))
            .pb(px(8.))
            .child(search)
            .when(!sessions.is_empty(), |this| {
                let ids: Vec<SessionId> = sessions.iter().map(|session| session.id.clone()).collect();
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .px(px(2.))
                        .child(Checkbox::new("archived-select-all", all_shown_picked).on_change({
                            let weak = cx.weak_entity();
                            move |checked, _, cx| {
                                weak.update(cx, |this: &mut Workbench, cx| {
                                    match checked {
                                        true => this.archived_selected.extend(ids.iter().cloned()),
                                        false => this.archived_selected.retain(|id| !ids.contains(id)),
                                    }
                                    cx.notify();
                                })
                                .ok();
                            }
                        }))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .text_size(typography::text_caption())
                                .text_color(colors.subtle_foreground)
                                .child(if all_shown_picked { "Deselect all" } else { "Select all" }),
                        )
                        .when(picked > 0, |this| {
                            this.child(
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
                                    .on_click(cx.listener(|this, _, _, cx| this.apply_to_selected(true, cx))),
                            )
                        }),
                )
            })
            .into_any_element();

        let rows: Vec<AnyElement> = sessions
            .iter()
            .map(|session| {
                let id = session.id.clone();
                let ticked = self.archived_selected.contains(&id);
                let when = session.archived_at.unwrap_or(session.last_activity_at);
                let (open_id, toggle_id) = (id.clone(), id.clone());
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(Checkbox::new(SharedString::from(format!("archived-pick-{}", id.0)), ticked).on_change({
                        let weak = cx.weak_entity();
                        move |checked, _, cx| {
                            let id = toggle_id.clone();
                            weak.update(cx, |this: &mut Workbench, cx| {
                                match checked {
                                    true => this.archived_selected.insert(id),
                                    false => this.archived_selected.remove(&id),
                                };
                                cx.notify();
                            })
                            .ok();
                        }
                    }))
                    .child(
                        div().flex_1().min_w_0().child(
                            SidebarListItem::new(SharedString::from(format!("archived-row-{}", id.0)), session.title.clone())
                                .leading(Icon::new(IconName::ChatBubbleText).size(IconSize::XSmall).color(colors.subtle_foreground))
                                .trailing(relative_time(when, now))
                                // Opening one puts it back: a session you are reading is not archived.
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    let id = open_id.clone();
                                    this.update_state(cx, |state| state.archive_session(&id, false));
                                    this.open_session(id, window, cx);
                                })),
                        ),
                    )
                    .into_any_element()
            })
            .collect();

        let detail = match (picked, sessions.len() == total) {
            (0, true) => None,
            (0, false) => Some(format!("{} of {total}", sessions.len())),
            (picked, _) => Some(format!("{picked} selected")),
        };
        let empty = match total {
            0 => EmptyState::new("Nothing archived").icon(IconName::Archive).message("Sessions you archive are kept here."),
            _ => EmptyState::new("No matches").icon(IconName::Search).message("No archived session has that in its name."),
        };
        crate::secondary::panel(
            "archived-panel",
            "Archived",
            IconName::Archive,
            detail,
            Vec::new(),
            Some(filters),
            crate::secondary::list("archived-list", rows, empty),
            cx,
        )
    }
}
