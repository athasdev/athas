//! Drawing the panel, after the web workbench's `stream` source control sidebar.

use ui::TooltipExt as _;
use web_time::{SystemTime, UNIX_EPOCH};

use gpui::{
    Anchor, AnyElement, ClickEvent, Context, ElementId, Hsla, IntoElement, MouseButton, MouseDownEvent, Render,
    SharedString, Window, div, point, prelude::*, px,
};
use theme::{ActiveTheme, ThemeColors};
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, Plane, WithScrollbar as _, metrics, typography};

use crate::{
    DraftKind, GitPanel, RepoState, Section, Tab,
    model::{self, ChangeFile, can_discard, filter_files, matches_query, plural, short_hash, status_letter},
    repository::{Commit, FileStatus, RemoteOp},
};

/// A sidebar bar: the identity row and the toolbars.
const BAR_HEIGHT: gpui::Pixels = px(32.);

pub(crate) fn now_seconds() -> i64 {
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
    pub(crate) fn render_header_buttons(&self, cx: &mut Context<Self>) -> AnyElement {
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

    /// Changes and History as an outline: each unfolds in place, History to its latest commits and
    /// a "View more" that opens the commit menu.
    fn render_categories(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let mut list = div().flex().flex_col().gap(px(2.));
        for (label, icon, count, which) in [
            ("Changes", IconName::GitDiff, Some(self.file_count()), Tab::Changes),
            ("History", IconName::History, None, Tab::History),
        ] {
            let open = self.expanded.contains(&which);
            let mut row = ui::AccordionRow::new(
                gpui::ElementId::Name(format!("git-category-{label}").into()),
                label,
                icon,
                open,
                cx.listener(move |panel, _: &ClickEvent, _, cx| panel.toggle_tab(which, cx)),
            );
            if let Some(count) = count {
                row = row.count(count);
            }
            list = list.child(row);
            if open {
                list = list.child(match which {
                    Tab::Changes => div()
                        .flex()
                        .flex_col()
                        .child(self.render_composer(colors, cx))
                        .child(self.render_toolbar(self.filter_input.clone(), Some(self.render_compare_button(cx))))
                        .child(self.render_changes(colors, cx))
                        .into_any_element(),
                    Tab::History => self.render_recent_commits(colors, cx).into_any_element(),
                });
            }
        }
        list
    }

    /// The latest commits on an indent guide, then "View more" for the full searchable list.
    fn render_recent_commits(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        const SHOWN: usize = 5;
        let now = now_seconds();
        let (ahead, _) = self.ahead_behind();
        let rows: Vec<AnyElement> = self
            .commits
            .iter()
            .take(SHOWN)
            .enumerate()
            .map(|(index, commit)| {
                let open = commit.clone();
                let unpushed = index < ahead;
                let dot = div().flex_none().size(px(6.)).rounded_full().bg(colors.primary);
                let item = ui::SidebarListItem::new(SharedString::from(format!("git-recent-commit-{}", commit.hash)), commit.summary.clone())
                    .leading(ui::Avatar::new(&commit.author).size(px(16.)).image(git_diff::avatar::author_avatar(&commit.email, cx)))
                    .indicator(unpushed.then_some(dot))
                    .trailing(model::relative_date(&commit.date, now))
                    .active(self.open_commit.as_deref() == Some(commit.hash.as_str()))
                    .on_click(cx.listener(move |panel, _: &ClickEvent, _, cx| panel.open_commit(&open, cx)));
                div()
                    .id(SharedString::from(format!("git-recent-{}", commit.hash)))
                    .flex_none()
                    .px(px(8.))
                    .on_drag(self.commit_drag(commit), |dragged, _, _, cx| dragged.preview(cx))
                    .child(item)
                    .into_any_element()
            })
            .collect();
        let empty = rows.is_empty();
        let more = (self.commits.len() > SHOWN || self.has_more_commits).then(|| {
            let item = ui::SidebarListItem::new("git-history-more", "View more").on_click(cx.listener(|panel, event: &ClickEvent, window, cx| {
                panel.show_history_menu(below(event), Anchor::TopLeft, window, cx)
            }));
            div().flex_none().px(px(8.)).child(item)
        });
        div()
            .relative()
            .flex()
            .flex_col()
            .flex_none()
            .pl(px(16.))
            .gap(px(2.))
            .child(div().absolute().top(px(2.)).bottom(px(2.)).left(px(20.)).w(px(1.)).bg(colors.border))
            .children(rows)
            .when(empty, |this| this.child(caption("No commits yet", colors).px(px(8.)).py(px(4.)).text_size(typography::TEXT_SM)))
            .children(more)
    }

    /// The rows under the list: stashes, remotes and tags each open their menu where they were
    /// clicked, instead of folding open.
    fn render_footer(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let mut rows: Vec<AnyElement> = Vec::new();
        let mut add = |id: &'static str, label: &'static str, icon: IconName, count: usize, open: fn(&mut GitPanel, gpui::Point<gpui::Pixels>, Anchor, &mut Window, &mut Context<GitPanel>)| {
            let item = ui::SidebarListItem::new(id, label)
                .leading(Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground))
                .trailing(count.to_string())
                .active(self.menu_is_open(id))
                .on_click(cx.listener(move |panel, event: &ClickEvent, window, cx| open(panel, event.position(), Anchor::BottomLeft, window, cx)));
            rows.push(div().flex_none().px(px(8.)).child(item).into_any_element());
        };
        if self.is_visible("stashes") {
            add("git-stashes", "Stashes", IconName::Stack, self.stashes.len(), GitPanel::show_stashes_menu);
        }
        if self.is_visible("remotes") {
            add("git-remotes", "Remotes", IconName::Globe, self.remotes.len(), GitPanel::show_remotes_menu);
        }
        if self.is_visible("tags") {
            add("git-tags", "Tags", IconName::Tag, self.tags.len(), GitPanel::show_tags_menu);
        }
        div().flex().flex_col().flex_none().gap(px(2.)).py(px(4.)).children(rows)
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
            .on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.show_branches_menu(below(event), Anchor::TopLeft, window, cx)));

        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(2.))
            .h(BAR_HEIGHT)
            .px(px(8.))
            .child(context)
            .child(self.render_sync_button(colors, cx))
            .child(div().flex_1())
            .child(self.render_header_buttons(cx))
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
        // The halves round their own outer corners: GPUI clips to a rectangle, so a rounded
        // parent leaves a child's fill (here the hover tint) square in the corners.
        div()
            .flex()
            .flex_none()
            .h(metrics::CHROME_CONTROL)
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
                    .rounded_l(metrics::RADIUS_MD)
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
                    .rounded_r(metrics::RADIUS_MD)
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
                .rounded(metrics::RADIUS_MD)
                .bg(colors.raised)
                .shadow(theme.shadows.raised_inset.clone())
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
                        // GPUI clips to a rectangle, so a rounded parent does not round a filled
                        // child: each half rounds its own outer corners instead.
                        .child({
                            let (hover, divider) = (colors.primary_hover, colors.primary_foreground.opacity(0.2));
                            // Commit can be unavailable while the menu is not: with a message
                            // typed and nothing staged, Stage All & Commit still works. So the
                            // label dims on its own; dimming the half would leave the chevron
                            // bright beside it and split the block in two.
                            let label = if can_commit { colors.primary_foreground } else { colors.primary_foreground.opacity(0.5) };
                            div()
                                .flex()
                                .flex_none()
                                .h(px(24.))
                                .text_color(colors.primary_foreground)
                                .child(
                                    div()
                                        .id("git-commit")
                                        .flex()
                                        .items_center()
                                        .px(px(10.))
                                        .rounded_l(metrics::RADIUS_MD)
                                        .bg(colors.primary)
                                        .text_size(typography::TEXT_SM)
                                        .font_weight(typography::MEDIUM)
                                        .whitespace_nowrap()
                                        .text_color(label)
                                        .child(if self.committing { "Committing…" } else { "Commit" })
                                        .anchored_tooltip(|| ui::Tooltip::new("Commit (⌘↵)"))
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
                                        .rounded_r(metrics::RADIUS_MD)
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
            Section::History => Vec::new(),
        }
    }

    fn section_title(section: Section) -> &'static str {
        match section {
            Section::Staged => "Staged",
            Section::Changes => "Changes",
            Section::History => "History",
        }
    }

    fn section_count(&self, section: Section) -> usize {
        match section {
            Section::Staged => self.groups.staged.len(),
            Section::Changes => self.groups.unstaged.len(),
            Section::History => self.commits.len(),
        }
    }

    /// The History search field shows in the section's sticky area once there are more than five
    /// commits.
    fn section_has_toolbar(&self, section: Section) -> bool {
        section == Section::History && self.section_open(section, self.commits.len()) && self.commits.len() > 5
    }

    /// A section's header: the same row as the tabs, one step in, with its actions on hover.
    fn render_section_header(&self, section: Section, cx: &mut Context<Self>) -> ui::AccordionRow {
        let title = Self::section_title(section);
        let count = self.section_count(section);
        let open = self.section_open(section, count);
        let icon = match section {
            Section::Staged => IconName::CheckCircle,
            Section::Changes => IconName::PencilLine,
            Section::History => IconName::History,
        };
        let mut row = ui::AccordionRow::new(
            SharedString::from(format!("git-sub-{title}")),
            title,
            icon,
            open,
            cx.listener(move |this, _: &ClickEvent, _, cx| this.toggle_section(section, cx)),
        )
        .count(count);
        let actions = self.section_actions(section, cx);
        if !actions.is_empty() {
            row = row.trailing(div().flex().items_center().gap(px(2.)).children(actions));
        }
        row
    }

    /// The History search bar under its header.
    fn render_history_toolbar(&self) -> gpui::Div {
        div().h(BAR_HEIGHT).pl(px(16.)).pr(px(8.)).flex().items_center().child(self.history_filter_input.clone())
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

        for section in sections {
            let open = self.section_open(section, self.section_count(section));
            let mut block = div().flex().flex_col().child(self.render_section_header(section, cx));
            if open && self.section_has_toolbar(section) {
                block = block.child(self.render_history_toolbar());
            }
            if open {
                block = block.child(div().child(match section {
                    Section::Staged => self.render_file_rows(Section::Staged, &staged, colors, cx),
                    Section::Changes => self.render_file_rows(Section::Changes, &unstaged, colors, cx),
                    Section::History => self.render_history(now, colors, cx).into_any_element(),
                }));
            }
            children.push(block.into_any_element());
        }

        div().flex().flex_col().gap(px(2.)).children(children)
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
            let dot = div().flex_none().size(px(6.)).rounded_full().bg(colors.primary);
            let copy_hash = commit.hash.clone();
            let branch_base = commit.hash.clone();
            let actions = div()
                .flex()
                .items_center()
                .gap(px(2.))
                .child(row_button(format!("hover-copy-{}", commit.hash), IconName::Copy, "Copy commit hash", cx, move |this, _, _, cx| this.copy(copy_hash.clone(), cx)))
                .child(row_button(format!("hover-branch-{}", commit.hash), IconName::GitBranch, "New branch from this commit", cx, move |this, _, window, cx| {
                    this.start_branch_draft(Some(branch_base.clone()), window, cx)
                }));
            let item = ui::SidebarListItem::new(SharedString::from(format!("commit-{}-item", commit.hash)), commit.summary.clone())
                .leading(ui::Avatar::new(&commit.author).size(px(16.)).image(git_diff::avatar::author_avatar(&commit.email, cx)))
                .indicator(unpushed.then_some(dot))
                .detail(commit.author.clone())
                .trailing(model::relative_date(&commit.date, now))
                .hover_trailing(actions)
                .active(selected);
            div()
                .id(SharedString::from(format!("commit-{}", commit.hash)))
                .flex()
                .flex_col()
                .w_full()
                .flex_none()
                .on_drag(self.commit_drag(&commit), |dragged, _, _, cx| dragged.preview(cx))
                .on_click(cx.listener(move |this, _, _, cx| this.open_commit(&open, cx)))
                .child(item)
                .children(expanded.map(|expanded| div().pl(px(22.)).pr(px(6.)).pb(px(6.)).child(expanded)))
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

    fn render_branch_draft(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let draft = self.branch_draft.as_ref()?;
        let current = self.branch();
        let from = draft.base.as_deref().map(|base| if base.len() == 40 { short_hash(base) } else { base }).unwrap_or(current);
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .px(px(12.))
                .py(px(6.))
                .child(caption(format!("New branch from {from}"), colors))
                .child(self.branch_name_input.clone())
                .child(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(4.))
                        .child(Button::new("git-branch-cancel", "Cancel").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| {
                            this.branch_draft = None;
                            cx.notify();
                        })))
                        .child(
                            Button::new("git-branch-create", "Create")
                                .variant(ButtonVariant::Accent)
                                .size(ButtonSize::Small)
                                .disabled(self.branch_name_input.read(cx).text().trim().is_empty())
                                .on_click(cx.listener(|this, _, _, cx| this.create_branch_from_draft(cx))),
                        ),
                )
                .into_any_element(),
        )
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
                let identity = self.render_identity(&colors, cx).into_any_element();
                let branch_draft = self.render_branch_draft(&colors, cx);
                let categories = self.render_categories(&colors, cx).into_any_element();
                let draft = self.draft.map(|kind| self.render_draft(kind, &colors, cx).into_any_element());
                let footer = self.render_footer(&colors, cx).into_any_element();
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .child(identity)
                    .children(branch_draft)
                    .child(
                        div()
                            .id("git-scroll")
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .track_scroll(&self.changes_scroll)
                            .child(categories)
                            .scrollbar(window, cx),
                    )
                    .children(draft.map(|draft| div().flex_none().px(px(8.)).child(draft)))
                    .child(footer)
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
