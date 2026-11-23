use std::{cell::Cell, rc::Rc, time::Duration};

use crate::scale::px;
use gpui::{
    AnyElement, App, Bounds, DispatchPhase, Element, ElementId, GlobalElementId, Hitbox, HitboxBehavior, Hsla,
    InspectorElementId, IntoElement, LayoutId, ListState, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent,
    Pixels, Point, Position, RenderOnce, Rgba, ScrollHandle, Style, UniformListScrollHandle, Window, div, fill, point,
    prelude::*, size,
};
use theme::ActiveTheme;
use web_time::Instant;

fn track_width() -> Pixels { px(12.) }
fn track_inset() -> Pixels { px(4.) }
fn min_thumb() -> Pixels { px(24.) }
/// How long the thumb stays after the content stops moving.
const SCROLLING_LINGER: Duration = Duration::from_millis(900);

/// Shows every overlay scrollbar's thumb whether or not the pointer is over its area, as the
/// original's `visibility="always"` bars do; headless snapshots turn it on to check the bars.
#[derive(Default)]
pub struct AlwaysShowScrollbars(pub bool);

impl gpui::Global for AlwaysShowScrollbars {}

#[derive(Default)]
struct ScrollbarState {
    /// The pointer's y and the scroll offset when a thumb drag began.
    drag: Rc<Cell<Option<(Pixels, Pixels)>>>,
    area_hovered: Rc<Cell<bool>>,
    /// The last painted offset and when it last changed.
    scrolled: Rc<Cell<Option<(Pixels, Option<Instant>)>>>,
}

/// What a scrollbar follows: a scrolling div or `uniform_list` (through its `ScrollHandle`), or a
/// variable-height `list`.
#[derive(Clone)]
enum ScrollSource {
    Handle(ScrollHandle),
    List(ListState),
}

impl ScrollSource {
    fn viewport(&self) -> Bounds<Pixels> {
        match self {
            Self::Handle(handle) => handle.bounds(),
            Self::List(list) => list.viewport_bounds(),
        }
    }

    fn max(&self) -> Pixels {
        match self {
            Self::Handle(handle) => handle.max_offset().y,
            Self::List(list) => list.max_offset_for_scrollbar().y,
        }
    }

    /// How far the content has scrolled, as a positive distance.
    fn offset(&self) -> Pixels {
        match self {
            Self::Handle(handle) => -handle.offset().y,
            Self::List(list) => -list.scroll_px_offset_for_scrollbar().y,
        }
    }

    fn set_offset(&self, offset: Pixels) {
        match self {
            Self::Handle(handle) => handle.set_offset(point(handle.offset().x, -offset)),
            Self::List(list) => list.set_offset_from_scrollbar(Point::new(px(0.), -offset)),
        }
    }

    fn drag_started(&self) {
        if let Self::List(list) = self {
            list.scrollbar_drag_started();
        }
    }

    fn drag_ended(&self) {
        if let Self::List(list) = self {
            list.scrollbar_drag_ended();
        }
    }
}

/// The overlay scrollbar of `ui/scroll-area.tsx` (and `styles/scrollbars.css`) for a vertically
/// scrolling element: a thin rounded thumb that shows while the pointer is over the area or it
/// was just scrolled, widens under the pointer and can be dragged or clicked along its track. Put
/// it in a `relative` parent beside the scrolling element; it is absolutely positioned on the
/// parent's right edge.
pub struct Scrollbar {
    id: ElementId,
    source: ScrollSource,
    inside: bool,
    /// Drawn whenever the content overflows, not only while the pointer is over it.
    always: bool,
    /// Where the thumb draws among the deferred elements. The bar is deferred so later rows
    /// cannot cover it, which also puts it under anything deferred above it — a scrolling list
    /// inside a modal (priority 2) needs its own priority to show at all.
    priority: usize,
    bar: Option<(AnyElement, Rc<Cell<Bounds<Pixels>>>)>,
}

impl Scrollbar {
    /// For a div with `overflow_y_scroll().track_scroll(handle)`.
    pub fn new(id: impl Into<ElementId>, handle: &ScrollHandle) -> Self {
        Self { id: id.into(), source: ScrollSource::Handle(handle.clone()), inside: false, always: false, priority: 0, bar: None }
    }

    /// For a `uniform_list(..).track_scroll(handle)`.
    pub fn uniform(id: impl Into<ElementId>, handle: &UniformListScrollHandle) -> Self {
        Self::new(id, &handle.0.borrow().base_handle)
    }

    /// For a variable-height `list(state, ..)`.
    pub fn list(id: impl Into<ElementId>, state: &ListState) -> Self {
        Self { id: id.into(), source: ScrollSource::List(state.clone()), inside: false, always: false, priority: 0, bar: None }
    }

    /// Always drawn while the content overflows: for a surface the keyboard drives, where the
    /// pointer may never go near the list (a command surface).
    pub fn always(mut self) -> Self {
        self.always = true;
        self
    }

    /// Draws the thumb among the deferred elements at `priority`, for a list inside an overlay
    /// that is itself deferred (a modal draws at 2, a menu at 4).
    pub fn priority(mut self, priority: usize) -> Self {
        self.priority = priority;
        self
    }

    /// For a bar added as the last child of the scrolling div itself (no wrapper): it undoes the
    /// div's scroll offset so it stays on the visible edge.
    pub fn inside(mut self) -> Self {
        self.inside = true;
        self
    }
}

/// Gives a scrolling div its overlay scrollbar in place: `div().id(..).overflow_y_scroll()` gets
/// `.scrollbar(window, cx)` (a scroll handle kept for it) or `.scrollbar_with(&handle)` (a handle
/// it already tracks), and the bar shows on its right edge.
pub trait WithScrollbar: Sized {
    fn scrollbar(self, window: &mut Window, cx: &mut App) -> Self;
    fn scrollbar_with(self, handle: &ScrollHandle) -> Self;
}

impl WithScrollbar for gpui::Stateful<gpui::Div> {
    fn scrollbar(mut self, window: &mut Window, cx: &mut App) -> Self {
        let key = scrollbar_key(&mut self);
        let handle = window.use_keyed_state(key, cx, |_, _| ScrollHandle::new()).read(cx).clone();
        self.track_scroll(&handle).scrollbar_with(&handle)
    }

    fn scrollbar_with(mut self, handle: &ScrollHandle) -> Self {
        let key = scrollbar_key(&mut self);
        self.track_scroll(handle).child(Scrollbar::new(key, handle).inside())
    }
}

fn scrollbar_key(element: &mut gpui::Stateful<gpui::Div>) -> ElementId {
    match element.interactivity().element_id.clone() {
        Some(id) => ElementId::from((id, "scrollbar")),
        None => "scrollbar".into(),
    }
}

/// Wraps a scrolling element in a `relative` box with the overlay scrollbar beside it. The box
/// takes the remaining space of a flex column (`flex_1`, `min_h_0`); `content` must scroll itself
/// and be tracked by `scrollbar`'s source.
pub fn with_scrollbar(content: impl IntoElement, scrollbar: Scrollbar) -> gpui::Div {
    div().relative().flex().flex_col().flex_1().min_h_0().min_w_0().child(content).child(scrollbar)
}

struct Geometry {
    track: Bounds<Pixels>,
    thumb: Bounds<Pixels>,
    max: Pixels,
}

impl Scrollbar {
    fn geometry(&self, bounds: Bounds<Pixels>) -> Option<Geometry> {
        let viewport = self.source.viewport();
        let max = self.source.max();
        if max <= px(0.) || viewport.size.height <= px(0.) {
            return None;
        }
        let offset = self.source.offset().clamp(px(0.), max);
        let track = Bounds::new(
            point(bounds.origin.x, bounds.origin.y + track_inset()),
            size(bounds.size.width, (bounds.size.height - track_inset() * 2.).max(px(0.))),
        );
        let content = viewport.size.height + max;
        let thumb_height = (track.size.height * (viewport.size.height / content)).max(min_thumb()).min(track.size.height);
        let top = track.origin.y + (track.size.height - thumb_height) * (offset / max);
        Some(Geometry { track, thumb: Bounds::new(point(track.origin.x, top), size(track.size.width, thumb_height)), max })
    }
}

fn thumb_colors(dark: bool) -> (Hsla, Hsla) {
    let gray = |value: f32, alpha: f32| -> Hsla { Rgba { r: value / 255., g: value / 255., b: value / 255., a: alpha }.into() };
    if dark { (gray(166., 0.38), gray(188., 0.58)) } else { (gray(120., 0.42), gray(105., 0.62)) }
}

impl Element for Scrollbar {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone())
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        // The bar is laid out here, as `deferred` lays out its child, and drawn later.
        let cell = Rc::new(Cell::new(Bounds::default()));
        let mut bar =
            ScrollbarBar { source: self.source.clone(), bounds: cell.clone(), hitbox: None, always: self.always, inside: self.inside }.into_any_element();
        let layout_id = bar.request_layout(window, cx);
        self.bar = Some((bar, cell));
        (layout_id, ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        _: &mut App,
    ) -> Self::PrepaintState {
        let bounds = if self.inside {
            // Laid out with no height (see `ScrollbarBar::request_layout`): the track is the
            // scrolling div's visible box, which it has measured before its children.
            let viewport = self.source.viewport();
            Bounds::new(point(viewport.origin.x + viewport.size.width - track_width(), viewport.origin.y), size(track_width(), viewport.size.height))
        } else {
            bounds
        };
        // The bar draws (and takes clicks) after everything else under the scrolling element's
        // ancestors, so rows added after it never cover the thumb; it stays clipped as before.
        let Some((bar, cell)) = self.bar.take() else { return };
        cell.set(bounds);
        window.defer_draw(bar, window.element_offset(), self.priority, Some(window.content_mask()));
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut Self::PrepaintState,
        _: &mut Window,
        _: &mut App,
    ) {
    }
}

/// The painted half of a [`Scrollbar`]: drawn as a deferred element at the bounds the bar was
/// laid out at, keyed under the bar's id.
struct ScrollbarBar {
    source: ScrollSource,
    bounds: Rc<Cell<Bounds<Pixels>>>,
    hitbox: Option<Hitbox>,
    /// Drawn whenever the content overflows, not only while the pointer is over it.
    always: bool,
    /// A child of the scrolling div: a full-height box there would count as content, and with
    /// the div's padding make it scroll by that much with nothing to scroll to.
    inside: bool,
}

impl ScrollbarBar {
    fn geometry(&self, bounds: Bounds<Pixels>) -> Option<Geometry> {
        Scrollbar { id: "".into(), source: self.source.clone(), inside: false, always: false, priority: 0, bar: None }.geometry(bounds)
    }
}

impl Element for ScrollbarBar {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        Some("bar".into())
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let mut style = Style::default();
        style.position = Position::Absolute;
        if self.inside {
            // An empty box where the content starts, so it widens neither scroll range.
            style.size.width = px(0.).into();
            style.size.height = px(0.).into();
        } else {
            style.inset.top = px(0.).into();
            style.inset.bottom = px(0.).into();
            style.inset.right = px(0.).into();
            style.size.width = track_width().into();
        }
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        _: &mut App,
    ) -> Self::PrepaintState {
        self.hitbox = Some(window.insert_hitbox(self.bounds.get(), HitboxBehavior::BlockMouseExceptScroll));
    }

    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let bounds = self.bounds.get();
        let Some(hitbox) = self.hitbox.as_ref() else { return };
        let Some(id) = id else { return };
        let dark = cx.theme().appearance.is_dark();
        let (drag, area_hovered, scrolled) = window.with_element_state(id, |state: Option<ScrollbarState>, _| {
            let state = state.unwrap_or_default();
            ((state.drag.clone(), state.area_hovered.clone(), state.scrolled.clone()), state)
        });
        let Some(geometry) = self.geometry(bounds) else { return };

        let viewport = self.source.viewport();
        let dragging = drag.get().is_some();
        let hovered = viewport.contains(&window.mouse_position());
        area_hovered.set(hovered);
        // `data-scrolling`: the bar also shows for a moment after the content moves.
        let now = Instant::now();
        let offset = self.source.offset();
        let recently_scrolled = match scrolled.get() {
            Some((last, _)) if last != offset => {
                scrolled.set(Some((offset, Some(now))));
                true
            }
            Some((_, Some(at))) => now.duration_since(at) < SCROLLING_LINGER,
            Some((_, None)) => false,
            None => {
                scrolled.set(Some((offset, None)));
                false
            }
        };
        if recently_scrolled && !hovered && !dragging {
            window.request_animation_frame();
        }
        let always = self.always || cx.try_global::<AlwaysShowScrollbars>().is_some_and(|always| always.0);
        if hovered || dragging || recently_scrolled || always {
            let widened = dragging || hitbox.is_hovered(window);
            let (rest, active) = thumb_colors(dark);
            let width = if widened { px(8.) } else { px(4.) };
            let thumb = Bounds::new(
                point(geometry.thumb.center().x - width / 2., geometry.thumb.origin.y),
                size(width, geometry.thumb.size.height),
            );
            window.paint_quad(fill(thumb, if widened { active } else { rest }).corner_radii(width / 2.));
        }

        let source = self.source.clone();
        let travel = (geometry.track.size.height - geometry.thumb.size.height).max(px(1.));
        let max = geometry.max;
        {
            let drag = drag.clone();
            let source = source.clone();
            window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, _| {
                if phase != DispatchPhase::Bubble {
                    return;
                }
                if let Some((start_y, start_offset)) = drag.get() {
                    let offset = (start_offset + (event.position.y - start_y) * (max / travel)).clamp(px(0.), max);
                    source.set_offset(offset);
                    window.refresh();
                } else if viewport.contains(&event.position) != area_hovered.get() {
                    window.refresh();
                }
            });
        }
        {
            let drag = drag.clone();
            let hitbox = hitbox.clone();
            let source = source.clone();
            let thumb = geometry.thumb;
            let track = geometry.track;
            window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble || event.button != MouseButton::Left || !hitbox.is_hovered(window) {
                    return;
                }
                let current = source.offset().clamp(px(0.), max);
                source.drag_started();
                if thumb.contains(&event.position) {
                    drag.set(Some((event.position.y, current)));
                } else {
                    let ratio = ((event.position.y - track.origin.y - thumb.size.height / 2.) / travel).clamp(0., 1.);
                    let offset = max * ratio;
                    source.set_offset(offset);
                    drag.set(Some((event.position.y, offset)));
                }
                cx.stop_propagation();
                window.refresh();
            });
        }
        window.on_mouse_event(move |_: &MouseUpEvent, phase, window, _| {
            if phase == DispatchPhase::Bubble && drag.take().is_some() {
                source.drag_ended();
                window.refresh();
            }
        });
    }
}

/// A vertically scrolling area with the overlay scrollbar (`ui/scroll-area.tsx`). It fills the
/// space its flex parent gives it; the scroll position is kept per `id` unless a handle is given.
#[derive(IntoElement)]
pub struct ScrollArea {
    id: ElementId,
    handle: Option<ScrollHandle>,
    max_height: Option<Pixels>,
    children: Vec<AnyElement>,
}

impl ScrollArea {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), handle: None, max_height: None, children: Vec::new() }
    }

    pub fn track_scroll(mut self, handle: &ScrollHandle) -> Self {
        self.handle = Some(handle.clone());
        self
    }

    /// Grows with its content up to `height`, then scrolls.
    pub fn max_h(mut self, height: Pixels) -> Self {
        self.max_height = Some(height);
        self
    }
}

impl ParentElement for ScrollArea {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for ScrollArea {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let handle = match self.handle {
            Some(handle) => handle,
            None => window.use_keyed_state(self.id.clone(), cx, |_, _| ScrollHandle::new()).read(cx).clone(),
        };
        let fixed = self.max_height.is_none();
        div()
            .id(self.id)
            .relative()
            .flex()
            .flex_col()
            .min_h_0()
            .min_w_0()
            .when(fixed, |this| this.flex_1().size_full())
            .when_some(self.max_height, |this, height| this.max_h(height))
            .child(
                div()
                    .id("viewport")
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .when(fixed, |this| this.flex_1())
                    .when_some(self.max_height, |this, height| this.max_h(height))
                    .overflow_y_scroll()
                    .track_scroll(&handle)
                    .children(self.children),
            )
            .child(Scrollbar::new("scrollbar", &handle))
    }
}
