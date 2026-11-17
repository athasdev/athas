//! Cuts holes in a page where workbench UI covers it. The page's host window gets a region
//! without the holes, which also sends the pointer there to the workbench window underneath.

use windows::Win32::{
    Foundation::HWND,
    Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, RGN_DIFF, SetWindowRgn},
    UI::HiDpi::GetDpiForWindow,
};
use wry::{WebView, WebViewExtWindows};

use crate::layout::Rect;

/// Far beyond any page, so the region keeps everything outside the holes.
const REGION_EXTENT: i32 = 1 << 20;

pub fn apply_holes(webview: &WebView, holes: &[Rect]) -> Result<(), String> {
    let controller = webview.controller();
    let mut window = HWND::default();
    // SAFETY: the controller is live while `webview` is; this runs on the main thread.
    unsafe { controller.ParentWindow(&mut window) }.map_err(|error| format!("Failed to find the page window: {error}"))?;
    // SAFETY: `window` is the page's host window. A region handed to `SetWindowRgn` belongs to
    // the system; every other region is deleted.
    unsafe {
        if holes.is_empty() {
            SetWindowRgn(window, None, true);
            return Ok(());
        }
        let dpi = GetDpiForWindow(window);
        let scale = if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 };
        let region = CreateRectRgn(0, 0, REGION_EXTENT, REGION_EXTENT);
        for hole in holes {
            let cut = CreateRectRgn(
                (hole.x * scale).floor() as i32,
                (hole.y * scale).floor() as i32,
                ((hole.x + hole.width) * scale).ceil() as i32,
                ((hole.y + hole.height) * scale).ceil() as i32,
            );
            let _ = CombineRgn(Some(region), Some(region), Some(cut), RGN_DIFF);
            let _ = DeleteObject(cut.into());
        }
        if SetWindowRgn(window, Some(region), true) == 0 {
            let _ = DeleteObject(region.into());
        }
    }
    Ok(())
}
