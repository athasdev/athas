//! Each window's frame count, and the sweep at the end of a frame that hides the pages whose slot
//! did not paint: a tab in the background, a closed panel. The workbench draws `frame_tracker()`
//! once per window.

use std::{collections::HashMap, rc::Weak};

use gpui::{
    App, Bounds, DispatchPhase, Element, ElementId, Global, GlobalElementId, InspectorElementId, IntoElement, LayoutId, MouseDownEvent,
    ParentElement, Pixels, Style, Styled, Window, WindowId, deferred, div,
};

use crate::host::{Host, HostRef};

#[derive(Default)]
struct WindowFrames {
    frame: u64,
    hosts: Vec<Weak<std::cell::RefCell<Host>>>,
}

#[derive(Default)]
struct Frames(HashMap<WindowId, WindowFrames>);

impl Global for Frames {}

fn window_frames<'a>(window: &Window, cx: &'a mut App) -> &'a mut WindowFrames {
    cx.default_global::<Frames>().0.entry(window.window_handle().window_id()).or_default()
}

/// The slot of `host` painted this frame; the sweep leaves it alone.
pub(crate) fn painted(host: &HostRef, window: &Window, cx: &mut App) {
    let frames = window_frames(window, cx);
    let frame = frames.frame;
    if !frames.hosts.iter().any(|known| known.as_ptr() == std::rc::Rc::as_ptr(host)) {
        frames.hosts.push(std::rc::Rc::downgrade(host));
    }
    host.borrow_mut().painted_frame = Some(frame);
}

/// Starts a frame when laid out, and sweeps the pages at its end.
pub fn frame_tracker() -> impl IntoElement {
    div().absolute().size_0().child(FrameStart).child(deferred(FrameEnd).with_priority(usize::MAX))
}

struct FrameStart;

impl Element for FrameStart {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(&mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>, window: &mut Window, cx: &mut App) -> (LayoutId, ()) {
        window_frames(window, cx).frame += 1;
        ui::occlusion::begin_frame(window, cx);
        (window.request_layout(Style::default(), [], cx), ())
    }

    fn prepaint(&mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>, _: Bounds<Pixels>, _: &mut (), _: &mut Window, _: &mut App) {}

    fn paint(&mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>, _: Bounds<Pixels>, _: &mut (), _: &mut (), _: &mut Window, _: &mut App) {}
}

struct FrameEnd;

impl Element for FrameEnd {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(&mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>, window: &mut Window, cx: &mut App) -> (LayoutId, ()) {
        let mut style = Style::default();
        style.size.width = ui::scale::px(0.).into();
        style.size.height = ui::scale::px(0.).into();
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(&mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>, _: Bounds<Pixels>, _: &mut (), _: &mut Window, _: &mut App) {}

    fn paint(&mut self, _: Option<&GlobalElementId>, _: Option<&InspectorElementId>, _: Bounds<Pixels>, _: &mut (), _: &mut (), window: &mut Window, cx: &mut App) {
        let frames = window_frames(window, cx);
        frames.hosts.retain(|host| host.strong_count() > 0);
        let frame = frames.frame;
        let hosts: Vec<HostRef> = frames.hosts.iter().filter_map(Weak::upgrade).collect();
        for host in &hosts {
            let mut host = host.borrow_mut();
            if host.painted_frame != Some(frame) {
                host.hide();
            }
        }
        if hosts.is_empty() {
            return;
        }
        // A click on the workbench never reaches a page, and the window's view does not take
        // keyboard focus on its own: hand it back from the page that has it.
        let hosts: Vec<_> = hosts.iter().map(std::rc::Rc::downgrade).collect();
        window.on_mouse_event(move |_: &MouseDownEvent, phase, _, _| {
            if phase != DispatchPhase::Capture {
                return;
            }
            for host in hosts.iter().filter_map(Weak::upgrade) {
                let mut host = host.borrow_mut();
                if host.native_focused {
                    host.native_focused = false;
                    if let Some(native) = &host.native {
                        native.focus_parent();
                    }
                }
            }
        });
    }
}
