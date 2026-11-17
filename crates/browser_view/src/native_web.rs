//! Pages in the web build: an `<iframe>` laid over the workbench's canvas where the slot lands, as
//! the old web workbench showed HTML previews. Previews load from the workspace server
//! ([`set_preview_address`]), which serves them sandboxed; web pages load as the site allows
//! framing. A frame cannot be cut around workbench UI or pictured, so it hides while UI covers it.

use std::{
    path::Path,
    sync::{Arc, OnceLock},
};

use futures::channel::mpsc::UnboundedSender;
use gpui::Window;
use wasm_bindgen::JsCast as _;
use web_sys::HtmlIFrameElement;

use crate::host::{Content, CreateOptions, NativeEvent, NavigationAction};
use crate::layout::Rect;

/// The address a project file's preview loads from.
pub type PreviewAddress = Arc<dyn Fn(&Path) -> Option<String> + Send + Sync>;

static PREVIEW_ADDRESS: OnceLock<PreviewAddress> = OnceLock::new();

/// Serves HTML previews from `address`, the workspace server's preview path of a file.
pub fn set_preview_address(address: PreviewAddress) {
    let _ = PREVIEW_ADDRESS.set(address);
}

/// The address `file`'s preview loads from on the web.
pub fn preview_address(file: &Path) -> Option<String> {
    PREVIEW_ADDRESS.get().and_then(|address| address(file))
}

pub enum NativeWebView {
    Frame { frame: HtmlIFrameElement, visible: bool, events: UnboundedSender<NativeEvent> },
}

fn style(frame: &HtmlIFrameElement, property: &str, value: &str) {
    let _ = frame.style().set_property(property, value);
}

impl NativeWebView {
    pub fn create(_: &Window, options: CreateOptions) -> Result<Option<Self>, String> {
        let document = web_sys::window().and_then(|window| window.document()).ok_or("The page has no document.")?;
        let body = document.body().ok_or("The page has no body.")?;
        let frame: HtmlIFrameElement = document.create_element("iframe").map_err(|error| format!("{error:?}"))?.dyn_into().map_err(|_| "Not a frame.".to_string())?;
        let address = match &options.content {
            Content::Url(url) => url.clone(),
            Content::Preview { url, .. } => url.clone(),
        };
        if matches!(options.content, Content::Preview { .. }) {
            let _ = frame.set_attribute("sandbox", "allow-scripts allow-forms allow-popups allow-modals");
        }
        frame.set_src(&address);
        for (property, value) in [("position", "fixed"), ("border", "0"), ("background", "white"), ("z-index", "1")] {
            style(&frame, property, value);
        }
        style(&frame, "border-radius", &format!("{}px", options.corner_radius));
        let _ = body.append_child(&frame);
        let mut view = NativeWebView::Frame { frame, visible: false, events: options.events };
        view.set_layout(Some((options.bounds, Vec::new())))?;
        view.set_zoom(options.zoom)?;
        Ok(Some(view))
    }

    pub fn is_visible(&self) -> bool {
        let NativeWebView::Frame { visible, .. } = self;
        *visible
    }

    pub fn set_layout(&mut self, layout: Option<(Rect, Vec<Rect>)>) -> Result<(), String> {
        let NativeWebView::Frame { frame, visible, .. } = self;
        match layout {
            Some((bounds, holes)) if holes.is_empty() => {
                style(frame, "left", &format!("{}px", bounds.x));
                style(frame, "top", &format!("{}px", bounds.y));
                style(frame, "width", &format!("{}px", bounds.width.max(1.0)));
                style(frame, "height", &format!("{}px", bounds.height.max(1.0)));
                style(frame, "display", "block");
                *visible = true;
            }
            _ => {
                style(frame, "display", "none");
                *visible = false;
            }
        }
        Ok(())
    }

    pub fn navigate(&self, url: &str) -> Result<(), String> {
        let NativeWebView::Frame { frame, events, .. } = self;
        frame.set_src(url);
        let _ = events.unbounded_send(NativeEvent::Location { can_go_back: None, can_go_forward: None });
        Ok(())
    }

    pub fn perform(&self, action: NavigationAction) -> Result<(), String> {
        let NativeWebView::Frame { frame, .. } = self;
        match action {
            NavigationAction::Reload => frame.set_src(&frame.src()),
            NavigationAction::Stop => frame.set_src("about:blank"),
            NavigationAction::Back | NavigationAction::Forward => {
                let history = frame.content_window().map(|window| window.history());
                if let Some(Ok(history)) = history {
                    let _ = if action == NavigationAction::Back { history.back() } else { history.forward() };
                }
            }
        }
        Ok(())
    }

    pub fn set_zoom(&self, zoom: f64) -> Result<(), String> {
        let NativeWebView::Frame { frame, .. } = self;
        style(frame, "zoom", &zoom.to_string());
        Ok(())
    }

    pub fn focus(&self) {
        let NativeWebView::Frame { frame, .. } = self;
        let _ = frame.focus();
    }

    pub fn focus_parent(&self) {
        let NativeWebView::Frame { frame, .. } = self;
        let _ = frame.blur();
    }

    pub fn url(&self) -> Option<String> {
        let NativeWebView::Frame { frame, .. } = self;
        Some(frame.src()).filter(|src| !src.is_empty())
    }

    pub fn open_devtools(&self) -> Result<(), String> {
        Err("Open the browser's developer tools to inspect this page.".into())
    }

    pub fn clear_data(&self) -> Result<(), String> {
        Ok(())
    }

    pub fn capture_snapshot(&self, events: UnboundedSender<NativeEvent>) {
        let _ = events.unbounded_send(NativeEvent::Snapshot(None));
    }
}

impl Drop for NativeWebView {
    fn drop(&mut self) {
        let NativeWebView::Frame { frame, .. } = self;
        frame.remove();
    }
}

pub fn capabilities() -> athas_browser::BrowserCapabilities {
    athas_browser::BrowserCapabilities { holes: false, snapshots: false }
}
