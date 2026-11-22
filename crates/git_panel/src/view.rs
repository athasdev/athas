//! Drawing the panel, after the web workbench's `stream` source control sidebar.

use ui::TooltipExt as _;
use web_time::{SystemTime, UNIX_EPOCH};

use gpui::{
    Anchor, AnyElement, ClickEvent, Context, ElementId, Hsla, IntoElement, MouseButton, MouseDownEvent, Render,
    SharedString, Window, div, point, prelude::*, px,
};
use theme::{ActiveTheme, ThemeColors};
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, Plane, metrics, typography};

use crate::{
    DraftKind, GitPanel, RepoState, Section, Tab,
    model::{self, ChangeFile, can_discard, filter_files, matches_query, plural, short_hash, stash_title, status_letter},
    repository::{Commit, FileStatus, RemoteOp, StashAction},
};

/// A sidebar bar: the identity row and the toolbars.
const BAR_HEIGHT: gpui::Pixels = px(32.);

fn now_seconds() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs() as i64)
}

fn status_color(status: FileStatus, colors: &ThemeColors) -> Hsla {
    match status {
        FileStatus::Modified => colors.git_modified,
        FileStatus::Added => colors.git_added,
        FileStatus::Deleted => colors.git_deleted,
        FileStatus::Untracked => colors.git_untracked,
        FileStatus::Renamed => colors.git_renamed,
    }
}

/// Where a menu opened from a button hangs: just below and inside the click.
fn below(event: &ClickEvent) -> gpui::Point<gpui::Pixels> {
    let position = event.position();
    point(position.x + px(8.), position.y + px(8.))
}

/// A small icon button inside a row or a section header. It keeps the click from reaching the row.
fn row_button(
    id: impl Into<ElementId>,
    icon: IconName,
    tooltip: &str,
    cx: &mut Context<GitPanel>,
    handler: impl Fn(&mut GitPanel, &ClickEvent, &mut Window, &mut Context<GitPanel>) + 'static,
) -> Button {
    Button::icon(id, icon).size(ButtonSize::XSmall).tooltip(tooltip.to_string()).on_click(cx.listener(
        move |this, event, window, cx| {
            cx.stop_propagation();
            handler(this, event, window, cx);
        },
    ))
}

fn diff_numbers(additions: usize, deletions: usize, colors: &ThemeColors) -> Option<AnyElement> {
    (additions > 0 || deletions > 0).then(|| {
        div()
            .flex()
            .flex_none()
            .gap(px(4.))
            .font_family(typography::MONO_FONT)
            .text_size(typography::TEXT_CAPTION)
            .when(additions > 0, |this| this.child(div().text_color(colors.git_added).child(format!("+{additions}"))))
            .when(deletions > 0, |this| this.child(div().text_color(colors.git_deleted).child(format!("−{deletions}"))))
            .into_any_element()
    })
}

fn caption(text: impl Into<SharedString>, colors: &ThemeColors) -> gpui::Div {
    div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(text.into())
}

/// An icon turning once a second, as Tailwind's `animate-spin`.
fn spinning_icon(id: &'static str, icon: IconName, color: Hsla) -> AnyElement {
    use gpui::AnimationExt as _;
    gpui::svg()
        .path(icon.path())
        .size(IconSize::XSmall.pixels())
        .flex_none()
        .text_color(color)
        .with_animation(id, gpui::Animation::new(std::time::Duration::from_secs(1)).repeat(), |svg, delta| {
            svg.with_transformation(gpui::Transformation::rotate(gpui::percentage(delta)))
        })
        .into_any_element()
}

/// One single-line list row: icon, title, a dimmed secondary text, then meta that gives way to the
/// row's actions on hover.
struct Row {
    id: ElementId,
    /// `None` leaves the title at the row's start (tags, where one icon on every row was noise).
    icon: Option<AnyElement>,
    title: SharedString,
    secondary: Option<SharedString>,
    meta: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    selected: bool,
    muted: bool,
    struck: bool,
    /// The row's right-click menu, opened where the pointer is.
    context: Option<RowMenu>,
}

/// Opens a row's menu at a point of the window.
type RowMenu = std::rc::Rc<dyn Fn(gpui::Point<gpui::Pixels>, &mut Window, &mut gpui::App)>;

/// A right-click menu for a row: `entries` builds its rows when it opens.
fn row_menu(
    key: String,
    cx: &mut Context<GitPanel>,
    entries: impl Fn(&mut GitPanel, gpui::Point<gpui::Pixels>, &mut Context<GitPanel>) -> Vec<ui::MenuEntry> + 'static,
) -> RowMenu {
    let this = cx.weak_entity();
    std::rc::Rc::new(move |position, window, cx| {
        this.update(cx, |panel, cx| {
            let rows = entries(panel, position, cx);
            panel.show_menu(&key, rows, position, Anchor::TopLeft, window, cx);
        })
        .ok();
    })
}

impl Row {
    fn new(id: impl Into<ElementId>, icon: impl IntoElement, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            icon: Some(icon.into_any_element()),
            title: title.into(),
            secondary: None,
            meta: Vec::new(),
            actions: Vec::new(),
            selected: false,
            muted: false,
            struck: false,
            context: None,
        }
    }

    /// Drawn as the sidebar's standard list row (`SidebarListItem`), with the title's detail on
    /// its line, the meta at the end and the actions in its place on hover.
    fn render(self, _colors: &ThemeColors) -> gpui::Stateful<gpui::Div> {
        let mut item = ui::SidebarListItem::new(ElementId::Name(format!("{}-item", self.id).into()), self.title).active(self.selected).struck(self.struck);
        if let Some(icon) = self.icon {
            item = item.leading(icon);
        }
        if let Some(secondary) = self.secondary {
            item = item.detail(secondary);
        }
        if !self.meta.is_empty() {
            item = item.trailing(div().flex().items_center().gap(px(6.)).text_size(typography::TEXT_CAPTION).children(self.meta));
        }
        if !self.actions.is_empty() {
            item = item.hover_trailing(div().flex().items_center().gap(px(2.)).children(self.actions));
        }
        if let Some(menu) = self.context {
            item = item.on_secondary_mouse_down(move |event, window, cx| {
                cx.stop_propagation();
                menu(event.position, window, cx);
            });
        }
        div().id(self.id).relative().w_full().flex_none().when(self.muted, |this| this.opacity(0.5)).child(item)
    }
}

impl GitPanel {
    pub(crate) fn render_header_buttons(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let menu_open = self.menu_is_open("git-actions");
        div()
            .flex()
            .items_center()
            .gap(px(2.))
            .child(
                Button::icon("git-refresh", IconName::ArrowClockwise)
                    .size(ButtonSize::Small)
                    .plane(Plane::Page)
                    .tooltip("Refresh")
                    .disabled(self.reloading)
                    .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
            )
            .child(
                Button::icon("git-actions", IconName::Dots)
                    .size(ButtonSize::Small)
                    .plane(Plane::Page)
                    .active(menu_open)
                    .tooltip("Git actions")
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                        let entries = this.actions_menu(cx);
                        this.show_menu("git-actions", entries, below(event), Anchor::TopRight, window, cx);
                    })),
            )
            .into_any_element()
    }

    fn render_missing(&self, error: Option<SharedString>, cx: &mut Context<Self>) -> AnyElement {
        div()
            .flex()
            .flex_1()
            .min_h_0()
            .items_center()
            .justify_center()
            .child(
                EmptyState::new(if self.has_root() { "Not a Git repository" } else { "No repository selected" })
                    .icon(IconName::GitBranch)
                    .when_some(error, |state, error| state.message(error))
                    .action(
                        Button::new("git-browse", "Browse")
                            .leading_icon(IconName::FolderStar)
                            .size(ButtonSize::Small)
                            .on_click(cx.listener(|this, _, _, cx| this.select_repository(cx))),
                    )
                    .action(
                        Button::new("git-init", if self.initializing { "Initializing…" } else { "Initialize" })
                            .leading_icon(IconName::GitBranch)
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .disabled(self.initializing || !self.has_root())
                            .on_click(cx.listener(|this, _, _, cx| this.initialize(cx))),
                    ),
            )
            .into_any_element()
    }

    /// The panel's header, as every sidebar tool has one: the section in front as a switcher
    /// that lists every section by name (an icon-only track was hard to read), and the panel's
    /// buttons at the end.
    fn render_tabs(&mut self, _colors: &ThemeColors, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let repositories = self.repository_paths().len();
        let mut tabs = vec![
            ("Changes", IconName::GitDiff, self.file_count(), Tab::Changes),
            ("Branches", IconName::GitBranch, self.branches.len(), Tab::Branches),
            ("Worktrees", IconName::Nodes, self.worktrees.len(), Tab::Worktrees),
        ];
        if self.is_visible("remotes") {
            tabs.push(("Remotes", IconName::Globe, self.remotes.len(), Tab::Remotes));
        }
        if self.is_visible("tags") {
            tabs.push(("Tags", IconName::Tag, self.tags.len(), Tab::Tags));
        }
        if repositories > 1 {
            tabs.push(("Repositories", IconName::FolderOpen, repositories, Tab::Repositories));
        }
        let current = self.tab;
        let tabs = tabs.into_iter().fold(ui::SectionTabs::new(), |row, (label, icon, count, which)| {
            row.tab(
                ui::SectionTab::new(gpui::ElementId::Name(format!("git-section-{label}").into()), label, icon, cx.listener(move |panel, _: &ClickEvent, _, cx| panel.show_tab(which, cx))).count(count),
                which == current,
            )
        });
        div().flex().flex_col().flex_none().child(self.render_title_only(cx)).child(tabs)
    }

    /// The header before there are sections (no repository yet, still loading): the tool's
    /// name, so the sidebar's tools all start the same way.
    fn render_title_only(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let actions = self.render_header_buttons(cx);
        div().flex_none().px(px(8.)).pb(px(2.)).child(ui::SectionLabel::new("Source Control").trailing(actions))
    }

    fn render_identity(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let repo_name = self
            .repo_root()
            .and_then(|root| root.file_name().map(|name| name.to_string_lossy().into_owned()))
            .unwrap_or_default();
        let branch = self.branch();
        let accent = colors.accent;
        let context = div()
            .id("git-branch-button")
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .gap(px(6.))
            .h(metrics::CHROME_CONTROL)
            .px(px(6.))
            .rounded(metrics::RADIUS_MD)
            .text_size(typography::TEXT_SM)
            .hover(move |style| style.bg(accent))
            .child(
                Icon::new(if self.is_linked_worktree() { IconName::Nodes } else { IconName::GitBranch })
                    .size(IconSize::XSmall)
                    .color(colors.subtle_foreground),
            )
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .when(self.width.get() - px(16.) > px(240.), |this| {
                        this.child(div().flex_none().text_color(colors.subtle_foreground).child(format!("{repo_name} / ")))
                    })
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .font_weight(typography::MEDIUM)
                            .text_color(colors.foreground)
                            .child(if branch.is_empty() { "detached".to_string() } else { branch.to_string() }),
                    ),
            )
            .child(Icon::new(IconName::ChevronDown).size(IconSize::XSmall).color(colors.subtle_foreground))
            .anchored_tooltip({
                let repo = self.repo_root().map(|root| root.display().to_string()).unwrap_or_default();
                let text = format!("{repo}\n{branch} — switch branch");
                move || ui::Tooltip::new(text.clone())
            })
            .on_click(cx.listener(|this, _, _, cx| this.show_tab(Tab::Branches, cx)));

        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(2.))
            .h(BAR_HEIGHT)
            .px(px(8.))
            .child(context)
            .child(self.render_sync_button(colors, cx))
    }

    fn render_sync_button(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let (ahead, behind) = self.ahead_behind();
        let suggested = model::suggested_remote(ahead, behind);
        let busy = self.remote_action.is_some();
        let tone = if behind > 0 {
            colors.warning
        } else if ahead > 0 {
            colors.primary
        } else {
            colors.subtle_foreground
        };
        let count = match suggested {
            RemoteOp::Pull => behind,
            RemoteOp::Push => ahead,
            RemoteOp::Fetch => 0,
        };
        let title = match suggested {
            RemoteOp::Fetch => "Fetch from remote".to_string(),
            RemoteOp::Pull => format!("Pull {}", plural(count, "commit")),
            RemoteOp::Push => format!("Push {}", plural(count, "commit")),
        };
        let icon = match suggested {
            _ if busy => IconName::ArrowsClockwise,
            RemoteOp::Fetch => IconName::ArrowsClockwise,
            RemoteOp::Pull => IconName::ArrowDown,
            RemoteOp::Push => IconName::ArrowUp,
        };
        let accent = colors.accent;
        div()
            .flex()
            .flex_none()
            .h(metrics::CHROME_CONTROL)
            .rounded(metrics::RADIUS_MD)
            .overflow_hidden()
            .text_size(typography::TEXT_SM)
            .font_weight(typography::MEDIUM)
            .text_color(tone)
            .child(
                div()
                    .id("git-sync")
                    .flex()
                    .items_center()
                    .gap(px(2.))
                    .pl(px(6.))
                    .pr(px(4.))
                    .when(busy, |this| this.opacity(0.6))
                    .when(!busy, |this| this.hover(move |style| style.bg(accent)))
                    .child(if busy { spinning_icon("git-sync-spin", icon, tone) } else { Icon::new(icon).size(IconSize::XSmall).color(tone).into_any_element() })
                    .when(count > 0, |this| this.child(count.to_string()))
                    .anchored_tooltip(move || ui::Tooltip::new(title.clone()))
                    .when(!busy, |this| this.on_click(cx.listener(move |this, _, _, cx| this.run_remote(suggested, cx)))),
            )
            .child(
                div()
                    .id("git-sync-menu")
                    .flex()
                    .items_center()
                    .px(px(2.))
                    .hover(move |style| style.bg(accent))
                    .when(self.menu_is_open("git-remote"), |this| this.bg(accent))
                    .child(Icon::new(IconName::ChevronDown).size(IconSize::XSmall).color(tone))
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                        let entries = this.remote_menu(cx);
                        this.show_menu("git-remote", entries, below(event), Anchor::TopRight, window, cx);
                    })),
            )
    }

    /// The commit box: message, what the commit takes, and the Commit button with its options.
    fn render_composer(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let scope = self.commit_scope();
        let (additions, deletions) = if scope.stages_all() {
            model::totals(&self.groups.unstaged)
        } else {
            model::totals(&self.groups.staged)
        };
        let can_commit = self.can_commit(cx);
        let theme = cx.theme().clone();
        div().flex_none().px(px(8.)).pt(px(4.)).pb(px(8.)).child(
            div()
                .flex()
                .flex_col()
                .relative()
                .rounded(metrics::RADIUS_LG)
                .bg(colors.raised)
                .shadow(theme.shadows.raised.clone())
                .child({
                    let width = self.composer_width.clone();
                    let panel = cx.entity().downgrade();
                    gpui::canvas(
                        move |bounds, _, cx| {
                            let new = f32::from(bounds.size.width);
                            let old = width.replace(new);
                            if (old >= 230.) != (new >= 230.) {
                                panel.update(cx, |_, cx| cx.notify()).ok();
                            }
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full()
                })
                .child(
                    div()
                        .px(px(10.))
                        .pt(px(8.))
                        .pb(px(4.))
                        .capture_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, _, cx| {
                            let keys = &event.keystroke;
                            if keys.key == "enter" && keys.modifiers.shift && (keys.modifiers.platform || keys.modifiers.control) {
                                cx.stop_propagation();
                                this.commit(true, false, cx);
                            }
                        }))
                        .child(self.commit_input.clone()),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .pl(px(10.))
                        .pr(px(4.))
                        .pb(px(4.))
                        .child(
                            Button::icon("git-generate-message", IconName::Sparkle)
                                .size(ButtonSize::XSmall)
                                .tooltip("Generate message with AI")
                                .disabled(self.groups.staged.is_empty() || self.generating)
                                .active(self.generating)
                                .on_click(cx.listener(|this, _, _, cx| this.generate_message(cx))),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_1()
                                .min_w_0()
                                .items_center()
                                .gap(px(6.))
                                .overflow_hidden()
                                .child(caption(scope.label(), colors).flex_none())
                                .when(self.composer_width.get() >= 230., |this| this.children(diff_numbers(additions, deletions, colors))),
                        )
                        // One 24px primary block with square inner edges (`h-6 overflow-hidden
                        // rounded-md`): Commit, then the menu chevron behind a faint divider.
                        .child({
                            let (hover, divider) = (colors.primary_hover, colors.primary_foreground.opacity(0.2));
                            div()
                                .flex()
                                .flex_none()
                                .h(px(24.))
                                .rounded(metrics::RADIUS_MD)
                                .overflow_hidden()
                                .text_color(colors.primary_foreground)
                                .child(
                                    div()
                                        .id("git-commit")
                                        .flex()
                                        .items_center()
                                        .px(px(10.))
                                        .bg(colors.primary)
                                        .text_size(typography::TEXT_SM)
                                        .font_weight(typography::MEDIUM)
                                        .whitespace_nowrap()
                                        .child(if self.committing { "Committing…" } else { "Commit" })
                                        .anchored_tooltip(|| ui::Tooltip::new("Commit (⌘↵)"))
                                        .when(!can_commit, |this| this.opacity(0.4))
                                        .when(can_commit, |this| {
                                            this.hover(move |style| style.bg(hover)).on_click(cx.listener(|this, _, _, cx| this.commit(false, false, cx)))
                                        }),
                                )
                                .child(
                                    div()
                                        .id("git-commit-menu")
                                        .flex()
                                        .items_center()
                                        .px(px(4.))
                                        .border_l_1()
                                        .border_color(divider)
                                        .bg(colors.primary)
                                        .hover(move |style| style.bg(hover))
                                        .anchored_tooltip(move || ui::Tooltip::new("More commit options"))
                                        .child(Icon::new(IconName::ChevronDown).size(IconSize::Custom(px(12.))).color(colors.primary_foreground))
                                        .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                                            let entries = this.commit_menu(cx);
                                            this.show_menu("git-commit", entries, below(event), Anchor::TopRight, window, cx);
                                        })),
                                )
                        }),
                ),
        )
    }

    fn render_toolbar(&self, input: gpui::Entity<ui::TextInput>, trailing: Option<AnyElement>) -> impl IntoElement {
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(2.))
            .h(BAR_HEIGHT)
            .pl(px(12.))
            .pr(px(8.))
            .child(div().flex_1().min_w_0().child(input))
            .children(trailing)
    }

    /// The buttons a section header shows on hover.
    fn section_actions(&self, section: Section, cx: &mut Context<Self>) -> Vec<AnyElement> {
        match section {
            Section::Staged => {
                let all = self.groups.staged.clone();
                vec![
                    row_button("git-review-staged", IconName::GitDiff, "Review staged", cx, |this, _, _, cx| this.view_all(git_diff::Scope::Staged, cx))
                        .into_any_element(),
                    row_button("git-unstage-all", IconName::Minus, "Unstage all", cx, move |this, _, _, cx| this.set_staged(all.clone(), false, cx))
                        .into_any_element(),
                ]
            }
            Section::Changes => {
                let all = self.groups.unstaged.clone();
                let discardable: Vec<ChangeFile> = all.iter().filter(|file| can_discard(file)).cloned().collect();
                vec![
                    row_button("git-stash-all", IconName::Stack, "Stash all", cx, |this, _, _, cx| this.stash("WIP from sidebar".into(), None, cx))
                        .into_any_element(),
                    row_button("git-discard-all", IconName::ArrowCounterClockwise, "Discard all", cx, move |this, event, window, cx| {
                        this.confirm_discard(discardable.clone(), below(event), window, cx)
                    })
                    .into_any_element(),
                    row_button("git-stage-all", IconName::Plus, "Stage all", cx, move |this, _, _, cx| this.set_staged(all.clone(), true, cx))
                        .into_any_element(),
                ]
            }
            Section::Stashes | Section::History => Vec::new(),
        }
    }

    fn section_title(section: Section) -> &'static str {
        match section {
            Section::Staged => "Staged",
            Section::Changes => "Changes",
            Section::Stashes => "Stashes",
            Section::History => "History",
        }
    }

    fn section_count(&self, section: Section) -> usize {
        match section {
            Section::Staged => self.groups.staged.len(),
            Section::Changes => self.groups.unstaged.len(),
            Section::Stashes => self.stashes.len(),
            Section::History => self.commits.len(),
        }
    }

    /// The History search field shows in the section's sticky area once there are more than five
    /// commits.
    fn section_has_toolbar(&self, section: Section) -> bool {
        section == Section::History && self.section_open(section, self.commits.len()) && self.commits.len() > 5
    }

    /// A section's header (`StreamSection`): chevron, title, count and the actions on hover, on
    /// the panel's background so rows do not show through it while it is stuck to the top.
    fn render_section_header(&self, section: Section, colors: &ThemeColors, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let title = Self::section_title(section);
        let count = self.section_count(section);
        let open = self.section_open(section, count);
        let group = SharedString::from(format!("git-section-{title}"));
        div()
            .id(SharedString::from(format!("git-section-{title}")))
            .group(group.clone())
            .flex()
            .items_center()
            .gap(px(6.))
            .h(metrics::LIST_ROW)
            .px(px(8.))
            .bg(colors.background)
            .child(
                Icon::new(if open { IconName::ChevronDown } else { IconName::ChevronRight })
                    .size(IconSize::XSmall)
                    .color(colors.subtle_foreground),
            )
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(typography::TEXT_SM)
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.muted_foreground)
                    .child(title),
            )
            .child(caption(count.to_string(), colors).flex_none())
            .child(
                div()
                    .ml_auto()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(2.))
                    .invisible()
                    .group_hover(group, |style| style.visible())
                    .children(self.section_actions(section, cx)),
            )
            .on_click(cx.listener(move |this, _, _, cx| this.toggle_section(section, cx)))
    }

    /// The History search bar under its header.
    fn render_history_toolbar(&self) -> gpui::Div {
        div().h(BAR_HEIGHT).px(px(8.)).flex().items_center().child(self.history_filter_input.clone())
    }

    /// The section whose header is scrolled past, and how far it is pushed up by the end of its
    /// section: its header (and History's search) stays on top as the original's `sticky -top-px`.
    fn stuck_section(&self, order: &[(usize, Section)]) -> Option<(Section, gpui::Pixels)> {
        let viewport = self.changes_scroll.bounds();
        let offset = self.changes_scroll.offset().y;
        if offset >= px(0.) {
            return None;
        }
        order.iter().find_map(|&(index, section)| {
            let bounds = self.changes_scroll.bounds_for_item(index)?;
            let (top, bottom) = (bounds.top() + offset, bounds.bottom() + offset);
            if top >= viewport.top() || bottom <= viewport.top() {
                return None;
            }
            let height = metrics::LIST_ROW + if self.section_has_toolbar(section) { BAR_HEIGHT } else { px(0.) };
            Some((section, (bottom - viewport.top() - height).min(px(0.))))
        })
    }

    /// `collapseEmptyGitSections` keeps a section without rows closed.
    fn section_open(&self, section: Section, count: usize) -> bool {
        self.sections.get(section) && !(self.settings.collapse_empty && count == 0)
    }

    /// A section's rows: flat with each file's folder beside it, or under folder captions with
    /// `gitChangesFolderView`.
    fn render_file_rows(&self, section: Section, files: &[&ChangeFile], colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let mut rows = div().flex().flex_col().pb(px(8.));
        if !self.settings.folder_view {
            return rows.children(files.iter().map(|file| self.render_file_row(file, true, colors, cx))).into_any_element();
        }
        let prefix = if section == Section::Staged { "staged" } else { "changes" };
        for (dir, files) in model::folder_groups(files) {
            let nested = !dir.is_empty();
            let key = format!("{prefix}:{dir}");
            let collapsed = nested && self.collapsed_folders.contains(&key);
            if nested {
                rows = rows.child(
                    div()
                        .id(SharedString::from(format!("git-folder-{key}")))
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .h(metrics::LIST_ROW)
                        .px(px(8.))
                        .rounded(metrics::RADIUS_MD)
                        .map(|this| ui::sidebar_row(this, false, false, cx))
                        .child(
                            Icon::new(if collapsed { IconName::ChevronRight } else { IconName::ChevronDown })
                                .size(IconSize::XSmall)
                                .color(colors.subtle_foreground),
                        )
                        .child(Icon::new(if collapsed { IconName::Folder } else { IconName::FolderOpen }).size(IconSize::XSmall).color(colors.subtle_foreground))
                        .child(div().min_w_0().truncate().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child(dir))
                        .child(caption(files.len().to_string(), colors).flex_none())
                        .on_click(cx.listener(move |this, _, _, cx| this.toggle_folder(key.clone(), cx))),
                );
            }
            if collapsed {
                continue;
            }
            rows = rows.child(
                div()
                    .flex()
                    .flex_col()
                    .when(nested, |this| this.pl(px(12.)))
                    .children(files.into_iter().map(|file| self.render_file_row(file, false, colors, cx))),
            );
        }
        rows.into_any_element()
    }

    fn render_file_row(&self, file: &ChangeFile, show_dir: bool, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let (letter, label) = status_letter(file.status);
        let key = file.key.clone();
        let mut actions = Vec::new();
        if can_discard(file) {
            let target = file.clone();
            actions.push(
                row_button(format!("discard-{key}"), IconName::ArrowCounterClockwise, "Discard", cx, move |this, event, window, cx| {
                    this.confirm_discard(vec![target.clone()], below(event), window, cx)
                })
                .into_any_element(),
            );
        }
        let target = file.clone();
        let staged = file.staged;
        actions.push(
            row_button(
                format!("stage-{key}"),
                if staged { IconName::Minus } else { IconName::Plus },
                if staged { "Unstage" } else { "Stage" },
                cx,
                move |this, _, _, cx| this.set_staged(vec![target.clone()], !staged, cx),
            )
            .into_any_element(),
        );

        let mut meta: Vec<AnyElement> = Vec::new();
        if !self.settings.compact_badges {
            meta.extend(diff_numbers(file.additions, file.deletions, colors));
        }
        meta.push(
            div()
                .id(SharedString::from(format!("status-{key}")))
                .flex()
                .flex_none()
                .size(px(16.))
                .items_center()
                .justify_center()
                .font_family(typography::MONO_FONT)
                .font_weight(typography::MEDIUM)
                .text_color(status_color(file.status, colors))
                .child(letter)
                .anchored_tooltip(move || ui::Tooltip::new(label))
                .into_any_element(),
        );

        let icon = match extensions::icon_for(&file.name, false, false, cx) {
            Some(source) => gpui::img(source).flex_none().size(px(14.)).into_any_element(),
            None => Icon::new(IconName::File).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element(),
        };
        let mut row = Row::new(format!("file-{key}"), icon, file.name.clone());
        row.secondary = (show_dir && !file.dir.is_empty()).then(|| file.dir.clone().into());
        row.meta = meta;
        row.actions = actions;
        row.muted = self.busy_keys.contains(&file.key);
        row.struck = file.status == FileStatus::Deleted;

        let open = file.clone();
        let menu_file = file.clone();
        let path = file.path.clone();
        let dragged = self.diff_drag(file);
        row.render(colors)
            .anchored_tooltip(move || ui::Tooltip::new(path.clone()))
            .when_some(dragged, |row, dragged| row.on_drag(dragged, |dragged, _, _, cx| dragged.preview(cx)))
            .on_click(cx.listener(move |this, _, _, cx| this.open_change(&open, cx)))
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    let entries = this.file_menu(&menu_file, cx);
                    this.show_menu(&format!("file:{}", menu_file.key), entries, event.position, Anchor::TopLeft, window, cx);
                }),
            )
            .into_any_element()
    }

    fn render_changes(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let query = self.filter_input.read(cx).text().to_string();
        let staged = filter_files(&self.groups.staged, &query);
        let unstaged = filter_files(&self.groups.unstaged, &query);
        let now = now_seconds();

        // Each section is one child of the scrolling list, so its bounds tell which header to pin.
        let mut children: Vec<AnyElement> = Vec::new();
        let mut sections: Vec<Section> = Vec::new();

        let show_changes = self.is_visible("changes");
        if show_changes && self.file_count() == 0 {
            children.push(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(2.))
                    .px(px(12.))
                    .py(px(24.))
                    .text_size(typography::TEXT_SM)
                    .child(div().text_color(colors.muted_foreground).child("Working tree clean"))
                    .child(div().text_color(colors.subtle_foreground).child("Edit something and it will show up here."))
                    .into_any_element(),
            );
        }
        if show_changes {
            let mut file_sections = Vec::new();
            if !self.groups.staged.is_empty() {
                file_sections.push(Section::Staged);
            }
            if !self.groups.unstaged.is_empty() {
                file_sections.push(Section::Changes);
            }
            if !self.settings.staged_first {
                file_sections.reverse();
            }
            sections.extend(file_sections);
        }
        if self.is_visible("stashes") && !self.stashes.is_empty() {
            sections.push(Section::Stashes);
        }
        if self.is_visible("history") {
            sections.push(Section::History);
        }

        // Which header is pinned comes from the last layout's section bounds.
        let probe: Vec<(usize, Section)> = sections.iter().enumerate().map(|(index, &section)| (index + children.len(), section)).collect();
        let stuck = self.stuck_section(&probe);

        for section in sections {
            let open = self.section_open(section, self.section_count(section));
            let mut block = div().flex().flex_col().child(self.render_section_header(section, colors, cx));
            if self.section_has_toolbar(section) {
                // While the header is pinned its search field draws there, so it leaves a gap here.
                block = block.child(if stuck.is_some_and(|(stuck, _)| stuck == section) {
                    div().h(BAR_HEIGHT)
                } else {
                    self.render_history_toolbar()
                });
            }
            if open {
                block = block.child(match section {
                    Section::Staged => self.render_file_rows(Section::Staged, &staged, colors, cx),
                    Section::Changes => self.render_file_rows(Section::Changes, &unstaged, colors, cx),
                    Section::Stashes => self.render_stashes(now, colors, cx),
                    Section::History => self.render_history(now, colors, cx).into_any_element(),
                });
            }
            children.push(block.into_any_element());
        }

        let list = div()
            .id("git-changes-list")
            .flex()
            .flex_col()
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&self.changes_scroll)
            .px(px(8.))
            .pb(px(12.))
            .children(children);

        let pinned = stuck.map(|(section, top)| {
            div()
                .id("git-sticky-section")
                .absolute()
                .left(px(8.))
                .right(px(8.))
                .top(top)
                .flex()
                .flex_col()
                .bg(colors.surface)
                .child(self.render_section_header(section, colors, cx))
                .when(self.section_has_toolbar(section), |this| this.child(self.render_history_toolbar()))
        });

        div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .child(list)
            .children(pinned)
            .child(ui::Scrollbar::new("git-changes-scrollbar", &self.changes_scroll))
    }

    fn render_stashes(&self, now: i64, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let rows: Vec<AnyElement> = self
            .stashes
            .iter()
            .map(|stash| {
                let index = stash.index;
                let mut row = Row::new(("stash", index), Icon::new(IconName::Stack).size(IconSize::XSmall).color(colors.subtle_foreground), stash_title(&stash.message));
                row.meta = vec![caption(model::relative_date(&stash.date, now), colors).into_any_element()];
                row.actions = vec![
                    row_button(("stash-apply", index), IconName::Archive, "Apply", cx, move |this, _, _, cx| this.stash_action(StashAction::Apply, index, cx))
                        .into_any_element(),
                    row_button(("stash-pop", index), IconName::ArrowUp, "Pop", cx, move |this, _, _, cx| this.stash_action(StashAction::Pop, index, cx))
                        .into_any_element(),
                    row_button(("stash-drop", index), IconName::Trash, "Drop", cx, move |this, _, _, cx| this.stash_action(StashAction::Drop, index, cx))
                        .into_any_element(),
                ];
                row.context = Some(row_menu(format!("stash-menu-{index}"), cx, move |panel, _, cx| {
                    vec![
                        panel.item("Show Changes", cx, move |this, _, cx| this.open_stash(index, cx)).icon(IconName::GitDiff).into(),
                        ui::MenuEntry::Separator,
                        panel.item("Apply", cx, move |this, _, cx| this.stash_action(StashAction::Apply, index, cx)).icon(IconName::Archive).into(),
                        panel.item("Pop", cx, move |this, _, cx| this.stash_action(StashAction::Pop, index, cx)).icon(IconName::ArrowUp).into(),
                        ui::MenuEntry::Separator,
                        panel.item("Drop", cx, move |this, _, cx| this.stash_action(StashAction::Drop, index, cx)).icon(IconName::Trash).destructive().into(),
                    ]
                }));
                let message = format!("{}\nClick to see its changes", stash.message);
                row.render(colors)
                    .anchored_tooltip(move || ui::Tooltip::new(message.clone()))
                    .on_click(cx.listener(move |this, _, _, cx| this.open_stash(index, cx)))
                    .into_any_element()
            })
            .collect();
        div().flex().flex_col().pb(px(8.)).children(rows).into_any_element()
    }

    /// The Changes toolbar's Compare button.
    fn render_compare_button(&self, cx: &mut Context<Self>) -> AnyElement {
        Button::icon("git-compare", IconName::GitDiff)
            .size(ButtonSize::Small)
            .tooltip("Compare")
            .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                let entries = this.compare_menu(cx);
                this.show_menu("git-compare", entries, below(event), Anchor::TopRight, window, cx);
            }))
            .into_any_element()
    }

    fn render_history(&self, now: i64, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let (ahead, _) = self.ahead_behind();
        let query = self.history_filter_input.read(cx).text().trim().to_lowercase();
        let commits: Vec<&Commit> = self
            .commits
            .iter()
            .filter(|commit| {
                query.is_empty()
                    || matches_query(
                        &query,
                        [commit.summary.as_str(), commit.description.as_deref().unwrap_or(""), commit.author.as_str(), commit.email.as_str(), commit.hash.as_str()],
                    )
            })
            .collect();
        let count = commits.len();
        let rows = commits.into_iter().enumerate().map(|(index, commit)| {
            let unpushed = query.is_empty() && index < ahead;
            let selected = self.open_commit.as_deref() == Some(commit.hash.as_str());
            let group = SharedString::from(format!("git-commit-{}", commit.hash));
            let hash = commit.hash.clone();
            let base = commit.hash.clone();
            let open = commit.clone();
            let expanded = selected.then(|| {
                let totals = self.open_commit_totals;
                div()
                    .mt(px(8.))
                    .flex()
                    .flex_col()
                    .children(commit.description.as_deref().map(str::trim).filter(|text| !text.is_empty()).map(|description| {
                        div()
                            .mb(px(8.))
                            .text_size(typography::TEXT_SM)
                            .line_height(px(16.))
                            .text_color(colors.muted_foreground)
                            .line_clamp(6)
                            .child(description.to_string())
                    }))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .text_size(typography::TEXT_CAPTION)
                            .text_color(colors.subtle_foreground)
                            .children(totals.map(|totals| {
                                div().flex_none().child(format!("{} file{}", totals.files, if totals.files == 1 { "" } else { "s" }))
                            }))
                            .children(totals.and_then(|totals| diff_numbers(totals.additions, totals.deletions, colors)))
                            .child(
                                div()
                                    .ml_auto()
                                    .flex()
                                    .flex_none()
                                    .items_center()
                                    .gap(px(2.))
                                    .child(div().font_family(typography::MONO_FONT).child(short_hash(&commit.hash).to_string()))
                                    .child(row_button(format!("copy-{hash}"), IconName::Copy, "Copy commit hash", cx, move |this, _, _, cx| {
                                        this.copy(hash.clone(), cx)
                                    }))
                                    .child(row_button(
                                        format!("branch-{base}"),
                                        IconName::GitBranch,
                                        "New branch from this commit",
                                        cx,
                                        move |this, _, window, cx| this.start_branch_draft(Some(base.clone()), window, cx),
                                    )),
                            ),
                    )
            });
            div()
                .id(SharedString::from(format!("commit-{}", commit.hash)))
                .group(group.clone())
                .relative()
                .flex()
                .gap(px(10.))
                .py(px(6.))
                .px(px(8.))
                .rounded(metrics::RADIUS_MD)
                .map(|this| ui::sidebar_row(this, selected, false, cx))
                .on_drag(self.commit_drag(&commit), |dragged, _, _, cx| dragged.preview(cx))
                .on_click(cx.listener(move |this, _, _, cx| this.open_commit(&open, cx)))
                .child(
                    div()
                        .relative()
                        .flex()
                        .flex_none()
                        .w(px(12.))
                        .justify_center()
                        .child(
                            div()
                                .absolute()
                                .w(px(1.))
                                .top(if index == 0 { px(8.) } else { px(-6.) })
                                .when(index + 1 == count, |this| this.h(px(14.)))
                                .when(index + 1 < count, |this| this.bottom(px(-6.)))
                                .bg(colors.divider),
                        )
                        .child(
                            div()
                                .mt(px(4.))
                                .size(px(10.))
                                .rounded_full()
                                .border_2()
                                .when(unpushed, |this| this.border_color(colors.primary).bg(colors.surface))
                                .when(!unpushed, |this| this.border_color(colors.surface).bg(colors.subtle_foreground)),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .text_size(typography::TEXT_SM)
                                .line_height(px(16.))
                                .text_color(colors.foreground)
                                .line_clamp(2)
                                .child(commit.summary.clone()),
                        )
                        .child(
                            div()
                                .mt(px(2.))
                                .flex()
                                .items_center()
                                .gap(px(6.))
                                .min_w_0()
                                .text_size(typography::TEXT_CAPTION)
                                .text_color(colors.subtle_foreground)
                                .child(ui::Avatar::new(&commit.author).size(px(14.)).image(git_diff::avatar::author_avatar(&commit.email, cx)))
                                .child(div().min_w_0().truncate().child(commit.author.clone()))
                                .child("·")
                                .child(div().flex_none().child(model::relative_date(&commit.date, now)))
                                .when(unpushed, |this| {
                                    this.child(
                                        div()
                                            .flex_none()
                                            .px(px(4.))
                                            .rounded_full()
                                            .bg(colors.primary_soft)
                                            .text_color(colors.primary)
                                            .child("unpushed"),
                                    )
                                })
                                .when(!selected, |this| {
                                    this.child(
                                        div()
                                            .ml_auto()
                                            .flex_none()
                                            .font_family(typography::MONO_FONT)
                                            .invisible()
                                            .group_hover(group.clone(), |style| style.visible())
                                            .child(short_hash(&commit.hash).to_string()),
                                    )
                                }),
                        )
                        .children(expanded),
                )
                .into_any_element()
        });
        let accent = colors.accent;
        let hover = colors.foreground;
        let searching = !query.is_empty();
        div()
            .flex()
            .flex_col()
            .children(rows)
            .when(count == 0, |this| {
                this.child(
                    caption(if searching { "No matching commits" } else { "No commits yet" }, colors)
                        .py(px(16.))
                        .text_center()
                        .text_size(typography::TEXT_SM),
                )
            })
            .when(self.has_more_commits && !searching, |this| {
                this.child(
                    div()
                        .id("git-load-more")
                        .mt(px(4.))
                        .py(px(6.))
                        .rounded(metrics::RADIUS_MD)
                        .text_center()
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.subtle_foreground)
                        .hover(move |style| style.bg(accent).text_color(hover))
                        .child("Load older commits")
                        .on_click(cx.listener(|this, _, _, cx| this.load_more_commits(cx))),
                )
            })
    }

    fn render_branches(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let query = self.branch_filter_input.read(cx).text().to_string();
        let current = self.branch().to_string();
        let (ahead, behind) = self.ahead_behind();
        let others: Vec<&String> = self
            .branches
            .iter()
            .filter(|branch| **branch != current && matches_query(&query, [branch.as_str()]))
            .collect();
        let show_current = !current.is_empty() && matches_query(&query, [current.as_str()]);

        let mut list = div()
            .id("git-branches-list")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .px(px(8.))
            .pb(px(12.));

        if let Some(draft) = &self.branch_draft {
            let from = draft.base.as_deref().map(|base| if base.len() == 40 { short_hash(base) } else { base }).unwrap_or(&current);
            list = list.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .px(px(4.))
                    .pt(px(4.))
                    .pb(px(10.))
                    .child(caption(format!("New branch from {from}"), colors).px(px(4.)))
                    .child(self.branch_name_input.clone())
                    .child(
                        div()
                            .flex()
                            .justify_end()
                            .gap(px(4.))
                            .child(
                                Button::new("git-branch-cancel", "Cancel")
                                    .variant(ButtonVariant::Ghost)
                                    .size(ButtonSize::Small)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.branch_draft = None;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new("git-branch-create", "Create")
                                    .variant(ButtonVariant::Accent)
                                    .size(ButtonSize::Small)
                                    .disabled(self.branch_name_input.read(cx).text().trim().is_empty())
                                    .on_click(cx.listener(|this, _, _, cx| this.create_branch_from_draft(cx))),
                            ),
                    ),
            );
        }

        if show_current {
            let mut row = Row::new("branch-current", Icon::new(IconName::Check).size(IconSize::XSmall), current.clone());
            row.selected = true;
            row.secondary = Some(if ahead > 0 || behind > 0 { format!("↑{ahead} ↓{behind}") } else { "up to date".into() }.into());
            let (base, name) = (current.clone(), current.clone());
            row.actions = vec![
                row_button("branch-current-new", IconName::Plus, "New branch from here", cx, move |this, _, window, cx| {
                    this.start_branch_draft(Some(base.clone()), window, cx)
                })
                .into_any_element(),
                row_button("branch-current-copy", IconName::Copy, "Copy name", cx, move |this, _, _, cx| this.copy(name.clone(), cx))
                    .into_any_element(),
            ];
            list = list
                .child(div().h(metrics::LIST_ROW).flex().items_center().px(px(8.)).child(caption("Current", colors).font_weight(typography::MEDIUM)))
                .child(row.render(colors));
        }

        list = list.child(
            div()
                .h(metrics::LIST_ROW)
                .mt(px(8.))
                .flex()
                .items_center()
                .gap(px(6.))
                .px(px(8.))
                .child(caption("Local", colors).font_weight(typography::MEDIUM))
                .child(caption(others.len().to_string(), colors)),
        );
        for branch in &others {
            let name = (*branch).clone();
            let mut row = Row::new(
                format!("branch-{name}"),
                Icon::new(IconName::GitBranch).size(IconSize::XSmall).color(colors.subtle_foreground),
                name.clone(),
            );
            let (base, doomed, compare) = (name.clone(), name.clone(), name.clone());
            row.actions = vec![
                row_button(format!("branch-compare-{name}"), IconName::GitDiff, &format!("Compare with {current}"), cx, move |this, _, _, cx| {
                    this.view_branch_diff(compare.clone(), cx)
                })
                .into_any_element(),
                row_button(format!("branch-new-{name}"), IconName::Plus, "New branch from this", cx, move |this, _, window, cx| {
                    this.start_branch_draft(Some(base.clone()), window, cx)
                })
                .into_any_element(),
                row_button(format!("branch-delete-{name}"), IconName::Trash, "Delete", cx, move |this, event, window, cx| {
                    this.confirm_delete_branch(doomed.clone(), below(event), window, cx)
                })
                .into_any_element(),
            ];
            let menu_name = name.clone();
            let current_name = current.clone();
            row.context = Some(row_menu(format!("branch-menu-{name}"), cx, move |panel, position, cx| {
                let (switch, compare, base, copy, doomed) = (menu_name.clone(), menu_name.clone(), menu_name.clone(), menu_name.clone(), menu_name.clone());
                vec![
                    panel.item("Switch to Branch", cx, move |this, _, cx| this.checkout(switch.clone(), cx)).icon(IconName::GitBranch).into(),
                    panel.item(format!("Compare with {current_name}"), cx, move |this, _, cx| this.view_branch_diff(compare.clone(), cx)).icon(IconName::GitDiff).into(),
                    panel.item("New Branch from This", cx, move |this, window, cx| this.start_branch_draft(Some(base.clone()), window, cx)).icon(IconName::Plus).into(),
                    ui::MenuEntry::Separator,
                    panel.item("Copy Name", cx, move |this, _, cx| this.copy(copy.clone(), cx)).icon(IconName::Copy).into(),
                    ui::MenuEntry::Separator,
                    panel.item("Delete Branch…", cx, move |this, window, cx| this.confirm_delete_branch(doomed.clone(), position, window, cx)).icon(IconName::Trash).destructive().into(),
                ]
            }));
            let tooltip = format!("{name}\nClick to switch");
            list = list.child(
                row.render(colors)
                    .anchored_tooltip(move || ui::Tooltip::new(tooltip.clone()))
                    .on_click(cx.listener(move |this, _, _, cx| this.checkout(name.clone(), cx))),
            );
        }
        if others.is_empty() {
            list = list.child(
                caption(if query.trim().is_empty() { "No other branches" } else { "No matching branches" }, colors)
                    .py(px(16.))
                    .text_center()
                    .text_size(typography::TEXT_SM),
            );
        }

        let new_branch = Button::icon("git-new-branch", IconName::Plus)
            .size(ButtonSize::XSmall)
            .tooltip("New branch")
            .on_click(cx.listener(|this, _, window, cx| this.start_branch_draft(None, window, cx)))
            .into_any_element();
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .child(self.render_toolbar(self.branch_filter_input.clone(), Some(new_branch)))
            .child(list)
    }

    /// A tab's toolbar, the add form when open, and its list.
    fn render_ref_tab(
        &self,
        filter: gpui::Entity<ui::TextInput>,
        kind: DraftKind,
        add_tooltip: &'static str,
        extra: Option<AnyElement>,
        rows: Vec<AnyElement>,
        empty: Option<(&'static str, Option<&'static str>)>,
        colors: &ThemeColors,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let add = Button::icon(SharedString::from(format!("git-add-{add_tooltip}")), IconName::Plus)
            .size(ButtonSize::XSmall)
            .tooltip(add_tooltip)
            .on_click(cx.listener(move |this, _, window, cx| this.start_draft(kind, window, cx)))
            .into_any_element();
        let trailing = div().flex().items_center().gap(px(2.)).children(extra).child(add).into_any_element();
        let mut list = div().id(SharedString::from(format!("git-{add_tooltip}-list"))).flex().flex_col().flex_1().min_h_0().overflow_y_scroll().px(px(8.)).pb(px(12.));
        if self.draft == Some(kind) {
            list = list.child(self.render_draft(kind, colors, cx));
        }
        list = list.children(rows);
        if let Some((title, hint)) = empty {
            list = list.child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(2.))
                    .px(px(12.))
                    .py(px(24.))
                    .text_size(typography::TEXT_SM)
                    .child(div().text_color(colors.muted_foreground).child(title))
                    .children(hint.map(|hint| div().text_center().text_color(colors.subtle_foreground).child(hint))),
            );
        }
        div().flex().flex_col().flex_1().min_h_0().child(self.render_toolbar(filter, Some(trailing))).child(list)
    }

    fn render_draft(&self, kind: DraftKind, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let title = match kind {
            DraftKind::Worktree => "New worktree".to_string(),
            DraftKind::Remote => "Add remote".to_string(),
            DraftKind::Tag => format!("Tag the current commit on {}", if self.branch().is_empty() { "HEAD" } else { self.branch() }),
        };
        let first_empty = self.draft_first.read(cx).text().trim().is_empty();
        let second_empty = self.draft_second.read(cx).text().trim().is_empty();
        let ready = !first_empty && (kind != DraftKind::Remote || !second_empty);
        div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .px(px(4.))
            .pt(px(4.))
            .pb(px(10.))
            .child(caption(title, colors).px(px(4.)))
            .child(self.draft_first.clone())
            .child(self.draft_second.clone())
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(4.))
                    .child(
                        Button::new("git-draft-cancel", "Cancel")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .on_click(cx.listener(|this, _, _, cx| this.cancel_draft(cx))),
                    )
                    .child(
                        Button::new("git-draft-create", if kind == DraftKind::Remote { "Add" } else { "Create" })
                            .variant(ButtonVariant::Accent)
                            .size(ButtonSize::Small)
                            .disabled(!ready)
                            .on_click(cx.listener(|this, _, _, cx| this.submit_draft(cx))),
                    ),
            )
    }

    /// The workspace's repositories (`RepositoriesPanel`): a click shows one.
    fn render_repositories(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let query = self.repository_filter_input.read(cx).text().to_string();
        let current = self.repo_root();
        let root = self.root().to_path_buf();
        let paths = self.repository_paths();
        let rows: Vec<AnyElement> = paths
            .iter()
            .filter(|path| matches_query(&query, [path.to_string_lossy().as_ref()]))
            .enumerate()
            .map(|(index, path)| {
                let is_current = current.as_ref() == Some(path);
                let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned());
                let icon = if is_current {
                    Icon::new(IconName::Check).size(IconSize::XSmall)
                } else {
                    Icon::new(IconName::FolderOpen).size(IconSize::XSmall).color(colors.subtle_foreground)
                };
                let mut row = Row::new(("repository", index), icon, name);
                row.selected = is_current;
                let relative = path.strip_prefix(&root).ok().map(|relative| relative.to_string_lossy().into_owned()).filter(|relative| !relative.is_empty());
                row.secondary = Some(relative.unwrap_or_else(|| path.to_string_lossy().into_owned()).into());
                let copy = path.to_string_lossy().into_owned();
                row.actions.push(
                    row_button(("repository-copy", index), IconName::Copy, "Copy path", cx, move |this, _, _, cx| this.copy(copy.clone(), cx)).into_any_element(),
                );
                let tooltip = path.to_string_lossy().into_owned();
                let open = path.clone();
                row.render(colors)
                    .anchored_tooltip(move || ui::Tooltip::new(tooltip.clone()))
                    .when(!is_current, |row| row.on_click(cx.listener(move |this, _, _, cx| this.switch_repository(open.clone(), cx))))
                    .into_any_element()
            })
            .collect();
        let empty = rows.is_empty();
        let browse = Button::icon("git-repositories-add", IconName::Plus)
            .size(ButtonSize::XSmall)
            .tooltip("Add repository")
            .on_click(cx.listener(|this, _, _, cx| this.select_repository(cx)))
            .into_any_element();
        let mut list = div().id("git-repositories-list").flex().flex_col().flex_1().min_h_0().overflow_y_scroll().px(px(8.)).pb(px(12.)).children(rows);
        if empty {
            list = list.child(div().px(px(12.)).py(px(24.)).text_center().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child("No matching repositories"));
        }
        div().flex().flex_col().flex_1().min_h_0().child(self.render_toolbar(self.repository_filter_input.clone(), Some(browse))).child(list)
    }

    fn render_worktrees(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let query = self.worktree_filter_input.read(cx).text().to_string();
        let main = self.worktrees.first().map(|worktree| worktree.path.clone());
        let mut visible: Vec<_> = self
            .worktrees
            .iter()
            .filter(|worktree| matches_query(&query, [worktree.path.as_str(), worktree.branch.as_deref().unwrap_or("")]))
            .collect();
        visible.sort_by_key(|worktree| !worktree.is_current);
        let rows: Vec<AnyElement> = visible
            .iter()
            .enumerate()
            .map(|(index, worktree)| {
                let name = worktree.path.trim_end_matches('/').rsplit('/').next().unwrap_or(&worktree.path).to_string();
                let icon = if worktree.prunable {
                    Icon::new(IconName::Warning).size(IconSize::XSmall).color(colors.warning)
                } else if worktree.is_current {
                    Icon::new(IconName::Check).size(IconSize::XSmall)
                } else {
                    Icon::new(IconName::Nodes).size(IconSize::XSmall).color(colors.subtle_foreground)
                };
                let mut row = Row::new(("worktree", index), icon, name);
                row.selected = worktree.is_current;
                row.secondary = Some(
                    worktree.branch.clone().unwrap_or_else(|| if worktree.is_detached { "detached".into() } else { "no branch".into() }).into(),
                );
                if main.as_ref() == Some(&worktree.path) {
                    row.meta.push(caption("main", colors).into_any_element());
                } else if worktree.locked {
                    row.meta.push(caption("locked", colors).text_color(colors.warning).into_any_element());
                }
                let openable = !worktree.prunable;
                if openable {
                    let path = worktree.path.clone();
                    row.actions.push(
                        row_button(("worktree-window", index), IconName::OpenExternal, "Open in new window", cx, move |_, _, _, cx| {
                            workbench_api::open_project_in_new_window(cx, path.clone())
                        })
                        .into_any_element(),
                    );
                }
                let path = worktree.path.clone();
                row.actions.push(
                    row_button(("worktree-copy", index), IconName::Copy, "Copy path", cx, move |this, _, _, cx| this.copy(path.clone(), cx)).into_any_element(),
                );
                if !worktree.is_current && main.as_ref() != Some(&worktree.path) && !worktree.is_bare {
                    let doomed = worktree.path.clone();
                    row.actions.push(
                        row_button(("worktree-remove", index), IconName::Trash, "Remove", cx, move |this, event, window, cx| {
                            this.confirm_remove_worktree(doomed.clone(), below(event), window, cx)
                        })
                        .into_any_element(),
                    );
                }
                {
                    let (path, prunable) = (worktree.path.clone(), worktree.prunable);
                    let removable = !worktree.is_current && main.as_ref() != Some(&worktree.path) && !worktree.is_bare;
                    row.context = Some(row_menu(format!("worktree-menu-{index}"), cx, move |panel, position, cx| {
                        let mut entries: Vec<ui::MenuEntry> = Vec::new();
                        if !prunable {
                            let (open, window_path) = (path.clone(), path.clone());
                            entries.push(panel.item("Open", cx, move |_, _, cx| workbench_api::open_project(cx, open.clone())).icon(IconName::FolderOpen).into());
                            entries.push(panel.item("Open in New Window", cx, move |_, _, cx| workbench_api::open_project_in_new_window(cx, window_path.clone())).icon(IconName::OpenExternal).into());
                            entries.push(ui::MenuEntry::Separator);
                        }
                        let copy = path.clone();
                        entries.push(panel.item("Copy Path", cx, move |this, _, cx| this.copy(copy.clone(), cx)).icon(IconName::Copy).into());
                        if prunable {
                            entries.push(ui::MenuEntry::Separator);
                            entries.push(panel.item("Prune Stale Worktrees", cx, |this, _, cx| this.prune_worktrees(cx)).icon(IconName::Broom).into());
                        } else if removable {
                            let doomed = path.clone();
                            entries.push(ui::MenuEntry::Separator);
                            entries.push(panel.item("Remove Worktree…", cx, move |this, window, cx| this.confirm_remove_worktree(doomed.clone(), position, window, cx)).icon(IconName::Trash).destructive().into());
                        }
                        entries
                    }));
                }
                let click_to_open = openable && !worktree.is_current;
                let tooltip = if click_to_open { format!("{}\nClick to open", worktree.path) } else { worktree.path.clone() };
                let open = worktree.path.clone();
                let dragged = ui::DraggedResource::new(ui::WORKTREE_KIND, worktree.path.clone(), name_for_drag(&worktree.path), worktree.path.clone(), IconName::Nodes);
                row.render(colors)
                    .anchored_tooltip(move || ui::Tooltip::new(tooltip.clone()))
                    .when(openable, |row| row.on_drag(dragged, |dragged, _, _, cx| dragged.preview(cx)))
                    .when(click_to_open, |row| row.on_click(move |_, _, cx| workbench_api::open_project(cx, open.clone())))
                    .into_any_element()
            })
            .collect();
        let empty = visible.is_empty().then_some((
            if query.trim().is_empty() { "No worktrees" } else { "No matching worktrees" },
            Some("Worktrees let you check out several branches side by side."),
        ));
        let reload = Button::icon("git-worktrees-reload", IconName::ArrowsClockwise)
            .size(ButtonSize::XSmall)
            .tooltip("Reload")
            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx)))
            .into_any_element();
        self.render_ref_tab(self.worktree_filter_input.clone(), DraftKind::Worktree, "New worktree", Some(reload), rows, empty, colors, cx)
    }

    fn render_remotes(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let query = self.remote_filter_input.read(cx).text().to_string();
        let busy = self.remote_action.is_some();
        let visible: Vec<_> = self.remotes.iter().filter(|remote| matches_query(&query, [remote.name.as_str(), remote.url.as_str()])).collect();
        let rows: Vec<AnyElement> = visible
            .iter()
            .enumerate()
            .map(|(index, remote)| {
                let mut row = Row::new(("remote", index), Icon::new(IconName::Globe).size(IconSize::XSmall).color(colors.subtle_foreground), remote.name.clone());
                row.secondary = Some(remote.url.clone().into());
                row.muted = busy;
                let (fetch, url, doomed) = (remote.name.clone(), remote.url.clone(), remote.name.clone());
                row.actions = vec![
                    row_button(("remote-fetch", index), IconName::ArrowsClockwise, &format!("Fetch {}", remote.name), cx, move |this, _, _, cx| {
                        this.fetch_remote(Some(fetch.clone()), cx)
                    })
                    .into_any_element(),
                    row_button(("remote-copy", index), IconName::Copy, "Copy URL", cx, move |this, _, _, cx| this.copy(url.clone(), cx)).into_any_element(),
                    row_button(("remote-remove", index), IconName::Trash, "Remove", cx, move |this, event, window, cx| {
                        this.confirm_remove_remote(doomed.clone(), below(event), window, cx)
                    })
                    .into_any_element(),
                ];
                let (name, url) = (remote.name.clone(), remote.url.clone());
                row.context = Some(row_menu(format!("remote-menu-{index}"), cx, move |panel, position, cx| {
                    let (fetch, copy_url, copy_name, doomed) = (name.clone(), url.clone(), name.clone(), name.clone());
                    vec![
                        panel.item(format!("Fetch {name}"), cx, move |this, _, cx| this.fetch_remote(Some(fetch.clone()), cx)).icon(IconName::ArrowsClockwise).into(),
                        ui::MenuEntry::Separator,
                        panel.item("Copy URL", cx, move |this, _, cx| this.copy(copy_url.clone(), cx)).icon(IconName::Copy).into(),
                        panel.item("Copy Name", cx, move |this, _, cx| this.copy(copy_name.clone(), cx)).icon(IconName::Copy).into(),
                        ui::MenuEntry::Separator,
                        panel.item("Remove Remote…", cx, move |this, window, cx| this.confirm_remove_remote(doomed.clone(), position, window, cx)).icon(IconName::Trash).destructive().into(),
                    ]
                }));
                let tooltip = remote.url.clone();
                row.render(colors).anchored_tooltip(move || ui::Tooltip::new(tooltip.clone())).into_any_element()
            })
            .collect();
        let fetch_all = Button::icon("git-fetch-all", IconName::ArrowsClockwise)
            .size(ButtonSize::XSmall)
            .tooltip("Fetch all")
            .disabled(busy || self.remotes.is_empty())
            .on_click(cx.listener(|this, _, _, cx| this.fetch_remote(None, cx)))
            .into_any_element();
        let empty = visible.is_empty().then_some(if query.trim().is_empty() {
            ("No remotes", Some("Add one to push and pull."))
        } else {
            ("No matching remotes", None)
        });
        self.render_ref_tab(self.remote_filter_input.clone(), DraftKind::Remote, "Add remote", Some(fetch_all), rows, empty, colors, cx)
    }

    fn render_tags(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let query = self.tag_filter_input.read(cx).text().to_string();
        let now = now_seconds();
        let rows: Vec<AnyElement> = self
            .tags
            .iter()
            .enumerate()
            .filter(|(_, tag)| matches_query(&query, [tag.name.as_str(), tag.message.as_deref().unwrap_or(""), tag.commit.as_str()]))
            .map(|(index, tag)| {
                let previous = self.tags.get(index + 1);
                // The version bright and its pre-release part dimmed beside it, so releases stand
                // out from their betas; no icon on every row, the hash and message in the tooltip.
                let (version, prerelease) = match tag.name.split_once('-') {
                    Some((version, rest)) if version.chars().any(|c| c.is_ascii_digit()) => (version.to_string(), Some(rest.to_string())),
                    _ => (tag.name.clone(), None),
                };
                let mut row = Row::new(("tag", index), div(), version);
                row.icon = None;
                row.secondary = prerelease.map(Into::into);
                if !tag.date.is_empty() {
                    row.meta.push(caption(model::relative_date(&tag.date, now), colors).into_any_element());
                }
                let target = tag.name.clone();
                row.actions.push(
                    row_button(("tag-compare-head", index), IconName::GitDiff, "Compare with HEAD", cx, move |this, _, _, cx| {
                        this.compare_tag("HEAD".into(), target.clone(), cx)
                    })
                    .into_any_element(),
                );
                let (menu_tag, menu_previous) = (tag.clone(), previous.cloned());
                row.actions.push(
                    row_button(("tag-menu", index), IconName::Dots, "Tag actions", cx, move |this, event, window, cx| {
                        let entries = this.tag_menu(&menu_tag, menu_previous.as_ref(), cx);
                        this.show_menu(&format!("tag:{}", menu_tag.name), entries, below(event), Anchor::TopRight, window, cx);
                    })
                    .into_any_element(),
                );
                let (context_tag, context_previous) = (tag.clone(), previous.cloned());
                row.context = Some(row_menu(format!("tag:{}", tag.name), cx, move |panel, _, cx| panel.tag_menu(&context_tag, context_previous.as_ref(), cx)));
                let base = previous.map_or_else(|| "HEAD".to_string(), |tag| tag.name.clone());
                let tooltip = format!(
                    "{} · {}{}\nClick to see what changed since {base}",
                    tag.name,
                    short_hash(&tag.commit),
                    tag.message.as_ref().filter(|message| !message.is_empty()).map(|message| format!("\n{message}")).unwrap_or_default(),
                );
                let target = tag.name.clone();
                row.render(colors)
                    .anchored_tooltip(move || ui::Tooltip::new(tooltip.clone()))
                    .on_click(cx.listener(move |this, _, _, cx| this.compare_tag(base.clone(), target.clone(), cx)))
                    .into_any_element()
            })
            .collect();
        let empty = rows.is_empty().then_some((if query.trim().is_empty() { "No tags" } else { "No matching tags" }, None));
        self.render_ref_tab(self.tag_filter_input.clone(), DraftKind::Tag, "New tag", None, rows, empty, colors, cx)
    }

}

impl Render for GitPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let body = match &self.repo {
            RepoState::Missing { error } => {
                let missing = self.render_missing(error.clone(), cx);
                div().flex().flex_col().flex_1().min_h_0().child(self.render_title_only(cx)).child(missing).into_any_element()
            }
            RepoState::Ready(_) if self.tree.is_some() => {
                let content = match self.tab {
                    Tab::Changes => div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_h_0()
                        .child(self.render_identity(&colors, cx))
                        .child(self.render_composer(&colors, cx))
                        .child(self.render_toolbar(self.filter_input.clone(), Some(self.render_compare_button(cx))))
                        .child(self.render_changes(&colors, cx))
                        .into_any_element(),
                    Tab::Branches => self.render_branches(&colors, cx).into_any_element(),
                    Tab::Worktrees => self.render_worktrees(&colors, cx).into_any_element(),
                    Tab::Remotes => self.render_remotes(&colors, cx).into_any_element(),
                    Tab::Tags => self.render_tags(&colors, cx).into_any_element(),
                    Tab::Repositories => self.render_repositories(&colors, cx).into_any_element(),
                };
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .child(self.render_tabs(&colors, window, cx))
                    .child(content)
                    .into_any_element()
            }
            _ => div()
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .child(self.render_title_only(cx))
                .child(
                    div()
                        .flex()
                        .flex_1()
                        .items_center()
                        .justify_center()
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.subtle_foreground)
                        .child("Loading Git status…"),
                )
                .into_any_element(),
        };
        div()
            .id("git-panel")
            .track_focus(&self.focus_handle)
            // No fill of its own: it sits on the sidebar like the other tools. A surface fill
            // made it a darker box than Files with glass on, where surface is the more opaque.
            .flex()
            .flex_col()
            .flex_1()
            .size_full()
            .min_h_0()
            .min_w_0()
            .child(body)
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}

/// A worktree's folder name, as its row shows it.
fn name_for_drag(path: &str) -> String {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or(path).to_string()
}
