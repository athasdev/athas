use ui::scale::px;
use gpui::{AnyElement, App, Context, DragMoveEvent, IntoElement, MouseButton, ParentElement, SharedString, Styled, StyledImage, Window, canvas, div, prelude::*, relative};
use theme::ActiveTheme;
use ui::{
    Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, Tab, framed_pane, metrics,
    pane_actions, pane_header,
};
use workspace::{DropZone, PaneNode, Panes, SplitAxis, TabItem, project_name};

/// `shouldShowTabCloseButton`: pinned tabs always show their pin.
fn close_button_shown(visibility: &str, active: bool, pinned: bool) -> bool {
    pinned || visibility == "always" || (visibility == "active" && active)
}

/// A tab being dragged to another group.
#[derive(Clone)]
pub(crate) struct DraggedTab {
    group: u64,
    index: usize,
    label: String,
    icon: IconName,
}

/// The tab under the pointer while it is dragged.
struct DraggedTabPreview(DraggedTab);

impl gpui::Render for DraggedTabPreview {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        Tab::new("dragged-tab", self.0.label.clone()).icon(self.0.icon).active(true)
    }
}

/// What every group of the split needs to know about the whole.
struct PaneLayout<'a> {
    panes: &'a Panes,
    /// The group in the top-left corner, under the floating title controls.
    leading: u64,
    /// The group in the top-right corner, which carries the centre's own actions.
    trailing: u64,
}

/// A file tab's icon from the icon theme (`BufferTypeIcon`).
fn file_icon(item: &TabItem, cx: &App) -> Option<AnyElement> {
    let TabItem::File { path } = item else { return None };
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    extensions::file_icon(name, px(12.), cx)
}

fn top_left(node: &PaneNode) -> u64 {
    match node {
        PaneNode::Group { id } => *id,
        PaneNode::Split { first, .. } => top_left(first),
    }
}

fn top_right(node: &PaneNode) -> u64 {
    match node {
        PaneNode::Group { id } => *id,
        PaneNode::Split { axis: SplitAxis::Horizontal, second, .. } => top_right(second),
        PaneNode::Split { first, .. } => top_right(first),
    }
}

use crate::{Drag, NewSession, OpenProject, QuickOpen, Workbench};

impl Workbench {
    /// The centre: the tabs of the session or project in front, and the bottom pane below them.
    pub(crate) fn render_centre(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let bottom = self.state.layout.bottom_pane_visible && !self.centre_maximized;
        let bottom_full_screen = self.bottom_full_screen && self.state.layout.bottom_pane_visible;
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w(metrics::min_centre_width())
            .min_h_0()
            .when(bottom_full_screen, |this| this.child(self.render_bottom_content(window, cx)))
            .when(!bottom_full_screen, |this| {
                this.child(match self.settings_takes_the_centre() {
                    true => self.render_settings_island(),
                    false => self.render_editor_island(window, cx),
                })
                .when(bottom, |this| this.child(self.render_bottom_pane(window, cx)))
            })
    }

    /// What the bottom pane shows (`bottomPaneActiveTab`): the terminals, the debugger with a
    /// header of its own, or the editor groups moved down there.
    fn render_bottom_content(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        match self.state.layout.bottom_tab {
            workspace::BottomTab::Buffers if !self.state.bottom.is_empty() => {
                let panes = self.state.bottom.clone();
                let layout = PaneLayout { panes: &panes, leading: u64::MAX, trailing: u64::MAX };
                div().flex().flex_col().flex_1().min_h_0().child(self.render_pane_node(&panes.root, &layout, window, cx)).into_any_element()
            }
            workspace::BottomTab::Debugger if self.debugger.is_some() => {
                let full_screen = self.bottom_full_screen;
                let header = div()
                    .absolute()
                    .top(px(6.))
                    .right(px(8.))
                    .child(
                        pane_actions()
                            .child(
                                Button::icon("debugger-full-screen", if full_screen { IconName::ArrowsIn } else { IconName::ArrowsOut })
                                    .size(ButtonSize::Small)
                                    .tooltip(if full_screen { "Exit full screen Run and Debug" } else { "Full screen Run and Debug" })
                                    .on_click(cx.listener(|this, _, _, cx| this.toggle_bottom_full_screen(cx))),
                            )
                            .child(
                                Button::icon("debugger-hide", IconName::X)
                                    .size(ButtonSize::Small)
                                    .tooltip("Close Panel")
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.bottom_full_screen = false;
                                        this.update_state(cx, |state| state.layout.bottom_pane_visible = false);
                                        this.restore_focus(window, cx);
                                    })),
                            ),
                    );
                framed_pane()
                    .relative()
                    .flex_1()
                    .child(div().flex().flex_col().flex_1().min_h_0().children(self.debugger.as_ref().map(|(debugger, _)| debugger.clone())))
                    .child(header)
                    .into_any_element()
            }
            _ => framed_pane().flex_1().children(self.terminal.as_ref().map(|(terminal, _)| terminal.clone())).into_any_element(),
        }
    }

    /// Whether Settings has the centre. It is a mode, not a document: the sidebar lists the
    /// pages and the centre shows the one picked, and leaving the sidebar gives the tabs back
    /// untouched. A tab would have belonged to one project or chat, and Settings belongs to none.
    pub(crate) fn settings_takes_the_centre(&self) -> bool {
        self.state.layout.sidebar_visible
            && self.state.layout.sidebar_view == workspace::SidebarView::Settings
            && self.settings_panel.is_some()
    }

    /// The Settings page, filling the centre in place of the editor groups.
    fn render_settings_island(&self) -> AnyElement {
        ui::framed_pane()
            .flex_1()
            .children(self.settings_panel.as_ref().map(|(view, _)| view.clone()))
            .into_any_element()
    }

    fn render_editor_island(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let panes = self.state.centre_panes().cloned().unwrap_or_default();
        if let Some(group) = self.fullscreen_group.filter(|group| panes.group(*group).is_some()) {
            let layout = PaneLayout { panes: &panes, leading: group, trailing: group };
            return self.render_group(group, &layout, window, cx);
        }
        let leading = top_left(&panes.root);
        let trailing = top_right(&panes.root);
        let layout = PaneLayout { panes: &panes, leading, trailing };
        self.render_pane_node(&panes.root, &layout, window, cx)
    }

    fn render_pane_node(&self, node: &PaneNode, layout: &PaneLayout, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        match node {
            PaneNode::Group { id } => self.render_group(*id, layout, window, cx),
            PaneNode::Split { id, axis, ratio, first, second } => {
                let horizontal = *axis == SplitAxis::Horizontal;
                let split_id = *id;
                let axis = *axis;
                let ratio = *ratio;
                let sizes = self.split_sizes.clone();
                let resizing = matches!(self.drag, Some(Drag::Split { split, .. }) if split == split_id);
                let focus = self.split_focus.borrow_mut().entry(split_id).or_insert_with(|| cx.focus_handle()).clone();
                let focused = focus.is_focused(window);
                // Primary while dragged; hovered or focused (it takes focus for the arrow keys) it
                // shows the strong border, so a finished drag does not leave it lit.
                let line = if resizing { cx.theme().colors.primary } else { cx.theme().colors.border_strong };
                let divider = cx.theme().colors.border;
                let handle = div()
                    .id(("split-handle", split_id as usize))
                    .track_focus(&focus.tab_stop(true))
                    .on_key_down(cx.listener(move |this, event: &gpui::KeyDownEvent, _, cx| {
                        let keystroke = &event.keystroke;
                        if keystroke.modifiers.platform || keystroke.modifiers.control || keystroke.modifiers.alt {
                            return;
                        }
                        let Some(next) = workspace::split_ratio_for_key(ratio, &keystroke.key, keystroke.modifiers.shift, horizontal) else { return };
                        cx.stop_propagation();
                        this.update_state(cx, |state| state.set_split_ratio(split_id, next));
                    }))
                    .on_click(cx.listener(move |this, event: &gpui::ClickEvent, _, cx| {
                        if event.click_count() == 2 {
                            this.update_state(cx, |state| state.set_split_ratio(split_id, 0.5));
                        }
                    }))
                    .flex()
                    .items_center()
                    .justify_center()
                    .group("split-handle")
                    .when(horizontal, |this| this.cursor_col_resize())
                    .when(!horizontal, |this| this.cursor_row_resize())
                    .child(
                        div()
                            .when(horizontal, |this| this.w(px(1.)).h_full())
                            .when(!horizontal, |this| this.h(px(1.)).w_full())
                            .when(resizing || focused, |this| this.bg(line))
                            .group_hover("split-handle", move |style| style.bg(line)),
                    )
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, event: &gpui::MouseDownEvent, window, cx| {
                            if let Some(focus) = this.split_focus.borrow().get(&split_id) {
                                window.focus(focus, cx);
                            }
                            this.drag = Some(Drag::Split {
                                split: split_id,
                                horizontal: axis == SplitAxis::Horizontal,
                                start: if horizontal { event.position.x } else { event.position.y },
                                start_ratio: ratio,
                            });
                            cx.stop_propagation();
                            cx.notify();
                        }),
                    );
                div()
                    .relative()
                    .flex()
                    .when(horizontal, |this| this.flex_row())
                    .when(!horizontal, |this| this.flex_col())
                    .flex_1()
                    .size_full()
                    .min_w_0()
                    .min_h_0()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_basis(gpui::relative(ratio))
                            .flex_shrink(1.)
                            .min_w_0()
                            .min_h_0()
                            .child(self.render_pane_node(first, layout, window, cx)),
                    )
                    .child(crate::resize_edge(horizontal, divider, handle))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .child(self.render_pane_node(second, layout, window, cx)),
                    )
                    .child(
                        canvas(
                            move |bounds, _, _| {
                                let size = if horizontal { bounds.size.width } else { bounds.size.height };
                                sizes.borrow_mut().insert(split_id, size);
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .into_any_element()
            }
        }
    }

    fn render_group(&self, group_id: u64, layout: &PaneLayout, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(group) = layout.panes.group(group_id) else { return div().into_any_element() };
        let tabs = group.tabs.clone();
        let platform = self.platform;
        let split = layout.panes.groups.len() > 1;
        // While the sidebar is hidden, the title controls float over the top-left header.
        let leading_space = px(0.);
        let trailing = group_id == layout.trailing;
        let trailing_space = if trailing && matches!(platform, crate::Platform::Windows | crate::Platform::Linux) {
            px(116.)
        } else {
            px(0.)
        };

        let (show_icons, close_visibility) = {
            let settings = settings::get(cx);
            (settings.show_tab_icons, settings.tab_close_button_visibility.clone())
        };
        let scroll = {
            let mut scrolls = self.tab_scrolls.borrow_mut();
            let (handle, shown) = scrolls.entry(group_id).or_default();
            // Bring the tab in front into view when it changes or a tab opens.
            if tabs.active.is_some() && *shown != tabs.active {
                if let Some(active) = tabs.active {
                    handle.scroll_to_item(active);
                }
                *shown = tabs.active;
            }
            handle.clone()
        };
        let drop_marker = cx.theme().colors.primary;
        let file_paths: Vec<Option<&str>> = tabs.tabs.iter().map(|item| if let TabItem::File { path } = item { Some(path.as_str()) } else { None }).collect();
        let display_names = display_names(&file_paths);
        // The welcome opens as a tab of its own in the top-left group (`openOnboardingBuffer`).
        let welcome = self.onboarding.as_ref().filter(|_| group_id == layout.leading).map(|(view, _)| view.clone());
        let welcome_active = welcome.is_some() && (self.onboarding_reopened || tabs.tabs.is_empty());
        let close_shortcut = cx
            .try_global::<keymap::ActiveKeymap>()
            .and_then(|active| keymap::shortcuts_by_command(&active.bindings).get("file.close").map(|key| SharedString::from(keymap::display_key(key))));
        let mut tab_elements: Vec<AnyElement> = tabs
            .tabs
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let (label, icon) = self.tab_label(item);
                let label = display_names[index].clone().unwrap_or(label);
                let dragged = DraggedTab { group: group_id, index, label: label.clone(), icon };
                let active = tabs.active == Some(index) && !welcome_active;
                let pinned = tabs.is_pinned(index);
                let (brand, attention) = self.tab_decoration(item);
                let favicon = self.tab_favicon(group_id, item, cx);
                let warning = cx.theme().colors.warning;
                let tab = Tab::new(gpui::ElementId::Name(format!("tab-{group_id}-{index}").into()), label)
                    .when(show_icons, |tab| match (brand, favicon, file_icon(item, cx)) {
                        (Some(brand), _, _) => tab.leading(brand.size(px(12.))),
                        (None, Some(favicon), _) => tab.leading(favicon),
                        (None, None, Some(file)) => tab.leading(file),
                        (None, None, None) => tab.icon(icon),
                    })
                    .when(attention, |tab| tab.indicator(div().flex_none().size(px(8.)).rounded_full().bg(warning)))
                    .dirty(self.dirty_tabs.contains(&crate::centre_views::view_key(group_id, item)))
                    .active(active)
                    .pinned(pinned)
                    .close_shortcut(close_shortcut.clone().filter(|_| !pinned))
                    .show_close(close_button_shown(&close_visibility, active, pinned))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.onboarding_reopened = false;
                        this.update_state(cx, |state| {
                            state.focus_group(group_id);
                            state.activate_tab(index);
                        });
                        // The tab that had focus is no longer drawn; keys pressed with focus on
                        // it reach no handler, so ⌘2 and the others would go nowhere.
                        this.focus_front_tab(window, cx)
                    }))
                    .on_close(cx.listener(move |this, _, window, cx| {
                        if pinned {
                            this.update_state(cx, |state| {
                                state.focus_group(group_id);
                                state.toggle_tab_pinned(index);
                            });
                        } else {
                            this.close_tabs_guarded(
                                move |state| {
                                    state.focus_group(group_id);
                                    state.close_tab(index);
                                },
                                window,
                                cx,
                            );
                        }
                    }))
                    .on_middle_click(cx.listener(move |this, _, window, cx| {
                        cx.stop_propagation();
                        this.close_tabs_guarded(
                            move |state| {
                                state.focus_group(group_id);
                                state.close_tab(index);
                            },
                            window,
                            cx,
                        );
                    }))
                    .on_secondary_mouse_down(cx.listener({
                        let item = item.clone();
                        move |this, event: &gpui::MouseDownEvent, window, cx| {
                            this.update_state(cx, |state| state.focus_group(group_id));
                            let entries = this.tab_menu_entries(index, &item, cx);
                            this.show_menu("tab-context", entries, event.position, gpui::Anchor::TopLeft, window, cx);
                        }
                    }));
                // The drop marker is a 2px primary bar over the tab's leading edge, 4px in from
                // top and bottom, so the strip does not shift while a tab is dragged.
                let drop_group = SharedString::from(format!("tab-drop-{group_id}-{index}"));
                div()
                    .id(gpui::ElementId::Name(format!("tab-drag-{group_id}-{index}").into()))
                    .group(drop_group.clone())
                    .relative()
                    // The header's window-drag handler would start moving the window on the first mouse move,
                    // before the tab's own drag passes its threshold.
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_drag(dragged, |dragged, _, _, cx| cx.new(|_| DraggedTabPreview(dragged.clone())))
                    .on_drop(cx.listener(move |this, dragged: &DraggedTab, _, cx| {
                        cx.stop_propagation();
                        this.tab_drop_zone = None;
                        let (from, from_index) = (dragged.group, dragged.index);
                        this.update_state(cx, |state| state.drop_tab_before(from, from_index, group_id, index));
                    }))
                    .child(tab)
                    .child(
                        div()
                            .absolute()
                            .top(px(4.))
                            .bottom(px(4.))
                            .left_0()
                            .w(px(2.))
                            .bg(drop_marker)
                            .invisible()
                            .group_drag_over::<DraggedTab>(drop_group, |style| style.visible()),
                    )
                    .into_any_element()
            })
            .collect();
        if let Some(view) = welcome.clone() {
            let title = view.read(cx).title();
            tab_elements.push(
                // As for the other tabs: the header's window drag must not take the press.
                div().on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation()).child(
                Tab::new(gpui::ElementId::Name(format!("tab-welcome-{group_id}").into()), title)
                    .when(show_icons, |tab| tab.icon(IconName::File))
                    .active(welcome_active)
                    .show_close(close_button_shown(&close_visibility, welcome_active, false))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.onboarding_reopened = true;
                        cx.notify();
                    }))
                    .on_close(move |_, _, cx| view.update(cx, |view, cx| view.close(cx))),
                )
                .into_any_element(),
            );
        }

        let vim_editor = tabs
            .active
            .and_then(|index| tabs.tabs.get(index))
            .and_then(|item| self.centre_views.get(&crate::centre_views::view_key(group_id, item)))
            .and_then(|view| view.editor.clone());
        let front_session = match tabs.active_item() {
            Some(TabItem::Session { id }) if !welcome_active => Some(id.clone()),
            _ => None,
        };
        // The header moves the window on a press and drag; its buttons keep their press so a
        // slight move between down and up does not swallow the click (Fullscreen, New, More).
        let actions = crate::over_drag_region(pane_actions().id(gpui::ElementId::Name(format!("centre-actions-{group_id}").into())))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .when_some(vim_editor, |this, editor| this.child(editor::VimModeIndicator::new(editor)))
            .when_some(front_session, |this, id| {
                let key = format!("session-more-{}", id.0);
                let side_shown = agent_ui::session_side_panel_shown(cx);
                this.child(
                    Button::icon(gpui::ElementId::Name(format!("session-side-{}", id.0).into()), IconName::SidebarRight)
                        .size(ButtonSize::Small)
                        .tooltip(if side_shown { "Hide session details" } else { "Show session details" })
                        .active(side_shown)
                        .on_click(|_, _, cx| agent_ui::toggle_session_side_panel(cx)),
                )
                .child({
                    let has_server = self.session_panes.get(&id.0).is_some_and(|panes| panes.server.is_some());
                    let session = id.0.clone();
                    Button::icon(gpui::ElementId::Name(format!("session-browser-{}", id.0).into()), IconName::Globe)
                        .size(ButtonSize::Small)
                        .tooltip(if has_server { "Open dev server" } else { "Open browser" })
                        .on_click(cx.listener(move |this, _, window, cx| this.open_session_browser_for(&session, None, true, window, cx)))
                })
                .child(
                    Button::icon(gpui::ElementId::Name(key.into()), IconName::Dots)
                        .size(ButtonSize::Small)
                        .tooltip("More actions")
                        .active(self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == SESSION_MORE_MENU))
                        .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| this.show_session_more_actions(group_id, &id, event.position(), window, cx))),
                )
            })
            .when(split, |this| {
                this.child(
                    Button::icon(gpui::ElementId::Name(format!("close-split-{group_id}").into()), IconName::Sidebar)
                        .size(ButtonSize::Small)
                        .tooltip("Close split")
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.update_state(cx, |state| {
                                state.focus_group(group_id);
                                state.close_active_group();
                            })
                        })),
                )
            })
            .when(trailing, |this| {
                this.child(
                    Button::icon("centre-new-session", IconName::Plus)
                        .size(ButtonSize::Small)
                        .tooltip("New Session")
                        .shortcut(platform.shortcut("⌘N", "Ctrl+N"))
                        .on_click(|_, window, cx| window.dispatch_action(Box::new(NewSession), cx)),
                )
                .child(
                    Button::icon("centre-maximize", if self.fullscreen_group.is_some() { IconName::ArrowsIn } else { IconName::ArrowsOut })
                        .size(ButtonSize::Small)
                        .tooltip(if self.fullscreen_group.is_some() { "Exit fullscreen" } else { "Fullscreen" })
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.fullscreen_group = if this.fullscreen_group.is_some() { None } else { Some(group_id) };
                            this.centre_maximized = this.fullscreen_group.is_some();
                            cx.notify();
                        })),
                )
            });

        let header = pane_header(cx)
            .id(gpui::ElementId::Name(format!("centre-header-{group_id}").into()))
            .child(div().w(leading_space).h_full().flex_none())
            .child({
                // The strip's edges fade while more tabs are hidden beyond them (`TabStrip`'s
                // `scroll-fade-x scroll-fade-6`).
                let offset = scroll.offset().x;
                let max = scroll.max_offset().x;
                let background = cx.theme().colors.background;
                let fade = |left: bool| {
                    let (from, to) = if left { (background, background.opacity(0.)) } else { (background.opacity(0.), background) };
                    div()
                        .absolute()
                        .top_0()
                        .bottom_0()
                        .w(px(24.))
                        .when(left, |this| this.left_0())
                        .when(!left, |this| this.right_0())
                        .bg(gpui::linear_gradient(90., gpui::linear_color_stop(from, 0.), gpui::linear_color_stop(to, 1.)))
                };
                div()
                    .relative()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .items_center()
                    .child(
                        // The strip itself lies above the drag region on Windows, so the wheel
                        // still scrolls it while a tab takes its own press.
                        crate::over_drag_region(div()
                            .id(gpui::ElementId::Name(format!("centre-tabs-{group_id}").into()))
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_center()
                            .gap(metrics::chrome_gap())
                            .overflow_x_scroll()
                            .when(!settings::get(cx).horizontal_tab_scroll, |this| this.restrict_scroll_to_axis())
                            .track_scroll(&scroll)
                            .children(tab_elements)),
                    )
                    .when(offset < px(-1.), |this| this.child(fade(true)))
                    .when(max > px(0.) && -offset < max - px(1.), |this| this.child(fade(false)))
            })
            .child(actions)
            .child(div().w(trailing_space).flex_none());
        let header = self.drag_region(header, cx);

        let body = match tabs.active_item().cloned() {
            _ if welcome_active => div().flex().flex_1().min_h_0().children(welcome).into_any_element(),
            Some(TabItem::ProjectDashboard { id }) => self.render_project_dashboard(&id, window, cx),
            Some(item) => self.render_tab_content(group_id, &item, cx),
            None if split => div().flex_1().into_any_element(),
            None => self.render_no_tabs(window, cx),
        };
        let body = match self.docked_outline(group_id, layout, cx) {
            Some(outline) => div()
                .flex()
                .flex_1()
                .min_h_0()
                .child(div().flex().flex_col().flex_1().min_w_0().child(body))
                .child(div().flex().flex_col().flex_none().w(px(256.)).min_w_0().border_l_1().border_color(cx.theme().colors.border).child(outline))
                .into_any_element(),
            None => body,
        };
        let active_key = tabs.active_item().map(|item| crate::centre_views::view_key(group_id, item));
        let crumbs = active_key.as_ref().and_then(|key| self.breadcrumbs.get(key)).cloned();
        let status = active_key.as_ref().and_then(|key| {
            let editor = self.centre_views.get(key)?.editor.clone()?;
            let existing = self.editor_status.borrow().get(key).cloned();
            Some(existing.unwrap_or_else(|| {
                let status = cx.new(|cx| editor::EditorStatusActions::new(&editor, window, cx));
                self.editor_status.borrow_mut().insert(key.clone(), status.clone());
                status
            }))
        });
        let body = match (crumbs, status) {
            (crumbs, Some(status)) => div()
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .min_w_0()
                        .pr(px(6.))
                        .child(
                            div()
                                .flex()
                                .flex_1()
                                .min_w_0()
                                .items_center()
                                .children(crumbs.map(|crumbs| div().min_w_0().child(crumbs)))
                                .children(crate::extension_contributions::toolbar_buttons(extensions_ui::ui_extensions::ToolbarPosition::Left, cx)),
                        )
                        .child(self.completion_status.clone())
                        .children(crate::extension_contributions::toolbar_buttons(extensions_ui::ui_extensions::ToolbarPosition::Right, cx))
                        .child(status),
                )
                .child(div().flex().flex_col().flex_1().min_h_0().child(body))
                .into_any_element(),
            (_, None) => body,
        };

        let _ = window;
        let drop_fill = cx.theme().colors.primary_soft;
        let drop_ring = cx.theme().colors.primary;
        let zone = self.tab_drop_zone.filter(|(group, _)| *group == group_id && cx.has_active_drag()).map(|(_, zone)| zone);
        let overlay = zone.map(|zone| {
            let fill = div().absolute().rounded(metrics::radius_lg()).bg(drop_fill);
            let fill = match zone {
                DropZone::Left => fill.top(px(4.)).bottom(px(4.)).left(px(4.)).right(relative(0.5)),
                DropZone::Right => fill.top(px(4.)).bottom(px(4.)).right(px(4.)).left(relative(0.5)),
                DropZone::Top => fill.left(px(4.)).right(px(4.)).top(px(4.)).bottom(relative(0.5)),
                DropZone::Bottom => fill.left(px(4.)).right(px(4.)).bottom(px(4.)).top(relative(0.5)),
                DropZone::Center => fill.inset(px(4.)),
            };
            div().absolute().inset_0().child(fill)
        });
        framed_pane()
            .flex_1()
            .size_full()
            .when(split && group_id != layout.panes.active, |this| this.opacity(0.98))
            .on_drop(cx.listener(move |this, dragged: &DraggedTab, _, cx| {
                let (from, index) = (dragged.group, dragged.index);
                let zone = this.tab_drop_zone.take().filter(|(group, _)| *group == group_id).map_or(DropZone::Center, |(_, zone)| zone);
                match zone.split() {
                    Some((axis, before)) => this.update_state(cx, |state| state.split_with_tab(from, index, group_id, axis, before)),
                    None => this.update_state(cx, |state| state.move_tab(from, index, group_id)),
                }
            }))
            .on_drop(cx.listener(move |this, dragged: &ui::DraggedResource, _, cx| {
                let zone = this.tab_drop_zone.take().filter(|(group, _)| *group == group_id).map_or(DropZone::Center, |(_, zone)| zone);
                if dragged.kind == ui::WORKTREE_KIND {
                    this.open_project_path(std::path::PathBuf::from(&dragged.id), cx);
                    return;
                }
                this.update_state(cx, |state| {
                    state.focus_group(group_id);
                    state.open_resource(&dragged.kind, &dragged.id, &dragged.title);
                    if let Some((axis, before)) = zone.split()
                        && let Some(index) = state.focused_tabs().and_then(|tabs| tabs.active)
                    {
                        state.split_with_tab(group_id, index, group_id, axis, before);
                    }
                });
            }))
            .on_drop(cx.listener(move |this, dragged: &terminal_view::DraggedTerminalTab, window, cx| {
                let zone = this.tab_drop_zone.take().filter(|(group, _)| *group == group_id).map_or(DropZone::Center, |(_, zone)| zone);
                let Some(moved) = dragged.take(window, cx) else { return };
                this.update_state(cx, |state| state.focus_group(group_id));
                this.open_terminal_tab(crate::centre_views::PendingTerminal::Moved(moved), &dragged.title, cx);
                if let Some((axis, before)) = zone.split() {
                    this.update_state(cx, |state| {
                        if let Some(index) = state.focused_tabs().and_then(|tabs| tabs.active) {
                            state.split_with_tab(group_id, index, group_id, axis, before);
                        }
                    });
                }
            }))
            .drag_over::<gpui::ExternalPaths>(move |style, _, _, _| style.border_2().border_color(drop_ring))
            .on_drop(cx.listener(move |this, paths: &gpui::ExternalPaths, _, cx| {
                this.update_state(cx, |state| state.focus_group(group_id));
                this.open_dropped_paths(paths.paths(), cx);
            }))
            .on_drop(cx.listener(move |this, dragged: &file_tree::DraggedEntry, _, cx| {
                if dragged.is_dir {
                    return;
                }
                let path = dragged.path.to_string_lossy().into_owned();
                this.update_state(cx, |state| {
                    state.focus_group(group_id);
                    state.open_file(&path);
                });
            }))
            .capture_any_mouse_down(cx.listener(move |this, _, _, cx| this.interrupt_follow(group_id, cx)))
            .capture_key_down(cx.listener(move |this, _: &gpui::KeyDownEvent, _, cx| this.interrupt_follow(group_id, cx)))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _, _, cx| {
                    if this.state.focused_panes().is_none_or(|panes| panes.group(group_id).is_none() || panes.active != group_id) {
                        this.update_state(cx, |state| state.focus_group(group_id));
                    }
                }),
            )
            .child(header)
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .on_drag_move::<DraggedTab>(cx.listener(move |this, event: &DragMoveEvent<DraggedTab>, _, cx| {
                        this.track_drop_zone(group_id, event.bounds, event.event.position, cx);
                    }))
                    .on_drag_move::<ui::DraggedResource>(cx.listener(move |this, event: &DragMoveEvent<ui::DraggedResource>, _, cx| {
                        this.track_drop_zone(group_id, event.bounds, event.event.position, cx);
                    }))
                    .on_drag_move::<terminal_view::DraggedTerminalTab>(cx.listener(move |this, event: &DragMoveEvent<terminal_view::DraggedTerminalTab>, _, cx| {
                        this.track_drop_zone(group_id, event.bounds, event.event.position, cx);
                    }))
                    .child(body)
                    .children(overlay),
            )
            .into_any_element()
    }

    /// Shows the context menu of the front group's tab `index` at `position` (snapshots).
    pub fn show_tab_menu(&mut self, index: usize, position: gpui::Point<gpui::Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.state.focused_tabs().and_then(|tabs| tabs.tabs.get(index)).cloned() else { return };
        let entries = self.tab_menu_entries(index, &item, cx);
        self.show_menu("tab-context", entries, position, gpui::Anchor::TopLeft, window, cx);
    }

    /// The edge of `group_id` a dragged tab or sidebar resource would split, as the pointer moves.
    fn track_drop_zone(&mut self, group_id: u64, bounds: gpui::Bounds<gpui::Pixels>, position: gpui::Point<gpui::Pixels>, cx: &mut Context<Self>) {
        let zone = bounds.contains(&position).then(|| {
            let x = (position.x - bounds.origin.x) / bounds.size.width;
            let y = (position.y - bounds.origin.y) / bounds.size.height;
            (group_id, DropZone::at(x, y))
        });
        let current = self.tab_drop_zone.filter(|(group, _)| *group == group_id);
        if zone != current && (zone.is_some() || current.is_some()) {
            self.tab_drop_zone = zone;
            cx.notify();
        }
    }

    /// `TabContextMenu`: pin and layout items, then the file's (or page's) items, then closing.
    fn tab_menu_entries(&self, index: usize, item: &TabItem, cx: &mut Context<Self>) -> Vec<ui::MenuEntry> {
        let weak = cx.weak_entity();
        let change = |label: &'static str, change: fn(&mut workspace::WorkspaceState, usize)| {
            let weak = weak.clone();
            ui::MenuItem::new(label).on_select(move |_, cx| {
                weak.update(cx, |this, cx| this.update_state(cx, |state| change(state, index))).ok();
            })
        };
        // Closing rows ask about unsaved files first.
        let close = |label: &'static str, change: fn(&mut workspace::WorkspaceState, usize)| {
            let weak = weak.clone();
            ui::MenuItem::new(label).on_select(move |window, cx| {
                weak.update(cx, |this, cx| this.close_tabs_guarded(move |state| change(state, index), window, cx)).ok();
            })
        };
        let pinned = self.state.focused_tabs().is_some_and(|tabs| tabs.is_pinned(index));
        let mut entries: Vec<ui::MenuEntry> = vec![
            change(if pinned { "Unpin Tab" } else { "Pin Tab" }, |state, index| state.toggle_tab_pinned(index))
                .icon(if pinned { IconName::PinSlash } else { IconName::Pin })
                .into(),
            change("Split Right", |state, index| {
                state.activate_tab(index);
                state.split_pane(SplitAxis::Horizontal);
            })
            .icon(IconName::Columns)
            .into(),
            change("Split Down", |state, index| {
                state.activate_tab(index);
                state.split_pane(SplitAxis::Vertical);
            })
            .icon(IconName::Rows)
            .into(),
        ];
        let group = self.state.focused_panes().map(|panes| panes.active);
        let locked = self.state.focused_panes().and_then(|panes| group.and_then(|group| panes.group(group))).is_some_and(|group| group.locked);
        entries.push(
            ui::MenuItem::new(if locked { "Unlock Editor Group" } else { "Lock Editor Group" })
                .icon(if locked { IconName::LockOpen } else { IconName::Lock })
                .on_select(|window, cx| window.dispatch_action(Box::new(crate::more_commands::ToggleEditorGroupLock), cx))
                .into(),
        );
        let view = group.and_then(|group| self.centre_views.get(&crate::centre_views::view_key(group, item)));
        let mut file_entries: Vec<ui::MenuEntry> = Vec::new();
        match item {
            TabItem::Resource { kind, id, .. } if kind == browser_view::BROWSER_KIND => {
                let page = view.and_then(|view| view.view.clone().downcast::<browser_view::BrowserPage>().ok());
                let address = page
                    .as_ref()
                    .map(|page| page.read(cx).url().to_string())
                    .or_else(|| browser_view::pages::with_store(|store| store.get(id).map(|page| page.url.clone())))
                    .unwrap_or_default();
                file_entries.push(
                    ui::MenuItem::new("Copy Address")
                        .icon(IconName::Copy)
                        .on_select(move |_, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(address.clone())))
                        .into(),
                );
                if let Some(page) = page {
                    file_entries.push(
                        ui::MenuItem::new("Reload")
                            .icon(IconName::ArrowCounterClockwise)
                            .on_select(move |_, cx| page.update(cx, |page, cx| page.reload(cx)))
                            .into(),
                    );
                }
            }
            TabItem::File { path } => {
                let copy = path.clone();
                let reveal = path.clone();
                let relative = match self.state.active_project() {
                    Some(project) => std::path::Path::new(path)
                        .strip_prefix(&project.path)
                        .map_or_else(|_| path.clone(), |relative| relative.to_string_lossy().into_owned()),
                    None => path.clone(),
                };
                file_entries.push(
                    ui::MenuItem::new("Copy Path")
                        .icon(IconName::Copy)
                        .on_select(move |_, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(copy.clone())))
                        .into(),
                );
                file_entries.push(
                    ui::MenuItem::new("Copy Relative Path")
                        .icon(IconName::Copy)
                        .on_select(move |_, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(relative.clone())))
                        .into(),
                );
                file_entries.push(
                    ui::MenuItem::new("Reveal in Finder")
                        .icon(IconName::FolderOpen)
                        .on_select(move |_, cx| {
                            if let Err(error) = file_tree::reveal(std::path::Path::new(&reveal), cx) {
                                notifications::info(cx, error);
                            }
                        })
                        .into(),
                );
                if !path.contains("://") {
                    if cfg!(target_os = "macos") {
                        let file = std::path::PathBuf::from(path);
                        file_entries.push(
                            ui::MenuItem::new("Share…")
                                .icon(IconName::SquareArrowUp)
                                .on_select(move |window, cx| {
                                    if let Err(error) = file_tree::share(window, &file) {
                                        notifications::error(cx, format!("Unable to share file: {error:#}"), None);
                                    }
                                })
                                .into(),
                        );
                    }
                    let folder = std::path::Path::new(path).parent().map(std::path::Path::to_path_buf);
                    let weak = weak.clone();
                    file_entries.push(
                        ui::MenuItem::new("Open in Terminal")
                            .icon(IconName::TerminalWindow)
                            .on_select(move |_, cx| {
                                let title = folder.as_deref().and_then(std::path::Path::file_name).map_or_else(|| "terminal".to_string(), |name| name.to_string_lossy().into_owned());
                                weak.update(cx, |this, cx| this.open_terminal_tab(crate::centre_views::PendingTerminal::In(folder.clone()), &title, cx)).ok();
                            })
                            .into(),
                    );
                }
                if let Some(editor) = view.and_then(|view| view.editor.clone()) {
                    file_entries.push(
                        ui::MenuItem::new("Reload")
                            .icon(IconName::ArrowCounterClockwise)
                            .on_select(move |_, cx| editor.update(cx, |editor, cx| editor.revert(cx)))
                            .into(),
                    );
                }
            }
            TabItem::Session { .. } => {
                let activate = move |weak: gpui::WeakEntity<Self>, window: &mut Window, cx: &mut App, action: Box<dyn gpui::Action>| {
                    weak.update(cx, |this, cx| this.update_state(cx, |state| state.activate_tab(index))).ok();
                    window.dispatch_action(action, cx);
                };
                let markdown = weak.clone();
                file_entries.push(
                    ui::MenuItem::new("Open Conversation as Markdown")
                        .icon(IconName::File)
                        .on_select(move |window, cx| activate(markdown.clone(), window, cx, Box::new(agent_ui::session_commands::OpenChatTranscript)))
                        .into(),
                );
                let share = weak.clone();
                file_entries.push(
                    ui::MenuItem::new("Share Agent to Web")
                        .icon(IconName::Upload)
                        .on_select(move |window, cx| activate(share.clone(), window, cx, Box::new(collaboration::ShareSession)))
                        .into(),
                );
            }
            _ => {}
        }
        if !file_entries.is_empty() {
            entries.push(ui::MenuEntry::Separator);
            entries.extend(file_entries);
        }
        entries.extend([
            ui::MenuEntry::Separator,
            close("Close", |state, index| state.close_tab(index)).into(),
            close("Close Others", |state, index| state.close_other_tabs(index)).into(),
            close("Close to Right", |state, index| state.close_tabs_to_the_right(index)).into(),
            close("Close All", |state, _| state.close_all_tabs()).into(),
        ]);
        entries
    }

    /// `registerTabDecoration("agent", …)`: a chat tab shows its agent's mark, and a dot while
    /// the chat waits on the user.
    fn tab_decoration(&self, item: &TabItem) -> (Option<ui::BrandMark>, bool) {
        let TabItem::Session { id } = item else { return (None, false) };
        let Some(session) = self.state.session(id) else { return (None, false) };
        (ui::BrandMark::agent(agent_ui::acp::agents::catalog_id(&session.agent)), session.status == workspace::SessionStatus::NeedsInput)
    }

    /// A browser tab's page icon (`BrowserTabIcon`): the globe while it loads or when it fails.
    fn tab_favicon(&self, group_id: u64, item: &TabItem, cx: &App) -> Option<AnyElement> {
        let TabItem::Resource { kind, .. } = item else { return None };
        if kind != browser_view::BROWSER_KIND {
            return None;
        }
        let view = self.centre_views.get(&crate::centre_views::view_key(group_id, item))?;
        let page = view.view.clone().downcast::<browser_view::BrowserPage>().ok()?;
        let url = page.read(cx).state().favicon.clone().filter(|url| url.starts_with("https://") || url.starts_with("http://"))?;
        let globe = cx.theme().colors.subtle_foreground;
        let fallback = move || Icon::new(IconName::Globe).size(IconSize::XSmall).color(globe).into_any_element();
        Some(gpui::img(SharedString::from(url)).flex_none().size(px(12.)).object_fit(gpui::ObjectFit::Contain).with_loading(fallback).with_fallback(fallback).into_any_element())
    }

    pub(crate) fn tab_label(&self, item: &TabItem) -> (String, IconName) {
        match item {
            TabItem::Session { id } => (
                self.state.session(id).map_or("Session".to_string(), |session| session.title.clone()),
                IconName::Sparkle,
            ),
            TabItem::File { path } => (project_name(path), IconName::File),
            TabItem::ProjectDashboard { id } => (
                self.state.project(id).map_or("Project".to_string(), |project| project.name.clone()),
                IconName::Folder,
            ),
            TabItem::Welcome => ("Welcome".to_string(), IconName::File),
            TabItem::Resource { kind, title, .. } => (
                // The catalog's buffer is "Integrations" (`SINGLETON_TOOL_BUFFER_METADATA`), whatever
                // older callers titled it.
                if kind == "extensions" && title == "Extensions" { "Integrations".to_string() } else { title.clone() },
                match kind.as_str() {
                    "search" => IconName::Search,
                    "docker" => IconName::Package,
                    "extensions" => IconName::PuzzlePiece,
                    "debugger" => IconName::Bug,
                    "terminal" => IconName::TerminalWindow,
                    "problems" => IconName::WarningCircle,
                    "git-diff" => IconName::GitDiff,
                    "git-commit" => IconName::GitCommit,
                    "git-blame" => IconName::History,
                    "references" => IconName::Link,
                    "outline" => IconName::ListChecks,
                    "history" => IconName::History,
                    "team" | "team-session" => IconName::Users,
                    "github-issue" => IconName::CircleDot,
                    "github-run" => IconName::PlayCircle,
                    "agent-review" => IconName::GitDiff,
                    "skills" => IconName::BookOpen,
                    "cloud-runs" | "cloud-run" => IconName::Cloud,
                    "acp-inspector" => IconName::ArrowsLeftRight,
                    "browser" => IconName::Globe,
                    "preview" => IconName::Eye,
                    _ => IconName::GitPullRequest,
                },
            ),
        }
    }

    /// `showOutline`: the outline docks beside the editor it follows, unless an Outline tab shows
    /// it already.
    fn docked_outline(&self, group_id: u64, layout: &PaneLayout, cx: &App) -> Option<AnyElement> {
        if !settings::get(cx).show_outline {
            return None;
        }
        let (outline, _) = self.outline.as_ref()?;
        let item = layout.panes.group(group_id)?.tabs.active_item()?;
        let editor = self.centre_views.get(&crate::centre_views::view_key(group_id, item))?.editor.as_ref()?;
        if outline.read(cx).editor().map(|followed| followed.entity_id()) != Some(editor.entity_id()) {
            return None;
        }
        let tab_open = layout
            .panes
            .groups
            .iter()
            .any(|group| matches!(group.tabs.active_item(), Some(TabItem::Resource { kind, .. }) if kind == "outline"));
        (!tab_open).then(|| outline.clone().into_any_element())
    }

    fn render_tab_content(&self, group: u64, item: &TabItem, cx: &App) -> AnyElement {
        if let Some(view) = self.centre_views.get(&crate::centre_views::view_key(group, item)) {
            return div().flex().flex_col().flex_1().min_h_0().min_w_0().overflow_hidden().child(view.view.clone()).into_any_element();
        }
        let content = match item {
            TabItem::Session { id } => {
                let title = self.state.session(id).map_or("Session".to_string(), |session| session.title.clone());
                let place = self
                    .state
                    .session(id)
                    .and_then(|session| session.project.as_ref())
                    .and_then(|project| self.state.project(project))
                    .map_or("a chat of no project".to_string(), |project| project.name.clone());
                EmptyState::new(title)
                    .icon(IconName::Sparkle)
                    .message(format!("Agent session in {place}. The transcript and composer arrive with the AI port."))
            }
            TabItem::File { path } => EmptyState::new(project_name(path))
                .icon(IconName::File)
                .message("The editor arrives with the editor port."),
            TabItem::ProjectDashboard { .. } | TabItem::Welcome => self.no_tabs_state(cx),
            TabItem::Resource { title, .. } => EmptyState::new(title.clone()).icon(IconName::Square),
        };
        div().flex().flex_1().items_center().justify_center().child(content).into_any_element()
    }

    fn no_tabs_state(&self, cx: &App) -> EmptyState {
        let platform = self.platform;
        let ai = ai_enabled(cx);
        let quick_open = Button::new("empty-quick-open", "Quick Open")
            .variant(if ai { ButtonVariant::Ghost } else { ButtonVariant::Accent })
            .leading_icon(IconName::Search)
            .on_click(|_, window, cx| window.dispatch_action(Box::new(QuickOpen), cx));
        let open_folder = Button::new("empty-open-folder", "Open Folder…")
            .variant(ButtonVariant::Ghost)
            .leading_icon(IconName::FolderOpen)
            .on_click(|_, window, cx| window.dispatch_action(Box::new(OpenProject), cx));
        let state = EmptyState::new("No open tabs");
        if !ai {
            return state.message("Open a file or folder to get started.").action(quick_open).action(open_folder);
        }
        state
            .message("Start a session, or open a file or folder.")
            .action(
                Button::new("empty-new-session", "New Session")
                    .variant(ButtonVariant::Accent)
                    .leading_icon(IconName::PencilLine)
                    .tooltip("New Session")
                    .shortcut(platform.shortcut("⌘N", "Ctrl+N"))
                    .on_click(|_, window, cx| window.dispatch_action(Box::new(NewSession), cx)),
            )
            .action(quick_open)
            .action(open_folder)
    }

    /// With every tab closed, the open project's home (its dashboard) while agents are on, else
    /// a plain starting point.
    fn render_no_tabs(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if let Some((view, _)) = &self.onboarding {
            return div().flex().flex_1().min_h_0().child(view.clone()).into_any_element();
        }
        if ai_enabled(cx)
            && let Some(project) = self.state.active_project().map(|project| project.id.clone())
        {
            return self.render_project_dashboard(&project, window, cx);
        }
        div()
            .flex()
            .flex_1()
            .justify_center()
            .pt(px(12.))
            .child(self.no_tabs_state(cx))
            .into_any_element()
    }

    /// The terminal and output panel under the centre.
    fn render_bottom_pane(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let height = px(self.state.layout.bottom_pane_height);
        let takes_tabs = self.state.layout.bottom_tab != workspace::BottomTab::Buffers;
        let drop_ring = cx.theme().colors.primary;
        let resizing = matches!(self.drag, Some(Drag::BottomPane { .. }));
        let line = if resizing { cx.theme().colors.primary } else { cx.theme().colors.border_strong };
        div()
            .relative()
            .flex()
            .flex_col()
            .flex_none()
            .h(height)
            // Inside the shell the bottom pane has no edge of its own; a hairline marks where the
            // centre ends, as the sidebar's divider does.
            .child(crate::resize_edge(
                false,
                cx.theme().colors.border,
                div()
                    .id("bottom-resize")
                    .flex()
                    .items_center()
                    .cursor_row_resize()
                    .group("bottom-resize")
                    .child(
                        div()
                            .h(px(1.))
                            .w_full()
                            .when(resizing, |this| this.bg(line))
                            .group_hover("bottom-resize", move |style| style.bg(line)),
                    )
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event: &gpui::MouseDownEvent, _, cx| {
                            this.drag = Some(Drag::BottomPane {
                                start_y: event.position.y,
                                start_height: this.state.layout.bottom_pane_height,
                            });
                            cx.stop_propagation();
                            cx.notify();
                        }),
                    ),
            ))
            .child(
                div()
                    .id("bottom-pane-content")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .rounded(metrics::radius_lg())
                    // An editor tab dropped here moves into the bottom pane's own groups.
                    .when(takes_tabs, |this| {
                        this.drag_over::<DraggedTab>(move |style, _, _, _| style.border_2().border_color(drop_ring)).on_drop(cx.listener(
                            |this, dragged: &DraggedTab, window, cx| {
                                let (group, index) = (dragged.group, dragged.index);
                                this.move_tab_to_bottom(group, index, window, cx);
                            },
                        ))
                    })
                    .child(self.render_bottom_content(window, cx)),
            )
    }
}


/// Tab names that tell same-named files apart (`calculateDisplayNames`): a name shared by
/// several tabs gets as many parent folders as it takes, as `../src/main.rs`; `None` keeps the
/// usual label.
pub(crate) fn display_names(paths: &[Option<&str>]) -> Vec<Option<String>> {
    let split = |path: &str| -> (String, Vec<String>) {
        let normalized = path.replace('\\', "/");
        let mut parts: Vec<String> = normalized.split('/').filter(|part| !part.is_empty()).map(str::to_string).collect();
        let name = normalized.rsplit('/').next().unwrap_or_default().to_string();
        parts.pop();
        (name, parts)
    };
    let entries: Vec<Option<(String, Vec<String>)>> = paths.iter().map(|path| path.map(split)).collect();
    let mut names = vec![None; paths.len()];
    let mut groups: Vec<(String, Vec<usize>)> = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let Some((name, _)) = entry else { continue };
        match groups.iter_mut().find(|(group, _)| group == name) {
            Some((_, members)) => members.push(index),
            None => groups.push((name.clone(), vec![index])),
        }
    }
    for (name, members) in groups {
        if members.len() == 1 {
            continue;
        }
        let segments = |index: usize| &entries[index].as_ref().expect("grouped entries are files").1;
        let longest = members.iter().map(|index| segments(*index).len()).max().unwrap_or(0);
        let label = |index: usize, count: usize| {
            let parts = segments(index);
            let tail = &parts[parts.len().saturating_sub(count)..];
            if tail.is_empty() { name.clone() } else { format!("../{}/{name}", tail.join("/")) }
        };
        let needed = (1..=longest).find(|count| {
            let mut seen = std::collections::HashSet::new();
            members.iter().all(|index| {
                let parts = segments(*index);
                seen.insert(parts[parts.len().saturating_sub(*count)..].join("/"))
            })
        });
        for index in &members {
            names[*index] = Some(label(*index, needed.unwrap_or(longest)));
        }
    }
    names
}

#[cfg(test)]
mod display_name_tests {
    use super::display_names;

    #[test]
    fn same_named_files_get_the_folders_that_tell_them_apart() {
        let names = display_names(&[Some("/p/src/main.rs"), Some("/p/tests/main.rs"), Some("/p/lib.rs"), None, Some("/p/a/x/mod.rs"), Some("/p/b/x/mod.rs")]);
        assert_eq!(
            names,
            vec![Some("../src/main.rs".into()), Some("../tests/main.rs".into()), None, None, Some("../a/x/mod.rs".into()), Some("../b/x/mod.rs".into())]
        );
    }
}

fn ai_enabled(cx: &App) -> bool {
    cx.try_global::<settings::SettingsStore>().is_none_or(|_| settings::get(cx).core_features.ai_chat)
}

const SESSION_MORE_MENU: &str = "session-more-actions";

impl Workbench {
    /// The session's other actions (`SessionMoreActionsMenu`): its plan, then the conversation's
    /// own actions.
    /// Opens the More actions menu of the session in front of the focused group, hanging from
    /// `position` (the header's … button).
    pub fn show_front_session_more_actions(&mut self, position: gpui::Point<gpui::Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(group) = self.state.focused_panes().map(|panes| panes.active) else { return };
        if let Some(TabItem::Session { id }) = self.state.focused_tabs().and_then(|tabs| tabs.active_item()).cloned() {
            self.show_session_more_actions(group, &id, position, window, cx);
        }
    }

    fn show_session_more_actions(&mut self, group_id: u64, id: &workspace::SessionId, position: gpui::Point<gpui::Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        if self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == SESSION_MORE_MENU) {
            self.close_menu(window, cx);
            return;
        }
        let weak = cx.weak_entity();
        let view = self.centre_views.get(&format!("session:{}", id.0)).and_then(|view| view.session.clone());
        let (has_plan, has_messages) = view.as_ref().map_or((false, false), |view| {
            let transcript = view.read(cx).transcript();
            (!transcript.plan.is_empty(), !transcript.entries.is_empty())
        });
        let mut entries: Vec<ui::MenuEntry> = Vec::new();
        // The plan unfolds in the session's side column (`openSessionTool(chatId, "plan")`).
        if has_plan {
            let (weak, id) = (weak.clone(), id.clone());
            entries.push(
                ui::MenuItem::new("Plan")
                    .icon(IconName::ListChecks)
                    .on_select(move |_, cx| {
                        weak.update(cx, |this, cx| this.open_session_plan(&id.0, cx)).ok();
                    })
                    .into(),
            );
        }
        if !entries.is_empty() {
            entries.push(ui::MenuEntry::Separator);
        }
        let run = |action: Box<dyn gpui::Action>| {
            let weak = weak.clone();
            let id = id.clone();
            move |window: &mut Window, cx: &mut App| {
                // The action works on the session in front, so this one comes to the front first.
                weak.update(cx, |this, cx| this.update_state(cx, |state| {
                    state.focus_group(group_id);
                    state.open_session(&id);
                }))
                .ok();
                window.dispatch_action(action.boxed_clone(), cx);
            }
        };
        entries.push(ui::MenuItem::new("Open as Markdown").icon(IconName::File).on_select(run(Box::new(agent_ui::session_commands::OpenChatTranscript))).into());
        entries.push(ui::MenuItem::new("Share").icon(IconName::Upload).disabled(!has_messages).on_select(run(Box::new(collaboration::ShareSession))).into());
        entries.push(ui::MenuItem::new("Open in New Window").icon(IconName::WindowExpand).on_select(run(Box::new(crate::agent_commands::OpenAgentInNewWindow))).into());
        self.open_menu = Some(ui::OpenMenu::sized(SESSION_MORE_MENU, entries, ui::MenuSize::Default, position, gpui::Anchor::TopRight, window, cx, |this, _| this.open_menu = None));
        cx.notify();
    }
}
