use std::rc::Rc;

use gpui::{
    Anchor, AnyElement, App, Bounds, Context, DismissEvent, Entity, FocusHandle, Focusable as _, MouseButton, Pixels, Subscription, Window, anchored,
    canvas, deferred, div, prelude::*, px,
};

use crate::{Menu, MenuEntry, MenuSize};

type EntriesBuilder = Rc<dyn Fn(&mut Window, &mut App) -> Vec<MenuEntry>>;
type TriggerBuilder = Rc<dyn Fn(bool, &mut Window, &mut App) -> AnyElement>;

/// Which edge of the trigger the menu lines up with.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DropdownAlign {
    Start,
    /// The web dropdown's default.
    #[default]
    End,
}

/// A trigger that opens a menu under it (`DropdownMenu` in `ui/dropdown.tsx`). The trigger is
/// drawn by `trigger(open, ..)` and the entries are built fresh each time the menu opens.
pub struct DropdownMenu {
    trigger: TriggerBuilder,
    entries: EntriesBuilder,
    size: MenuSize,
    align: DropdownAlign,
    open_up: bool,
    menu: Option<(Entity<Menu>, Subscription)>,
    /// Where the keyboard was before the menu took it, so closing gives it back.
    focus_before_menu: Option<FocusHandle>,
    trigger_bounds: Option<Bounds<Pixels>>,
}

impl DropdownMenu {
    pub fn new(
        trigger: impl Fn(bool, &mut Window, &mut App) -> AnyElement + 'static,
        entries: impl Fn(&mut Window, &mut App) -> Vec<MenuEntry> + 'static,
    ) -> Self {
        Self {
            trigger: Rc::new(trigger),
            entries: Rc::new(entries),
            size: MenuSize::Auto,
            align: DropdownAlign::End,
            open_up: false,
            menu: None,
            focus_before_menu: None,
            trigger_bounds: None,
        }
    }

    pub fn size(mut self, size: MenuSize) -> Self {
        self.size = size;
        self
    }

    pub fn align(mut self, align: DropdownAlign) -> Self {
        self.align = align;
        self
    }

    pub fn open_up(mut self) -> Self {
        self.open_up = true;
        self
    }

    pub fn is_open(&self) -> bool {
        self.menu.is_some()
    }

    pub fn toggle(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some((menu, _)) = self.menu.take() {
            self.restore_focus(&menu, window, cx);
            cx.notify();
            return;
        }
        // The menu takes the keyboard while it is open. Without handing it back, closing leaves
        // the window with nothing focused, and no shortcut is answered until the next click.
        self.focus_before_menu = window.focused(cx);
        let entries = (self.entries)(window, cx);
        let menu = Menu::build_sized(entries, self.size, window, cx);
        menu.update(cx, |menu, _| menu.set_trigger_bounds(self.trigger_bounds));
        let subscription = cx.subscribe_in(&menu, window, |this, menu, _: &DismissEvent, window, cx| {
            this.menu = None;
            this.restore_focus(menu, window, cx);
            cx.notify();
        });
        self.menu = Some((menu, subscription));
        cx.notify();
    }

    /// Hands the keyboard back to whatever held it before the menu opened, unless a picked row
    /// moved it somewhere on purpose.
    fn restore_focus(&mut self, menu: &Entity<Menu>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(previous) = self.focus_before_menu.take() else { return };
        let menu_focus = menu.read(cx).focus_handle(cx);
        if window.focused(cx).is_none_or(|focused| focused == menu_focus || menu_focus.contains_focused(window, cx)) {
            window.focus(&previous, cx);
        }
    }
}

impl Render for DropdownMenu {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let open = self.menu.is_some();
        let trigger = (self.trigger)(open, window, cx);
        let entity = cx.entity().downgrade();
        let anchor = match (self.open_up, self.align) {
            (false, DropdownAlign::Start) => Anchor::TopLeft,
            (false, DropdownAlign::End) => Anchor::TopRight,
            (true, DropdownAlign::Start) => Anchor::BottomLeft,
            (true, DropdownAlign::End) => Anchor::BottomRight,
        };
        div()
            .relative()
            .flex()
            .flex_none()
            .child(
                div()
                    .on_mouse_down(MouseButton::Left, cx.listener(|this, _, window, cx| this.toggle(window, cx)))
                    .child(trigger),
            )
            .child(
                canvas(
                    move |bounds, _, cx| {
                        entity.update(cx, |dropdown, _| dropdown.trigger_bounds = Some(bounds)).ok();
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .children(self.menu.as_ref().map(|(menu, _)| {
                div()
                    .absolute()
                    .when(self.open_up, |this| this.top_0())
                    .when(!self.open_up, |this| this.top_full())
                    .when(self.align == DropdownAlign::Start, |this| this.left_0())
                    .when(self.align == DropdownAlign::End, |this| this.right_0())
                    .child(
                        deferred(
                            anchored().anchor(anchor).snap_to_window_with_margin(px(8.)).child(
                                div()
                                    .when(self.open_up, |this| this.mb(px(4.)))
                                    .when(!self.open_up, |this| this.mt(px(4.)))
                                    .child(menu.clone()),
                            ),
                        )
                        .with_priority(3),
                    )
            }))
    }
}
