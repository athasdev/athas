//! The workbench's model: open projects, agent sessions, the tabs each one keeps, and the layout,
//! with no UI in it, so the desktop app, the web build and tests share it.

pub mod new_project;
mod persistence;
pub mod project_icons;
mod recents;
pub mod team;
mod time;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub use persistence::{FileStore, MAIN_WINDOW, MemoryStore, StateStore, window_file_name};
pub use recents::{MAX_RECENT_PROJECTS, RecentImport, RecentMetadata, RecentProject};
pub use time::{now_ms, relative_time};

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ProjectId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SessionId(pub String);

/// A folder open in Athas: local, over SSH (`remote://`), or in WSL.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub path: String,
    pub last_opened: u64,
    #[serde(default)]
    pub custom_icon: Option<String>,
    /// Folders added to the workspace beside `path` (Add Folder to Workspace).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folders: Vec<String>,
}

impl Project {
    pub fn is_remote(&self) -> bool {
        self.path.starts_with("remote://")
    }

    /// The project's folder, then the folders added to the workspace.
    pub fn roots(&self) -> Vec<String> {
        std::iter::once(self.path.clone()).chain(self.folders.iter().cloned()).collect()
    }
}

/// Where an agent session stands, as its sidebar row shows it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionStatus {
    #[default]
    Idle,
    Running,
    NeedsInput,
    ReviewReady,
    PrOpen,
    Merged,
    Failed,
}

/// The title a session starts with, until the agent or its first prompt names it.
pub const NEW_SESSION_TITLE: &str = "New session";

/// An agent session: a conversation with an agent, in a project or on its own (a chat).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub id: SessionId,
    pub title: String,
    /// The project the session works in; `None` for a chat that belongs to no project.
    pub project: Option<ProjectId>,
    /// The project folder, kept so the session finds its project again after it reopens.
    #[serde(default)]
    pub workspace_path: Option<String>,
    pub agent: String,
    pub created_at: u64,
    pub last_activity_at: u64,
    #[serde(default)]
    pub message_count: u32,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub archived_at: Option<u64>,
    #[serde(default)]
    pub status: SessionStatus,
    #[serde(default)]
    pub unread: bool,
    #[serde(default)]
    pub branch: Option<String>,
}

impl Session {
    /// Whether the session was never used: started, never written in, and still carrying the
    /// title it was made with. Pressing New session and then doing something else leaves one of
    /// these; they are not worth keeping in the history.
    pub fn is_unused(&self) -> bool {
        self.message_count == 0 && self.title.trim() == NEW_SESSION_TITLE && !self.pinned && self.archived_at.is_none() && self.status == SessionStatus::Idle
    }
}

/// What the activity bar picks for the sidebar.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SidebarView {
    #[default]
    Agents,
    Files,
    Git,
    #[serde(rename = "github-prs")]
    GitHub,
    Settings,
    Notifications,
}

impl SidebarView {
    pub const PROJECT_TOOLS: [SidebarView; 3] = [SidebarView::Files, SidebarView::Git, SidebarView::GitHub];

    pub fn title(self) -> &'static str {
        match self {
            SidebarView::Agents => "Agents",
            SidebarView::Files => "Files",
            SidebarView::Git => "Source Control",
            SidebarView::GitHub => "GitHub",
            SidebarView::Settings => "Settings",
            SidebarView::Notifications => "Inbox",
        }
    }
}

/// How long a session holds its place in the sidebar's lists while it is working.
const TOUCH_SETTLE_MS: u64 = 5_000;

/// Who a set of tabs and the dock belong to: a session, or a project's classic view.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "lowercase")]
pub enum Owner {
    Project(ProjectId),
    Session(SessionId),
}

impl Owner {
    fn key(&self) -> String {
        match self {
            Owner::Project(id) => format!("project:{}", id.0),
            Owner::Session(id) => format!("session:{}", id.0),
        }
    }
}

/// What a tab shows.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TabItem {
    Session { id: SessionId },
    File { path: String },
    ProjectDashboard { id: ProjectId },
    Welcome,
    /// A view a tool opens in the centre: a pull request, search results, a database, Docker.
    /// `kind` names the tool's view, `id` what it shows.
    Resource { kind: String, id: String, title: String },
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TabSet {
    pub tabs: Vec<TabItem>,
    pub active: Option<usize>,
    /// How many tabs at the start are pinned; pinned tabs always come first, as the tab strip
    /// draws them (`tab-bar.tsx`).
    #[serde(default)]
    pub pinned: usize,
}

impl TabSet {
    pub fn active_item(&self) -> Option<&TabItem> {
        self.active.and_then(|index| self.tabs.get(index))
    }

    pub fn is_pinned(&self, index: usize) -> bool {
        index < self.pinned.min(self.tabs.len())
    }

    fn open(&mut self, item: TabItem) {
        let index = match self.tabs.iter().position(|tab| *tab == item) {
            Some(index) => index,
            None => {
                let index = self
                    .active
                    .map_or(self.tabs.len(), |active| active + 1)
                    .clamp(self.pinned.min(self.tabs.len()), self.tabs.len());
                self.tabs.insert(index, item);
                index
            }
        };
        self.active = Some(index);
    }

    /// Pins an unpinned tab after the pinned ones, or unpins a pinned one to just after them.
    fn toggle_pinned(&mut self, index: usize) {
        if index >= self.tabs.len() {
            return;
        }
        self.pinned = self.pinned.min(self.tabs.len());
        let active = self.active.and_then(|active| self.tabs.get(active).cloned());
        let target = if self.is_pinned(index) {
            self.pinned -= 1;
            self.pinned
        } else {
            self.pinned += 1;
            self.pinned - 1
        };
        let item = self.tabs.remove(index);
        self.tabs.insert(target, item);
        self.active = active.and_then(|active| self.tabs.iter().position(|tab| *tab == active));
    }

    /// Moves a tab in front of the tab at `before` (the end when past it), keeping pinned tabs
    /// first: a tab stays on its side of the pinned ones.
    fn move_before(&mut self, index: usize, before: usize) {
        if index >= self.tabs.len() {
            return;
        }
        let active = self.active.and_then(|active| self.tabs.get(active).cloned());
        let pinned = self.pinned.min(self.tabs.len());
        let was_pinned = index < pinned;
        let item = self.tabs.remove(index);
        let before = if before > index { before - 1 } else { before };
        let target = if was_pinned { before.min(pinned - 1) } else { before.clamp(pinned, self.tabs.len()) };
        self.tabs.insert(target.min(self.tabs.len()), item);
        self.active = active.and_then(|active| self.tabs.iter().position(|tab| *tab == active));
    }

    fn close(&mut self, index: usize) {
        if index >= self.tabs.len() {
            return;
        }
        if self.is_pinned(index) {
            self.pinned -= 1;
        }
        self.tabs.remove(index);
        self.active = match self.active {
            _ if self.tabs.is_empty() => None,
            Some(active) if active > index => Some(active - 1),
            Some(active) if active == index => Some(index.min(self.tabs.len() - 1)),
            other => other,
        };
    }
}

/// Which way a split lays its two sides.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitAxis {
    /// Side by side.
    Horizontal,
    /// One above the other.
    Vertical,
}

/// The editor area as a tree of splits; each leaf is a group of tabs (`panes/pane.store.ts`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PaneNode {
    Group { id: u64 },
    Split { id: u64, axis: SplitAxis, ratio: f32, first: Box<PaneNode>, second: Box<PaneNode> },
}

impl PaneNode {
    fn replace_group(&mut self, group: u64, with: PaneNode) -> bool {
        match self {
            PaneNode::Group { id } if *id == group => {
                *self = with;
                true
            }
            PaneNode::Group { .. } => false,
            PaneNode::Split { first, second, .. } => {
                first.replace_group(group, with.clone()) || second.replace_group(group, with)
            }
        }
    }

    /// Takes a group out, letting its sibling take the split's place.
    fn remove_group(&mut self, group: u64) -> bool {
        let PaneNode::Split { first, second, .. } = self else { return false };
        if matches!(**first, PaneNode::Group { id } if id == group) {
            *self = (**second).clone();
            return true;
        }
        if matches!(**second, PaneNode::Group { id } if id == group) {
            *self = (**first).clone();
            return true;
        }
        first.remove_group(group) || second.remove_group(group)
    }

    fn set_ratio(&mut self, split: u64, value: f32) {
        if let PaneNode::Split { id, ratio, first, second, .. } = self {
            if *id == split {
                *ratio = value.clamp(0.1, 0.9);
            } else {
                first.set_ratio(split, value);
                second.set_ratio(split, value);
            }
        }
    }

    /// The outermost split's id, if the node is split.
    pub fn split_id(&self) -> Option<u64> {
        match self {
            PaneNode::Split { id, .. } => Some(*id),
            PaneNode::Group { .. } => None,
        }
    }

    pub fn group_ids(&self) -> Vec<u64> {
        match self {
            PaneNode::Group { id } => vec![*id],
            PaneNode::Split { first, second, .. } => {
                let mut ids = first.group_ids();
                ids.extend(second.group_ids());
                ids
            }
        }
    }
}

/// The ratio a focused split handle takes for a key (`pane-resize-handle.tsx`): arrows move it by
/// 2% (10% with Shift), Home and End to either limit, Enter back to even; `None` for other keys.
pub fn split_ratio_for_key(ratio: f32, key: &str, shift: bool, horizontal: bool) -> Option<f32> {
    let (backward, forward) = if horizontal { ("left", "right") } else { ("up", "down") };
    let step = if shift { 0.1 } else { 0.02 };
    let next = match key {
        "enter" => 0.5,
        "home" => 0.,
        "end" => 1.,
        key if key == backward => ratio - step,
        key if key == forward => ratio + step,
        _ => return None,
    };
    Some(next.clamp(0.1, 0.9))
}

/// Where a tab dragged over a group lands (`pane-drop-zones.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DropZone {
    Left,
    Right,
    Top,
    Bottom,
    Center,
}

impl DropZone {
    /// The zone under a point at `x`, `y` as fractions of the group's width and height: the
    /// outer quarter of each side splits, the middle moves the tab in.
    pub fn at(x: f32, y: f32) -> Self {
        let threshold = 0.25;
        if x < threshold && x < y && x < 1. - y {
            DropZone::Left
        } else if x > 1. - threshold && 1. - x < y && 1. - x < 1. - y {
            DropZone::Right
        } else if y < threshold {
            DropZone::Top
        } else if y > 1. - threshold {
            DropZone::Bottom
        } else {
            DropZone::Center
        }
    }

    /// The split a drop on this zone makes, and whether the new group goes first.
    pub fn split(self) -> Option<(SplitAxis, bool)> {
        match self {
            DropZone::Left => Some((SplitAxis::Horizontal, true)),
            DropZone::Right => Some((SplitAxis::Horizontal, false)),
            DropZone::Top => Some((SplitAxis::Vertical, true)),
            DropZone::Bottom => Some((SplitAxis::Vertical, false)),
            DropZone::Center => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PaneGroup {
    pub id: u64,
    pub tabs: TabSet,
    /// A locked group keeps its tabs: new ones open in another group (`toggleEditorGroupLock`).
    #[serde(default)]
    pub locked: bool,
}

/// The tab groups a session or project keeps, and how they are split.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Panes {
    pub groups: Vec<PaneGroup>,
    pub root: PaneNode,
    /// The group new tabs open in and keys go to.
    pub active: u64,
    next_id: u64,
}

impl Default for Panes {
    fn default() -> Self {
        Self::starting_at(0)
    }
}

/// Where the bottom pane's group ids start, so they never meet the centre's.
pub const BOTTOM_GROUP_BASE: u64 = 1 << 40;

/// A direction to move between editor groups.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Left,
    Right,
    Up,
    Down,
}

impl Panes {
    /// One empty group, numbered from `base`.
    pub fn starting_at(base: u64) -> Self {
        Self {
            groups: vec![PaneGroup { id: base, tabs: TabSet::default(), locked: false }],
            root: PaneNode::Group { id: base },
            active: base,
            next_id: base + 1,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.groups.iter().all(|group| group.tabs.tabs.is_empty())
    }

    /// The group next to `group` in `direction` (`getAdjacentPane`): the nearest one whose edge
    /// faces it, the one sharing the longest stretch of that edge on a tie.
    pub fn adjacent_group(&self, group: u64, direction: Direction) -> Option<u64> {
        fn visit(node: &PaneNode, rect: [f32; 4], out: &mut Vec<(u64, [f32; 4])>) {
            match node {
                PaneNode::Group { id } => out.push((*id, rect)),
                PaneNode::Split { axis, ratio, first, second, .. } => {
                    let [left, top, right, bottom] = rect;
                    match axis {
                        SplitAxis::Horizontal => {
                            let x = left + (right - left) * ratio;
                            visit(first, [left, top, x, bottom], out);
                            visit(second, [x, top, right, bottom], out);
                        }
                        SplitAxis::Vertical => {
                            let y = top + (bottom - top) * ratio;
                            visit(first, [left, top, right, y], out);
                            visit(second, [left, y, right, bottom], out);
                        }
                    }
                }
            }
        }
        let mut rects = Vec::new();
        visit(&self.root, [0., 0., 100., 100.], &mut rects);
        let [left, top, right, bottom] = rects.iter().find(|(id, _)| *id == group)?.1;
        let overlap = |a: f32, b: f32, c: f32, d: f32| (b.min(d) - a.max(c)).max(0.);
        let epsilon = 0.001;
        let mut best: Option<(u64, f32, f32)> = None;
        for (id, [l, t, r, b]) in rects.iter().copied().filter(|(id, _)| *id != group) {
            let (distance, shared) = match direction {
                Direction::Left if r <= left + epsilon => (left - r, overlap(top, bottom, t, b)),
                Direction::Right if l >= right - epsilon => (l - right, overlap(top, bottom, t, b)),
                Direction::Up if b <= top + epsilon => (top - b, overlap(left, right, l, r)),
                Direction::Down if t >= bottom - epsilon => (t - bottom, overlap(left, right, l, r)),
                _ => continue,
            };
            if shared <= 0. {
                continue;
            }
            if best.is_none_or(|(_, best_distance, best_shared)| distance < best_distance || (distance == best_distance && shared > best_shared)) {
                best = Some((id, distance, shared));
            }
        }
        best.map(|(id, _, _)| id)
    }

    pub fn group(&self, id: u64) -> Option<&PaneGroup> {
        self.groups.iter().find(|group| group.id == id)
    }

    fn group_mut(&mut self, id: u64) -> Option<&mut PaneGroup> {
        self.groups.iter_mut().find(|group| group.id == id)
    }

    pub fn active_set(&self) -> &TabSet {
        &self.group(self.active).unwrap_or(&self.groups[0]).tabs
    }

    fn active_set_mut(&mut self) -> &mut TabSet {
        let active = if self.group(self.active).is_some() { self.active } else { self.groups[0].id };
        &mut self.group_mut(active).expect("the active group exists").tabs
    }

    /// Opens `item` in the active group; when that group is locked, in the group that already
    /// shows it, else the first unlocked group, else a new group beside it.
    fn open(&mut self, item: TabItem) {
        let active_locked = self.group(self.active).is_some_and(|group| group.locked);
        if active_locked {
            let target = self
                .groups
                .iter()
                .find(|group| group.tabs.tabs.contains(&item))
                .or_else(|| self.groups.iter().find(|group| !group.locked))
                .map(|group| group.id);
            match target {
                Some(id) => self.active = id,
                None => {
                    self.split(SplitAxis::Horizontal);
                    self.active_set_mut().tabs.clear();
                    self.active_set_mut().active = None;
                }
            }
        }
        self.active_set_mut().open(item);
    }

    /// Gives every split an even share again (`distributePaneSplit`).
    fn reset_ratios(&mut self) {
        fn reset(node: &mut PaneNode) {
            if let PaneNode::Split { ratio, first, second, .. } = node {
                *ratio = 0.5;
                reset(first);
                reset(second);
            }
        }
        reset(&mut self.root);
    }

    /// Closes a group, moving its tabs into the group that takes its place.
    fn close_group(&mut self, id: u64) -> bool {
        if self.groups.len() <= 1 || self.group(id).is_none() {
            return false;
        }
        let order = self.root.group_ids();
        let position = order.iter().position(|group| *group == id).unwrap_or(0);
        if !self.root.remove_group(id) {
            return false;
        }
        let closing = self.groups.iter().position(|group| group.id == id).map(|index| self.groups.remove(index));
        let remaining = self.root.group_ids();
        let fallback = remaining.get(position.saturating_sub(1).min(remaining.len().saturating_sub(1))).copied().unwrap_or(0);
        let was_active = self.active == id;
        if let Some(closing) = closing
            && let Some(target) = self.group_mut(fallback)
        {
            let active = closing.tabs.active_item().cloned();
            for item in closing.tabs.tabs {
                if !target.tabs.tabs.contains(&item) {
                    target.tabs.tabs.push(item);
                }
            }
            if let Some(active) = active.filter(|_| was_active) {
                target.tabs.active = target.tabs.tabs.iter().position(|tab| *tab == active);
            }
        }
        if self.active == id || self.group(self.active).is_none() {
            self.active = fallback;
        }
        true
    }

    /// Moves the active group's tab in front to the next or previous group, wrapping around.
    fn move_active_tab(&mut self, forward: bool) -> bool {
        let order = self.root.group_ids();
        if order.len() <= 1 {
            return false;
        }
        let Some(position) = order.iter().position(|group| *group == self.active) else { return false };
        let target = order[(position + if forward { 1 } else { order.len() - 1 }) % order.len()];
        let source = self.active;
        let Some(index) = self.active_set().active else { return false };
        let Some(item) = self.active_set().tabs.get(index).cloned() else { return false };
        self.active_set_mut().close(index);
        if let Some(group) = self.group_mut(target) {
            group.tabs.open(item);
        }
        self.active = target;
        if self.group(source).is_some_and(|group| group.tabs.tabs.is_empty()) {
            self.prune_empty();
        }
        true
    }

    /// Splits the active group, opening its tab in front in the new group beside it.
    fn split(&mut self, axis: SplitAxis) -> u64 {
        let id = self.next_id;
        let split_id = self.next_id + 1;
        self.next_id += 2;
        let mut tabs = TabSet::default();
        // A session has one view, so it stays on its side; files and tools open on both.
        if let Some(item) = self.active_set().active_item().cloned()
            && !matches!(item, TabItem::Session { .. })
        {
            tabs.open(item);
        }
        self.groups.push(PaneGroup { id, tabs, locked: false });
        let active = self.active;
        self.root.replace_group(
            active,
            PaneNode::Split {
                id: split_id,
                axis,
                ratio: 0.5,
                first: Box::new(PaneNode::Group { id: active }),
                second: Box::new(PaneNode::Group { id }),
            },
        );
        self.active = id;
        id
    }

    /// Moves a tab into a new group split off `target` on one side (`getPaneSplitDropOptions`):
    /// before puts the new group left of or above it.
    fn split_with_tab(&mut self, from: u64, index: usize, target: u64, axis: SplitAxis, before: bool) -> bool {
        if self.group(target).is_none() || (from == target && self.group(from).is_some_and(|group| group.tabs.tabs.len() <= 1)) {
            return false;
        }
        let Some(source) = self.group_mut(from) else { return false };
        let Some(item) = source.tabs.tabs.get(index).cloned() else { return false };
        source.tabs.close(index);
        let id = self.next_id;
        let split_id = self.next_id + 1;
        self.next_id += 2;
        let mut tabs = TabSet::default();
        tabs.open(item);
        self.groups.push(PaneGroup { id, tabs, locked: false });
        let (first, second) = if before { (id, target) } else { (target, id) };
        self.root.replace_group(
            target,
            PaneNode::Split {
                id: split_id,
                axis,
                ratio: 0.5,
                first: Box::new(PaneNode::Group { id: first }),
                second: Box::new(PaneNode::Group { id: second }),
            },
        );
        self.active = id;
        self.prune_empty();
        true
    }

    /// Removes groups that emptied, keeping at least one.
    fn prune_empty(&mut self) {
        let empty: Vec<u64> = self.groups.iter().filter(|group| group.tabs.tabs.is_empty()).map(|group| group.id).collect();
        for id in empty {
            if self.groups.len() == 1 {
                break;
            }
            if self.root.remove_group(id) {
                self.groups.retain(|group| group.id != id);
                if self.active == id {
                    self.active = self.root.group_ids().first().copied().unwrap_or(0);
                }
            }
        }
    }

    fn all_tabs(&self) -> impl Iterator<Item = &TabItem> {
        self.groups.iter().flat_map(|group| group.tabs.tabs.iter())
    }
}

/// The workbench's columns and what each shows.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Layout {
    pub sidebar_visible: bool,
    pub sidebar_width: f32,
    /// The Inbox beside the sidebar, while open.
    pub inbox_width: f32,
    pub sidebar_view: SidebarView,
    pub dock_hidden: bool,
    pub dock_width: f32,
    pub bottom_pane_visible: bool,
    pub bottom_pane_height: f32,
    /// What the bottom pane shows (`bottomPaneActiveTab`).
    pub bottom_tab: BottomTab,
    pub archived_expanded: bool,
}

/// What a project remembers of the layout (`ProjectUiSession`); a project seen for the first time
/// gets the defaults (`DEFAULT_PROJECT_UI_STATE`): sidebar shown, bottom pane hidden on Terminal.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUi {
    pub sidebar_visible: bool,
    pub bottom_pane_visible: bool,
    pub bottom_tab: BottomTab,
}

impl Default for ProjectUi {
    fn default() -> Self {
        Self { sidebar_visible: true, bottom_pane_visible: false, bottom_tab: BottomTab::Terminal }
    }
}

impl ProjectUi {
    fn of(layout: &Layout) -> Self {
        Self { sidebar_visible: layout.sidebar_visible, bottom_pane_visible: layout.bottom_pane_visible, bottom_tab: layout.bottom_tab }
    }

    fn apply(self, layout: &mut Layout) {
        layout.sidebar_visible = self.sidebar_visible;
        layout.bottom_pane_visible = self.bottom_pane_visible;
        layout.bottom_tab = self.bottom_tab;
    }
}

/// The bottom pane's content: the terminals, the debugger, or editor tabs moved down there.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BottomTab {
    #[default]
    Terminal,
    Debugger,
    Buffers,
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            sidebar_visible: true,
            sidebar_width: 220.,
            inbox_width: 320.,
            sidebar_view: SidebarView::Agents,
            dock_hidden: false,
            dock_width: 420.,
            bottom_pane_visible: false,
            bottom_pane_height: 320.,
            bottom_tab: BottomTab::Terminal,
            archived_expanded: false,
        }
    }
}

pub const STATE_VERSION: u32 = 1;

/// Everything the workbench restores when it opens again.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspaceState {
    pub version: u32,
    /// Open projects, in the order the switcher lists them.
    pub projects: Vec<Project>,
    pub active_project: Option<ProjectId>,
    pub recent_projects: Vec<RecentProject>,
    pub sessions: Vec<Session>,
    /// What the centre shows: a session, or the active project's classic view.
    pub focus: Option<Owner>,
    #[serde(rename = "panes")]
    tab_sets: HashMap<String, Panes>,
    pub layout: Layout,
    next_id: u64,
    /// Tabs closed most recently, newest last, for Reopen Closed Tab.
    #[serde(skip)]
    closed_tabs: Vec<(Owner, TabItem)>,
    /// Where each file was left, by path, so it reopens there (`workspace-session-buffer-restore.ts`).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub editor_views: HashMap<String, EditorView>,
    /// Tabs of closed projects, by folder, oldest first, so a project opens again with the files
    /// it had (`buffer-session-persistence.ts`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    closed_project_tabs: Vec<(String, Panes)>,
    /// The file every window keeps closed projects' tabs in, so a project closed in one window
    /// opens with its tabs in another (the original's session store is shared by all windows).
    #[serde(skip)]
    shared_closed_tabs: Option<std::path::PathBuf>,
    /// The sidebar and bottom pane as each project left them, by folder, so switching projects
    /// brings its own back (`workspace-ui-session.ts`).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    project_ui: HashMap<String, ProjectUi>,
    /// The bottom pane's own editor groups (`bottomRoot`), shown when its Buffers tab is.
    pub bottom: Panes,
    /// Whether the bottom pane's groups take new tabs and the tab keys, instead of the centre's.
    pub bottom_focused: bool,
    /// How terminal editor tabs started, by tab id, oldest first, so they start again the same
    /// way on the next launch (`TerminalBufferSession`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    terminal_tabs: Vec<(String, TerminalTab)>,
}

/// The folder and command a terminal editor tab started with.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalTab {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

/// Terminal editor tabs whose start is remembered at most.
const MAX_TERMINAL_TABS: usize = 100;

/// Closed projects whose tabs are remembered at most.
const MAX_CLOSED_PROJECT_TABS: usize = 30;

fn read_closed_tabs(file: &std::path::Path) -> Vec<(String, Panes)> {
    std::fs::read_to_string(file).ok().and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default()
}

fn write_closed_tabs(file: &std::path::Path, mut tabs: Vec<(String, Panes)>) {
    let excess = tabs.len().saturating_sub(MAX_CLOSED_PROJECT_TABS);
    tabs.drain(..excess);
    let Ok(json) = serde_json::to_string(&tabs) else { return };
    if let Err(error) = FileStore::new(file).save(&json) {
        eprintln!("workspace: could not save {}: {error:#}", file.display());
    }
}

/// The caret and scroll of a file as it was left.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct EditorView {
    /// Byte offset of the caret.
    pub cursor: usize,
    /// Pixels scrolled down.
    pub scroll: f32,
    /// When it was recorded, in recording order, so the oldest go first.
    #[serde(default)]
    pub order: u64,
}

/// Files whose view is remembered at most.
const MAX_EDITOR_VIEWS: usize = 300;

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            projects: Vec::new(),
            active_project: None,
            recent_projects: Vec::new(),
            sessions: Vec::new(),
            focus: None,
            tab_sets: HashMap::new(),
            layout: Layout::default(),
            next_id: 1,
            closed_tabs: Vec::new(),
            editor_views: HashMap::new(),
            closed_project_tabs: Vec::new(),
            shared_closed_tabs: None,
            project_ui: HashMap::new(),
            bottom: Panes::starting_at(BOTTOM_GROUP_BASE),
            bottom_focused: false,
            terminal_tabs: Vec::new(),
        }
    }
}

/// The sidebar's lists: the open project's sessions, then pinned, projectless and archived ones.
#[derive(Debug, Default)]
pub struct SidebarSessions<'a> {
    pub pinned: Vec<&'a Session>,
    pub project: Vec<&'a Session>,
    /// Sessions of no project, or of a project that is not open.
    pub chats: Vec<&'a Session>,
    pub archived: Vec<&'a Session>,
}

pub fn project_name(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

/// `relocatePath`: `path` moved along with `old` to `new`, when it is `old` or inside it.
pub fn relocate_path(path: &str, old: &str, new: &str) -> Option<String> {
    if path == old {
        return Some(new.to_string());
    }
    let rest = path.strip_prefix(old)?;
    let separator = rest.chars().next()?;
    if separator != '/' && separator != '\\' && !old.ends_with(['/', '\\']) {
        return None;
    }
    Some(format!("{new}{rest}"))
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() { path.to_string() } else { trimmed.to_string() }
}

impl WorkspaceState {
    pub fn from_json(json: &str) -> anyhow::Result<Self> {
        let mut state: Self = serde_json::from_str(json)?;
        state.merge_session_tabs();
        state.drop_unused_sessions();
        Ok(state)
    }

    /// Forgets the sessions that were never used and have no tab left open, so the history keeps
    /// the conversations and not the times New session was pressed.
    fn drop_unused_sessions(&mut self) {
        let open: Vec<SessionId> = self
            .every_panes()
            .flat_map(|panes| panes.all_tabs())
            .filter_map(|tab| match tab {
                TabItem::Session { id } => Some(id.clone()),
                _ => None,
            })
            .collect();
        let stale: Vec<SessionId> =
            self.sessions.iter().filter(|session| session.is_unused() && !open.contains(&session.id)).map(|session| session.id.clone()).collect();
        for id in stale {
            self.delete_session(&id);
        }
    }

    pub fn to_json(&self) -> anyhow::Result<String> {
        Ok(serde_json::to_string_pretty(self)?)
    }

    /// How the terminal editor tab `id` started, when it was remembered.
    pub fn terminal_tab(&self, id: &str) -> Option<&TerminalTab> {
        self.terminal_tabs.iter().find(|(tab, _)| tab == id).map(|(_, tab)| tab)
    }

    /// Remembers how the terminal editor tab `id` started.
    pub fn remember_terminal_tab(&mut self, id: &str, tab: TerminalTab) {
        self.terminal_tabs.retain(|(other, _)| other != id);
        self.terminal_tabs.push((id.to_string(), tab));
        let excess = self.terminal_tabs.len().saturating_sub(MAX_TERMINAL_TABS);
        self.terminal_tabs.drain(..excess);
    }

    fn next_id(&mut self, prefix: &str) -> String {
        let id = self.next_id;
        self.next_id += 1;
        format!("{prefix}-{}-{id}", now_ms())
    }

    pub fn project(&self, id: &ProjectId) -> Option<&Project> {
        self.projects.iter().find(|project| project.id == *id)
    }

    pub fn active_project(&self) -> Option<&Project> {
        self.active_project.as_ref().and_then(|id| self.project(id))
    }

    pub fn session(&self, id: &SessionId) -> Option<&Session> {
        self.sessions.iter().find(|session| session.id == *id)
    }

    fn session_mut(&mut self, id: &SessionId) -> Option<&mut Session> {
        self.sessions.iter_mut().find(|session| session.id == *id)
    }

    /// Opens the folder at `path` as a project, or brings it to the front if it is open.
    pub fn open_project(&mut self, path: &str) -> ProjectId {
        let path = normalize_path(path);
        let now = now_ms();
        let id = match self.projects.iter_mut().find(|project| project.path == path) {
            Some(project) => {
                project.last_opened = now;
                project.id.clone()
            }
            None => {
                let id = ProjectId(path.clone());
                let custom_icon = self.recent_projects.iter().find(|recent| recent.path == path).and_then(|recent| recent.custom_icon.clone());
                self.projects.push(Project {
                    id: id.clone(),
                    name: project_name(&path),
                    path: path.clone(),
                    last_opened: now,
                    custom_icon,
                    folders: Vec::new(),
                });
                if let Some(panes) = self.take_closed_project_tabs(&path) {
                    self.tab_sets.insert(Owner::Project(id.clone()).key(), panes);
                }
                // Sessions started in this folder before belong to it again.
                for session in &mut self.sessions {
                    if session.project.is_none() && session.workspace_path.as_deref() == Some(&path) {
                        session.project = Some(id.clone());
                    }
                }
                id
            }
        };
        self.remember_recent(&path, now);
        self.activate_project(&id);
        id
    }

    /// Adds `folder` to project `id`'s workspace (`addFolderToWorkspace`). Returns false when it is
    /// already one of the workspace's folders.
    pub fn add_project_folder(&mut self, id: &ProjectId, folder: &str) -> bool {
        let folder = normalize_path(folder);
        let Some(project) = self.projects.iter_mut().find(|project| project.id == *id) else { return false };
        if project.path == folder || project.folders.contains(&folder) {
            return false;
        }
        project.folders.push(folder.clone());
        self.remember_recent(&folder, now_ms());
        true
    }

    /// Removes an added folder; the project's own folder stays. Returns whether one was removed.
    pub fn remove_project_folder(&mut self, id: &ProjectId, folder: &str) -> bool {
        let folder = normalize_path(folder);
        let Some(project) = self.projects.iter_mut().find(|project| project.id == *id) else { return false };
        let before = project.folders.len();
        project.folders.retain(|existing| *existing != folder);
        project.folders.len() != before
    }

    fn remember_recent(&mut self, path: &str, now: u64) {
        self.recent_projects = recents::upsert_recent(&self.recent_projects, path, now, RecentMetadata::default());
    }

    pub fn remove_recent(&mut self, path: &str) {
        self.recent_projects.retain(|recent| recent.path != path);
    }

    pub fn remove_missing_recents(&mut self) {
        self.recent_projects.retain(|recent| !recent.missing);
    }

    pub fn toggle_recent_pinned(&mut self, path: &str) {
        if let Some(recent) = self.recent_projects.iter_mut().find(|recent| recent.path == path) {
            recent.pinned = !recent.pinned;
        }
        self.recent_projects = recents::limit_recents(std::mem::take(&mut self.recent_projects));
    }

    /// A recent folder that could not be opened stays listed, marked missing.
    pub fn mark_recent_missing(&mut self, path: &str, missing: bool) {
        if let Some(recent) = self.recent_projects.iter_mut().find(|recent| recent.path == path) {
            recent.missing = missing;
        }
    }

    /// Adds folders other editors opened that are not listed yet, just older than now so they sort
    /// after the folders opened here. Returns how many were added.
    pub fn import_recent_projects(&mut self, imports: Vec<RecentImport>) -> usize {
        let imports: Vec<RecentImport> = recents::unique_imports(imports)
            .into_iter()
            .filter(|import| !self.recent_projects.iter().any(|recent| recent.path == import.path))
            .collect();
        let base = now_ms().saturating_sub(60_000);
        for (index, import) in imports.iter().enumerate() {
            let metadata = RecentMetadata {
                missing: Some(false),
                import_source_id: import.source_id.clone(),
                import_source_name: import.source_name.clone(),
                ..Default::default()
            };
            self.recent_projects = recents::upsert_recent(&self.recent_projects, &import.path, base.saturating_sub(index as u64), metadata);
        }
        imports.len()
    }

    /// Gives a project its own icon (`emoji:…`, `icon:…` or an image path), or takes it away.
    pub fn set_project_icon(&mut self, id: &ProjectId, icon: Option<String>) {
        let Some(project) = self.projects.iter_mut().find(|project| project.id == *id) else { return };
        project.custom_icon = icon.clone();
        let path = project.path.clone();
        if let Some(recent) = self.recent_projects.iter_mut().find(|recent| recent.path == path) {
            recent.custom_icon = icon;
        }
    }

    /// Brings a project to the front: its classic view, unless a session of it is in front.
    pub fn activate_project(&mut self, id: &ProjectId) -> bool {
        self.bottom_focused = false;
        let Some(path) = self.project(id).map(|project| project.path.clone()) else {
            return false;
        };
        if self.active_project.as_ref() != Some(id) {
            self.remember_project_ui();
            self.project_ui.get(&path).copied().unwrap_or_default().apply(&mut self.layout);
        }
        self.active_project = Some(id.clone());
        let session_of_project = matches!(
            &self.focus,
            Some(Owner::Session(session)) if self.session(session).and_then(|s| s.project.as_ref()) == Some(id)
        );
        if !session_of_project {
            self.focus = Some(Owner::Project(id.clone()));
        }
        true
    }

    fn remember_project_ui(&mut self) {
        if let Some(path) = self.active_project().map(|project| project.path.clone()) {
            self.project_ui.insert(path, ProjectUi::of(&self.layout));
        }
    }

    /// Keeps closed projects' tabs in `file`, shared with the other windows, and moves the ones
    /// this window kept there.
    pub fn share_closed_project_tabs(&mut self, file: std::path::PathBuf) {
        let own = std::mem::take(&mut self.closed_project_tabs);
        if !own.is_empty() {
            let mut shared = read_closed_tabs(&file);
            shared.retain(|(path, _)| !own.iter().any(|(own, _)| own == path));
            shared.extend(own);
            write_closed_tabs(&file, shared);
        }
        self.shared_closed_tabs = Some(file);
    }

    fn take_closed_project_tabs(&mut self, path: &str) -> Option<Panes> {
        if let Some(index) = self.closed_project_tabs.iter().position(|(closed, _)| closed == path) {
            return Some(self.closed_project_tabs.remove(index).1);
        }
        let file = self.shared_closed_tabs.as_ref()?;
        let mut shared = read_closed_tabs(file);
        let index = shared.iter().position(|(closed, _)| closed == path)?;
        let (_, panes) = shared.remove(index);
        write_closed_tabs(file, shared);
        Some(panes)
    }

    fn forget_closed_project_tabs(&mut self, path: &str) {
        self.closed_project_tabs.retain(|(closed, _)| closed != path);
        if let Some(file) = &self.shared_closed_tabs {
            let mut shared = read_closed_tabs(file);
            let before = shared.len();
            shared.retain(|(closed, _)| closed != path);
            if shared.len() != before {
                write_closed_tabs(file, shared);
            }
        }
    }

    /// Closes a project: its sessions stay, listed under Chats until it opens again.
    pub fn close_project(&mut self, id: &ProjectId) {
        let Some(index) = self.projects.iter().position(|project| project.id == *id) else {
            return;
        };
        if self.active_project.as_ref() == Some(id) {
            self.remember_project_ui();
        }
        let project = self.projects.remove(index);
        for session in &mut self.sessions {
            if session.project.as_ref() == Some(id) {
                session.project = None;
                session.workspace_path.get_or_insert(project.path.clone());
            }
        }
        self.forget_closed_project_tabs(&project.path);
        if let Some(panes) = self.tab_sets.remove(&Owner::Project(id.clone()).key())
            && panes.all_tabs().next().is_some()
        {
            match self.shared_closed_tabs.clone() {
                Some(file) => {
                    let mut shared = read_closed_tabs(&file);
                    shared.push((project.path.clone(), panes));
                    write_closed_tabs(&file, shared);
                }
                None => {
                    self.closed_project_tabs.push((project.path.clone(), panes));
                    let excess = self.closed_project_tabs.len().saturating_sub(MAX_CLOSED_PROJECT_TABS);
                    self.closed_project_tabs.drain(..excess);
                }
            }
        }
        if self.active_project.as_ref() == Some(id) {
            let next = self.projects.get(index.min(self.projects.len().saturating_sub(1))).map(|p| p.id.clone());
            self.active_project = None;
            self.focus = None;
            if let Some(next) = next {
                self.activate_project(&next);
            }
        } else if matches!(&self.focus, Some(Owner::Project(focused)) if focused == id) {
            self.focus = None;
        }
    }

    /// Closes the project and forgets it was ever opened.
    pub fn remove_project(&mut self, id: &ProjectId) {
        let path = self.project(id).map(|project| project.path.clone());
        self.close_project(id);
        if let Some(path) = path {
            self.recent_projects.retain(|recent| recent.path != path);
            self.project_ui.remove(&path);
            self.forget_closed_project_tabs(&path);
        }
    }

    /// Starts a session in `project`, or a chat of no project, and puts it in front. A session
    /// of the same project and agent that was never used is opened again instead of a second one
    /// being made, so asking for a new session twice over does not fill the history.
    pub fn new_session(&mut self, project: Option<ProjectId>, agent: &str) -> SessionId {
        if let Some(unused) =
            self.sessions.iter().find(|session| session.is_unused() && session.project == project && session.agent == agent).map(|session| session.id.clone())
        {
            self.open_session(&unused);
            return unused;
        }
        let id = SessionId(self.next_id("session"));
        let now = now_ms();
        let workspace_path = project.as_ref().and_then(|id| self.project(id)).map(|p| p.path.clone());
        self.sessions.push(Session {
            id: id.clone(),
            title: NEW_SESSION_TITLE.to_string(),
            project,
            workspace_path,
            agent: agent.to_string(),
            created_at: now,
            last_activity_at: now,
            message_count: 0,
            pinned: false,
            archived_at: None,
            status: SessionStatus::Idle,
            unread: false,
            branch: None,
        });
        self.open_session(&id);
        id
    }

    /// Puts a session in front, with the tabs it keeps.
    pub fn open_session(&mut self, id: &SessionId) {
        self.bottom_focused = false;
        let Some(session) = self.session_mut(id) else { return };
        session.unread = false;
        let project = session.project.clone();
        if let Some(project) = project {
            self.active_project = Some(project);
        }
        let owner = Owner::Session(id.clone());
        let key = self.set_key(&owner);
        let panes = self.tab_sets.entry(key).or_default();
        if !panes.all_tabs().any(|tab| matches!(tab, TabItem::Session { id: tab_id } if tab_id == id)) {
            let set = panes.active_set_mut();
            let index = set.pinned.min(set.tabs.len());
            set.tabs.insert(index, TabItem::Session { id: id.clone() });
        }
        if let Some(group) = panes.groups.iter().find(|group| group.tabs.tabs.contains(&TabItem::Session { id: id.clone() })) {
            panes.active = group.id;
        }
        panes.open(TabItem::Session { id: id.clone() });
        self.focus = Some(owner);
    }

    /// Shows the active project's classic view: its open files, without a session.
    pub fn show_project_view(&mut self) {
        self.bottom_focused = false;
        if let Some(id) = self.active_project.clone() {
            self.focus = Some(Owner::Project(id));
        }
    }

    pub fn rename_session(&mut self, id: &SessionId, title: &str) {
        if let Some(session) = self.session_mut(id) {
            session.title = title.to_string();
        }
    }

    pub fn set_session_status(&mut self, id: &SessionId, status: SessionStatus) {
        if let Some(session) = self.session_mut(id) {
            session.status = status;
        }
    }

    /// Marks activity in a session; one that is not in front shows as unread.
    pub fn touch_session(&mut self, id: &SessionId, at: u64) {
        let in_front = self.focus == Some(Owner::Session(id.clone()));
        if let Some(session) = self.session_mut(id) {
            // An agent writing a reply reports activity for every chunk of it — several times a
            // second — and the lists are ordered by what happened last. Moving the stamp each
            // time reshuffled the rows under the pointer while they were being read, so a
            // session keeps its place until it has been quiet for a moment.
            if at.saturating_sub(session.last_activity_at) >= TOUCH_SETTLE_MS {
                session.last_activity_at = at;
            }
            session.message_count += 1;
            if !in_front {
                session.unread = true;
            }
        }
    }

    pub fn set_session_pinned(&mut self, id: &SessionId, pinned: bool) {
        if let Some(session) = self.session_mut(id) {
            session.pinned = pinned;
        }
    }

    pub fn archive_session(&mut self, id: &SessionId, archived: bool) {
        if let Some(session) = self.session_mut(id) {
            session.archived_at = archived.then(now_ms);
            if archived {
                session.pinned = false;
            }
        }
        if archived {
            self.leave_session(id);
        }
    }

    pub fn delete_session(&mut self, id: &SessionId) {
        self.sessions.retain(|session| session.id != *id);
        self.tab_sets.remove(&Owner::Session(id.clone()).key());
        for panes in self.every_panes_mut() {
            for group in &mut panes.groups {
                while let Some(index) =
                    group.tabs.tabs.iter().position(|tab| matches!(tab, TabItem::Session { id: tab_id } if tab_id == id))
                {
                    group.tabs.close(index);
                }
            }
            panes.prune_empty();
        }
        self.leave_session(id);
    }

    /// Removes every session (Clear chat history), their tabs and tab sets with them.
    pub fn clear_sessions(&mut self) {
        let ids: Vec<SessionId> = self.sessions.iter().map(|session| session.id.clone()).collect();
        for id in ids {
            self.delete_session(&id);
        }
    }

    /// Takes a session out of the centre, showing its project instead.
    pub fn leave_session(&mut self, id: &SessionId) {
        if self.focus == Some(Owner::Session(id.clone())) {
            self.focus = self.active_project.clone().map(Owner::Project);
        }
    }

    pub fn focused_session(&self) -> Option<&Session> {
        match &self.focus {
            Some(Owner::Session(id)) => self.session(id),
            _ => None,
        }
    }

    /// The tabs of the group in front of an owner's panes.
    pub fn tab_set(&self, owner: &Owner) -> Option<&TabSet> {
        self.tab_sets.get(&self.set_key(owner)).map(Panes::active_set)
    }

    /// The tabs an owner shows. A session of a project shares its project's tabs, so the files
    /// and that project's sessions sit in one row; a chat without a project keeps its own.
    fn set_key(&self, owner: &Owner) -> String {
        match owner {
            Owner::Session(id) => match self.session(id).and_then(|session| session.project.clone()) {
                Some(project) => Owner::Project(project).key(),
                None => owner.key(),
            },
            Owner::Project(_) => owner.key(),
        }
    }

    /// In a project's shared tabs, the tab in front says what is in front: a session's tab puts
    /// that session there (the sidebar selects it), any other tab the project's view.
    fn follow_active_tab(&mut self) {
        if self.bottom_focused {
            return;
        }
        let project = match &self.focus {
            Some(Owner::Project(id)) => Some(id.clone()),
            Some(Owner::Session(id)) => self.session(id).and_then(|session| session.project.clone()),
            None => None,
        };
        let Some(project) = project else { return };
        let active = self.tab_sets.get(&Owner::Project(project.clone()).key()).and_then(|panes| {
            let set = panes.active_set();
            set.active.and_then(|index| set.tabs.get(index).cloned())
        });
        self.focus = Some(match active {
            Some(TabItem::Session { id }) if self.session(&id).is_some_and(|session| session.project.as_ref() == Some(&project)) => Owner::Session(id),
            _ => Owner::Project(project),
        });
    }

    /// Tabs used to be kept per session; a session of a project now shares its project's, so
    /// the tabs saved under such a session join the project's when the state loads.
    fn merge_session_tabs(&mut self) {
        let moves: Vec<(String, String)> = self
            .sessions
            .iter()
            .filter_map(|session| session.project.as_ref().map(|project| (Owner::Session(session.id.clone()).key(), Owner::Project(project.clone()).key())))
            .collect();
        for (from, to) in moves {
            let Some(panes) = self.tab_sets.remove(&from) else { continue };
            let target = self.tab_sets.entry(to).or_default();
            let tabs: Vec<TabItem> = panes.all_tabs().filter(|tab| !target.all_tabs().any(|kept| kept == *tab)).cloned().collect();
            let set = target.active_set_mut();
            set.tabs.extend(tabs);
            if set.active.is_none() && !set.tabs.is_empty() {
                set.active = Some(0);
            }
        }
    }

    /// The panes the centre shows: every group and how they are split.
    pub fn focused_panes(&self) -> Option<&Panes> {
        if self.bottom_focused {
            return Some(&self.bottom);
        }
        self.centre_panes()
    }

    /// The centre's groups, whether or not the bottom pane has the keys.
    pub fn centre_panes(&self) -> Option<&Panes> {
        self.focus.as_ref().and_then(|owner| self.tab_sets.get(&self.set_key(owner)))
    }

    fn focused_panes_mut(&mut self) -> Option<&mut Panes> {
        if self.bottom_focused {
            return Some(&mut self.bottom);
        }
        let key = self.set_key(&self.focus.clone()?);
        self.tab_sets.get_mut(&key)
    }

    fn every_panes(&self) -> impl Iterator<Item = &Panes> {
        self.tab_sets.values().chain(std::iter::once(&self.bottom))
    }

    fn every_panes_mut(&mut self) -> impl Iterator<Item = &mut Panes> {
        self.tab_sets.values_mut().chain(std::iter::once(&mut self.bottom))
    }

    /// Moves a tab between the centre and the bottom pane: into `to_group` of the other side, in
    /// front there. Returns false when the groups are on the same side.
    pub fn move_tab_across(&mut self, from_group: u64, index: usize, to_group: u64) -> bool {
        let from_bottom = self.bottom.group(from_group).is_some();
        let to_bottom = self.bottom.group(to_group).is_some();
        if from_bottom == to_bottom {
            return false;
        }
        let centre_key = match self.focus.clone() {
            Some(owner) => self.set_key(&owner),
            None => return false,
        };
        let Some(centre) = self.tab_sets.get_mut(&centre_key) else { return false };
        let (source, target) = if from_bottom { (&mut self.bottom, centre) } else { (centre, &mut self.bottom) };
        if target.group(to_group).is_none() {
            return false;
        }
        let Some(group) = source.group_mut(from_group) else { return false };
        let Some(item) = group.tabs.tabs.get(index).cloned() else { return false };
        group.tabs.close(index);
        source.prune_empty();
        if let Some(group) = target.group_mut(to_group) {
            group.tabs.open(item);
        }
        target.active = to_group;
        self.bottom_focused = to_bottom;
        true
    }

    /// Moves a centre tab into the bottom pane's group in front.
    pub fn move_tab_to_bottom(&mut self, from_group: u64, index: usize) -> bool {
        let to = self.bottom.active;
        self.move_tab_across(from_group, index, to)
    }

    /// Shows the bottom pane with `tab` in it.
    pub fn show_bottom_tab(&mut self, tab: BottomTab) {
        self.layout.bottom_pane_visible = true;
        self.layout.bottom_tab = tab;
        if tab != BottomTab::Buffers {
            self.bottom_focused = false;
        }
    }

    /// Gives the keys and new tabs to the bottom pane's groups, or back to the centre's.
    pub fn focus_bottom(&mut self, focused: bool) {
        self.bottom_focused = focused && !self.bottom.is_empty();
    }

    /// Splits the group in front, showing its tab on both sides.
    pub fn split_pane(&mut self, axis: SplitAxis) -> Option<u64> {
        self.focused_panes_mut().map(|panes| panes.split(axis))
    }

    /// Makes a group the one new tabs open in and keys go to.
    pub fn focus_group(&mut self, group: u64) {
        if self.bottom.group(group).is_some() {
            self.bottom_focused = true;
        } else if self.bottom_focused && self.centre_panes().is_some_and(|panes| panes.group(group).is_some()) {
            self.bottom_focused = false;
        }
        if let Some(panes) = self.focused_panes_mut()
            && panes.group(group).is_some()
        {
            panes.active = group;
        }
        self.follow_active_tab();
    }

    /// Moves a tab to another group, in front there; a group it leaves empty goes away.
    pub fn move_tab(&mut self, from_group: u64, index: usize, to_group: u64) {
        if self.move_tab_across(from_group, index, to_group) {
            return;
        }
        let Some(panes) = self.focused_panes_mut() else { return };
        if from_group == to_group || panes.group(to_group).is_none() {
            return;
        }
        let Some(source) = panes.group_mut(from_group) else { return };
        let Some(item) = source.tabs.tabs.get(index).cloned() else { return };
        source.tabs.close(index);
        if let Some(target) = panes.group_mut(to_group) {
            target.tabs.open(item);
        }
        panes.active = to_group;
        panes.prune_empty();
    }

    /// Drops a tab on another tab: it lands in front of it, in that tab's group.
    pub fn drop_tab_before(&mut self, from_group: u64, index: usize, to_group: u64, before: usize) {
        if self.move_tab_across(from_group, index, to_group) {
            return;
        }
        let Some(panes) = self.focused_panes_mut() else { return };
        if from_group == to_group {
            if let Some(group) = panes.group_mut(from_group) {
                group.tabs.move_before(index, before);
            }
            panes.active = to_group;
            return;
        }
        if panes.group(to_group).is_none() {
            return;
        }
        let Some(source) = panes.group_mut(from_group) else { return };
        let Some(item) = source.tabs.tabs.get(index).cloned() else { return };
        source.tabs.close(index);
        if let Some(target) = panes.group_mut(to_group) {
            match target.tabs.tabs.iter().position(|tab| *tab == item) {
                Some(existing) => target.tabs.active = Some(existing),
                None => {
                    let at = before.clamp(target.tabs.pinned.min(target.tabs.tabs.len()), target.tabs.tabs.len());
                    target.tabs.tabs.insert(at, item);
                    target.tabs.active = Some(at);
                }
            }
        }
        panes.active = to_group;
        panes.prune_empty();
    }

    /// Drops a tab on an edge of a group: it opens in a new group split off that side.
    pub fn split_with_tab(&mut self, from_group: u64, index: usize, target_group: u64, axis: SplitAxis, before: bool) {
        if let Some(panes) = self.focused_panes_mut() {
            panes.split_with_tab(from_group, index, target_group, axis, before);
        }
    }

    /// Split ids start over in every project's and session's panes: only the panes in front
    /// (and the bottom pane, whose ids are its own) take the ratio, not every split numbered so.
    pub fn set_split_ratio(&mut self, split: u64, ratio: f32) {
        if let Some(key) = self.focus.clone().map(|owner| self.set_key(&owner))
            && let Some(panes) = self.tab_sets.get_mut(&key)
        {
            panes.root.set_ratio(split, ratio);
        }
        self.bottom.root.set_ratio(split, ratio);
    }

    /// The tabs the centre shows.
    pub fn focused_tabs(&self) -> Option<&TabSet> {
        if self.bottom_focused {
            return Some(self.bottom.active_set());
        }
        self.focus.as_ref().and_then(|owner| self.tab_set(owner))
    }

    pub fn activate_tab(&mut self, index: usize) {
        if let Some(panes) = self.focused_panes_mut() {
            let set = panes.active_set_mut();
            if index < set.tabs.len() {
                set.active = Some(index);
            }
        }
        self.follow_active_tab();
    }

    /// Closes a tab in front. Closing a session's own tab leaves the session for its project.
    pub fn close_tab(&mut self, index: usize) {
        if self.bottom_focused {
            let set = self.bottom.active_set_mut();
            if let Some(item) = set.tabs.get(index).cloned()
                && let Some(owner) = self.focus.clone()
            {
                self.closed_tabs.push((owner, item));
            }
            self.bottom.active_set_mut().close(index);
            self.bottom.prune_empty();
            if self.bottom.is_empty() {
                self.bottom_focused = false;
            }
            return;
        }
        let Some(owner) = self.focus.clone() else { return };
        let key = self.set_key(&owner);
        let Some(panes) = self.tab_sets.get_mut(&key) else { return };
        let set = panes.active_set_mut();
        if let Some(item) = set.tabs.get(index) {
            self.closed_tabs.push((owner.clone(), item.clone()));
            if self.closed_tabs.len() > 20 {
                self.closed_tabs.remove(0);
            }
        }
        let closing_session = matches!(
            (set.tabs.get(index), &owner),
            (Some(TabItem::Session { id }), Owner::Session(focused)) if id == focused
        );
        set.close(index);
        panes.prune_empty();
        if closing_session && let Owner::Session(id) = owner {
            self.leave_session(&id);
        }
        self.follow_active_tab();
    }

    /// Closes the tabs in front that `keep` rejects, by index; the session's own tab and pinned
    /// tabs stay.
    fn close_tabs_where(&mut self, keep: impl Fn(usize, &TabItem) -> bool) {
        let Some(owner) = self.focus.clone() else { return };
        let Some(panes) = (if self.bottom_focused { Some(&self.bottom) } else { self.tab_sets.get(&self.set_key(&owner)) }) else { return };
        let set = panes.active_set();
        let closing: Vec<usize> = set
            .tabs
            .iter()
            .enumerate()
            .filter(|(index, item)| {
                let own_session = matches!((item, &owner), (TabItem::Session { id }, Owner::Session(focused)) if id == focused);
                !own_session && !set.is_pinned(*index) && !keep(*index, item)
            })
            .map(|(index, _)| index)
            .collect();
        for index in closing.into_iter().rev() {
            self.close_tab(index);
        }
    }

    pub fn close_other_tabs(&mut self, index: usize) {
        self.close_tabs_where(|other, _| other == index);
    }

    pub fn close_tabs_to_the_right(&mut self, index: usize) {
        self.close_tabs_where(|other, _| other <= index);
    }

    pub fn close_tabs_to_the_left(&mut self, index: usize) {
        self.close_tabs_where(|other, _| other >= index);
    }

    /// Closes the tabs in front that `is_dirty` says hold no unsaved changes (`handleCloseSavedTabs`).
    pub fn close_saved_tabs(&mut self, is_dirty: impl Fn(u64, &TabItem) -> bool) {
        let Some(group) = self.focused_panes().map(|panes| panes.active) else { return };
        self.close_tabs_where(|_, item| !matches!(item, TabItem::File { .. }) || is_dirty(group, item));
    }

    /// Closes the active group; its tabs join the group beside it.
    pub fn close_active_group(&mut self) -> bool {
        self.focused_panes_mut().is_some_and(|panes| {
            let active = panes.active;
            panes.close_group(active)
        })
    }

    pub fn close_other_groups(&mut self) -> bool {
        let Some(panes) = self.focused_panes_mut() else { return false };
        let keep = panes.active;
        let others: Vec<u64> = panes.root.group_ids().into_iter().filter(|id| *id != keep).collect();
        let mut closed = false;
        for id in others {
            closed |= panes.close_group(id);
        }
        panes.active = keep;
        closed
    }

    pub fn move_active_tab_to_group(&mut self, forward: bool) -> bool {
        self.focused_panes_mut().is_some_and(|panes| panes.move_active_tab(forward))
    }

    pub fn reset_split_ratios(&mut self) {
        if let Some(panes) = self.focused_panes_mut() {
            panes.reset_ratios();
        }
    }

    /// Locks or unlocks the active group; returns whether it is locked now.
    pub fn toggle_active_group_locked(&mut self) -> Option<bool> {
        let panes = self.focused_panes_mut()?;
        let active = panes.active;
        let group = panes.group_mut(active)?;
        group.locked = !group.locked;
        Some(group.locked)
    }

    pub fn close_all_tabs(&mut self) {
        self.close_tabs_where(|_, _| false);
    }

    /// Pins or unpins a tab in front (`handleTabPin`).
    pub fn toggle_tab_pinned(&mut self, index: usize) {
        if let Some(panes) = self.focused_panes_mut() {
            panes.active_set_mut().toggle_pinned(index);
        }
    }

    /// Closes the oldest tabs past `max` in every group, leaving pinned tabs, the tab in front
    /// and those `keep` holds on to (`maxOpenTabs`; 0 means no limit).
    pub fn limit_tabs(&mut self, max: usize, keep: impl Fn(&TabItem) -> bool) {
        if max == 0 {
            return;
        }
        for panes in self.every_panes_mut() {
            for set in panes.groups.iter_mut().map(|group| &mut group.tabs) {
                let mut excess = set.tabs.len().saturating_sub(max);
                let mut index = 0;
                while excess > 0 && index < set.tabs.len() {
                    let item = &set.tabs[index];
                    if set.is_pinned(index) || set.active == Some(index) || matches!(item, TabItem::Session { .. }) || keep(item) {
                        index += 1;
                        continue;
                    }
                    set.close(index);
                    excess -= 1;
                }
            }
        }
    }

    /// Opens the tab closed most recently again, among the tabs it was closed from.
    pub fn reopen_closed_tab(&mut self) -> bool {
        let Some((owner, item)) = self.closed_tabs.pop() else { return false };
        if let Owner::Session(id) = &owner
            && self.session(id).is_none()
        {
            return self.reopen_closed_tab();
        }
        // A closed project's tab is not brought back without its project.
        if let Owner::Project(id) = &owner
            && !self.projects.iter().any(|project| project.id == *id)
        {
            return self.reopen_closed_tab();
        }
        let key = self.set_key(&owner);
        self.tab_sets.entry(key).or_default().open(item);
        self.focus = Some(owner);
        self.follow_active_tab();
        true
    }

    /// Remembers where a file's caret and scroll were; returns whether that changed anything.
    pub fn remember_editor_view(&mut self, path: &str, cursor: usize, scroll: f32) -> bool {
        if self.editor_views.get(path).is_some_and(|view| view.cursor == cursor && view.scroll == scroll) {
            return false;
        }
        let order = self.editor_views.values().map(|view| view.order).max().map_or(0, |order| order + 1);
        self.editor_views.insert(path.to_string(), EditorView { cursor, scroll, order });
        if self.editor_views.len() > MAX_EDITOR_VIEWS
            && let Some(oldest) = self.editor_views.iter().min_by_key(|(_, view)| view.order).map(|(path, _)| path.clone())
        {
            self.editor_views.remove(&oldest);
        }
        true
    }

    /// Opens a file among the tabs in front: the session's, or the project's.
    pub fn open_file(&mut self, path: &str) {
        let owner = match self.focus.clone() {
            Some(owner) => owner,
            None => match self.active_project.clone() {
                Some(project) => Owner::Project(project),
                None => return,
            },
        };
        if self.bottom_focused {
            self.bottom.open(TabItem::File { path: path.to_string() });
            return;
        }
        let key = self.set_key(&owner);
        self.tab_sets.entry(key).or_default().open(TabItem::File { path: path.to_string() });
        self.focus = Some(owner);
        self.follow_active_tab();
    }

    /// Points every tab of `old` at `new`, after a Save As.
    pub fn rename_file(&mut self, old: &str, new: &str) {
        for panes in self.every_panes_mut() {
            for tab in panes.groups.iter_mut().flat_map(|group| group.tabs.tabs.iter_mut()) {
                if matches!(tab, TabItem::File { path } if path == old) {
                    *tab = TabItem::File { path: new.to_string() };
                }
            }
        }
    }

    /// After an entry was renamed or moved on disk, points the tabs of it and of every file
    /// inside it at the new path.
    pub fn relocate_paths(&mut self, old: &str, new: &str) {
        if old == new {
            return;
        }
        for panes in self.every_panes_mut() {
            for tab in panes.groups.iter_mut().flat_map(|group| group.tabs.tabs.iter_mut()) {
                if let TabItem::File { path } = tab
                    && let Some(moved) = relocate_path(path, old, new)
                {
                    *path = moved;
                }
            }
        }
    }

    /// Closes the tabs of a deleted entry and of every file inside it.
    pub fn close_paths_under(&mut self, root: &str) {
        let inside = |path: &str| relocate_path(path, root, root).is_some();
        for panes in self.every_panes_mut() {
            for set in panes.groups.iter_mut().map(|group| &mut group.tabs) {
                while let Some(index) = set.tabs.iter().position(|tab| matches!(tab, TabItem::File { path } if inside(path))) {
                    set.close(index);
                }
            }
            panes.prune_empty();
        }
    }

    /// The paths of every open file tab.
    pub fn open_file_paths(&self) -> Vec<String> {
        let mut paths: Vec<String> = self
            .all_tabs()
            .filter_map(|tab| match tab {
                TabItem::File { path } => Some(path.clone()),
                _ => None,
            })
            .collect();
        paths.sort();
        paths.dedup();
        paths
    }

    /// Closes every tab of a file, wherever it is open.
    pub fn close_file(&mut self, path: &str) {
        for panes in self.every_panes_mut() {
            for set in panes.groups.iter_mut().map(|group| &mut group.tabs) {
                while let Some(index) = set.tabs.iter().position(|tab| matches!(tab, TabItem::File { path: p } if p == path)) {
                    set.close(index);
                }
            }
            panes.prune_empty();
        }
    }

    /// Closes a tool's tabs wherever they are open.
    pub fn close_resource(&mut self, kind: &str, id: &str) {
        let matches = |tab: &TabItem| matches!(tab, TabItem::Resource { kind: k, id: i, .. } if k == kind && i == id);
        for panes in self.every_panes_mut() {
            for set in panes.groups.iter_mut().map(|group| &mut group.tabs) {
                while let Some(index) = set.tabs.iter().position(matches) {
                    set.close(index);
                }
            }
            panes.prune_empty();
        }
    }

    /// Opens a tool's view among the tabs in front, as `open_file` does for files.
    pub fn open_resource(&mut self, kind: &str, id: &str, title: &str) {
        let owner = match self.focus.clone() {
            Some(owner) => owner,
            None => match self.active_project.clone() {
                Some(project) => Owner::Project(project),
                None => return,
            },
        };
        let key = self.set_key(&owner);
        let set = if self.bottom_focused { self.bottom.active_set_mut() } else { self.tab_sets.entry(key).or_default().active_set_mut() };
        let existing = set.tabs.iter().position(|tab| {
            matches!(tab, TabItem::Resource { kind: k, id: i, .. } if k == kind && i == id)
        });
        match existing {
            Some(index) => {
                set.tabs[index] = TabItem::Resource { kind: kind.into(), id: id.into(), title: title.into() };
                set.active = Some(index);
            }
            None => set.open(TabItem::Resource { kind: kind.into(), id: id.into(), title: title.into() }),
        }
        self.focus = Some(owner);
        self.follow_active_tab();
    }

    /// Opens a project's dashboard as a tab of the project's own view.
    pub fn open_project_dashboard(&mut self, id: &ProjectId) {
        if self.project(id).is_none() {
            return;
        }
        self.active_project = Some(id.clone());
        let owner = Owner::Project(id.clone());
        self.tab_sets.entry(owner.key()).or_default().active_set_mut().open(TabItem::ProjectDashboard { id: id.clone() });
        self.focus = Some(owner);
    }

    /// Renames a tool's tabs wherever they are open, without bringing them to the front.
    pub fn rename_resource(&mut self, kind: &str, id: &str, title: &str) {
        for panes in self.every_panes_mut() {
            for tab in panes.groups.iter_mut().flat_map(|group| group.tabs.tabs.iter_mut()) {
                if let TabItem::Resource { kind: k, id: i, title: current } = tab
                    && k == kind
                    && i == id
                {
                    *current = title.to_string();
                }
            }
        }
    }

    /// Every tab in every set, to know which views are still open.
    pub fn all_tabs(&self) -> impl Iterator<Item = &TabItem> {
        self.every_panes().flat_map(Panes::all_tabs)
    }

    /// Every tab with the group it is in.
    pub fn all_group_tabs(&self) -> impl Iterator<Item = (u64, &TabItem)> {
        self.every_panes()
            .flat_map(|panes| panes.groups.iter().flat_map(|group| group.tabs.tabs.iter().map(move |tab| (group.id, tab))))
    }

    pub fn sidebar_sessions(&self) -> SidebarSessions<'_> {
        let mut lists = SidebarSessions::default();
        for session in &self.sessions {
            if session.archived_at.is_some() {
                lists.archived.push(session);
            } else if session.pinned {
                lists.pinned.push(session);
            } else if session.project.is_some() && session.project == self.active_project {
                lists.project.push(session);
            } else if session.project.is_none() || session.project.as_ref().is_some_and(|id| self.project(id).is_none()) {
                lists.chats.push(session);
            }
        }
        let recent_first = |a: &&Session, b: &&Session| b.last_activity_at.cmp(&a.last_activity_at);
        lists.pinned.sort_by(recent_first);
        lists.project.sort_by(recent_first);
        lists.chats.sort_by(recent_first);
        lists.archived.sort_by(|a, b| b.archived_at.cmp(&a.archived_at));
        lists
    }

    /// Adds a session as an agent would report one, for restoring history and for demos.
    pub fn insert_session(&mut self, session: Session) {
        self.sessions.push(session);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A working agent reports activity many times a second; the lists are ordered by it, so the
    /// stamp only moves once the session has been quiet for a moment.
    #[test]
    fn a_working_session_keeps_its_place_in_the_list() {
        let mut state = WorkspaceState::default();
        let id = state.new_session(None, "claude");
        let started = state.session(&id).unwrap().last_activity_at;
        state.touch_session(&id, started + 10);
        state.touch_session(&id, started + 500);
        assert_eq!(state.session(&id).unwrap().last_activity_at, started, "a burst of chunks does not reorder the list");
        state.touch_session(&id, started + TOUCH_SETTLE_MS);
        assert_eq!(state.session(&id).unwrap().last_activity_at, started + TOUCH_SETTLE_MS, "once it settles, it moves");
    }

    #[test]
    fn editor_views_are_remembered_and_saved() {
        let mut state = WorkspaceState::default();
        assert!(state.remember_editor_view("/p/a.rs", 10, 40.));
        assert!(!state.remember_editor_view("/p/a.rs", 10, 40.));
        assert!(state.remember_editor_view("/p/b.rs", 3, 0.));
        let restored = WorkspaceState::from_json(&state.to_json().unwrap()).unwrap();
        assert_eq!(restored.editor_views.get("/p/a.rs").map(|view| (view.cursor, view.scroll)), Some((10, 40.)));
        for index in 0..MAX_EDITOR_VIEWS {
            state.remember_editor_view(&format!("/p/{index}"), index, 0.);
        }
        assert_eq!(state.editor_views.len(), MAX_EDITOR_VIEWS);
        assert!(!state.editor_views.contains_key("/p/a.rs"));
    }

    #[test]
    fn terminal_tabs_start_again_the_same_way() {
        let mut state = WorkspaceState::default();
        let id = state.open_project("/work/app");
        state.open_resource("terminal", "t-1", "npm run dev");
        state.remember_terminal_tab("t-1", TerminalTab { cwd: Some("/work/app/web".into()), command: Some("npm run dev".into()) });
        let restored = WorkspaceState::from_json(&state.to_json().unwrap()).unwrap();
        assert_eq!(restored.project(&id).map(|project| project.path.as_str()), Some("/work/app"));
        assert!(restored.all_tabs().any(|tab| matches!(tab, TabItem::Resource { kind, id, .. } if kind == "terminal" && id == "t-1")));
        let tab = restored.terminal_tab("t-1").unwrap();
        assert_eq!((tab.cwd.as_deref(), tab.command.as_deref()), (Some("/work/app/web"), Some("npm run dev")));
        for index in 0..MAX_TERMINAL_TABS {
            state.remember_terminal_tab(&format!("t-{}", index + 2), TerminalTab::default());
        }
        assert!(state.terminal_tab("t-1").is_none());
        assert_eq!(state.terminal_tabs.len(), MAX_TERMINAL_TABS);
    }

    #[test]
    fn added_folders_persist_with_the_project() {
        let mut state = WorkspaceState::default();
        let id = state.open_project("/work/app");
        assert!(state.add_project_folder(&id, "/work/lib/"));
        assert!(!state.add_project_folder(&id, "/work/lib"), "already in the workspace");
        assert!(!state.add_project_folder(&id, "/work/app"), "the project's own folder");
        assert_eq!(state.project(&id).unwrap().roots(), ["/work/app", "/work/lib"]);
        assert!(state.recent_projects.iter().any(|recent| recent.path == "/work/lib"));

        let restored = WorkspaceState::from_json(&state.to_json().unwrap()).unwrap();
        assert_eq!(restored.project(&id).unwrap().folders, ["/work/lib"]);
        let old = r#"{"projects": [{"id": "/a", "name": "a", "path": "/a", "last_opened": 1}]}"#;
        assert!(WorkspaceState::from_json(old).map(|state| state.projects[0].folders.is_empty()).unwrap_or(true));

        assert!(state.remove_project_folder(&id, "/work/lib"));
        assert!(!state.remove_project_folder(&id, "/work/app"));
        assert_eq!(state.project(&id).unwrap().roots(), ["/work/app"]);
    }

    fn files(state: &WorkspaceState) -> Vec<String> {
        state
            .focused_tabs()
            .unwrap()
            .tabs
            .iter()
            .map(|tab| match tab {
                TabItem::File { path } => path.clone(),
                other => format!("{other:?}"),
            })
            .collect()
    }

    #[test]
    fn pinned_tabs_come_first_and_survive_bulk_closes() {
        let mut state = WorkspaceState::default();
        state.open_project("/code/athas");
        for path in ["a", "b", "c", "d"] {
            state.open_file(path);
        }
        state.toggle_tab_pinned(2);
        assert_eq!(files(&state), ["c", "a", "b", "d"]);
        assert_eq!(state.focused_tabs().unwrap().pinned, 1);
        assert_eq!(state.focused_tabs().unwrap().active_item(), Some(&TabItem::File { path: "d".into() }));

        state.open_file("e");
        assert_eq!(files(&state), ["c", "a", "b", "d", "e"]);
        state.activate_tab(0);
        state.open_file("f");
        assert_eq!(files(&state), ["c", "f", "a", "b", "d", "e"], "a new tab never lands among pinned ones");

        state.close_all_tabs();
        assert_eq!(files(&state), ["c"]);
        state.toggle_tab_pinned(0);
        assert_eq!(state.focused_tabs().unwrap().pinned, 0);
        state.close_all_tabs();
        assert!(files(&state).is_empty());
    }

    #[test]
    fn unpinning_moves_a_tab_after_the_pinned_ones() {
        let mut state = WorkspaceState::default();
        state.open_project("/code/athas");
        for path in ["a", "b", "c"] {
            state.open_file(path);
        }
        state.toggle_tab_pinned(1);
        state.toggle_tab_pinned(2);
        assert_eq!(files(&state), ["b", "c", "a"]);
        state.toggle_tab_pinned(0);
        assert_eq!(files(&state), ["c", "b", "a"]);
        assert_eq!(state.focused_tabs().unwrap().pinned, 1);
        state.close_tab(0);
        assert_eq!(state.focused_tabs().unwrap().pinned, 0);
        state.close_other_tabs(0);
        assert_eq!(files(&state), ["b"]);
    }

    #[test]
    fn the_tab_limit_closes_the_oldest_unpinned_tabs() {
        let mut state = WorkspaceState::default();
        state.open_project("/code/athas");
        for path in ["a", "b", "c", "d", "e"] {
            state.open_file(path);
        }
        state.toggle_tab_pinned(0);
        state.limit_tabs(3, |tab| matches!(tab, TabItem::File { path } if path == "b"));
        assert_eq!(files(&state), ["a", "b", "e"]);
        state.limit_tabs(0, |_| false);
        assert_eq!(files(&state).len(), 3);
    }

    #[test]
    fn tabs_move_into_the_bottom_pane_and_back() {
        let mut state = WorkspaceState::default();
        state.open_project("/tmp/bottom");
        state.open_file("/tmp/bottom/a.rs");
        state.open_file("/tmp/bottom/b.rs");
        let centre = state.focused_panes().unwrap().active;
        assert!(state.move_tab_to_bottom(centre, 1));
        assert!(state.bottom_focused);
        assert_eq!(state.focused_tabs().unwrap().tabs, vec![TabItem::File { path: "/tmp/bottom/b.rs".into() }]);
        state.open_file("/tmp/bottom/c.rs");
        assert_eq!(state.bottom.active_set().tabs.len(), 2);
        assert_eq!(state.centre_panes().unwrap().active_set().tabs.len(), 1);
        let bottom = state.bottom.active;
        assert!(bottom >= BOTTOM_GROUP_BASE);
        state.move_tab(bottom, 0, centre);
        assert!(!state.bottom_focused);
        assert_eq!(state.focused_tabs().unwrap().tabs.len(), 2);
        state.focus_group(bottom);
        state.close_tab(0);
        assert!(state.bottom.is_empty());
        assert!(!state.bottom_focused);
        assert_eq!(state.all_tabs().count(), 2);
    }

    #[test]
    fn adjacent_groups_by_direction() {
        let mut state = WorkspaceState::default();
        state.open_project("/tmp/grid");
        state.open_file("/tmp/grid/a.rs");
        let first = state.focused_panes().unwrap().active;
        let right = state.split_pane(SplitAxis::Horizontal).unwrap();
        state.focus_group(right);
        let below = state.split_pane(SplitAxis::Vertical).unwrap();
        let panes = state.focused_panes().unwrap();
        assert_eq!(panes.adjacent_group(first, Direction::Right), Some(right));
        assert_eq!(panes.adjacent_group(right, Direction::Down), Some(below));
        assert_eq!(panes.adjacent_group(below, Direction::Up), Some(right));
        assert_eq!(panes.adjacent_group(below, Direction::Left), Some(first));
        assert_eq!(panes.adjacent_group(first, Direction::Left), None);
        assert_eq!(panes.adjacent_group(first, Direction::Down), None);
    }

    #[test]
    fn a_closed_project_opens_again_with_its_files() {
        let mut state = WorkspaceState::default();
        let id = state.open_project("/tmp/alpha");
        state.open_file("/tmp/alpha/a.rs");
        state.open_file("/tmp/alpha/b.rs");
        state.close_project(&id);
        assert!(state.open_file_paths().is_empty());
        let state = WorkspaceState::from_json(&state.to_json().unwrap()).unwrap();
        let mut state = state;
        state.open_project("/tmp/alpha");
        assert_eq!(state.open_file_paths(), vec!["/tmp/alpha/a.rs".to_string(), "/tmp/alpha/b.rs".to_string()]);
        let id = state.active_project.clone().unwrap();
        state.remove_project(&id);
        state.open_project("/tmp/alpha");
        assert!(state.open_file_paths().is_empty());
    }

    #[test]
    fn each_project_keeps_its_sidebar_and_bottom_pane() {
        let mut state = WorkspaceState::default();
        let first = state.open_project("/tmp/one");
        state.layout.bottom_pane_visible = true;
        state.layout.bottom_tab = BottomTab::Debugger;
        state.layout.sidebar_visible = false;
        let second = state.open_project("/tmp/two");
        assert_eq!(ProjectUi::of(&state.layout), ProjectUi::default());
        state.layout.bottom_pane_visible = true;
        state.activate_project(&first);
        assert_eq!(
            ProjectUi::of(&state.layout),
            ProjectUi { sidebar_visible: false, bottom_pane_visible: true, bottom_tab: BottomTab::Debugger }
        );
        state.activate_project(&first);
        assert!(!state.layout.sidebar_visible);
        let state = WorkspaceState::from_json(&state.to_json().unwrap()).unwrap();
        let mut state = state;
        state.activate_project(&second);
        assert!(state.layout.bottom_pane_visible && state.layout.sidebar_visible);
        state.close_project(&second);
        assert_eq!(state.active_project.as_ref(), Some(&first));
        assert!(!state.layout.sidebar_visible);
        state.open_project("/tmp/two");
        assert!(state.layout.bottom_pane_visible);
    }

    #[test]
    fn split_handles_resize_from_the_keyboard() {
        assert_eq!(split_ratio_for_key(0.5, "right", false, true), Some(0.52));
        assert_eq!(split_ratio_for_key(0.5, "left", true, true), Some(0.4));
        assert_eq!(split_ratio_for_key(0.5, "left", false, false), None);
        assert_eq!(split_ratio_for_key(0.5, "down", false, false), Some(0.52));
        assert_eq!(split_ratio_for_key(0.3, "home", false, true), Some(0.1));
        assert_eq!(split_ratio_for_key(0.3, "end", false, false), Some(0.9));
        assert_eq!(split_ratio_for_key(0.3, "enter", false, true), Some(0.5));
        assert_eq!(split_ratio_for_key(0.88, "right", true, true), Some(0.9));
    }

    #[test]
    fn closed_project_tabs_are_shared_by_windows() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("closed-project-tabs.json");
        let mut first = WorkspaceState::default();
        let old = first.open_project("/tmp/old");
        first.open_file("/tmp/old/a.rs");
        first.close_project(&old);
        first.share_closed_project_tabs(file.clone());
        let id = first.open_project("/tmp/beta");
        first.open_file("/tmp/beta/main.rs");
        first.close_project(&id);

        let mut second = WorkspaceState::default();
        second.share_closed_project_tabs(file.clone());
        second.open_project("/tmp/beta");
        assert_eq!(second.open_file_paths(), vec!["/tmp/beta/main.rs".to_string()]);
        second.open_project("/tmp/old");
        assert!(second.open_file_paths().contains(&"/tmp/old/a.rs".to_string()));
        first.open_project("/tmp/beta");
        assert!(first.open_file_paths().is_empty());

        let id = second.active_project.clone().unwrap();
        second.close_project(&id);
        assert!(file.exists());
        assert!(read_closed_tabs(&file).iter().any(|(path, _)| path == "/tmp/old"));
        let mut other = WorkspaceState::default();
        other.share_closed_project_tabs(file.clone());
        let gamma = other.open_project("/tmp/old");
        other.remove_project(&gamma);
        assert!(!read_closed_tabs(&file).iter().any(|(path, _)| path == "/tmp/old"));
        let mut third = WorkspaceState::default();
        third.share_closed_project_tabs(file);
        third.open_project("/tmp/old");
        assert!(third.open_file_paths().is_empty());
    }

    #[test]
    fn asking_for_a_new_session_twice_keeps_one() {
        let mut state = WorkspaceState::default();
        let project = state.open_project("/code/athas");
        let first = state.new_session(Some(project.clone()), "claude-code");
        let again = state.new_session(Some(project.clone()), "claude-code");
        assert_eq!(first, again, "an unused session is opened again, not duplicated");
        assert_eq!(state.sessions.len(), 1);
        // Another agent, another project and a session with a message of its own each get one.
        state.new_session(Some(project.clone()), "codex");
        state.new_session(None, "claude-code");
        state.touch_session(&first, now_ms());
        let after_use = state.new_session(Some(project), "claude-code");
        assert_ne!(after_use, first);
        assert_eq!(state.sessions.len(), 4);
    }

    #[test]
    fn a_reloaded_workspace_forgets_the_sessions_never_used() {
        let mut state = WorkspaceState::default();
        let project = state.open_project("/code/athas");
        let kept = state.new_session(Some(project.clone()), "claude-code");
        state.touch_session(&kept, now_ms());
        let titled = state.new_session(Some(project.clone()), "codex");
        state.rename_session(&titled, "Claude Agent session");
        let open = state.new_session(Some(project.clone()), "gemini");
        // One that was never used and whose tab is gone: the kind that filled the history.
        let dropped = state.new_session(None, "claude-code");
        state.leave_session(&dropped);
        state.tab_sets.remove(&Owner::Session(dropped.clone()).key());

        let reloaded = WorkspaceState::from_json(&state.to_json().unwrap()).unwrap();
        let ids: Vec<&SessionId> = reloaded.sessions.iter().map(|session| &session.id).collect();
        assert!(ids.contains(&&kept) && ids.contains(&&titled) && ids.contains(&&open));
        assert!(!ids.contains(&&dropped), "an unused session with no tab is forgotten");
    }

    #[test]
    fn tab_sets_saved_before_pins_still_load() {
        let set: TabSet = serde_json::from_str(r#"{"tabs":[{"type":"welcome"}],"active":0}"#).unwrap();
        assert_eq!(set.pinned, 0);
    }

    #[test]
    fn opening_a_project_twice_keeps_one() {
        let mut state = WorkspaceState::default();
        let a = state.open_project("/code/athas/");
        let b = state.open_project("/code/athas");
        assert_eq!(a, b);
        assert_eq!(state.projects.len(), 1);
        assert_eq!(state.projects[0].name, "athas");
        assert_eq!(state.focus, Some(Owner::Project(a)));
    }

    #[test]
    fn sessions_follow_their_project() {
        let mut state = WorkspaceState::default();
        let athas = state.open_project("/code/athas");
        let session = state.new_session(Some(athas.clone()), "claude-code");
        let chat = state.new_session(None, "claude-code");
        assert_eq!(state.focus, Some(Owner::Session(chat.clone())));
        let lists = state.sidebar_sessions();
        assert_eq!(lists.project.iter().map(|s| &s.id).collect::<Vec<_>>(), vec![&session]);
        assert_eq!(lists.chats.iter().map(|s| &s.id).collect::<Vec<_>>(), vec![&chat]);

        state.close_project(&athas);
        assert!(state.sidebar_sessions().chats.iter().any(|s| s.id == session));
        state.open_project("/code/athas");
        assert!(state.sidebar_sessions().project.iter().any(|s| s.id == session));
    }

    #[test]
    fn a_projects_sessions_share_its_tabs() {
        let mut state = WorkspaceState::default();
        let athas = state.open_project("/code/athas");
        state.open_file("/code/athas/src/main.rs");
        let session = state.new_session(Some(athas.clone()), "claude-code");
        state.open_session(&session);
        // One row: the file stays beside the session instead of the bar switching to the
        // session's own tabs.
        let tabs = state.focused_tabs().unwrap().tabs.clone();
        assert!(tabs.contains(&TabItem::File { path: "/code/athas/src/main.rs".into() }));
        assert!(tabs.contains(&TabItem::Session { id: session.clone() }));
        assert_eq!(state.focus, Some(Owner::Session(session.clone())));

        // The tab in front says who is in front.
        let file = tabs.iter().position(|tab| matches!(tab, TabItem::File { .. })).unwrap();
        state.activate_tab(file);
        assert_eq!(state.focus, Some(Owner::Project(athas.clone())));
        assert_eq!(state.focused_tabs().unwrap().tabs, tabs);
        let own = tabs.iter().position(|tab| *tab == TabItem::Session { id: session.clone() }).unwrap();
        state.activate_tab(own);
        assert_eq!(state.focus, Some(Owner::Session(session.clone())));
    }

    #[test]
    fn tabs_saved_under_a_session_join_its_project() {
        let mut state = WorkspaceState::default();
        let athas = state.open_project("/code/athas");
        let session = state.new_session(Some(athas.clone()), "claude-code");
        let mut old = Panes::default();
        old.open(TabItem::File { path: "/code/athas/a.rs".into() });
        state.tab_sets.insert(Owner::Session(session.clone()).key(), old);
        let state = WorkspaceState::from_json(&state.to_json().unwrap()).unwrap();
        assert!(!state.tab_sets.contains_key(&Owner::Session(session).key()));
        let project = state.tab_set(&Owner::Project(athas)).unwrap();
        assert!(project.tabs.contains(&TabItem::File { path: "/code/athas/a.rs".into() }));
    }

    #[test]
    fn closing_a_sessions_tab_returns_to_the_project() {
        let mut state = WorkspaceState::default();
        let project = state.open_project("/code/athas");
        let session = state.new_session(Some(project.clone()), "claude-code");
        assert_eq!(state.focused_tabs().unwrap().tabs.len(), 1);
        state.close_tab(0);
        assert_eq!(state.focus, Some(Owner::Project(project)));
        assert!(state.session(&session).is_some());
    }

    #[test]
    fn closing_the_active_project_activates_its_neighbour() {
        let mut state = WorkspaceState::default();
        let a = state.open_project("/a");
        let b = state.open_project("/b");
        assert_eq!(state.active_project, Some(b.clone()));
        state.close_project(&b);
        assert_eq!(state.active_project, Some(a));
    }

    #[test]
    fn closing_and_reopening_tabs() {
        let mut state = WorkspaceState::default();
        state.open_project("/code/athas");
        for name in ["a", "b", "c", "d"] {
            state.open_file(&format!("/code/athas/{name}"));
        }
        state.close_tabs_to_the_right(1);
        assert_eq!(state.focused_tabs().unwrap().tabs.len(), 2);
        state.close_other_tabs(0);
        assert_eq!(state.focused_tabs().unwrap().tabs, vec![TabItem::File { path: "/code/athas/a".into() }]);
        assert!(state.reopen_closed_tab());
        assert_eq!(state.focused_tabs().unwrap().tabs.len(), 2);
        state.close_all_tabs();
        assert!(state.focused_tabs().unwrap().tabs.is_empty());
    }

    #[test]
    fn splitting_and_closing_groups() {
        let mut state = WorkspaceState::default();
        state.open_project("/code/athas");
        state.open_file("/code/athas/a");
        let right = state.split_pane(SplitAxis::Horizontal).unwrap();
        assert_eq!(state.focused_panes().unwrap().groups.len(), 2);
        assert_eq!(state.focused_tabs().unwrap().tabs, vec![TabItem::File { path: "/code/athas/a".into() }]);
        state.open_file("/code/athas/b");
        assert_eq!(state.focused_panes().unwrap().group(right).unwrap().tabs.tabs.len(), 2);
        state.close_all_tabs();
        let panes = state.focused_panes().unwrap();
        assert_eq!(panes.groups.len(), 1, "an emptied group goes away");
        assert_eq!(panes.root, PaneNode::Group { id: 0 });
    }

    #[test]
    fn group_commands() {
        let file = |path: &str| TabItem::File { path: path.into() };
        let mut state = WorkspaceState::default();
        state.open_project("/p");
        state.open_file("a");
        state.open_file("b");
        let right = state.split_pane(SplitAxis::Horizontal).unwrap();
        state.open_file("c");
        state.set_split_ratio(state.focused_panes().unwrap().root.split_id().unwrap(), 0.8);
        state.reset_split_ratios();
        assert!(matches!(state.focused_panes().unwrap().root, PaneNode::Split { ratio, .. } if ratio == 0.5));

        assert!(state.move_active_tab_to_group(true));
        let panes = state.focused_panes().unwrap();
        assert_eq!(panes.active, 0);
        assert_eq!(panes.group(0).unwrap().tabs.active_item(), Some(&file("c")));

        assert_eq!(state.toggle_active_group_locked(), Some(true));
        state.open_file("d");
        let panes = state.focused_panes().unwrap();
        assert_eq!(panes.active, right, "a locked group sends new tabs elsewhere");
        assert!(!panes.group(0).unwrap().tabs.tabs.contains(&file("d")));

        state.focus_group(0);
        assert!(state.close_other_groups());
        let panes = state.focused_panes().unwrap();
        assert_eq!(panes.groups.len(), 1);
        assert!(panes.group(0).unwrap().tabs.tabs.contains(&file("d")), "closed groups hand their tabs over");
        assert!(!state.close_active_group(), "the last group stays");
    }

    #[test]
    fn dropping_a_tab_on_a_tab_lands_in_front_of_it() {
        let file = |path: &str| TabItem::File { path: path.into() };
        let mut set = TabSet { tabs: vec![file("p"), file("a"), file("b"), file("c")], active: Some(1), pinned: 1 };
        set.move_before(3, 1);
        assert_eq!(set.tabs, [file("p"), file("c"), file("a"), file("b")]);
        assert_eq!(set.active, Some(2), "the active tab stays active");
        set.move_before(1, 0);
        assert_eq!(set.tabs[0], file("p"), "unpinned tabs stay after the pinned ones");
        set.move_before(0, 4);
        assert_eq!(set.tabs[0], file("p"), "pinned tabs stay first");

        let mut state = WorkspaceState::default();
        state.open_project("/p");
        state.open_file("a");
        state.open_file("b");
        let right = state.split_pane(SplitAxis::Horizontal).unwrap();
        state.open_file("c");
        state.drop_tab_before(right, 1, 0, 0);
        let panes = state.focused_panes().unwrap();
        assert_eq!(panes.active, 0);
        assert_eq!(panes.group(0).unwrap().tabs.tabs[0], file("c"));
        assert_eq!(panes.group(0).unwrap().tabs.active_item(), Some(&file("c")));
    }

    #[test]
    fn drop_zones_match_the_web_workbench() {
        assert_eq!(DropZone::at(0.1, 0.5), DropZone::Left);
        assert_eq!(DropZone::at(0.9, 0.5), DropZone::Right);
        assert_eq!(DropZone::at(0.5, 0.1), DropZone::Top);
        assert_eq!(DropZone::at(0.5, 0.9), DropZone::Bottom);
        assert_eq!(DropZone::at(0.1, 0.05), DropZone::Top);
        assert_eq!(DropZone::at(0.5, 0.5), DropZone::Center);
        assert_eq!(DropZone::Top.split(), Some((SplitAxis::Vertical, true)));
        assert_eq!(DropZone::Center.split(), None);
    }

    #[test]
    fn dropping_a_tab_on_an_edge_splits_that_side() {
        let mut state = WorkspaceState::default();
        state.open_project("/p");
        state.open_file("/p/a.rs");
        state.open_file("/p/b.rs");
        let panes = state.focused_panes().unwrap().clone();
        let group = panes.active;
        let index = panes.active_set().tabs.iter().position(|tab| matches!(tab, TabItem::File { path } if path == "/p/b.rs")).unwrap();
        state.split_with_tab(group, index, group, SplitAxis::Horizontal, true);
        let panes = state.focused_panes().unwrap();
        assert_eq!(panes.groups.len(), 2);
        let PaneNode::Split { axis, first, .. } = &panes.root else { panic!("split") };
        assert_eq!(*axis, SplitAxis::Horizontal);
        assert_eq!(**first, PaneNode::Group { id: panes.active }, "before puts the new group first");
        assert_eq!(panes.active_set().active_item(), Some(&TabItem::File { path: "/p/b.rs".into() }));
        let new_group = panes.active;
        state.split_with_tab(new_group, 0, group, SplitAxis::Vertical, false);
        let panes = state.focused_panes().unwrap();
        assert_eq!(panes.groups.len(), 2, "the emptied group collapses");
        let PaneNode::Split { axis, .. } = &panes.root else { panic!("split") };
        assert_eq!(*axis, SplitAxis::Vertical);
    }

    #[test]
    fn locked_only_group_splits_for_new_tabs() {
        let mut state = WorkspaceState::default();
        state.open_project("/p");
        state.open_file("a");
        state.toggle_active_group_locked();
        state.open_file("b");
        let panes = state.focused_panes().unwrap();
        assert_eq!(panes.groups.len(), 2);
        assert_eq!(panes.active_set().tabs, vec![TabItem::File { path: "b".into() }]);
    }

    #[test]
    fn closing_tabs_to_the_left_and_saved_ones() {
        let mut state = WorkspaceState::default();
        state.open_project("/p");
        for path in ["a", "b", "c", "d"] {
            state.open_file(path);
        }
        state.close_tabs_to_the_left(2);
        assert_eq!(files(&state), ["c", "d"]);
        state.close_saved_tabs(|_, item| *item == TabItem::File { path: "d".into() });
        assert_eq!(files(&state), ["d"]);
    }

    #[test]
    fn moving_a_tab_between_groups() {
        let mut state = WorkspaceState::default();
        state.open_project("/code/athas");
        state.open_file("/code/athas/a");
        state.open_file("/code/athas/b");
        let right = state.split_pane(SplitAxis::Horizontal).unwrap();
        state.move_tab(0, 0, right);
        let panes = state.focused_panes().unwrap();
        assert_eq!(panes.group(0).unwrap().tabs.tabs, vec![TabItem::File { path: "/code/athas/b".into() }]);
        assert_eq!(panes.group(right).unwrap().tabs.tabs.len(), 2);
        state.move_tab(0, 0, right);
        assert_eq!(state.focused_panes().unwrap().groups.len(), 1, "the emptied left group goes away");
    }

    #[test]
    fn relocating_and_closing_paths_under_a_folder() {
        let mut state = WorkspaceState::default();
        state.open_project("/p");
        for path in ["/p/src/a.rs", "/p/src/b/c.rs", "/p/srcs/d.rs"] {
            state.open_file(path);
        }
        state.relocate_paths("/p/src", "/p/lib");
        assert_eq!(state.open_file_paths(), vec!["/p/lib/a.rs", "/p/lib/b/c.rs", "/p/srcs/d.rs"]);
        state.close_paths_under("/p/lib");
        assert_eq!(state.open_file_paths(), vec!["/p/srcs/d.rs"]);
    }

    #[test]
    fn recents_keep_icons_pins_and_imports() {
        let mut state = WorkspaceState::default();
        let a = state.open_project("/a");
        state.set_project_icon(&a, Some("icon:rocket".into()));
        state.close_project(&a);
        state.toggle_recent_pinned("/a");
        state.open_project("/b");
        assert_eq!(state.recent_projects[0].path, "/a", "pinned first");
        let reopened = state.open_project("/a");
        assert_eq!(state.project(&reopened).unwrap().custom_icon.as_deref(), Some("icon:rocket"));
        let added = state.import_recent_projects(vec![
            RecentImport { path: "/b".into(), source_id: None, source_name: None },
            RecentImport { path: "/c".into(), source_id: Some("zed".into()), source_name: Some("Zed".into()) },
            RecentImport { path: "/c".into(), source_id: None, source_name: None },
        ]);
        assert_eq!(added, 1);
        let c = state.recent_projects.iter().find(|recent| recent.path == "/c").unwrap();
        assert_eq!(c.import_source_name.as_deref(), Some("Zed"));
        state.mark_recent_missing("/c", true);
        state.remove_missing_recents();
        assert!(state.recent_projects.iter().all(|recent| recent.path != "/c"));
    }

    #[test]
    fn state_round_trips_through_json() {
        let mut state = WorkspaceState::default();
        let project = state.open_project("/code/athas");
        state.new_session(Some(project), "claude-code");
        let restored = WorkspaceState::from_json(&state.to_json().unwrap()).unwrap();
        assert_eq!(restored, state);
    }
}
