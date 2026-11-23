//! The lists under the Source Control sidebar's footer: stashes, remotes, tags and history.
//!
//! They are long and worth searching, so each opens the Command surface
//! (`palette::CommandList`, the original's `GitCommandSurface`) rather than a dropdown. An item
//! with more than one action leads to a surface of its own, so picking never needs a submenu.

use gpui::{Context, SharedString, Window};
use palette::{CommandList, CommandRow};
use ui::IconName;

use crate::{
    DraftKind, GitPanel, StashAction, model,
    repository::{Commit, Remote, Stash, Tag},
    view,
};

impl GitPanel {
    /// A row that calls back into the panel.
    fn row(
        &self,
        label: impl Into<SharedString>,
        icon: IconName,
        cx: &Context<Self>,
        action: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> CommandRow {
        let this = cx.entity().downgrade();
        CommandRow::new(label).icon(icon).on_select(move |window, cx| {
            this.update(cx, |panel, cx| action(panel, window, cx)).ok();
        })
    }

    /// A row that leads to another surface, such as one item's actions.
    fn leads_to(label: impl Into<SharedString>, icon: IconName, list: CommandList) -> CommandRow {
        CommandRow::new(label).icon(icon).on_select(move |_, cx| palette::show_command_list(cx, list.clone()))
    }

    /// Stashes: what is stashed, and what each one can do.
    pub(crate) fn stashes_surface(&self, cx: &Context<Self>) -> CommandList {
        let now = view::now_seconds();
        let mut rows = vec![
            self.row("Stash changes", IconName::Plus, cx, |panel, _, cx| panel.stash(String::new(), None, cx)).section("Stash"),
        ];
        let panel = cx.entity().downgrade();
        for stash in &self.stashes {
            let index = stash.index;
            let (apply, drop) = (panel.clone(), panel.clone());
            rows.push(
                Self::leads_to(model::stash_title(&stash.message), IconName::Stack, self.stash_surface(stash, cx))
                    .section("Stashes")
                    .trailing(model::relative_date(&stash.date, now))
                    .keywords(stash.message.clone())
                    .action(IconName::Archive, "Apply", move |_, cx| {
                        apply.update(cx, |panel, cx| panel.stash_action(StashAction::Apply, index, cx)).ok();
                    })
                    .destructive_action(IconName::Trash, "Drop", move |_, cx| {
                        drop.update(cx, |panel, cx| panel.stash_action(StashAction::Drop, index, cx)).ok();
                    }),
            );
        }
        CommandList::new("Stashes", rows).icon(IconName::Stack).empty("No stashes")
    }

    /// One stash's actions.
    fn stash_surface(&self, stash: &Stash, cx: &Context<Self>) -> CommandList {
        let index = stash.index;
        let rows = vec![
            self.row("Show changes", IconName::GitDiff, cx, move |panel, _, cx| panel.open_stash(index, cx)),
            self.row("Apply", IconName::Archive, cx, move |panel, _, cx| panel.stash_action(StashAction::Apply, index, cx)),
            self.row("Pop", IconName::ArrowUp, cx, move |panel, _, cx| panel.stash_action(StashAction::Pop, index, cx)),
            self.row("Drop", IconName::Trash, cx, move |panel, _, cx| panel.stash_action(StashAction::Drop, index, cx)),
        ];
        CommandList::new(model::stash_title(&stash.message), rows).icon(IconName::Stack).placeholder("Search actions…").empty("No matching action")
    }

    /// Remotes: every remote, and what each one can do.
    pub(crate) fn remotes_surface(&self, cx: &Context<Self>) -> CommandList {
        let mut rows = vec![
            self.row("Add remote…", IconName::Plus, cx, |panel, window, cx| panel.start_draft(DraftKind::Remote, window, cx)).section("Remotes"),
            self.row("Fetch all", IconName::ArrowsClockwise, cx, |panel, _, cx| panel.fetch_remote(None, cx)).section("Remotes"),
        ];
        for remote in &self.remotes {
            let (fetch, name) = (cx.entity().downgrade(), remote.name.clone());
            rows.push(
                Self::leads_to(remote.name.clone(), IconName::Globe, self.remote_surface(remote, cx))
                    .section("Remotes")
                    .description(remote.url.clone())
                    .keywords(remote.url.clone())
                    .action(IconName::ArrowsClockwise, "Fetch", move |_, cx| {
                        fetch.update(cx, |panel, cx| panel.fetch_remote(Some(name.clone()), cx)).ok();
                    }),
            );
        }
        CommandList::new("Remotes", rows).icon(IconName::Globe).empty("No remotes")
    }

    /// One remote's actions.
    fn remote_surface(&self, remote: &Remote, cx: &Context<Self>) -> CommandList {
        let (name, url) = (remote.name.clone(), remote.url.clone());
        let (fetch, copy_url, copy_name, doomed) = (name.clone(), url.clone(), name.clone(), name.clone());
        let rows = vec![
            self.row(format!("Fetch {name}"), IconName::ArrowsClockwise, cx, move |panel, _, cx| panel.fetch_remote(Some(fetch.clone()), cx)),
            self.row("Copy URL", IconName::Copy, cx, move |panel, _, cx| panel.copy(copy_url.clone(), cx)),
            self.row("Copy name", IconName::Copy, cx, move |panel, _, cx| panel.copy(copy_name.clone(), cx)),
            self.row("Remove remote…", IconName::Trash, cx, move |panel, window, cx| {
                let position = window.mouse_position();
                panel.confirm_remove_remote(doomed.clone(), position, window, cx)
            }),
        ];
        CommandList::new(name, rows).icon(IconName::Globe).placeholder("Search actions…").empty("No matching action")
    }

    /// Tags: every tag, newest first, each leading to its actions.
    pub(crate) fn tags_surface(&self, cx: &Context<Self>) -> CommandList {
        let now = view::now_seconds();
        let mut rows =
            vec![self.row("New tag…", IconName::Plus, cx, |panel, window, cx| panel.start_draft(DraftKind::Tag, window, cx)).section("Tags")];
        for (index, tag) in self.tags.iter().enumerate() {
            let previous = self.tags.get(index + 1);
            let (panel, name) = (cx.entity().downgrade(), tag.name.clone());
            let mut row = Self::leads_to(tag.name.clone(), IconName::Tag, self.tag_surface(tag, previous, cx))
                .section("Tags")
                .keywords(tag.commit.clone())
                .action(IconName::Copy, "Copy name", move |_, cx| {
                    panel.update(cx, |panel, cx| panel.copy(name.clone(), cx)).ok();
                });
            if !tag.date.is_empty() {
                row = row.trailing(model::relative_date(&tag.date, now));
            }
            if let Some(message) = tag.message.clone().filter(|message| !message.trim().is_empty()) {
                row = row.description(message);
            }
            rows.push(row);
        }
        CommandList::new("Tags", rows).icon(IconName::Tag).empty("No tags")
    }

    /// One tag's actions, the same ones its menu had.
    fn tag_surface(&self, tag: &Tag, previous: Option<&Tag>, cx: &Context<Self>) -> CommandList {
        let name = tag.name.clone();
        let remote = self.tag_remote();
        let mut rows = Vec::new();
        if let Some(base) = previous.map(|tag| tag.name.clone()) {
            let target = name.clone();
            rows.push(self.row(format!("Compare with {base}"), IconName::History, cx, move |panel, _, cx| {
                panel.compare_tag(base.clone(), target.clone(), cx)
            }));
        }
        let target = name.clone();
        rows.push(self.row("Compare with HEAD", IconName::GitDiff, cx, move |panel, _, cx| panel.compare_tag("HEAD".into(), target.clone(), cx)));
        let target = name.clone();
        rows.push(self.row("Checkout tag", IconName::Tag, cx, move |panel, _, cx| panel.checkout_tag(target.clone(), cx)));
        if let Some(remote) = remote.clone() {
            let (target, push_remote) = (name.clone(), remote.clone());
            rows.push(self.row(format!("Push to {remote}"), IconName::Upload, cx, move |panel, _, cx| {
                panel.push_tag(target.clone(), push_remote.clone(), cx)
            }));
            let (target, delete_remote) = (name.clone(), remote.clone());
            rows.push(self.row(format!("Delete from {remote}"), IconName::X, cx, move |panel, window, cx| {
                let position = window.mouse_position();
                let (doomed, remote) = (target.clone(), delete_remote.clone());
                panel.confirm("delete-remote-tag", format!("Delete {doomed} from {remote}?"), "Delete", position, window, cx, move |panel, cx| {
                    panel.delete_remote_tag(doomed.clone(), remote.clone(), cx)
                })
            }));
        }
        let copy_name = name.clone();
        rows.push(self.row("Copy name", IconName::Copy, cx, move |panel, _, cx| panel.copy(copy_name.clone(), cx)));
        let commit = tag.commit.clone();
        rows.push(self.row("Copy commit SHA", IconName::GitCommit, cx, move |panel, _, cx| panel.copy(commit.clone(), cx)));
        let doomed = name.clone();
        rows.push(self.row("Delete local tag", IconName::Trash, cx, move |panel, window, cx| {
            let position = window.mouse_position();
            let doomed = doomed.clone();
            panel.confirm("delete-tag", format!("Delete tag \"{doomed}\"?"), "Delete", position, window, cx, move |panel, cx| {
                panel.delete_tag(doomed.clone(), cx)
            })
        }));
        CommandList::new(name, rows).icon(IconName::Tag).placeholder("Search actions…").empty("No matching action")
    }

    /// Every commit loaded, to search and open.
    pub(crate) fn history_surface(&self, cx: &Context<Self>) -> CommandList {
        let mut rows: Vec<CommandRow> = self.commits.iter().map(|commit| self.commit_row(commit, cx)).collect();
        if self.has_more_commits {
            rows.push(
                self.row("Load older commits", IconName::ArrowDown, cx, |panel, _, cx| panel.load_more_commits(cx)).section("History"),
            );
        }
        CommandList::new("History", rows).icon(IconName::History).placeholder("Search commits…").empty("No matching commits")
    }

    fn commit_row(&self, commit: &Commit, cx: &Context<Self>) -> CommandRow {
        let open = commit.clone();
        let (panel, hash) = (cx.entity().downgrade(), commit.hash.clone());
        self.row(commit.summary.clone(), IconName::GitCommit, cx, move |panel, _, cx| panel.open_commit(&open, cx))
            .section("History")
            .trailing(model::short_hash(&commit.hash).to_string())
            .description(commit.author.clone())
            .keywords(commit.hash.clone())
            .action(IconName::Copy, "Copy commit SHA", move |_, cx| {
                panel.update(cx, |panel, cx| panel.copy(hash.clone(), cx)).ok();
            })
    }
}

impl GitPanel {
    /// One of the footer's surfaces by name, for the command palette's own entries and the
    /// headless snapshot.
    pub fn command_surface(&self, which: &str, cx: &Context<Self>) -> Option<CommandList> {
        Some(match which {
            "stashes" => self.stashes_surface(cx),
            "remotes" => self.remotes_surface(cx),
            "tags" => self.tags_surface(cx),
            "history" => self.history_surface(cx),
            _ => return None,
        })
    }
}
