//! What a page's view and its slot share: the native page, if there is one, and what it waits for.

use std::{cell::RefCell, path::PathBuf, rc::Rc, sync::Arc};

use athas_browser::BrowserEvent;
use futures::channel::mpsc::UnboundedSender;

use crate::{
    layout::{Occlusion, Rect},
    native::NativeWebView,
};

/// What a native page loads when it is made.
#[derive(Clone, Debug, PartialEq)]
pub enum Content {
    /// A web page.
    Url(String),
    /// A file of `root`, served on the preview scheme at `url`.
    Preview { root: PathBuf, url: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NavigationAction {
    Back,
    Forward,
    Reload,
    Stop,
}

/// What a native page reports, delivered to its view.
#[cfg_attr(target_family = "wasm", allow(dead_code))]
#[derive(Clone, Debug, PartialEq)]
pub enum NativeEvent {
    Page(BrowserEvent),
    /// The page's address may have changed; its view reads it from the webview.
    Location { can_go_back: Option<bool>, can_go_forward: Option<bool> },
    /// A link the operating system handles, such as `mailto:`.
    OpenExternally(String),
    /// Making the page failed.
    Failed(String),
    /// A picture of the page went out; the view gives up on it after a moment.
    CaptureStarted,
    /// The JPEG of the page, or `None` when the picture failed.
    Snapshot(Option<Vec<u8>>),
    /// Nothing covers the page any more; its picture goes once the page has drawn again.
    Revealed,
    /// The page asks to make a passkey (`create`) or sign in with one. `origin` is what the page
    /// claims; the view checks it against the webview's own address.
    PasskeyRequest { request_id: u64, create: bool, origin: String, options: serde_json::Value },
    /// The page gave up on a passkey request.
    PasskeyCancel(u64),
}

#[cfg_attr(target_family = "wasm", allow(dead_code))]
pub struct CreateOptions {
    pub content: Content,
    pub bounds: Rect,
    pub zoom: f64,
    pub corner_radius: f64,
    pub key_bindings: Vec<athas_browser::BrowserKeyBinding>,
    pub events: UnboundedSender<NativeEvent>,
}

pub struct Host {
    pub native: Option<NativeWebView>,
    /// The window has no native handle (headless) or this build has no native pages.
    pub unavailable: bool,
    /// What to load once the slot shows; pages are made the first time they show.
    pub pending: Option<Content>,
    pub zoom: f64,
    pub key_bindings: Vec<athas_browser::BrowserKeyBinding>,
    pub occlusion: Occlusion,
    /// The picture under workbench UI over the page.
    pub snapshot: Option<Arc<gpui::Image>>,
    /// The layout last handed to the native page.
    pub applied: Option<Option<(Rect, Vec<Rect>)>>,
    /// The frame of its window the slot last painted in.
    pub painted_frame: Option<u64>,
    /// The page has keyboard focus inside the window.
    pub native_focused: bool,
    pub events: UnboundedSender<NativeEvent>,
}

pub type HostRef = Rc<RefCell<Host>>;

impl Host {
    pub fn new(events: UnboundedSender<NativeEvent>, zoom: f64) -> HostRef {
        Rc::new(RefCell::new(Self {
            native: None,
            unavailable: false,
            pending: None,
            zoom,
            key_bindings: Vec::new(),
            occlusion: Occlusion::Clear,
            snapshot: None,
            applied: None,
            painted_frame: None,
            native_focused: false,
            events,
        }))
    }

    /// Moves or hides the native page, skipping layouts it already has.
    pub fn apply(&mut self, layout: Option<(Rect, Vec<Rect>)>) {
        if self.applied.as_ref() == Some(&layout) {
            return;
        }
        let Some(native) = self.native.as_mut() else { return };
        match native.set_layout(layout.clone()) {
            Ok(()) => self.applied = Some(layout),
            Err(error) => {
                let _ = self.events.unbounded_send(NativeEvent::Failed(error));
            }
        }
    }

    pub fn is_shown(&self) -> bool {
        self.native.as_ref().is_some_and(NativeWebView::is_visible)
    }

    /// Shows the whole page again once nothing covers it.
    pub fn reveal(&mut self) {
        if self.occlusion == Occlusion::Clear {
            return;
        }
        self.occlusion = Occlusion::Clear;
        if self.snapshot.is_some() {
            let _ = self.events.unbounded_send(NativeEvent::Revealed);
        }
    }

    /// Hides the page: its slot is not on screen.
    pub fn hide(&mut self) {
        self.apply(None);
        self.reveal();
        self.snapshot = None;
    }
}

/// The longest a page waits for its picture before it makes room for workbench UI anyway.
const SNAPSHOT_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(150);
/// How long the picture stays under a page that came back, until the native page has drawn.
const SNAPSHOT_LINGER: std::time::Duration = std::time::Duration::from_millis(80);

/// Handles the events about the picture that stands in for a covered page; `false` for others.
pub fn handle_occlusion<T: 'static>(host: &HostRef, event: &NativeEvent, cx: &mut gpui::Context<T>) -> bool {
    match event {
        NativeEvent::CaptureStarted => {
            let host = host.clone();
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(SNAPSHOT_TIMEOUT).await;
                let mut host = host.borrow_mut();
                if host.occlusion == Occlusion::Capturing {
                    host.occlusion = Occlusion::Covered;
                    drop(host);
                    this.update(cx, |_, cx| cx.notify()).ok();
                }
            })
            .detach();
        }
        NativeEvent::Snapshot(bytes) => {
            let mut host = host.borrow_mut();
            if host.occlusion == Occlusion::Capturing {
                host.snapshot = bytes.clone().map(|bytes| Arc::new(gpui::Image::from_bytes(gpui::ImageFormat::Jpeg, bytes)));
                host.occlusion = Occlusion::Covered;
                drop(host);
                cx.notify();
            }
        }
        NativeEvent::Revealed => {
            let host = host.clone();
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(SNAPSHOT_LINGER).await;
                let mut host = host.borrow_mut();
                if host.occlusion == Occlusion::Clear && host.snapshot.take().is_some() {
                    drop(host);
                    this.update(cx, |_, cx| cx.notify()).ok();
                }
            })
            .detach();
        }
        _ => return false,
    }
    true
}
