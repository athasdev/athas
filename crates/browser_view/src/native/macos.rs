use std::cell::RefCell;

use wry::{WebView, WebViewExtMacOS};

/// The running macOS major version, `0` when it can't be read.
pub fn major_version() -> u64 {
    let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    version.majorVersion.max(0) as u64
}

/// Rounds the corners of a page so it sits inside the slot's rounded frame.
pub fn round_corners(webview: &WebView, radius: f64) {
    use objc2::{msg_send, runtime::AnyObject};

    let view = webview.webview();
    let view = objc2::rc::Retained::as_ptr(&view) as *mut AnyObject;
    // SAFETY: `view` is the live WKWebView that `webview` owns, and this runs on the main thread.
    unsafe {
        let view = &*view;
        let _: () = msg_send![view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![view, layer];
        let Some(layer) = layer.as_ref() else { return };
        let _: () = msg_send![layer, setCornerRadius: radius];
        let _: () = msg_send![layer, setMasksToBounds: true];
    }
}

/// Lifts WebKit's 60 FPS cap on a page so it follows the display's refresh rate on 120 Hz
/// ProMotion displays, like Safari does: turns off the private
/// `PreferPageRenderingUpdatesNear60FPSEnabled` feature. Does nothing when this WebKit lacks the
/// private API.
///
/// Ported from Athas's `src-tauri/src/refresh_rate.rs`.
pub fn unlock_refresh_rate(webview: &WebView) {
    use std::ffi::{CStr, c_char};

    use objc2::{class, msg_send, runtime::{AnyObject, Bool}, sel};

    const FEATURE: &CStr = c"PreferPageRenderingUpdatesNear60FPSEnabled";

    let view = webview.webview();
    let view = objc2::rc::Retained::as_ptr(&view) as *mut AnyObject;
    // SAFETY: `view` is the live WKWebView that `webview` owns, and this runs on the main thread.
    // Every private selector is checked with `respondsToSelector:` or comes from WebKit's own
    // feature list.
    unsafe {
        let view = &*view;
        let configuration: *mut AnyObject = msg_send![view, configuration];
        let Some(configuration) = configuration.as_ref() else { return };
        let preferences: *mut AnyObject = msg_send![configuration, preferences];
        let Some(preferences) = preferences.as_ref() else { return };
        let supported: Bool = msg_send![preferences, respondsToSelector: sel!(_setEnabled:forFeature:)];
        if !supported.as_bool() {
            return;
        }
        let class = class!(WKPreferences);
        let lists_features: Bool = msg_send![class, respondsToSelector: sel!(_features)];
        if !lists_features.as_bool() {
            return;
        }
        let features: *mut AnyObject = msg_send![class, _features];
        let Some(features) = features.as_ref() else { return };
        let count: usize = msg_send![features, count];
        for index in 0..count {
            let feature: *mut AnyObject = msg_send![features, objectAtIndex: index];
            let Some(feature) = feature.as_ref() else { continue };
            let key: *mut AnyObject = msg_send![feature, key];
            let Some(key) = key.as_ref() else { continue };
            let name: *const c_char = msg_send![key, UTF8String];
            if !name.is_null() && CStr::from_ptr(name) == FEATURE {
                let _: () = msg_send![preferences, _setEnabled: Bool::NO, forFeature: feature];
                return;
            }
        }
    }
}

/// Captures what a page shows right now as a JPEG and hands it to `done`, or `None` when the
/// capture fails.
pub fn capture_snapshot(webview: &WebView, done: impl FnOnce(Option<Vec<u8>>) + 'static) {
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKSnapshotConfiguration;

    let done = RefCell::new(Some(done));
    let handler = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
        // SAFETY: WebKit passes a valid image or null.
        let bytes = unsafe { image.as_ref() }.and_then(|image| {
            let tiff = image.TIFFRepresentation()?;
            let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)?;
            let properties = NSDictionary::<NSBitmapImageRepPropertyKey, objc2::runtime::AnyObject>::new();
            // SAFETY: an empty property dictionary is valid for every file type.
            let jpeg = unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::JPEG, &properties) }?;
            Some(jpeg.to_vec())
        });
        if let Some(done) = done.borrow_mut().take() {
            done(bytes);
        }
    });

    let Some(main_thread) = objc2::MainThreadMarker::new() else { return };
    let view = webview.webview();
    // SAFETY: this runs on the main thread with the live WKWebView `webview` owns. Capturing the
    // last rendered frame avoids waiting for a new one.
    unsafe {
        let configuration = WKSnapshotConfiguration::new(main_thread);
        configuration.setAfterScreenUpdates(false);
        view.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &handler);
    }
}
