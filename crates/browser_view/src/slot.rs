//! The element a native page sits over. It measures where it lands each frame, finds the floating
//! workbench UI over it, and moves, cuts, hides or makes the native page to match.

use gpui::{App, Bounds, Element, ElementId, GlobalElementId, InspectorElementId, LayoutId, Pixels, Position, Style, Window};

use crate::{
    frame,
    host::{CreateOptions, HostRef, NativeEvent},
    layout::{self, Occlusion, Plan, PlanInput, Rect},
    native::{self, NativeWebView},
};

pub struct WebviewSlot {
    host: HostRef,
    corner_radius: f64,
}

/// Fills its (positioned) parent with the native page of `host`.
pub fn webview_slot(host: HostRef, corner_radius: f64) -> WebviewSlot {
    WebviewSlot { host, corner_radius }
}

fn rect(bounds: Bounds<Pixels>) -> Rect {
    Rect::new(f64::from(bounds.origin.x), f64::from(bounds.origin.y), f64::from(bounds.size.width), f64::from(bounds.size.height))
}

impl Element for WebviewSlot {
    type RequestLayoutState = ();
    type PrepaintState = Bounds<Pixels>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(&mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>, window: &mut Window, cx: &mut App) -> (LayoutId, ()) {
        let mut style = Style { position: Position::Absolute, ..Style::default() };
        style.inset.top = gpui::px(0.).into();
        style.inset.left = gpui::px(0.).into();
        style.size.width = gpui::relative(1.).into();
        style.size.height = gpui::relative(1.).into();
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(&mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>, _: Bounds<Pixels>, _: &mut (), window: &mut Window, _: &mut App) -> Bounds<Pixels> {
        let viewport = Bounds { origin: gpui::Point::default(), size: window.viewport_size() };
        window.content_mask().bounds.intersect(&viewport)
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        clip: &mut Bounds<Pixels>,
        window: &mut Window,
        cx: &mut App,
    ) {
        frame::painted(&self.host, window, cx);
        let geometry = layout::visible_slot_geometry(rect(bounds), rect(*clip));
        let mut holes = match geometry {
            Some(geometry) => {
                let overlays: Vec<Rect> = ui::occlusion::overlays(window, cx).into_iter().map(rect).collect();
                layout::local_holes(geometry, &overlays)
            }
            None => Vec::new(),
        };
        // A tab dragged over the page shows the pane's drop zones there, so the page steps aside.
        if let Some(geometry) = geometry
            && cx.has_active_drag()
        {
            let mouse = window.mouse_position();
            let (x, y) = (f64::from(mouse.x), f64::from(mouse.y));
            if x >= geometry.x && x <= geometry.x + geometry.width && y >= geometry.y && y <= geometry.y + geometry.height {
                holes = vec![Rect::new(0.0, 0.0, geometry.width, geometry.height)];
            }
        }

        let mut host = self.host.borrow_mut();
        if host.unavailable {
            return;
        }
        let plan = layout::plan(PlanInput {
            geometry,
            holes: &holes,
            created: host.native.is_some(),
            pending: host.pending.is_some(),
            shown: host.is_shown(),
            occlusion: host.occlusion,
            capabilities: native::capabilities(),
        });
        match plan {
            Plan::Hide => host.hide(),
            Plan::Wait => {}
            Plan::Create(geometry) => {
                let Some(content) = host.pending.take() else { return };
                let options = CreateOptions {
                    content,
                    bounds: geometry,
                    zoom: host.zoom,
                    corner_radius: self.corner_radius,
                    key_bindings: host.key_bindings.clone(),
                    events: host.events.clone(),
                };
                match NativeWebView::create(window, options) {
                    Ok(Some(native)) => {
                        host.native = Some(native);
                        host.applied = Some(Some((geometry, Vec::new())));
                    }
                    Ok(None) => host.unavailable = true,
                    Err(error) => {
                        let _ = host.events.unbounded_send(NativeEvent::Failed(error));
                    }
                }
            }
            Plan::Show(geometry) => {
                host.apply(Some((geometry, Vec::new())));
                host.reveal();
            }
            Plan::Capture => {
                host.occlusion = Occlusion::Capturing;
                let events = host.events.clone();
                if let Some(native) = &host.native {
                    native.capture_snapshot(events.clone());
                }
                let _ = events.unbounded_send(NativeEvent::CaptureStarted);
            }
            Plan::Cover(layout) => {
                host.occlusion = Occlusion::Covered;
                host.apply(layout);
            }
        }
    }
}
