use std::cell::Cell;
use std::rc::Rc;
use std::sync::Mutex;
use std::time::Duration;

use gpui::prelude::*;
use gpui::{
    AnyElement, AnyView, App, Bounds, Context, Element, GlobalElementId, InspectorElementId, IntoElement, LayoutId,
    ParentElement, Pixels, Point, Render, SharedString, Style, Styled, Task, Window, canvas, div, point, px, size,
};
use theme::ActiveTheme;
use web_time::Instant;

use crate::{Kbd, typography};

/// How long the pointer rests on a control before its tooltip opens (`TooltipProvider delay`).
pub const TOOLTIP_DELAY: Duration = Duration::from_millis(800);
/// After a tooltip closes, the next one within this window opens at once (`timeout`).
const TOOLTIP_WARM: Duration = Duration::from_millis(400);
/// gpui's own wait before it builds a tooltip set with plain `.tooltip(...)`.
const GPUI_DELAY: Duration = Duration::from_millis(500);
/// Space between the control and the tooltip (`sideOffset={4}`).
const SIDE_OFFSET: f32 = 4.;
/// How close a tooltip may come to the window's edge before it flips or shifts (`collisionPadding`).
const COLLISION_PADDING: f32 = 8.;

static LAST_HIDDEN: Mutex<Option<Instant>> = Mutex::new(None);

fn warm() -> bool {
    LAST_HIDDEN.lock().ok().and_then(|last| *last).is_some_and(|last| last.elapsed() < TOOLTIP_WARM)
}

/// Which side of its control a tooltip opens on. Top unless a vertical rail says otherwise
/// (`OverlaySideProvider side="right"` around the activity bar).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TooltipSide {
    #[default]
    Top,
    Bottom,
    Left,
    Right,
}

/// The bounds of the control a tooltip belongs to, recorded while the control is laid out.
/// Put [`TooltipAnchor::probe`] inside the control and pass the anchor to [`Tooltip::anchor`];
/// [`TooltipExt::anchored_tooltip`] does both.
#[derive(Clone, Default)]
pub struct TooltipAnchor(Rc<Cell<Option<Bounds<Pixels>>>>);

impl TooltipAnchor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn bounds(&self) -> Option<Bounds<Pixels>> {
        self.0.get()
    }

    /// An empty child covering its parent that records the parent's window bounds.
    pub fn probe(&self) -> impl IntoElement {
        let cell = self.0.clone();
        canvas(move |bounds, _, _| cell.set(Some(bounds)), |_, _, _, _| {}).absolute().top_0().left_0().size_full()
    }
}

/// A short label beside the control it names, with the control's shortcut: `rounded-md bg-overlay
/// px-2 py-1 ui-text-chrome text-foreground shadow-popover`, 4px from the control on its side
/// (top by default), centred on it, flipped or shifted 8px inside the window, opened after 800ms.
pub struct Tooltip {
    text: SharedString,
    shortcut: Option<SharedString>,
    side: TooltipSide,
    anchor: Option<Bounds<Pixels>>,
    pointer: Point<Pixels>,
    wait: Duration,
    visible: bool,
    shown_at: Option<Instant>,
    _timer: Option<Task<()>>,
}

impl Tooltip {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self {
            text: text.into(),
            shortcut: None,
            side: TooltipSide::Top,
            anchor: None,
            pointer: Point::default(),
            // Plain `.tooltip(...)` already waited gpui's 500ms; make up the rest of the 800.
            wait: TOOLTIP_DELAY.saturating_sub(GPUI_DELAY),
            visible: false,
            shown_at: None,
            _timer: None,
        }
    }

    pub fn shortcut(mut self, shortcut: Option<SharedString>) -> Self {
        self.shortcut = shortcut;
        self
    }

    pub fn side(mut self, side: TooltipSide) -> Self {
        self.side = side;
        self
    }

    /// The control's bounds; without them the tooltip sits beside the pointer.
    pub fn anchor(mut self, anchor: &TooltipAnchor) -> Self {
        self.anchor = anchor.bounds();
        self
    }

    pub fn anchor_bounds(mut self, bounds: Option<Bounds<Pixels>>) -> Self {
        self.anchor = bounds;
        self
    }

    /// How long the tooltip waits after gpui builds it (gpui's own delay comes first).
    pub fn wait(mut self, wait: Duration) -> Self {
        self.wait = wait;
        self
    }

    pub fn build(mut self, window: &mut Window, cx: &mut App) -> AnyView {
        self.pointer = window.mouse_position();
        let wait = if warm() { Duration::ZERO } else { self.wait };
        cx.new(|cx: &mut Context<Self>| {
            if wait.is_zero() {
                self.visible = true;
                self.shown_at = Some(Instant::now());
            } else {
                let task = cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(wait).await;
                    this.update(cx, |this, cx| {
                        this.visible = true;
                        this.shown_at = Some(Instant::now());
                        cx.notify();
                    })
                    .ok();
                });
                self._timer = Some(task);
            }
            self
        })
        .into()
    }

    pub fn text(text: impl Into<SharedString>) -> impl Fn(&mut Window, &mut App) -> AnyView {
        let text = text.into();
        move |window, cx| Tooltip::new(text.clone()).build(window, cx)
    }

    /// The tooltip's box alone, as it draws once open (for galleries and snapshots).
    pub fn bubble(text: impl Into<SharedString>, shortcut: Option<SharedString>, cx: &App) -> AnyElement {
        let theme = cx.theme();
        div()
            .flex()
            .flex_none()
            .items_center()
            .whitespace_nowrap()
            .gap(px(8.))
            .px(px(8.))
            .py(px(4.))
            .rounded(px(6.))
            .bg(theme.colors.overlay)
            .shadow(theme.shadows.popover.clone())
            .text_size(typography::TEXT_SM)
            .font_family(typography::UI_FONT)
            .text_color(theme.colors.foreground)
            .child(text.into())
            .children(shortcut.map(Kbd::new))
            .into_any_element()
    }
}

impl Drop for Tooltip {
    fn drop(&mut self) {
        if self.shown_at.is_some()
            && let Ok(mut last) = LAST_HIDDEN.lock()
        {
            *last = Some(Instant::now());
        }
    }
}

impl Render for Tooltip {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.visible {
            return div().into_any_element();
        }
        let target = self.anchor.unwrap_or_else(|| {
            // No control bounds: treat a 20px band around the pointer as the control.
            Bounds::new(point(self.pointer.x, self.pointer.y - px(10.)), size(px(0.), px(20.)))
        });
        let bubble = Tooltip::bubble(self.text.clone(), self.shortcut.clone(), cx);
        TooltipPlacement { child: Some(bubble), target, side: self.side }.into_any_element()
    }
}

/// Where a tooltip of `tooltip` size goes beside `target` inside a `viewport`-sized window:
/// on `side`, 4px off, centred, flipped to the other side when it would cross the 8px padding
/// and the other side has room, then shifted back inside the padding.
pub fn tooltip_origin(
    target: Bounds<Pixels>,
    tooltip: gpui::Size<Pixels>,
    viewport: gpui::Size<Pixels>,
    side: TooltipSide,
) -> Point<Pixels> {
    let offset = px(SIDE_OFFSET);
    let pad = px(COLLISION_PADDING);
    let place = |side: TooltipSide| match side {
        TooltipSide::Top => point(target.center().x - tooltip.width / 2., target.top() - offset - tooltip.height),
        TooltipSide::Bottom => point(target.center().x - tooltip.width / 2., target.bottom() + offset),
        TooltipSide::Left => point(target.left() - offset - tooltip.width, target.center().y - tooltip.height / 2.),
        TooltipSide::Right => point(target.right() + offset, target.center().y - tooltip.height / 2.),
    };
    let fits = |side: TooltipSide, origin: Point<Pixels>| match side {
        TooltipSide::Top => origin.y >= pad,
        TooltipSide::Bottom => origin.y + tooltip.height <= viewport.height - pad,
        TooltipSide::Left => origin.x >= pad,
        TooltipSide::Right => origin.x + tooltip.width <= viewport.width - pad,
    };
    let opposite = match side {
        TooltipSide::Top => TooltipSide::Bottom,
        TooltipSide::Bottom => TooltipSide::Top,
        TooltipSide::Left => TooltipSide::Right,
        TooltipSide::Right => TooltipSide::Left,
    };
    let mut origin = place(side);
    if !fits(side, origin) {
        let flipped = place(opposite);
        if fits(opposite, flipped) {
            origin = flipped;
        }
    }
    let clamp = |value: Pixels, length: Pixels, limit: Pixels| {
        let max = (limit - pad - length).max(pad);
        value.max(pad).min(max)
    };
    match side {
        TooltipSide::Top | TooltipSide::Bottom => origin.x = clamp(origin.x, tooltip.width, viewport.width),
        TooltipSide::Left | TooltipSide::Right => origin.y = clamp(origin.y, tooltip.height, viewport.height),
    }
    origin
}

/// Lays its child out at its own size and moves it next to `target` (window coordinates),
/// wherever gpui put the tooltip view.
struct TooltipPlacement {
    child: Option<AnyElement>,
    target: Bounds<Pixels>,
    side: TooltipSide,
}

impl Element for TooltipPlacement {
    type RequestLayoutState = Option<LayoutId>;
    type PrepaintState = ();

    fn id(&self) -> Option<gpui::ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let child_id = self.child.as_mut().map(|child| child.request_layout(window, cx));
        let mut style = Style::default();
        style.position = gpui::Position::Absolute;
        style.display = gpui::Display::Flex;
        let layout_id = window.request_layout(style, child_id, cx);
        (layout_id, child_id)
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        child_id: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let (Some(child), Some(child_id)) = (self.child.as_mut(), *child_id) else { return };
        let child_bounds = window.layout_bounds(child_id);
        let origin = tooltip_origin(self.target, child_bounds.size, window.viewport_size(), self.side);
        let offset = origin - child_bounds.origin;
        let _ = bounds;
        window.with_element_offset(offset, |window| child.prepaint(window, cx));
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        _prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        if let Some(child) = self.child.as_mut() {
            child.paint(window, cx);
        }
    }
}

/// `.tooltip(...)` anchored to the element it is set on, as the original's tooltips are: the
/// element records its bounds while it is laid out, and the tooltip opens 4px off it after 800ms.
pub trait TooltipExt: StatefulInteractiveElement + ParentElement + Sized {
    fn anchored_tooltip(self, tooltip: impl Fn() -> Tooltip + 'static) -> Self {
        let anchor = TooltipAnchor::new();
        let probe = anchor.probe();
        self.child(probe).tooltip_show_delay(Duration::ZERO).tooltip(move |window, cx| {
            tooltip().anchor(&anchor).wait(TOOLTIP_DELAY).build(window, cx)
        })
    }
}

impl<E: StatefulInteractiveElement + ParentElement + Sized> TooltipExt for E {}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(x: f32, y: f32, w: f32, h: f32) -> Bounds<Pixels> {
        Bounds::new(point(px(x), px(y)), size(px(w), px(h)))
    }

    #[test]
    fn tooltip_sits_centred_four_pixels_above() {
        let origin = tooltip_origin(bounds(100., 100., 28., 28.), size(px(60.), px(24.)), size(px(1400.), px(900.)), TooltipSide::Top);
        assert_eq!(origin, point(px(84.), px(72.)));
    }

    #[test]
    fn tooltip_flips_below_at_the_top_edge_and_shifts_inside() {
        let origin = tooltip_origin(bounds(2., 4., 28., 28.), size(px(60.), px(24.)), size(px(1400.), px(900.)), TooltipSide::Top);
        assert_eq!(origin, point(px(8.), px(36.)));
    }

    #[test]
    fn right_side_tooltip_flips_left_at_the_window_edge() {
        let origin = tooltip_origin(bounds(1380., 100., 20., 20.), size(px(60.), px(20.)), size(px(1400.), px(900.)), TooltipSide::Right);
        assert_eq!(origin, point(px(1316.), px(100.)));
    }
}
