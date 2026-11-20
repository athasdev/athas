//! Builds without native pages (Linux, the web, or the `webview` feature off): pages are never
//! made, and the tab shows its placeholder.

use futures::channel::mpsc::UnboundedSender;
use gpui::Window;

use crate::host::{CreateOptions, NativeEvent, NavigationAction};
use crate::layout::Rect;

pub enum NativeWebView {}

impl NativeWebView {
    pub fn create(_: &Window, _: CreateOptions) -> Result<Option<Self>, String> {
        Ok(None)
    }

    pub fn is_visible(&self) -> bool {
        match *self {}
    }

    pub fn set_layout(&mut self, _: Option<(Rect, Vec<Rect>)>) -> Result<(), String> {
        match *self {}
    }

    pub fn navigate(&self, _: &str) -> Result<(), String> {
        match *self {}
    }

    pub fn perform(&self, _: NavigationAction) -> Result<(), String> {
        match *self {}
    }

    pub fn set_zoom(&self, _: f64) -> Result<(), String> {
        match *self {}
    }

    pub fn focus(&self) {
        match *self {}
    }

    pub fn focus_parent(&self) {
        match *self {}
    }

    pub fn url(&self) -> Option<String> {
        match *self {}
    }

    pub fn open_devtools(&self) -> Result<(), String> {
        match *self {}
    }

    pub fn clear_data(&self) -> Result<(), String> {
        match *self {}
    }

    pub fn capture_snapshot(&self, _: UnboundedSender<NativeEvent>) {
        match *self {}
    }
}

pub fn capabilities() -> athas_browser::BrowserCapabilities {
    athas_browser::BrowserCapabilities { holes: false, snapshots: false }
}
