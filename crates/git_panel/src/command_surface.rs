//! What one stash, remote or tag can do.
//!
//! The lists themselves are panels in the secondary column now ([`crate::section_panel`]). An
//! item has more actions than a row can hold, so clicking one opens them as a Command surface
//! (`palette::CommandList`, the original's `GitCommandSurface`) -- searchable, and never a
//! submenu to aim at.

use gpui::{Context, SharedString, Window};
use palette::{CommandList, CommandRow};
use ui::IconName;

use crate::{
    GitPanel, StashAction, model,
    repository::{Remote, Stash, Tag},
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



    /// One stash's actions.
    pub(crate) fn stash_surface(&self, stash: &Stash, cx: &Context<Self>) -> CommandList {
        let index = stash.index;
        let rows = vec![
            self.row("Show changes", IconName::GitDiff, cx, move |panel, _, cx| panel.open_stash(index, cx)),
            self.row("Apply", IconName::Archive, cx, move |panel, _, cx| panel.stash_action(StashAction::Apply, index, cx)),
            self.row("Pop", IconName::ArrowUp, cx, move |panel, _, cx| panel.stash_action(StashAction::Pop, index, cx)),
            self.row("Drop", IconName::Trash, cx, move |panel, _, cx| panel.stash_action(StashAction::Drop, index, cx)),
        ];
        CommandList::new(model::stash_title(&stash.message), rows).icon(IconName::Stack).placeholder("Search actions").empty("No matching action")
    }


    /// One remote's actions.
    pub(crate) fn remote_surface(&self, remote: &Remote, cx: &Context<Self>) -> CommandList {
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
        CommandList::new(name, rows).icon(IconName::Globe).placeholder("Search actions").empty("No matching action")
    }


    /// One tag's actions, the same ones its menu had.
    pub(crate) fn tag_surface(&self, tag: &Tag, previous: Option<&Tag>, cx: &Context<Self>) -> CommandList {
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
        CommandList::new(name, rows).icon(IconName::Tag).placeholder("Search actions").empty("No matching action")
    }


}
