//! A sidebar resource being dragged (`sidebar-resource-drag.ts`): a pull request, issue, run,
//! release, deployment, commit or diff from the git and GitHub sidebars. Dropped on an editor
//! group it opens there; dropped on the agent composer it goes along as context.

use crate::scale::px;
use gpui::{App, AppContext as _, Context, Entity, IntoElement, ParentElement, Render, SharedString, Styled, Window, div,};
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, metrics, typography};

/// A git worktree (`git-worktree`): dropped on an editor group it opens as the project, dropped
/// on the agent composer its folder goes along as context; `id` is its path.
pub const WORKTREE_KIND: &str = "git-worktree";

/// The tab it opens (`workspace::TabItem::Resource`) and the label the drag shows.
#[derive(Clone, Debug, PartialEq)]
pub struct DraggedResource {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub label: SharedString,
    pub icon: IconName,
}

impl DraggedResource {
    pub fn new(kind: impl Into<String>, id: impl Into<String>, title: impl Into<String>, label: impl Into<SharedString>, icon: IconName) -> Self {
        Self { kind: kind.into(), id: id.into(), title: title.into(), label: label.into(), icon }
    }

    /// The view GPUI draws under the pointer.
    pub fn preview(&self, cx: &mut App) -> Entity<DraggedResourcePreview> {
        let resource = self.clone();
        cx.new(|_| DraggedResourcePreview(resource))
    }
}

pub struct DraggedResourcePreview(DraggedResource);

impl Render for DraggedResourcePreview {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        div()
            .flex()
            .items_center()
            .gap(px(6.))
            .max_w(px(280.))
            .px(px(8.))
            .py(px(2.))
            .rounded(metrics::radius())
            .bg(colors.overlay)
            .shadow(cx.theme().shadows.popover.clone())
            .text_size(typography::text_sm())
            .text_color(colors.foreground)
            .child(Icon::new(self.0.icon).size(IconSize::XSmall).color(colors.muted_foreground))
            .child(div().min_w_0().truncate().child(self.0.label.clone()))
    }
}
