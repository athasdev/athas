//! The bodies of the Source Control footer's lists, as the secondary column draws them.
//!
//! History, stashes, remotes and tags used to open the Command surface — a palette over the
//! whole window for a list that belongs beside the sidebar. They are panels in the secondary
//! column now, the shape Usage, Accounts and Archived take, so the workbench builds the shell
//! (title, actions, hairline) and asks here for what goes in it.
//!
//! A row shows the item and, on hover, the one or two actions worth reaching for without
//! thinking. Clicking it opens that item's own surface, which still holds every action it had.

use gpui::{AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div};
use theme::ActiveTheme;
use ui::scale::px;
use ui::{Button, ButtonSize, EmptyState, Icon, IconName, IconSize, SidebarListItem};

use crate::{GitPanel, GitSection, StashAction, model, view};

/// What the secondary column needs to draw one of these lists.
pub struct SectionBody {
    /// The buttons beside the title.
    pub actions: Vec<AnyElement>,
    /// The search field, when the list has one and it is showing.
    pub filters: Option<AnyElement>,
    pub rows: Vec<AnyElement>,
    /// What shows in place of the rows when there are none.
    pub empty: EmptyState,
}

impl GitPanel {
    pub fn section_body(&self, section: GitSection, cx: &mut Context<Self>) -> SectionBody {
        match section {
            GitSection::History => self.history_body(cx),
            GitSection::Stashes => self.stashes_body(cx),
            GitSection::Remotes => self.remotes_body(cx),
            GitSection::Tags => self.tags_body(cx),
        }
    }

    /// A hover action on one of these rows, which must not also trigger the row.
    fn action(&self, id: String, icon: IconName, tooltip: &str, cx: &mut Context<Self>, run: impl Fn(&mut Self, &mut Context<Self>) + 'static) -> AnyElement {
        Button::icon(SharedString::from(id), icon)
            .size(ButtonSize::XSmall)
            .tooltip(tooltip.to_string())
            .on_click(cx.listener(move |panel, _, _, cx| {
                cx.stop_propagation();
                run(panel, cx);
            }))
            .into_any_element()
    }

    /// Every commit loaded, newest first, with the unpushed ones marked as the sidebar marked
    /// them. One row apiece: the author is already the avatar, and spelling it out underneath
    /// cost every commit a second line to say what the picture says. "Load older commits" sits
    /// at the end rather than a "View more" that opened a palette.
    fn history_body(&self, cx: &mut Context<Self>) -> SectionBody {
        let colors = cx.theme().colors.clone();
        let now = view::now_seconds();
        let (ahead, _) = self.ahead_behind();
        let query = self.history_filter_input.read(cx).text().trim().to_lowercase();
        let matching: Vec<(usize, &crate::repository::Commit)> = self
            .commits
            .iter()
            .enumerate()
            .filter(|(_, commit)| {
                query.is_empty()
                    || commit.summary.to_lowercase().contains(&query)
                    || commit.author.to_lowercase().contains(&query)
                    || commit.hash.to_lowercase().contains(&query)
            })
            .collect();
        let mut rows: Vec<AnyElement> = matching
            .into_iter()
            .map(|(index, commit)| {
                let open = commit.clone();
                let hash = commit.hash.clone();
                let dot = div().flex_none().size(px(6.)).rounded_full().bg(colors.primary);
                SidebarListItem::new(SharedString::from(format!("git-history-{}", commit.hash)), commit.summary.clone())
                    .leading(ui::Avatar::new(&commit.author).size(px(16.)).image(git_diff::avatar::author_avatar(&commit.email, cx)))
                    .indicator((index < ahead).then_some(dot))
                    .trailing(model::relative_date(&commit.date, now))
                    .active(self.open_commit.as_deref() == Some(commit.hash.as_str()))
                    .hover_trailing(self.action(format!("git-history-copy-{hash}"), IconName::Copy, "Copy commit SHA", cx, {
                        let hash = hash.clone();
                        move |panel, cx| panel.copy(hash.clone(), cx)
                    }))
                    .on_click(cx.listener(move |panel, _, _, cx| panel.open_commit(&open, cx)))
                    .into_any_element()
            })
            .collect();
        if self.has_more_commits && query.is_empty() {
            rows.push(
                SidebarListItem::new("git-history-more", "Load older commits")
                    .leading(Icon::new(IconName::ArrowDown).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .on_click(cx.listener(|panel, _, _, cx| panel.load_more_commits(cx)))
                    .into_any_element(),
            );
        }
        let open = self.history_filter_is_open(cx);
        let actions = vec![
            Button::icon("git-history-filter", IconName::Filter)
                .size(ButtonSize::XSmall)
                .active(open)
                .tooltip(if open { "Hide search" } else { "Search commits" })
                .on_click(cx.listener(|panel, _, window, cx| panel.toggle_history_filter(window, cx)))
                .into_any_element(),
        ];
        let filters = open.then(|| {
            div()
                .flex()
                .flex_none()
                .items_center()
                .h(px(28.))
                .px(ui::metrics::sidebar_inset() + px(6.))
                .child(self.history_filter_input.clone())
                .into_any_element()
        });
        let empty = match query.is_empty() {
            true => EmptyState::new("No commits yet").icon(IconName::History),
            false => EmptyState::new("No matching commits").icon(IconName::History),
        };
        SectionBody { actions, filters, rows, empty }
    }

    fn stashes_body(&self, cx: &mut Context<Self>) -> SectionBody {
        let colors = cx.theme().colors.clone();
        let now = view::now_seconds();
        let actions = vec![self.action("git-stash-new".into(), IconName::Plus, "Stash changes", cx, |panel, cx| {
            panel.stash(String::new(), None, cx)
        })];
        let rows = self
            .stashes
            .iter()
            .map(|stash| {
                let index = stash.index;
                let surface = self.stash_surface(stash, cx);
                SidebarListItem::new(SharedString::from(format!("git-stash-{index}")), model::stash_title(&stash.message))
                    .leading(Icon::new(IconName::Stack).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .trailing(model::relative_date(&stash.date, now))
                    .hover_trailing(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(2.))
                            .child(self.action(format!("git-stash-apply-{index}"), IconName::Archive, "Apply", cx, move |panel, cx| {
                                panel.stash_action(StashAction::Apply, index, cx)
                            }))
                            .child(self.action(format!("git-stash-drop-{index}"), IconName::Trash, "Drop", cx, move |panel, cx| {
                                panel.stash_action(StashAction::Drop, index, cx)
                            })),
                    )
                    .on_click(move |_, _, cx| palette::show_command_list(cx, surface.clone()))
                    .into_any_element()
            })
            .collect();
        SectionBody { actions, filters: None, rows, empty: EmptyState::new("No stashes").icon(IconName::Stack).message("Stash what you are not ready to commit.") }
    }

    fn remotes_body(&self, cx: &mut Context<Self>) -> SectionBody {
        let colors = cx.theme().colors.clone();
        let actions = vec![
            self.action("git-remote-fetch-all".into(), IconName::ArrowsClockwise, "Fetch all", cx, |panel, cx| panel.fetch_remote(None, cx)),
            Button::icon("git-remote-add", IconName::Plus)
                .size(ButtonSize::XSmall)
                .tooltip("Add remote…")
                .on_click(cx.listener(|panel, _, window, cx| panel.start_draft(crate::DraftKind::Remote, window, cx)))
                .into_any_element(),
        ];
        let rows = self
            .remotes
            .iter()
            .map(|remote| {
                let name = remote.name.clone();
                let surface = self.remote_surface(remote, cx);
                SidebarListItem::new(SharedString::from(format!("git-remote-{name}")), remote.name.clone())
                    .leading(Icon::new(IconName::Globe).size(IconSize::XSmall).color(colors.subtle_foreground))
                    // The URL beside the name, not under it: a remote is a name and where it
                    // points, and the second line doubled every row's height to say so.
                    .detail(remote.url.clone())
                    .hover_trailing(self.action(format!("git-remote-fetch-{name}"), IconName::ArrowsClockwise, "Fetch", cx, {
                        let name = name.clone();
                        move |panel, cx| panel.fetch_remote(Some(name.clone()), cx)
                    }))
                    .on_click(move |_, _, cx| palette::show_command_list(cx, surface.clone()))
                    .into_any_element()
            })
            .collect();
        SectionBody { actions, filters: None, rows, empty: EmptyState::new("No remotes").icon(IconName::Globe).message("Add one to push and pull.") }
    }

    fn tags_body(&self, cx: &mut Context<Self>) -> SectionBody {
        let colors = cx.theme().colors.clone();
        let now = view::now_seconds();
        let actions = vec![
            Button::icon("git-tag-new", IconName::Plus)
                .size(ButtonSize::XSmall)
                .tooltip("New tag…")
                .on_click(cx.listener(|panel, _, window, cx| panel.start_draft(crate::DraftKind::Tag, window, cx)))
                .into_any_element(),
        ];
        let rows = self
            .tags
            .iter()
            .enumerate()
            .map(|(index, tag)| {
                let name = tag.name.clone();
                let surface = self.tag_surface(tag, self.tags.get(index + 1), cx);
                let mut item = SidebarListItem::new(SharedString::from(format!("git-tag-{name}")), tag.name.clone())
                    .leading(Icon::new(IconName::Tag).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .hover_trailing(self.action(format!("git-tag-copy-{name}"), IconName::Copy, "Copy name", cx, {
                        let name = name.clone();
                        move |panel, cx| panel.copy(name.clone(), cx)
                    }))
                    .on_click(move |_, _, cx| palette::show_command_list(cx, surface.clone()));
                if !tag.date.is_empty() {
                    item = item.trailing(model::relative_date(&tag.date, now));
                }
                if let Some(message) = tag.message.clone().filter(|message| !message.trim().is_empty()) {
                    item = item.detail(message);
                }
                item.into_any_element()
            })
            .collect();
        SectionBody { actions, filters: None, rows, empty: EmptyState::new("No tags").icon(IconName::Tag).message("Tag a commit to mark a release.") }
    }
}
