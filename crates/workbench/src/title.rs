use ui::TooltipExt as _;
use ui::scale::px;
use gpui::{
    Anchor, Context, IntoElement, ParentElement, ResizeEdge, SharedString, Styled, Window, WindowControlArea, canvas, div,
    point, prelude::*,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, Icon, IconName, IconSize, metrics};

use crate::{Platform, ToggleSidebar, Workbench, bounds_right};

const PROJECT_SWITCHER_MENU: &str = "project-switcher";

impl Workbench {
    /// The leading end of the title row, next to the window controls: the sidebar toggle, search,
    /// then the project switcher. It floats over the top of the sidebar, in line with the pane
    /// headers; while the sidebar is hidden the centre's header makes room for it.
    pub(crate) fn render_title_leading(
        &self,
        sidebar_shown: bool,
        traffic_lights: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let narrow = Self::is_narrow(window);
        let sidebar_visible = if narrow { self.sidebar_overlay_open } else { sidebar_shown };
        let inset = if traffic_lights {
            metrics::traffic_lights_inset()
        } else {
            // Lines the first button up with the activity rail below it.
            metrics::workbench_gap()
        };
        let active = self.state.active_project().cloned();
        let leading_end = self.title_leading_end.clone();
        let platform = self.platform;
        let switcher_open = self.menu_is_open(PROJECT_SWITCHER_MENU);
        let muted = cx.theme().colors.subtle_foreground;
        // Over the sidebar, the row ends where the sidebar does; a long project name truncates.
        let max_width = if sidebar_shown && !narrow {
            metrics::workbench_gap() + metrics::rail_control() + px(self.state.layout.sidebar_width)
        } else {
            window.viewport_size().width * 0.5
        };

        let switcher = Button::new(
            "project-switcher",
            active.as_ref().map_or("Open project".to_string(), |project| project.name.clone()),
        )
        .variant(ui::ButtonVariant::Chrome)
        .size(ButtonSize::Medium)
        .shrinkable()
        .active(switcher_open)
        .leading(match &active {
            Some(project) => crate::project_icon::project_glyph(Some(&project.path), project.custom_icon.as_deref(), IconSize::Small.pixels(), muted),
            None => Icon::new(IconName::FolderOpen).color(muted).into_any_element(),
        })
        .tooltip("Switch Project")
        .on_click(cx.listener(|this, event: &gpui::ClickEvent, window, cx| {
            let mut entries: Vec<ui::MenuEntry> = this
                .state
                .projects
                .iter()
                .map(|project| {
                    let id = project.id.clone();
                    let weak = cx.weak_entity();
                    ui::MenuItem::new(project.name.clone())
                        .checked(this.state.active_project.as_ref() == Some(&project.id))
                        .on_select(move |_, cx| {
                            weak.update(cx, |this, cx| this.activate_project(id.clone(), cx)).ok();
                        })
                        .into()
                })
                .collect();
            // What the project in front offers — its dashboard, its folder, its icon — belongs
            // here, where projects are switched, not under a list of sessions.
            if let Some(id) = this.state.active_project.clone() {
                entries.push(ui::MenuEntry::Separator);
                entries.extend(this.project_menu_entries(&id, cx));
            }
            if !entries.is_empty() {
                entries.push(ui::MenuEntry::Separator);
            }
            entries.extend(this.add_project_entries(cx));
            let position = event.position();
            let position = point(position.x - px(12.), metrics::workbench_gap() + metrics::pane_header() - px(4.));
            this.show_menu(PROJECT_SWITCHER_MENU, entries, position, Anchor::TopLeft, window, cx);
        }));

        // The strip moves the window on a press and a drag, and on Windows the whole drag region
        // answers the hit test as the title bar, so the window takes the press and the release
        // never reaches the button. Its controls keep their press, as the pane header's tabs and
        // buttons do.
        let keep_press = || div().on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation());

        let row = div()
            .id("title-leading")
            // Fills the title row, so its controls centre with the window controls.
            .h_full()
            .pl(inset)
            .pr(px(4.))
            .max_w(max_width)
            .flex()
            .items_center()
            .gap(if platform == Platform::Mac { metrics::chrome_gap_tight() } else { metrics::chrome_gap() })
            .children(self.render_window_menu_button(cx).map(|button| keep_press().child(button)))
            .child(keep_press().child(
                Button::icon("toggle-sidebar", IconName::Sidebar)
                    .size(ButtonSize::Medium)
                    .variant(ui::ButtonVariant::Chrome)
                    .filled_when_active()
                    .active(sidebar_visible)
                    .tooltip(if sidebar_visible { "Hide Sidebar" } else { "Show Sidebar" })
                    .shortcut(platform.shortcut("⌘B", "Ctrl+B"))
                    .on_click(|_, window, cx| window.dispatch_action(Box::new(ToggleSidebar), cx)),
            ))
            .child(keep_press().child({
                let search_active = self.search_tab_active();
                Button::icon("global-search", if search_active { IconName::X } else { IconName::Search })
                    .size(ButtonSize::Medium)
                    .variant(ui::ButtonVariant::Chrome)
                    .active(search_active)
                    .filled_when_active()
                    .tooltip(if search_active { "Close Search" } else { "Search" })
                    .shortcut(platform.shortcut("⇧⌘F", "Ctrl+Shift+F"))
                    .on_click(cx.listener(|this, _, window, cx| {
                        if this.search_tab_active() {
                            let Some(index) = this.state.focused_tabs().and_then(|tabs| tabs.active) else { return };
                            this.close_tabs_guarded(move |state| state.close_tab(index), window, cx);
                        } else {
                            this.modal = None;
                            this.open_menu = None;
                            this.update_state(cx, |state| state.open_resource("search", "project", "Search"));
                        }
                    }))
            }))
            .child(keep_press().flex().min_w_0().flex_shrink(1.).overflow_hidden().child(switcher))
            .child(
                canvas(
                    move |bounds, _, _| leading_end.set(bounds_right(bounds)),
                    |_, _, _, _| {},
                )
                .size_0(),
            );
        row
    }

    /// Minimise, maximise and close for Windows and Linux, where Athas draws its own title bar
    /// (`window-controls.tsx`): each names itself and its shortcut in a tooltip, and maximise
    /// turns into Restore while the window fills the screen.
    pub(crate) fn render_window_controls(&self, window: &Window, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        if matches!(self.platform, Platform::Mac | Platform::Web) {
            return None;
        }
        let colors = cx.theme().colors.clone();
        let shortcuts = cx.try_global::<keymap::ActiveKeymap>().map(|active| keymap::shortcuts_by_command(&active.bindings)).unwrap_or_default();
        let shortcut = |ids: &[&str]| ids.iter().find_map(|id| shortcuts.get(*id)).map(|key| SharedString::from(keymap::display_key(key)));
        let maximized = window.is_maximized();
        let control = |id: &'static str, icon: IconName, area: WindowControlArea, label: &'static str, shortcut: Option<SharedString>| {
            let hover = if area == WindowControlArea::Close { colors.destructive } else { colors.accent };
            div()
                .id(id)
                .flex()
                .items_center()
                .justify_center()
                .w(px(36.))
                .h(metrics::rail_control())
                .rounded(metrics::radius_md())
                .window_control_area(area)
                // The title row under them moves the window on a press; the control keeps it.
                .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .hover(move |style| style.bg(hover))
                .anchored_tooltip(move || ui::Tooltip::new(label).shortcut(shortcut.clone()))
                .child(Icon::new(icon).size(IconSize::Small).color(colors.subtle_foreground))
                .on_click(move |_, window, cx| match area {
                    WindowControlArea::Min => window.minimize_window(),
                    WindowControlArea::Max => window.zoom_window(),
                    WindowControlArea::Close => window.dispatch_action(Box::new(crate::CloseWindow), cx),
                    WindowControlArea::Drag => {}
                })
        };
        let (max_icon, max_label) = if maximized { (IconName::ArrowsIn, "Restore") } else { (IconName::ArrowsOut, "Maximize") };
        Some(
            div()
                .h_full()
                .flex_none()
                .flex()
                .items_center()
                .gap(px(2.))
                .child(control("window-minimize", IconName::Minus, WindowControlArea::Min, "Minimize", shortcut(&["window.minimize.alt", "window.minimize"])))
                .child(control("window-maximize", max_icon, WindowControlArea::Max, max_label, shortcut(&["window.maximize"])))
                .child(control("window-close", IconName::X, WindowControlArea::Close, "Close", shortcut(&["workbench.closeWindow"]))),
        )
    }

    /// Shown while files are dragged over the window (`main-layout.tsx`).
    pub(crate) fn render_drop_overlay(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        div()
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .bg(colors.background)
            .opacity(0.)
            .group_drag_over::<gpui::ExternalPaths>("workbench", |style| style.opacity(1.))
            .child(
                div()
                    .rounded(metrics::radius_xl())
                    .border_2()
                    .border_dashed()
                    .border_color(colors.primary)
                    .bg(colors.surface)
                    .px(px(32.))
                    .py(px(24.))
                    .text_size(ui::typography::text_base())
                    .font_weight(ui::typography::SEMIBOLD)
                    .text_color(colors.foreground)
                    .child("Drop folder to open project, or file to open buffer"),
            )
    }

    /// Edges and corners that resize a window drawing its own frame (`window-resize-border.tsx`);
    /// only Linux leaves that to the app.
    pub(crate) fn render_resize_border(&self, window: &Window) -> Option<impl IntoElement> {
        if self.platform != Platform::Linux || !matches!(window.window_decorations(), gpui::Decorations::Client { .. }) {
            return None;
        }
        const EDGE: f32 = 8.;
        const CORNER: f32 = 16.;
        let zone = |id: &'static str, edge: ResizeEdge| {
            let base = div().id(id).absolute().occlude();
            let base = match edge {
                ResizeEdge::TopLeft => base.top_0().left_0().size(px(CORNER)).cursor_nwse_resize(),
                ResizeEdge::TopRight => base.top_0().right_0().size(px(CORNER)).cursor_nesw_resize(),
                ResizeEdge::BottomLeft => base.bottom_0().left_0().size(px(CORNER)).cursor_nesw_resize(),
                ResizeEdge::BottomRight => base.bottom_0().right_0().size(px(CORNER)).cursor_nwse_resize(),
                ResizeEdge::Top => base.top_0().left(px(CORNER)).right(px(CORNER)).h(px(EDGE)).cursor_ns_resize(),
                ResizeEdge::Bottom => base.bottom_0().left(px(CORNER)).right(px(CORNER)).h(px(EDGE)).cursor_ns_resize(),
                ResizeEdge::Left => base.left_0().top(px(CORNER)).bottom(px(CORNER)).w(px(EDGE)).cursor_ew_resize(),
                ResizeEdge::Right => base.right_0().top(px(CORNER)).bottom(px(CORNER)).w(px(EDGE)).cursor_ew_resize(),
            };
            base.on_mouse_down(gpui::MouseButton::Left, move |_, window, cx| {
                cx.stop_propagation();
                window.start_window_resize(edge);
            })
        };
        Some(
            div()
                .absolute()
                .inset_0()
                .child(zone("resize-nw", ResizeEdge::TopLeft))
                .child(zone("resize-ne", ResizeEdge::TopRight))
                .child(zone("resize-sw", ResizeEdge::BottomLeft))
                .child(zone("resize-se", ResizeEdge::BottomRight))
                .child(zone("resize-n", ResizeEdge::Top))
                .child(zone("resize-s", ResizeEdge::Bottom))
                .child(zone("resize-w", ResizeEdge::Left))
                .child(zone("resize-e", ResizeEdge::Right)),
        )
    }
}
